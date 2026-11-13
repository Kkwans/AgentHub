import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { apiData } from './baseline-support.js';
import { initializeGitProject, test, expect } from './fixtures.js';

const execFile = promisify(execFileCallback);
type Identified = { id: string };
test.use({ authMode: 'local_trusted' });
test.setTimeout(180_000);

async function capture(
  page: Page,
  info: TestInfo,
  state: string,
  anchor: Locator,
  region: Locator,
) {
  await anchor.scrollIntoViewIfNeeded();
  await expect(anchor).toBeInViewport({ ratio: 1 });
  await expect(region).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  const geometry = await region.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
    };
  });
  // Do not call a viewport capture a capture of all internal scroll content.
  await info.attach(`${state}-visible-region`, {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  const path = info.outputPath(`workspace-${state}.png`);
  await page.screenshot({ path });
  await info.attach(state, { path, contentType: 'image/png' });
  const regionPath = info.outputPath(`workspace-${state}-region.png`);
  await region.screenshot({ path: regionPath });
  await info.attach(`${state}-region`, { path: regionPath, contentType: 'image/png' });
}
async function showInspector(page: Page, width: number, tab: 'files' | 'changes') {
  if (width < 768 && !(await page.getByRole('tablist', { name: '检查器视图' }).isVisible())) {
    await page
      .getByRole('tablist', { name: 'Workspace 视图' })
      .getByRole('tab', { name: tab === 'files' ? '文件' : 'Git', exact: true })
      .click();
    return;
  }
  if (width >= 768 && width < 1180) {
    const open = page.getByRole('button', { name: '打开辅助栏', exact: true });
    if (await open.isVisible()) await open.click();
    await page
      .getByRole('tablist', { name: '辅助栏视图' })
      .getByRole('tab', { name: '检查器', exact: true })
      .click();
  }
  await page
    .getByRole('tablist', { name: '检查器视图' })
    .getByRole('tab', { name: tab === 'files' ? '文件' : '变更', exact: true })
    .click();
}
for (const width of [390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`真实 Workspace 内容 文件 Git ${width} ${theme}`, async ({ page, context, app }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await initializeGitProject(app.projectRoot);
      const target = await apiData<Identified>(context, 'post', '/execution-targets', {
        name: 'Workspace 视觉验收主机',
        kind: 'LOCAL_HOST',
        hostname: '127.0.0.1',
        os: process.platform,
        arch: process.arch,
      });
      const project = await apiData<Identified>(context, 'post', '/projects', {
        name: '真实内容与文件变更验收项目',
        targetId: target.id,
        rootPath: app.projectRoot,
        kind: 'TEST',
      });
      const agent = await apiData<Identified>(context, 'post', '/agents', {
        name: '本地 ACP 协议验收工具',
        targetId: target.id,
        agentKind: 'CUSTOM_ACP',
        executable: process.execPath,
        args: [
          new URL('../fixtures/acp/fake-agent.mjs', import.meta.url).pathname,
          '--write-fixture',
        ],
      });
      expect(
        (
          await apiData<{ status: string }>(context, 'post', `/agents/${agent.id}/preflight`, {
            cwd: app.projectRoot,
          })
        ).status,
      ).toBe('READY');
      const session = await apiData<Identified>(context, 'post', '/sessions', {
        projectId: project.id,
        agentId: agent.id,
        title: '真实文件变更与 Git 提交验证会话',
        cwd: app.projectRoot,
        branch: 'main',
      });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      await page.goto(`/workspace/${session.id}`);
      const composer = page.getByRole('textbox', { name: '给 Agent 发送工程指令', exact: true });
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill('请修改隔离测试项目的 Fixture 文件，等待批准，再汇报结果。');
      // Capture the enabled input before sending: completion can still leave
      // the run settling, which is not evidence of keyboard-focus treatment.
      await expect(composer).toBeFocused();
      await expect(composer).toBeEnabled();
      const inputGeometry = await composer.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          scrollTop: node.scrollTop,
          clientHeight: node.clientHeight,
          lineHeight: parseFloat(style.lineHeight),
          paddingTop: parseFloat(style.paddingTop),
          paddingBottom: parseFloat(style.paddingBottom),
        };
      });
      expect(inputGeometry.paddingTop).toBeGreaterThanOrEqual(12);
      expect(inputGeometry.scrollTop).toBeLessThanOrEqual(1);
      expect(inputGeometry.clientHeight).toBeGreaterThanOrEqual(
        inputGeometry.lineHeight * 2 + inputGeometry.paddingTop + inputGeometry.paddingBottom - 1,
      );
      await capture(page, info, 'composer-focused', composer, page.locator('.chat-command-card'));
      await page.getByRole('button', { name: '发送', exact: true }).click();
      const approve = page.getByRole('button', { name: '允许一次', exact: true });
      await expect(approve).toBeVisible({ timeout: 30_000 });
      await capture(page, info, 'approval', approve, page.locator('.approval-card'));
      const requestedApprovals = await apiData<Array<{ id: string; status: string }>>(
        context,
        'get',
        '/approvals?sessionId=' + session.id,
      );
      const requestedApproval = requestedApprovals.find(
        (approval) => approval.status === 'PENDING',
      );
      expect(requestedApproval).toBeDefined();
      await approve.click();
      await expect
        .poll(
          async () =>
            (
              await apiData<{ deliveryState: string }>(
                context,
                'get',
                '/approvals/' + requestedApproval!.id,
              )
            ).deliveryState,
        )
        .toBe('DELIVERED');
      await expect(page.getByText('决定已保存，Agent 已确认接收。', { exact: true })).toBeVisible();
      await expect(
        page.getByText('决定已安全保存，正在确认 Agent 接收状态。', { exact: true }),
      ).toHaveCount(0);

      const completed = page.getByText('Fixture 已完成', { exact: true });
      await expect(completed).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.tool-event-row')).toHaveCount(1);
      await capture(
        page,
        info,
        'conversation',
        completed,
        page.getByRole('region', { name: 'Agent 对话' }),
      );
      const body = await readFile(join(app.projectRoot, 'fixture-output.md'), 'utf8');
      expect(body).toContain('Approval 已确认');
      // Intent-to-add produces a real reviewable diff for the new fixture file.
      await execFile('/usr/bin/git', [
        '-C',
        app.projectRoot,
        'add',
        '-N',
        '--',
        'fixture-output.md',
      ]);
      const diff = await apiData<{ patch: string }>(
        context,
        'get',
        `/projects/${project.id}/git/diff`,
      );
      expect(diff.patch).toContain('Approval 已确认');
      await showInspector(page, width, 'files');
      await page.getByRole('button', { name: 'fixture-output.md', exact: true }).click();
      await expect(page.locator('.file-preview-header')).toContainText('fixture-output.md');
      await expect(page.locator('.file-preview-editor .monaco-editor')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator('.file-preview-editor .view-lines')).toContainText('Approval');
      await capture(
        page,
        info,
        'file',
        page.locator('.file-preview-header'),
        page.locator('.file-preview-editor'),
      );
      await showInspector(page, width, 'changes');
      const preview = page.getByRole('button', {
        name: '查看 fixture-output.md Diff',
        exact: true,
      });
      await expect(preview).toBeVisible({ timeout: 15_000 });
      await preview.click();
      const diffRegion = page.getByRole('region', {
        name: '已选择 fixture-output.md 的 Diff',
        exact: true,
      });
      await expect(diffRegion).toBeVisible({ timeout: 30_000 });
      await capture(
        page,
        info,
        'diff',
        diffRegion.getByText('文件 Diff', { exact: true }),
        diffRegion,
      );
      await showInspector(page, width, 'changes');
      await page
        .getByRole('tree', { name: 'Git 文件变更树' })
        .getByRole('checkbox', { name: '选择 fixture-output.md', exact: true })
        .check();
      const form = page.locator('form.git-commit-form');
      await form.getByLabel('提交说明').fill('test: 真实 Workspace 视觉验收');
      const commit = form.getByRole('button', { name: '提交所选文件 (1)', exact: true });
      await commit.scrollIntoViewIfNeeded();
      await expect(commit).toBeInViewport({ ratio: 1 });
      const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/projects/${project.id}/git/commit`),
      );
      await commit.click();
      const response = await responsePromise;
      expect(response.ok(), await response.text()).toBe(true);
      const receipt = page.locator('.git-commit-receipt');
      await expect(receipt).toContainText('提交完成', { timeout: 30_000 });
      await capture(page, info, 'commit-receipt', receipt, receipt);
      const committed = await execFile('/usr/bin/git', [
        '-C',
        app.projectRoot,
        'show',
        '--format=%s',
        '--name-only',
        'HEAD',
      ]);
      expect(committed.stdout).toContain('test: 真实 Workspace 视觉验收');
      expect(committed.stdout).toContain('fixture-output.md');
      const status = await execFile('/usr/bin/git', [
        '-C',
        app.projectRoot,
        'status',
        '--porcelain',
      ]);
      expect(status.stdout.trim()).toBe('');
      expect(errors).toEqual([]);
    });
  }
}
