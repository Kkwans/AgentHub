import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import { apiData } from './baseline-support.js';
import { expect, initializeGitProject, test, type RealApp } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
type Id = { id: string };
type Session = Id & { title: string; status: string };
const userText = '导出用的用户原文：保留 **字面 Markdown** 和 ``` 代码围栏。';
const assistantText = 'Fixture 过程展示验收完成。';

// Real HTTP + PGlite + the existing controlled ACP process. No external provider.
async function seed(context: BrowserContext, app: RealApp) {
  await initializeGitProject(app.projectRoot);
  const target = await apiData<Id>(context, 'post', '/execution-targets', {
    name: '导出验收主机',
    kind: 'LOCAL_HOST',
    hostname: '127.0.0.1',
    os: process.platform,
    arch: process.arch,
  });
  const project = await apiData<Id>(context, 'post', '/projects', {
    name: '导出验收项目',
    targetId: target.id,
    rootPath: app.projectRoot,
    kind: 'TEST',
  });
  const agent = await apiData<Id>(context, 'post', '/agents', {
    name: '公开文本导出 Fixture',
    targetId: target.id,
    agentKind: 'CUSTOM_ACP',
    executable: process.execPath,
    args: [
      resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/acp/fake-agent.mjs'),
      '--process-visual',
    ],
  });
  expect(
    (
      await apiData<{ status: string }>(context, 'post', `/agents/${agent.id}/preflight`, {
        cwd: app.projectRoot,
      })
    ).status,
  ).toBe('READY');
  await Promise.all(
    ['thought', 'tools'].map((stage) =>
      writeFile(join(app.projectRoot, `.agenthub-process-${stage}-release`), 'fixture', 'utf8'),
    ),
  );
  const session = await apiData<Session>(context, 'post', '/sessions', {
    projectId: project.id,
    agentId: agent.id,
    cwd: app.projectRoot,
    title: '会话文字记录 · 导出验收',
  });
  await run(context, session.id, userText);
  return { session, project, agent };
}
async function run(context: BrowserContext, sessionId: string, text: string) {
  await apiData(context, 'post', `/sessions/${sessionId}/runs`, { text });
  await expect
    .poll(async () => (await apiData<Session>(context, 'get', `/sessions/${sessionId}`)).status, {
      timeout: 30_000,
      intervals: [50, 100, 250],
    })
    .toBe('READY');
  await expect
    .poll(
      async () =>
        (
          await apiData<Array<{ status: string }>>(context, 'get', `/sessions/${sessionId}/runs`)
        ).at(-1)?.status,
    )
    .toBe('COMPLETED');
}
async function enter(page: Page, sessionId: string) {
  await page.goto(`/workspace/${sessionId}`);
  await expect(
    page.getByRole('textbox', { name: '给 Agent 发送工程指令', exact: true }),
  ).toBeEnabled();
  await expect(page.getByText(assistantText, { exact: true }).first()).toBeVisible();
}
async function openExport(page: Page) {
  const trigger = page.getByRole('button', { name: '导出文字记录', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '导出文字记录', exact: true });
  await expect(dialog).toBeVisible();
  return { trigger, dialog };
}
async function downloadedText(page: Page) {
  const download = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: '导出文字记录', exact: true })
    .getByRole('button', { name: '下载 Markdown', exact: true })
    .click();
  const file = await download;
  expect(await file.failure()).toBeNull();
  expect(file.suggestedFilename()).toMatch(/-文字记录\.md$/);
  const path = await file.path();
  expect(path).not.toBeNull();
  return readFile(path!, 'utf8');
}
for (const width of [390, 768, 1024, 1440])
  for (const theme of ['light', 'dark']) {
    test(`真实会话文字导出 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const { session } = await seed(context, app);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await enter(page, session.id);
      await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
      const entry = info.outputPath(`session-export-entry-${width}-${theme}.png`);
      await page.screenshot({ path: entry });
      await info.attach('文字导出入口', { path: entry, contentType: 'image/png' });
      const titleBox = await page.locator('.codex-session-title strong').boundingBox();
      const renameBox = await page
        .getByRole('button', { name: '重命名会话', exact: true })
        .boundingBox();
      const exportBox = await page
        .getByRole('button', { name: '导出文字记录', exact: true })
        .boundingBox();
      expect(titleBox).not.toBeNull();
      expect(renameBox).not.toBeNull();
      expect(exportBox).not.toBeNull();
      if (width === 390) expect(titleBox!.width).toBeGreaterThanOrEqual(60);
      for (const box of [renameBox!, exportBox!]) {
        expect(box.width).toBeGreaterThanOrEqual(43.99);
        expect(box.height).toBeGreaterThanOrEqual(43.99);
      }
      expect(
        renameBox!.x + renameBox!.width <= exportBox!.x + 0.01 ||
          exportBox!.x + exportBox!.width <= renameBox!.x + 0.01,
      ).toBe(true);
      await info.attach('顶栏可读标题与点击区域', {
        body: JSON.stringify({ titleBox, renameBox, exportBox }),
        contentType: 'application/json',
      });
      const { trigger, dialog } = await openExport(page);
      await expect(dialog).toContainText('不是完整审计记录');
      await expect(dialog).toContainText('分享前请检查');
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const shot = info.outputPath(`session-export-dialog-${width}-${theme}.png`);
      await page.screenshot({ path: shot });
      await info.attach('文字导出确认窗口', { path: shot, contentType: 'image/png' });
      const writes: string[] = [];
      page.on('request', (request) => {
        if (
          !['GET', 'HEAD'].includes(request.method()) &&
          new URL(request.url()).pathname.startsWith('/api/v1/')
        )
          writes.push(request.method());
      });
      const markdown = await downloadedText(page);
      expect(markdown).toContain(session.title);
      expect(markdown).toContain(session.id);
      expect(markdown).toContain(userText);
      expect(markdown).toContain(assistantText);
      expect(markdown).toContain('## 用户');
      expect(markdown).toContain('## 助手');
      expect(markdown).not.toContain('Fixture 公开过程说明');
      expect(markdown).not.toContain('Fixture 预期失败');
      expect(markdown).not.toContain('Fixture 进行中工具');
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
      await info.attach('下载的持久化文字', { body: markdown, contentType: 'text/markdown' });
      await expect(dialog.getByRole('status')).toContainText('已生成文字记录并发起下载');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }

test('浏览器分页契约fixture（非DB端到端）：201条消息固定边界下载且不写入', async ({
  page,
  context,
  app,
}) => {
  const { session } = await seed(context, app);
  await enter(page, session.id);
  await openExport(page);
  const rows = Array.from({ length: 201 }, (_, index) => ({
    id: `pagination-fixture-${index + 1}`,
    sessionId: session.id,
    sequence: index + 1,
    role: index % 2 === 0 ? 'USER' : 'ASSISTANT',
    text: `分页契约原文 ${index + 1}`,
    createdAt: '2026-11-14T00:00:00.000Z',
  }));
  const cursors: Array<number | null> = [];
  const writes: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/') && request.method() !== 'GET')
      writes.push(request.method());
  });
  await page.route(`**/api/v1/sessions/${session.id}/messages?*`, async (route) => {
    const url = new URL(route.request().url());
    expect(route.request().method()).toBe('GET');
    expect(url.searchParams.get('limit')).toBe('200');
    const raw = url.searchParams.get('beforeSequence');
    const before = raw === null ? null : Number(raw);
    cursors.push(before);
    // A new row outside the captured upper bound exists after the first page.
    const source =
      before === null
        ? rows
        : [
            ...rows,
            { ...rows[0]!, id: 'later-message', sequence: 202, text: '不应导出的迟到消息' },
          ];
    const data = source.filter((row) => before === null || row.sequence < before).slice(-200);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, requestId: 'export-pagination-contract-fixture' }),
    });
  });
  const markdown = await downloadedText(page);
  expect(markdown).toContain('分页契约原文 1');
  expect(markdown).toContain('分页契约原文 201');
  expect(markdown).not.toContain('不应导出的迟到消息');
  expect(markdown.match(/^## (用户|助手) ·/gm)).toHaveLength(201);
  expect(markdown).toContain('消息序号上界：201');
  expect(cursors).toEqual([null, 2, 1]);
  expect(writes).toEqual([]);
});

for (const action of ['取消', '切会话'] as const)
  test(`导出${action}后迟到GET不得触发下载`, async ({ page, context, app }) => {
    const { session, project, agent } = await seed(context, app);
    const other = await apiData<Session>(context, 'post', '/sessions', {
      projectId: project.id,
      agentId: agent.id,
      cwd: app.projectRoot,
      title: '另一个会话',
    });
    await enter(page, session.id);
    const { dialog } = await openExport(page);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const captured = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finish!: () => void;
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const downloads: string[] = [];
    page.on('download', (file) => downloads.push(file.suggestedFilename()));
    let held = false;
    await page.route(`**/api/v1/sessions/${session.id}/messages?*`, async (route) => {
      if (held) return route.continue();
      held = true;
      try {
        const response = await route.fetch();
        entered();
        await barrier;
        await route.fulfill({ response });
      } catch {
        /* Abort after cancel/navigation is expected; no synthetic successful response. */
      } finally {
        finish();
      }
    });
    await dialog.getByRole('button', { name: '下载 Markdown', exact: true }).click();
    await captured;
    await expect(dialog.getByRole('button', { name: '正在读取…', exact: true })).toBeDisabled();
    if (action === '取消')
      await dialog.getByRole('button', { name: '取消导出', exact: true }).click();
    else {
      // Use the existing React Router link, not a document reload that would
      // trivially discard the export controller along with the whole page.
      await page
        .locator(`a[href="/workspace/${other.id}"]`)
        .first()
        .evaluate((link) => (link as HTMLAnchorElement).click());
      await expect(page).toHaveURL(new RegExp(`/workspace/${other.id}$`));
    }
    release();
    await completed;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(downloads).toEqual([]);
  });
