import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { apiData } from './baseline-support.js';
import { test, expect, initializeGitProject } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(180_000);
type Id = { id: string };
async function marker(root: string, stage: string) {
  await expect
    .poll(
      async () => {
        try {
          await access(join(root, `.agenthub-process-${stage}-ready`));
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}
async function release(root: string, stage: string) {
  await writeFile(join(root, `.agenthub-process-${stage}-release`), 'fixture', 'utf8');
}
async function capture(page: Page, info: TestInfo, name: string, region: Locator) {
  await region.scrollIntoViewIfNeeded();
  await expect(region).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  const box = await region.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await info.attach(`${name}-geometry`, {
    body: JSON.stringify(box),
    contentType: 'application/json',
  });
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}
for (const width of [390, 768, 1024, 1440])
  for (const theme of ['light', 'dark'] as const) {
    test(`公开合成 Fixture 过程展示 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await initializeGitProject(app.projectRoot);
      const target = await apiData<Id>(context, 'post', '/execution-targets', {
        name: 'Fixture 过程验收主机',
        kind: 'LOCAL_HOST',
        hostname: '127.0.0.1',
        os: process.platform,
        arch: process.arch,
      });
      const project = await apiData<Id>(context, 'post', '/projects', {
        name: 'Fixture 合成过程验收',
        targetId: target.id,
        rootPath: app.projectRoot,
        kind: 'TEST',
      });
      const agent = await apiData<Id>(context, 'post', '/agents', {
        name: '公开合成 ACP Fixture',
        targetId: target.id,
        agentKind: 'CUSTOM_ACP',
        executable: process.execPath,
        args: [
          new URL('../fixtures/acp/fake-agent.mjs', import.meta.url).pathname,
          '--process-visual',
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
        title: '公开合成 Fixture 过程演示',
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
      await expect(composer).toBeEnabled({ timeout: 30_000 });
      await composer.fill('展示公开合成 Fixture 过程，不执行真实工具。');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      try {
        await marker(app.projectRoot, 'thought');
        const thought = page.locator('.thinking-event-row');
        await expect(thought).toContainText('这是合成测试数据，不是模型隐藏推理。');
        const thoughtToggle = thought.getByRole('button');
        await expect(thoughtToggle).toHaveAttribute('aria-expanded', 'true');
        // CSS target is 44px; tolerate subpixel rounding, not a smaller hit target.
        expect((await thoughtToggle.boundingBox())!.height).toBeGreaterThanOrEqual(43.99);
        await capture(page, info, `process-thought-streaming-${theme}-${width}`, thought);
        await thoughtToggle.focus();
        await page.keyboard.press('Enter');
        await expect(thoughtToggle).toHaveAttribute('aria-expanded', 'false');
        await page.keyboard.press('Enter');
        await expect(thoughtToggle).toHaveAttribute('aria-expanded', 'true');
        await release(app.projectRoot, 'thought');
        await marker(app.projectRoot, 'tools');
        const tools = page.locator('.tool-entry-card');
        await expect(tools).toHaveCount(3);
        for (const card of await tools.all()) {
          const title = card.locator('.tool-entry-badge');
          await expect(title).toHaveCSS('font-size', '14px');
          await expect(title).toHaveCSS('font-weight', '600');
          expect(await title.evaluate((node) => getComputedStyle(node).fontFamily)).not.toMatch(
            /mono/i,
          );
          await expect(card).toHaveCSS('border-top-width', '1px');
          await expect(card).toHaveCSS('border-top-style', 'solid');
          expect(await card.evaluate((node) => getComputedStyle(node).borderTopColor)).not.toBe(
            'rgba(0, 0, 0, 0)',
          );
          // Fixture input repeats its title: do not render the same subtitle twice.
          await expect(card.locator('.tool-entry-summary')).toHaveCount(0);
          await expect(card.locator('.tool-entry-separator')).toHaveCount(0);
        }
        await expect(thought.locator('.process-thought-label')).toHaveCSS('font-size', '14px');
        await expect(thought.locator('.process-thought-body')).toHaveCSS('font-size', '14px');
        await expect(thought.locator('.process-thought-body .markdown-body').first()).toHaveCSS(
          'font-size',
          '14px',
        );
        const running = tools.filter({ hasText: 'Fixture 进行中工具' });
        const success = tools.filter({ hasText: 'Fixture 成功工具' });
        const failed = tools.filter({ hasText: 'Fixture 失败工具' });
        await expect(running).toHaveClass(/tool-entry-card--active/);
        await expect(failed).toHaveClass(/tool-entry-card--failed/);
        await expect(failed.locator('.tool-entry-failure-preview')).toContainText(
          'Fixture 预期失败',
        );
        await capture(page, info, `process-tools-running-${theme}-${width}`, running);
        const outputToggle = success.locator('button[aria-expanded]').first();
        expect((await outputToggle.boundingBox())!.height).toBeGreaterThanOrEqual(43.99);
        await expect(outputToggle).toHaveAttribute('aria-expanded', 'false');
        await outputToggle.focus();
        await page.keyboard.press('Enter');
        await expect(outputToggle).toHaveAttribute('aria-expanded', 'true');
        await expect(success).toContainText('Fixture 输出 80');
        expect(
          await success.evaluate((node) =>
            [...node.querySelectorAll('*')].some((child) => {
              const style = getComputedStyle(child);
              return (
                ['auto', 'scroll'].includes(style.overflowY) &&
                child.scrollHeight > child.clientHeight
              );
            }),
          ),
        ).toBe(true);
        await capture(page, info, `process-tool-output-expanded-${theme}-${width}`, success);
        await page.keyboard.press('Enter');
        await expect(outputToggle).toHaveAttribute('aria-expanded', 'false');
        await capture(page, info, `process-tool-failed-${theme}-${width}`, failed);
        await release(app.projectRoot, 'tools');
        await expect
          .poll(
            async () =>
              (await apiData<{ status: string }>(context, 'get', `/sessions/${session.id}`)).status,
            { timeout: 30_000 },
          )
          .toBe('READY');
        await expect(page.getByText('Fixture 过程展示验收完成。', { exact: true })).toBeVisible();
        await expect(running).not.toHaveClass(/tool-entry-card--active/);
        await expect(thoughtToggle).toHaveAttribute('aria-expanded', 'false');
        await thoughtToggle.focus();
        await page.keyboard.press('Enter');
        await expect(thoughtToggle).toHaveAttribute('aria-expanded', 'true');
        await capture(page, info, `process-completed-${theme}-${width}`, thought);
        expect(errors).toEqual([]);
      } finally {
        // Unblock this explicit fixture even if a visual assertion fails; never leave a provider pending.
        await release(app.projectRoot, 'thought');
        await release(app.projectRoot, 'tools');
      }
    });
  }
