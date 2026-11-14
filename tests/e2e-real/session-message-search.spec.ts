import type { Page } from '@playwright/test';
import { apiData, seedWorkspace } from './baseline-support.js';
import { expect, test } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
const needle = '历史定位验收_中文%_';
const draft = '尚未发送的工程草稿，搜索不得覆盖。';
function history(turns: number) {
  return Array.from({ length: turns }, (_, i) => [
    {
      role: 'USER' as const,
      text: i === 0 ? `${needle} 用户原文 <img> **字面文字**` : `Fixture 用户第 ${i + 1} 回合`,
    },
    { role: 'ASSISTANT' as const, text: `Fixture 助手第 ${i + 1} 回合已保存回复` },
  ]).flat();
}
async function searchUntilFound(page: Page, id: string) {
  await page.getByRole('button', { name: '搜索已保存文字', exact: true }).click();
  const panel = page.getByRole('region', { name: '当前会话文字搜索' });
  await panel.getByRole('textbox', { name: '搜索已保存文字' }).fill(needle);
  await panel.getByRole('button', { name: '搜索', exact: true }).click();
  const result = panel.getByRole('button', { name: `定位消息 ${id}`, exact: true });
  for (let i = 0; i < 15; i++) {
    await expect(panel.getByRole('button', { name: '搜索', exact: true })).toBeEnabled();
    if (await result.count()) break;
    await panel.getByRole('button', { name: '继续搜索', exact: true }).click();
  }
  await expect(result).toBeVisible();
  return { panel, result };
}
async function assertLocated(page: Page, id: string, sequence: number) {
  await expect(page.getByText('已定位到原消息。', { exact: true })).toBeVisible();
  const message = page.locator(`article[data-message-id="${id}"]`);
  await expect(message).toHaveAttribute('data-message-sequence', String(sequence));
  await expect(message).toBeFocused();
  await expect(message).toBeInViewport();
  await expect
    .poll(async () =>
      message.evaluate((node) => {
        const scroller = node.closest('.conversation-scroll');
        if (!scroller) return false;
        const a = node.getBoundingClientRect();
        const b = scroller.getBoundingClientRect();
        return (
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0
        );
      }),
    )
    .toBe(true);
  await expect(message).toContainText(needle);
  await expect(
    page.getByRole('textbox', { name: '给 Agent 发送工程指令', exact: true }),
  ).toHaveValue(draft);
}
for (const width of [390, 768, 1024, 1440])
  for (const theme of ['light', 'dark']) {
    test(`真实持久文字搜索与定位 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const { session } = await seedWorkspace(context, app);
      const records = await app.seedSavedMessageHistory(session.id, history(121));
      const target = records[0]!;
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const errors: string[] = [];
      const writes: string[] = [];
      const historyReads: string[] = [];
      let searchPosts = 0;
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (
          request.method() === 'POST' &&
          url.pathname === `/api/v1/sessions/${session.id}/messages/search`
        )
          searchPosts++;
        // Both are read-only despite POST: PromptService.resolve only reads bindings,
        // prompt/version/label records and renders context (no Run/snapshot persistence).
        // Workspace's promptContext useQuery invokes it when Session loads.
        const readOnlyPost =
          request.method() === 'POST' &&
          (url.pathname === `/api/v1/sessions/${session.id}/messages/search` ||
            url.pathname === '/api/v1/prompt-context/resolve');
        if (
          request.method() !== 'GET' &&
          request.method() !== 'HEAD' &&
          url.pathname.startsWith('/api/') &&
          !readOnlyPost
        )
          writes.push(request.method() + ' ' + url.pathname);
        if (url.pathname.endsWith('/messages') && url.searchParams.has('beforeSequence'))
          historyReads.push(url.search);
      });
      await page.goto(`/workspace/${session.id}`);
      const composer = page.getByRole('textbox', { name: '给 Agent 发送工程指令', exact: true });
      await expect(composer).toBeEnabled();
      await composer.fill(draft);
      const titleBox = await page.locator('.codex-session-title > strong').boundingBox();
      expect(titleBox).not.toBeNull();
      const toolBoxes = [];
      for (const name of ['重命名会话', '导出文字记录', '搜索已保存文字']) {
        const box = await page.getByRole('button', { name, exact: true }).boundingBox();
        expect(box).not.toBeNull();
        // These three icon controls have an existing 44px contract at every width.
        expect(box!.width).toBeGreaterThanOrEqual(43.99);
        expect(box!.height).toBeGreaterThanOrEqual(43.99);
        toolBoxes.push(box!);
      }
      for (let i = 0; i < toolBoxes.length; i++)
        for (let j = i + 1; j < toolBoxes.length; j++) {
          const a = toolBoxes[i]!,
            b = toolBoxes[j]!;
          expect(
            a.x + a.width <= b.x + 0.01 ||
              b.x + b.width <= a.x + 0.01 ||
              a.y + a.height <= b.y + 0.01 ||
              b.y + b.height <= a.y + 0.01,
          ).toBe(true);
        }
      if (width === 390) {
        expect(titleBox!.width).toBeGreaterThanOrEqual(63.99);
        for (const box of toolBoxes)
          expect(box.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height - 0.01);
      }
      expect(
        await page
          .locator('.workspace-contextbar')
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
      await info.attach('会话标题与工具行几何', {
        body: JSON.stringify({ titleBox, toolBoxes }),
        contentType: 'application/json',
      });
      const { panel, result } = await searchUntilFound(page, target.id);
      const resultsPath = info.outputPath(`search-results-${width}-${theme}.png`);
      await page.screenshot({ path: resultsPath });
      await info.attach('真实搜索结果', { path: resultsPath, contentType: 'image/png' });
      const expandedGeometry = {
        panel: await panel.boundingBox(),
        conversation: await page.locator('.conversation-scroll').boundingBox(),
      };
      await result.focus();
      await page.keyboard.press('Enter');
      await assertLocated(page, target.id, target.sequence);
      await expect(panel.getByRole('textbox', { name: '搜索已保存文字' })).toHaveCount(0);
      await expect(panel.getByRole('button', { name: '返回搜索结果', exact: true })).toBeVisible();
      const latest = page.getByRole('button', { name: '回到最新', exact: true });
      await expect(latest).toBeVisible();
      await expect(latest).not.toContainText(/\d+ 条新消息/);
      const compactGeometry = {
        panel: await panel.boundingBox(),
        conversation: await page.locator('.conversation-scroll').boundingBox(),
        latest: await latest.boundingBox(),
      };
      expect(expandedGeometry.panel).not.toBeNull();
      expect(expandedGeometry.conversation).not.toBeNull();
      expect(compactGeometry.panel).not.toBeNull();
      expect(compactGeometry.conversation).not.toBeNull();
      expect(compactGeometry.latest).not.toBeNull();
      // Relative geometry proves reclaimed reading space without a guessed pixel budget.
      expect(compactGeometry.panel!.height).toBeLessThan(expandedGeometry.panel!.height);
      expect(compactGeometry.conversation!.height).toBeGreaterThan(
        expandedGeometry.conversation!.height,
      );
      const c = compactGeometry.conversation!,
        b = compactGeometry.latest!;
      expect(b.y + 0.01).toBeGreaterThanOrEqual(c.y + c.height);
      expect(await latest.evaluate((node) => node.closest('.conversation-scroll') === null)).toBe(
        true,
      );
      await info.attach('定位前后阅读区与独立回最新控件', {
        body: JSON.stringify({ expandedGeometry, compactGeometry }),
        contentType: 'application/json',
      });
      expect(historyReads.length).toBeGreaterThanOrEqual(2);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const locatedPath = info.outputPath(`search-located-${width}-${theme}.png`);
      await page.screenshot({ path: locatedPath });
      await info.attach('真实原消息定位', { path: locatedPath, contentType: 'image/png' });
      const locatedMessage = page.locator(`article[data-message-id="${target.id}"]`);
      // Keyboard navigation must retain a visible native focus indicator after
      // the temporary location highlight expires; a class-name check is insufficient.
      await expect(locatedMessage).not.toHaveAttribute('data-message-located', 'true');
      await expect(locatedMessage).toBeFocused();
      await expect
        .poll(async () =>
          locatedMessage.evaluate((node) => {
            const style = getComputedStyle(node);
            const opaque = (color: string) =>
              color !== 'transparent' &&
              !/rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color) &&
              !/\/\s*0(?:\.0+)?%?\s*\)$/.test(color);
            const outline =
              parseFloat(style.outlineWidth) > 0 &&
              style.outlineStyle !== 'none' &&
              opaque(style.outlineColor);
            const shadow =
              style.boxShadow !== 'none' &&
              style.boxShadow.split(/,(?![^()]*\))/).some((part) => {
                const color = part.match(/rgba?\([^)]*\)/)?.[0];
                return Boolean(
                  color &&
                  opaque(color) &&
                  (part.match(/-?[\d.]+px/g) ?? []).some(
                    (length) => Math.abs(parseFloat(length)) > 0,
                  ),
                );
              });
            return outline || shadow;
          }),
        )
        .toBe(true);

      const priorSearchPosts = searchPosts;
      await panel.getByRole('button', { name: '返回搜索结果', exact: true }).click();
      const searchInput = panel.getByRole('textbox', { name: '搜索已保存文字' });
      await expect(searchInput).toHaveValue(needle);
      await expect(searchInput).toBeFocused();
      expect(searchPosts).toBe(priorSearchPosts);
      await expect(result).toBeVisible();
      await searchInput.fill('Fixture 助手');
      await panel.getByRole('button', { name: '搜索', exact: true }).click();
      await expect(panel.getByRole('button', { name: '搜索', exact: true })).toBeEnabled();
      await expect(panel.getByRole('button', { name: /^定位消息 / }).first()).toBeVisible();
      await expect(composer).toHaveValue(draft);
      await panel.getByRole('button', { name: '关闭搜索' }).click();
      await expect(page.getByRole('button', { name: '搜索已保存文字', exact: true })).toBeFocused();
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
      expect(await apiData<unknown[]>(context, 'get', `/sessions/${session.id}/runs`)).toEqual([]);
    });
  }

test('501个真实持久turn跨定位预算继续，真实分页不伪造结果', async ({ page, context, app }) => {
  const { session } = await seedWorkspace(context, app);
  const records = await app.seedSavedMessageHistory(session.id, history(501));
  const target = records[0]!;
  await page.goto(`/workspace/${session.id}`);
  const composer = page.getByRole('textbox', { name: '给 Agent 发送工程指令', exact: true });
  await expect(composer).toBeEnabled();
  await composer.fill(draft);
  const { panel, result } = await searchUntilFound(page, target.id);
  await result.click();
  await expect(panel.getByRole('button', { name: '继续加载历史', exact: true })).toBeVisible();
  await expect(page.getByText('已定位到原消息。', { exact: true })).toHaveCount(0);
  await expect(page.locator(`article[data-message-id="${target.id}"]`)).toHaveCount(0);
  await panel.getByRole('button', { name: '继续加载历史', exact: true }).click();
  await assertLocated(page, target.id, target.sequence);
  expect(await apiData<unknown[]>(context, 'get', `/sessions/${session.id}/runs`)).toEqual([]);
});

test('取消定位后迟到的真实历史响应不抢焦点、不宣称定位成功', async ({ page, context, app }) => {
  const { session } = await seedWorkspace(context, app);
  const records = await app.seedSavedMessageHistory(session.id, history(121));
  const target = records[0]!;
  await page.goto(`/workspace/${session.id}`);
  const composer = page.getByRole('textbox', { name: '给 Agent 发送工程指令', exact: true });
  await expect(composer).toBeEnabled();
  await composer.fill(draft);
  const { panel, result } = await searchUntilFound(page, target.id);
  let entered!: () => void;
  let release!: () => void;
  let finished!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route(`**/sessions/${session.id}/messages?**`, async (route) => {
    if (!new URL(route.request().url()).searchParams.has('beforeSequence')) {
      await route.continue();
      return;
    }
    const response = await route.fetch(); // Real server JSON, never fabricated history.
    entered();
    await gate;
    try {
      await route.fulfill({ response });
    } catch {
      /* Browser may already have aborted the owned request. */
    } finally {
      finished();
    }
  });
  try {
    await result.click();
    await waiting;
    await panel.getByRole('button', { name: '取消定位', exact: true }).click();
    await composer.focus();
    release();
    await done;
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue(draft);
    await expect(page.getByText('已定位到原消息。', { exact: true })).toHaveCount(0);
    await expect(page.locator(`article[data-message-id="${target.id}"]`)).toHaveCount(0);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

async function selectSession(page: Page, id: string) {
  const link = page.locator(`.session-rail a[href="/workspace/${id}"]`);
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/workspace/${id}$`));
}

test('成功定位只消费一次，SPA切换A到B再回A不重放旧焦点并保留双方草稿', async ({
  page,
  context,
  app,
}) => {
  const { project, agent, session: first } = await seedWorkspace(context, app);
  const second = await apiData<{ id: string }>(context, 'post', '/sessions', {
    projectId: project.id,
    agentId: agent.id,
    title: '搜索定位第二会话',
    cwd: app.projectRoot,
  });
  const records = await app.seedSavedMessageHistory(first.id, history(121));
  const target = records[0]!;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workspace/${first.id}`);
  const composer = page.getByRole('textbox', { name: '给 Agent 发送工程指令', exact: true });
  await expect(composer).toBeEnabled();
  await composer.fill(draft);
  const { result } = await searchUntilFound(page, target.id);
  await result.click();
  await assertLocated(page, target.id, target.sequence);
  await selectSession(page, second.id);
  await expect(composer).toBeEnabled();
  await composer.fill('第二会话独立草稿');
  // Capture the actual focus side effect, not just the final focus after overriding it.
  await page.evaluate((id) => {
    const state = { count: 0 };
    (window as Window & { __searchOldFocus?: { count: number } }).__searchOldFocus = state;
    document.addEventListener('focusin', (event) => {
      if (event.target instanceof HTMLElement && event.target.dataset.messageId === id)
        state.count++;
    });
  }, target.id);
  await selectSession(page, first.id);
  await expect(composer).toHaveValue(draft);
  await expect(composer).toBeEnabled();
  await expect(page.getByRole('region', { name: '当前会话文字搜索' })).toHaveCount(0);
  await composer.focus();
  // Observe committed layout frames, without a timed sleep or a page reload.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(
      () => (window as Window & { __searchOldFocus?: { count: number } }).__searchOldFocus?.count,
    ),
  ).toBe(0);
  await expect(composer).toBeFocused();
  expect(
    await page
      .locator(`article[data-message-id="${target.id}"]`)
      .evaluateAll((nodes) => nodes.every((node) => (node as HTMLElement).style.outline === '')),
  ).toBe(true);
  await selectSession(page, second.id);
  await expect(composer).toHaveValue('第二会话独立草稿');
  expect(await apiData<unknown[]>(context, 'get', `/sessions/${first.id}/runs`)).toEqual([]);
  expect(await apiData<unknown[]>(context, 'get', `/sessions/${second.id}/runs`)).toEqual([]);
});
