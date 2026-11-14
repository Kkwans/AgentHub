import { execFile as execFileCallback } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Page, TestInfo } from '@playwright/test';
import { apiData } from './baseline-support.js';
import { test, expect, initializeGitProject } from './fixtures.js';

const execFile = promisify(execFileCallback);
type Id = { id: string };
test.use({ authMode: 'local_trusted' });
test.setTimeout(180_000);

async function capture(page: Page, info: TestInfo, name: string) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  const geometry = await page.locator('.conversation-scroll').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      };
    }),
  );
  await info.attach(`${name}-geometry`, {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

async function showChanges(page: Page, width: number) {
  if (width < 768) {
    await page
      .getByRole('tablist', { name: 'Workspace 视图' })
      .getByRole('tab', { name: 'Git', exact: true })
      .click();
    return;
  }
  if (width < 1180) {
    const open = page.getByRole('button', { name: '打开辅助栏', exact: true });
    if (await open.isVisible()) await open.click();
    await page
      .getByRole('tablist', { name: '辅助栏视图' })
      .getByRole('tab', { name: '检查器', exact: true })
      .click();
  }
  await page
    .getByRole('tablist', { name: '检查器视图' })
    .getByRole('tab', { name: '变更', exact: true })
    .click();
}

for (const width of [390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`参考构图：合成中文对话与实际 Git 差异 ${width} ${theme}`, async ({
      page,
      context,
      app,
    }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await initializeGitProject(app.projectRoot);
      // This repository belongs exclusively to this disposable real-service fixture.
      const git = (args: string[]) =>
        execFile('/usr/bin/git', ['-C', app.projectRoot, ...args], {
          env: {
            PATH: '/usr/bin:/bin',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_TERMINAL_PROMPT: '0',
          },
        });
      await writeFile(
        join(app.projectRoot, 'runner.ts'),
        'export function runStep() {\n  return "continue";\n}\n',
      );
      await writeFile(
        join(app.projectRoot, 'task.ts'),
        'export const cancellationPolicy = "none";\n',
      );
      await writeFile(
        join(app.projectRoot, 'cancel.test.ts'),
        '// Synthetic example only.\nexport const expectedAfterCancel = "continue";\n',
      );
      await git(['add', '--', 'runner.ts', 'task.ts', 'cancel.test.ts']);
      await git(['commit', '-m', 'test: seed disposable cancellation example']);
      const target = await apiData<Id>(context, 'post', '/execution-targets', {
        name: '演示主机',
        kind: 'LOCAL_HOST',
        hostname: '127.0.0.1',
        os: process.platform,
        arch: process.arch,
      });
      const project = await apiData<Id>(context, 'post', '/projects', {
        name: 'AgentHub 演示项目',
        targetId: target.id,
        rootPath: app.projectRoot,
        kind: 'TEST',
      });
      const agent = await apiData<Id>(context, 'post', '/agents', {
        name: '合成演示适配器',
        targetId: target.id,
        agentKind: 'CUSTOM_ACP',
        executable: process.execPath,
        args: [
          new URL('../fixtures/acp/fake-agent.mjs', import.meta.url).pathname,
          '--reference-visual',
        ],
      });
      expect(
        (
          await apiData<{ status: string }>(context, 'post', `/agents/${agent.id}/preflight`, {
            cwd: app.projectRoot,
            smokeSession: false,
          })
        ).status,
      ).toBe('READY');
      const session = await apiData<Id>(context, 'post', '/sessions', {
        projectId: project.id,
        agentId: agent.id,
        title: '修复任务取消状态 · 合成演示',
        cwd: app.projectRoot,
        branch: 'main',
      });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      await page.goto(`/workspace/${session.id}`);
      const composer = page.getByRole('textbox', { name: '给 Agent 发送工程指令', exact: true });
      await expect(composer).toBeEnabled({ timeout: 30_000 });
      await composer.fill('合成演示数据，非真实 Agent 执行：展示取消任务后的中断检查。');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect
        .poll(
          async () =>
            (
              await apiData<{ status: string }[]>(context, 'get', `/sessions/${session.id}/runs`)
            ).map((run) => run.status),
          { timeout: 30_000 },
        )
        .toEqual(['COMPLETED']);
      await expect
        .poll(
          async () =>
            (await apiData<{ status: string }>(context, 'get', `/sessions/${session.id}`)).status,
          { timeout: 30_000 },
        )
        .toBe('READY');
      await expect(composer).toBeEnabled();
      // Plans share the card surface, but are not tool executions. Count only
      // the renderer's actual tool-event rows and verify every exact title.
      const tools = page.locator('.tool-event-row .tool-entry-card');
      await expect(tools).toHaveCount(4);
      await expect(page.locator('.plan-event-row')).toHaveCount(1);
      for (const label of ['读取代码', '编辑文件', '测试结果（合成）', '静态检查（合成）']) {
        const heading = tools
          .locator('.tool-entry-badge')
          .filter({ hasText: new RegExp(`^${label}$`) });
        await expect(heading).toHaveCount(1);
        await expect(heading).toHaveText(label);
      }
      await expect(page.locator('.thinking-event-row')).toHaveCount(0);
      await expect(
        page.getByText('合成演示数据，非真实 Agent 执行。', { exact: true }),
      ).toBeVisible();
      const messages = await apiData<{ role: string; text: string }[]>(
        context,
        'get',
        `/sessions/${session.id}/messages?limit=100`,
      );
      expect(
        messages.some(
          (message) => message.role === 'ASSISTANT' && message.text.includes('具体计划'),
        ),
      ).toBe(true);
      const diff = await apiData<{ patch: string }>(
        context,
        'get',
        `/projects/${project.id}/git/diff`,
      );
      expect(diff.patch).toContain('+  if (cancelled) return "stopped";');
      for (const file of ['runner.ts', 'task.ts', 'cancel.test.ts'])
        expect(diff.patch).toContain(file);
      await composer.fill('继续检查取消后的状态传播。');
      // Capture the real conversation separately before opening narrow-screen review.
      await capture(page, info, `reference-conversation-${theme}-${width}`);
      await showChanges(page, width);
      await page.getByRole('button', { name: '查看 runner.ts Diff', exact: true }).click();
      const review = page.getByRole('region', { name: '已选择 runner.ts 的 Diff', exact: true });
      await expect(review).toBeVisible({ timeout: 30_000 });
      await expect(review.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
      await expect(review).toContainText('cancelled');
      await capture(page, info, `reference-review-${theme}-${width}`);
      expect(errors).toEqual([]);
      expect((await apiData<Id[]>(context, 'get', `/sessions/${session.id}/runs`)).length).toBe(1);
    });
  }
}
