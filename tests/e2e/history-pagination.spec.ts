import { expect, test, type Page, type Route } from '@playwright/test';
import type { ResolvedPromptContextRecord } from '../../apps/web/src/lib/api';

const emptyPromptContext = {
  ready: true,
  finalContext: '',
  missingVariables: [],
  items: [],
} satisfies ResolvedPromptContextRecord;

// Browser/API contract fixtures only: no database, provider, or real execution evidence.
// playwright.config.ts supplies 1440/1024/768/390; each case runs in both themes.
const project = {
  id: 'history-project',
  name: '历史分页契约',
  targetId: 'history-target',
  rootPath: '/fixture',
  realRootPath: '/fixture',
  repoKind: 'GIT',
  status: 'ACTIVE',
};
const agent = {
  id: 'history-agent',
  targetId: project.targetId,
  name: 'Fixture Agent',
  agentKind: 'CUSTOM_ACP',
  adapterKind: 'ACP_STDIO',
  enabled: true,
  status: 'READY',
  capabilitiesJson: {},
};
const sessions = ['A', 'B'].map((id) => ({
  id,
  projectId: project.id,
  agentId: agent.id,
  taskId: null,
  title: `历史会话 ${id}`,
  titleRevision: 0,
  cwd: '/fixture',
  status: 'READY',
  model: null,
  mode: null,
  lastActiveAt: '2026-11-14T00:00:00Z',
}));
const rows = (id: string, from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${id}-${from + i}`,
    sessionId: id,
    sequence: from + i,
    runId: null,
    role: 'USER',
    kind: 'TEXT',
    text: `${id} 已保存消息 ${from + i}。分页契约内容用于验证阅读位置，不代表真实 Agent 输出。`,
    createdAt: '2026-11-14T00:00:00Z',
  }));
async function fixture(page: Page, theme: string, older: (route: Route) => Promise<void>) {
  await page.addInitScript((value) => {
    localStorage.setItem('agenthub-theme', value);
    class QuietSocket extends EventTarget {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 3;
      send() {}
      close() {}
    }
    Object.defineProperty(window, 'WebSocket', { value: QuietSocket, configurable: true });
  }, theme);
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    let data: unknown = [];
    const matched = /^\/sessions\/([AB])(?:\/(.*))?$/.exec(path);
    if (path === '/auth/status')
      data = {
        mode: 'local_trusted',
        localTrusted: true,
        setupRequired: false,
        authenticated: true,
        user: null,
      };
    else if (path === '/projects') data = [project];
    else if (path === `/projects/${project.id}`) data = project;
    else if (path === '/agents') data = [agent];
    else if (path === `/agents/${agent.id}`) data = agent;
    else if (path === '/sessions') data = sessions;
    // Composer reads the resolved DTO even when no prompts are bound. Returning
    // the generic [] fallback crashes the whole workspace before history renders.
    else if (path === '/prompt-context/resolve') data = emptyPromptContext;
    else if (matched) {
      if (!matched[2]) data = sessions.find((session) => session.id === matched[1]);
      else if (matched[2] === 'messages') {
        if (matched[1] === 'A' && url.searchParams.has('beforeSequence')) return older(route);
        data = rows(matched[1]!, 101, 100);
      } else if (matched[2] === 'configuration')
        data = { supported: false, current: {}, options: {} };
    } else if (path.endsWith('/git/status')) data = { branch: 'main', clean: true, entries: [] };
    await route.fulfill({ json: { data } });
  });
  await page.goto('/workspace/A');
  await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
  await expect(
    page.getByRole('textbox', { name: '给 Agent 发送工程指令', exact: true }),
  ).toBeEnabled();
  await expect(page.locator('.conversation-scroll .message').last()).toContainText(
    'A 已保存消息 200',
  );
}
const composer = (page: Page) =>
  page.getByRole('textbox', { name: '给 Agent 发送工程指令', exact: true });
async function olderClick(page: Page) {
  // Keyboard activation avoids Playwright scrolling to the top first: that scroll
  // itself starts automatic pagination and can disable a barrier-held button.
  const button = page.getByRole('button', { name: '加载更早消息', exact: true });
  await button.evaluate((node) => node.focus({ preventScroll: true }));
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
}

async function routeSession(page: Page, id: string) {
  // Exercise mounted router identity changes, not page reload or a fake component.
  await page.evaluate((value) => {
    history.pushState(null, '', `/workspace/${value}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, id);
  await expect(page.locator('.conversation-scroll .message').last()).toContainText(
    `${id} 已保存消息 200`,
  );
}
for (const theme of ['light', 'dark']) {
  test(`历史分页契约 fixture：成功旧页保留阅读位置与草稿 · ${theme}`, async ({ page }, info) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = 0;
    await fixture(page, theme, async (route) => {
      requested++;
      await barrier;
      await route.fulfill({ json: { data: rows('A', 1, 100) } });
    });
    await composer(page).fill('A 未发送草稿');
    await olderClick(page);
    await expect.poll(() => requested).toBe(1);
    const scroll = page.locator('.conversation-scroll');
    const before = await scroll.evaluate((node) => ({
      height: node.scrollHeight,
      top: node.scrollTop,
    }));
    release();
    await expect(page.getByRole('button', { name: '加载更早消息', exact: true })).toBeEnabled();
    await expect
      .poll(() => scroll.evaluate((node) => node.scrollHeight))
      .toBeGreaterThan(before.height);
    await expect
      .poll(async () =>
        scroll.evaluate(
          (node, previous) =>
            Math.abs(node.scrollTop - (node.scrollHeight - previous.height + previous.top)),
          before,
        ),
      )
      .toBeLessThanOrEqual(2);
    await expect(composer(page)).toHaveValue('A 未发送草稿');
    await info.attach(`history-success-${theme}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
  test(`历史分页契约 fixture：失败后可重试且草稿不丢 · ${theme}`, async ({ page }) => {
    let requested = 0;
    let failing = true;
    await fixture(page, theme, async (route) => {
      requested++;
      if (failing)
        await route.fulfill({
          status: 503,
          json: { error: { code: 'FIXTURE_UNAVAILABLE', message: '历史页读取暂不可用' } },
        });
      else await route.fulfill({ json: { data: rows('A', 1, 100) } });
    });
    await composer(page).fill('失败也保留草稿');
    await olderClick(page);
    // Unknown backend codes intentionally use the client's safe message, not raw server text.
    const historyError = page
      .getByRole('log')
      .getByText('请求失败，请查看设置中的诊断信息。', { exact: true });
    await expect(historyError).toBeVisible();
    await expect(page.getByText('历史页读取暂不可用', { exact: true })).toHaveCount(0);
    await expect(composer(page)).toHaveValue('失败也保留草稿');
    const failures = requested;
    failing = false;
    await olderClick(page);
    await expect.poll(() => requested).toBeGreaterThan(failures);
    await expect(historyError).toBeHidden();
    await expect
      .poll(() => page.locator('.conversation-scroll').evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await expect(composer(page)).toHaveValue('失败也保留草稿');
  });
  test(`历史分页契约 fixture：切会话后迟到旧页不抢滚动或草稿 · ${theme}`, async ({ page }) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = 0;
    let settled = false;
    await fixture(page, theme, async (route) => {
      requested++;
      await barrier;
      try {
        await route.fulfill({ json: { data: rows('A', 1, 100) } });
      } catch {
        /* canceled browser request */
      } finally {
        settled = true;
      }
    });
    await composer(page).fill('A 未发送草稿');
    await olderClick(page);
    await expect.poll(() => requested).toBe(1);
    await routeSession(page, 'B');
    await composer(page).fill('B 独立草稿');
    const scroll = page.locator('.conversation-scroll');
    await scroll.evaluate((node) => {
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true }));
      node.scrollTop = 250;
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBe(250);
    release();
    await expect.poll(() => settled).toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await scroll.evaluate((node) => node.scrollTop)).toBe(250);
    await expect(composer(page)).toHaveValue('B 独立草稿');
    await expect(scroll).not.toContainText('A 已保存消息');
    await routeSession(page, 'A');
    await expect(composer(page)).toHaveValue('A 未发送草稿');
  });
}
