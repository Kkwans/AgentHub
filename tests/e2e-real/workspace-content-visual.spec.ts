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
async function assertComposerLabels(page: Page, width: number) {
  const prompt = page.getByRole('button', { name: /^PromptOS / });
  const terminal = page.getByRole('button', { name: /^打开 Terminal/ });
  await expect(prompt).toBeVisible();
  await expect(terminal).toBeVisible();
  await expect(terminal.locator('.terminal-launcher-label')).toHaveText('Terminal');
  await expect(prompt).toHaveAttribute('title', (await prompt.getAttribute('aria-label'))!);
  const labels = [terminal.locator('.terminal-launcher-label')];
  if (width < 640) {
    const short = prompt.locator('.composer-context-mobile-label');
    await expect(short).toHaveText('提示');
    await expect(short).toBeVisible();
    labels.push(short);
    for (const control of [prompt, terminal]) {
      const box = await control.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  }
  for (const label of labels) {
    // Intersect every clipping ancestor, not just the label's own clientWidth.
    const visible = await label.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      let left = 0,
        right = innerWidth;
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) {
          const bounds = ancestor.getBoundingClientRect();
          left = Math.max(left, bounds.left);
          right = Math.min(right, bounds.right);
        }
      }
      return (
        rect.left >= left - 1 && rect.right <= right + 1 && node.scrollWidth <= node.clientWidth + 1
      );
    });
    expect(visible).toBe(true);
  }
  const controls = await Promise.all(
    [prompt, terminal, page.locator('.composer-toolbar-end')].map((node) => node.boundingBox()),
  );
  for (let i = 0; i < controls.length; i++)
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i]!,
        b = controls[j]!;
      expect(
        a.x + a.width <= b.x + 1 ||
          b.x + b.width <= a.x + 1 ||
          a.y + a.height <= b.y + 1 ||
          b.y + b.height <= a.y + 1,
      ).toBe(true);
    }
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
      const compactInput = (await composer.boundingBox())!;
      expect(compactInput.height).toBeGreaterThanOrEqual(43.99);
      expect(compactInput.height).toBeLessThanOrEqual(48);
      await composer.fill('检查取消状态');
      expect(
        await composer.evaluate((node) => node.scrollHeight - node.clientHeight),
      ).toBeLessThanOrEqual(1);
      const compactCard = (await page.locator('.chat-command-card').boundingBox())!;
      expect(compactCard.height).toBeLessThanOrEqual(110);
      await composer.fill(
        Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 行：保留长文与手动调整。`).join('\n'),
      );
      expect(
        await composer.evaluate((node) => node.scrollHeight - node.clientHeight),
      ).toBeGreaterThan(100);
      expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(48);
      await composer.press('ControlOrMeta+End');
      await expect.poll(() => composer.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      const resize = page.getByRole('separator', { name: '调整输入框高度', exact: true });
      const handle = (await resize.boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 80);
      await page.mouse.up();
      expect((await composer.boundingBox())!.height).toBeGreaterThanOrEqual(
        compactInput.height + 79,
      );
      const grown = (await resize.boundingBox())!;
      await page.mouse.move(grown.x + grown.width / 2, grown.y + grown.height / 2);
      await page.mouse.down();
      await page.mouse.move(grown.x + grown.width / 2, grown.y + grown.height / 2 + 80);
      await page.mouse.up();
      expect((await composer.boundingBox())!.height).toBeLessThanOrEqual(48);
      await info.attach('composer-compact-geometry', {
        body: JSON.stringify({ compactInput, compactCard }),
        contentType: 'application/json',
      });
      await composer.fill('检查取消状态');
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
      expect(inputGeometry.paddingTop).toBe(10);
      expect(inputGeometry.scrollTop).toBeLessThanOrEqual(1);
      expect(inputGeometry.clientHeight).toBeGreaterThanOrEqual(
        inputGeometry.lineHeight + inputGeometry.paddingTop + inputGeometry.paddingBottom - 1,
      );
      await assertComposerLabels(page, width);
      const focusedCard = page.locator('.chat-command-card');
      await expect(focusedCard).toHaveCSS('outline-style', 'solid');
      await expect(focusedCard).toHaveCSS('outline-width', '2px');
      await expect(focusedCard).toHaveCSS('outline-offset', '-1px');
      await expect(focusedCard).toHaveCSS('box-shadow', 'none');
      await expect(composer).toHaveCSS('outline-style', 'none');
      const focusContrast = await focusedCard.evaluate((node) => {
        // Canvas resolves computed modern color(srgb)/color-mix as well as rgb.
        // This measures solid computed surfaces, not a claim of whole-page WCAG conformance.
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        const rgba = (color: string) => {
          if (!CSS.supports('color', color)) throw new Error('Unparseable computed focus color');
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data).map((value) => value / 255);
        };
        const over = (foreground: number[], background: number[]) => {
          const alpha = foreground[3]!;
          return [0, 1, 2]
            .map((index) => foreground[index]! * alpha + background[index]! * (1 - alpha))
            .concat(1);
        };
        const surface = (element: Element | null) => {
          const layers: number[][] = [];
          for (let current = element; current; current = current.parentElement) {
            const css = getComputedStyle(current);
            if (css.backgroundImage !== 'none')
              throw new Error('Focus contrast requires a solid surface');
            const layer = rgba(css.backgroundColor);
            layers.unshift(layer);
            if (layer[3] === 1) break;
          }
          return layers.reduce((background, layer) => over(layer, background), [1, 1, 1, 1]);
        };
        const luminance = (color: number[]) =>
          color
            .slice(0, 3)
            .reduce(
              (total, value, index) =>
                total +
                (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
                  [0.2126, 0.7152, 0.0722][index]!,
              0,
            );
        const outlineColor = getComputedStyle(node).outlineColor;
        const outline = rgba(outlineColor);
        const inside = surface(node);
        const outside = surface(node.parentElement);
        const ratios = [inside, outside].map((background) => {
          const a = luminance(over(outline, background)),
            b = luminance(background);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
        return { outlineColor, outline, inside, outside, ratios };
      });
      expect(focusContrast.outline[3]).toBe(1);
      for (const ratio of focusContrast.ratios) expect(ratio).toBeGreaterThanOrEqual(3);
      await info.attach('composer-focus-contrast', {
        body: JSON.stringify(focusContrast),
        contentType: 'application/json',
      });
      await capture(page, info, 'composer-focused', composer, focusedCard);
      await composer.fill('请修改隔离测试项目的 Fixture 文件，等待批准，再汇报结果。');
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
      await expect
        .poll(
          async () =>
            (await apiData<{ status: string }>(context, 'get', `/sessions/${session.id}`)).status,
          { timeout: 30_000 },
        )
        .toBe('READY');
      await expect
        .poll(
          async () =>
            (
              await apiData<Array<{ status: string }>>(
                context,
                'get',
                `/sessions/${session.id}/runs`,
              )
            ).map((run) => run.status),
          { timeout: 30_000 },
        )
        .toEqual(['COMPLETED']);
      await expect(composer).toBeEnabled();
      await assertComposerLabels(page, width);
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
        diffRegion.getByRole('group', { name: '文件 Diff 显示选项' }),
        diffRegion,
      );
      await showInspector(page, width, 'changes');
      await page.getByRole('button', { name: '展开文件清单', exact: true }).click();
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
      await expect(receipt).toContainText('提交命令已完成；观测 HEAD：', { timeout: 30_000 });
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
