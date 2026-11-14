import { test, expect, type Locator, type BrowserContext } from '@playwright/test';
import { startIsolatedInfrastructureChild } from './infrastructure-child-lifecycle.js';

test.setTimeout(120_000);
const allowedReads = new Set([
  '/api/v1/auth/status',
  '/api/v1/remote-nodes',
  '/api/v1/agents/diagnostics/host',
]);
for (const width of [390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`隔离基础设施只读图证 ${width} ${theme}`, async ({ browser }, info) => {
      // This is a dedicated process with empty PATH/private HOME, not an OS sandbox.
      // Do not import the normal Git/ACP fixtures or seed any Agent/Node/Session.
      const app = await startIsolatedInfrastructureChild();
      let context: BrowserContext | undefined;
      const requests: Array<{ method: string; path: string; allowed: boolean }> = [];
      const errors: string[] = [];
      const sockets: Array<{ path: string; sameOrigin: boolean }> = [];
      const metrics: Record<string, unknown> = {};
      try {
        context = await browser.newContext({
          baseURL: app.origin,
          viewport: { width, height: width === 390 ? 844 : 900 },
          reducedMotion: 'reduce',
          serviceWorkers: 'block',
        });
        await context.addInitScript(
          ({ origin, theme }) => {
            if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
          },
          { origin: app.origin, theme },
        );
        await context.route('**/api/**', async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          const allowed =
            url.origin === app.origin &&
            request.method() === 'GET' &&
            allowedReads.has(url.pathname);
          requests.push({ method: request.method(), path: url.pathname, allowed });
          if (!allowed) return route.abort('blockedbyclient');
          return route.continue();
        });
        const page = await context.newPage();
        page.on('websocket', (socket) => {
          const url = new URL(socket.url());
          sockets.push({
            path: url.pathname,
            sameOrigin: url.host === new URL(app.origin).host && url.protocol === 'ws:',
          });
        });
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        let touchIndex = 0;
        const touch = async (control: Locator) => {
          await expect(control).toBeVisible();
          const box = await control.boundingBox();
          expect(box).not.toBeNull();
          const identity = await control.evaluate((element) => ({
            tag: element.tagName,
            text: element.textContent?.trim(),
            ariaLabel: element.getAttribute('aria-label'),
            labels:
              'labels' in element
                ? Array.from((element as HTMLInputElement).labels ?? []).map((label) =>
                    label.textContent?.trim(),
                  )
                : [],
          }));
          await info.attach(`touch-${++touchIndex}.json`, {
            body: JSON.stringify({ ...identity, box }, null, 2),
            contentType: 'application/json',
          });
          // Keep this case red for undersized controls, but collect the remaining safe page evidence.
          expect.soft(box!.height).toBeGreaterThanOrEqual(43.99);
          expect.soft(box!.width).toBeGreaterThanOrEqual(43.99);
        };
        const capture = async (state: string) => {
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
          ).toBeLessThanOrEqual(1);
          metrics[state] = await page.evaluate(() => ({
            viewport: { width: innerWidth, height: innerHeight },
            document: {
              width: document.documentElement.scrollWidth,
              height: document.documentElement.scrollHeight,
            },
            scrollRegions: Array.from(document.querySelectorAll('main, pre, [role="main"]')).map(
              (node) => {
                const element = node as HTMLElement;
                const box = element.getBoundingClientRect();
                return {
                  tag: element.tagName,
                  width: box.width,
                  height: box.height,
                  clientWidth: element.clientWidth,
                  scrollWidth: element.scrollWidth,
                  clientHeight: element.clientHeight,
                  scrollHeight: element.scrollHeight,
                  overflowX: getComputedStyle(element).overflowX,
                  overflowY: getComputedStyle(element).overflowY,
                };
              },
            ),
          }));
          const path = info.outputPath(`infrastructure-${state}-${width}-${theme}.png`);
          await page.screenshot({ path, fullPage: true });
          await info.attach(state, { path, contentType: 'image/png' });
          const scrollState = await page.evaluate(() => {
            const elements = Array.from(
              document.querySelectorAll<HTMLElement>('main, [role="main"]'),
            );
            return {
              windowY: scrollY,
              documentScrollable: document.documentElement.scrollHeight > innerHeight + 1,
              panels: elements.map((element, index) => ({
                index,
                top: element.scrollTop,
                scrollable:
                  /auto|scroll/.test(getComputedStyle(element).overflowY) &&
                  element.scrollHeight > element.clientHeight + 1,
              })),
            };
          });
          try {
            for (const panel of scrollState.panels.filter((panel) => panel.scrollable)) {
              const main = page.locator('main, [role="main"]').nth(panel.index);
              await main.evaluate((element) => {
                element.scrollTop = element.scrollHeight;
              });
              await expect
                .poll(() =>
                  main.evaluate((element) =>
                    Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
                  ),
                )
                .toBeLessThanOrEqual(1);
              const bottom = info.outputPath(
                `infrastructure-${state}-main-${panel.index}-bottom-${width}-${theme}.png`,
              );
              await page.screenshot({ path: bottom });
              await info.attach(`${state}-main-${panel.index}-bottom`, {
                path: bottom,
                contentType: 'image/png',
              });
            }
            if (scrollState.documentScrollable) {
              await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
              await expect
                .poll(() =>
                  page.evaluate(() =>
                    Math.abs(document.documentElement.scrollHeight - innerHeight - scrollY),
                  ),
                )
                .toBeLessThanOrEqual(1);
              const bottom = info.outputPath(
                `infrastructure-${state}-document-bottom-${width}-${theme}.png`,
              );
              await page.screenshot({ path: bottom });
              await info.attach(`${state}-document-bottom`, {
                path: bottom,
                contentType: 'image/png',
              });
            }
          } finally {
            await page.evaluate((state) => {
              const elements = Array.from(
                document.querySelectorAll<HTMLElement>('main, [role="main"]'),
              );
              for (const panel of state.panels)
                if (elements[panel.index]) elements[panel.index]!.scrollTop = panel.top;
              window.scrollTo(0, state.windowY);
            }, scrollState);
            await expect
              .poll(() =>
                page.evaluate((state) => {
                  const elements = Array.from(
                    document.querySelectorAll<HTMLElement>('main, [role="main"]'),
                  );
                  return (
                    Math.abs(scrollY - state.windowY) <= 1 &&
                    state.panels.every(
                      (panel) =>
                        Math.abs((elements[panel.index]?.scrollTop ?? panel.top) - panel.top) <= 1,
                    )
                  );
                }, scrollState),
              )
              .toBe(true);
          }
        };
        const nodesResponse = page.waitForResponse(
          (response) => new URL(response.url()).pathname === '/api/v1/remote-nodes',
        );
        await page.goto(`${app.origin}/agents/nodes`);
        const nodes = await nodesResponse;
        expect(nodes.status()).toBe(200);
        expect((await nodes.json()).data).toEqual([]);
        await expect(page.getByText('还没有远程节点', { exact: true })).toBeVisible();
        const authorize = page.getByRole('link', { name: '授权 Node', exact: true });
        await expect(authorize).toHaveCount(1);
        await expect(page.getByRole('heading', { name: '远程节点', level: 1 })).toBeVisible();
        await expect(page.getByText('Agent Infrastructure', { exact: true })).toHaveCount(0);
        await touch(authorize);
        const nodesGeometry = await page.evaluate(() => {
          const title = document.querySelector('h1')!.getBoundingClientRect();
          const content = document.querySelector('.page-content')!;
          const empty = content.querySelector('h2')!.getBoundingClientRect();
          const link = document
            .querySelector('a[href="/agents/nodes/register"]')!
            .getBoundingClientRect();
          const box = content.getBoundingClientRect();
          return {
            title: title.toJSON(),
            empty: empty.toJSON(),
            link: link.toJSON(),
            content: box.toJSON(),
            paddingLeft: parseFloat(getComputedStyle(content).paddingLeft),
          };
        });
        await info.attach('nodes-reading-layout.json', {
          body: JSON.stringify(nodesGeometry, null, 2),
          contentType: 'application/json',
        });
        expect
          .soft(
            Math.abs(
              nodesGeometry.empty.left - nodesGeometry.content.left - nodesGeometry.paddingLeft,
            ),
          )
          .toBeLessThanOrEqual(1);
        expect.soft(nodesGeometry.empty.width).toBeLessThanOrEqual(480);
        if (width === 390) {
          expect
            .soft(
              Math.abs(
                nodesGeometry.title.top +
                  nodesGeometry.title.height / 2 -
                  nodesGeometry.link.top -
                  nodesGeometry.link.height / 2,
              ),
            )
            .toBeLessThanOrEqual(1);
        }
        await capture('nodes-empty');
        await authorize.click();
        await expect(page).toHaveURL(`${app.origin}/agents/nodes/register`);
        const name = page.getByRole('textbox', { name: 'Node 名称', exact: true });
        const roots = page.getByRole('textbox', { name: '授权目录', exact: true });
        await expect(name).toHaveValue('');
        await expect(roots).toHaveValue('');
        await touch(name);
        await touch(roots);
        await touch(page.getByRole('combobox', { name: '有效期', exact: true }));
        await expect(
          page.getByRole('button', { name: '生成一次性注册码', exact: true }),
        ).toBeDisabled();
        await name.focus();
        await expect(name).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.getByRole('combobox', { name: '有效期', exact: true })).toBeFocused();
        await capture('register-unsubmitted');
        const back = page.getByRole('button', { name: '返回 Nodes', exact: true });
        await touch(back);
        await back.click();
        await expect(page).toHaveURL(`${app.origin}/agents/nodes`);
        await expect(page.getByText('还没有远程节点', { exact: true })).toBeVisible();

        const diagnosticResponse = page.waitForResponse(
          (response) => new URL(response.url()).pathname === '/api/v1/agents/diagnostics/host',
        );
        await page.goto(`${app.origin}/agents/diagnostics`);
        const response = await diagnosticResponse;
        expect(response.status()).toBe(200);
        const data = (await response.json()).data;
        expect(data.opencode.status).toBe('MISSING');
        expect(data.codex).not.toHaveProperty('auth');
        expect(data.codex).not.toHaveProperty('runtimeExecutable');
        // A bundled adapter may be INSTALLED; that is not CLI login or Provider connectivity.
        const summary = page.locator('summary').filter({ hasText: '查看详细诊断' });
        const details = summary.locator('..');
        await expect(details).not.toHaveAttribute('open', '');
        await touch(summary);
        await capture('diagnostics-collapsed');
        const requestCount = requests.length;
        await summary.focus();
        await summary.press('Enter');
        await expect(details).toHaveAttribute('open', '');
        await expect(details.locator('pre')).toBeVisible();
        await capture('diagnostics-expanded');
        const pre = details.locator('pre');
        await pre.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
          element.scrollLeft = element.scrollWidth;
        });
        await pre.scrollIntoViewIfNeeded();
        const bottom = info.outputPath(`infrastructure-diagnostics-bottom-${width}-${theme}.png`);
        await page.screenshot({ path: bottom });
        await info.attach('diagnostics-bottom', { path: bottom, contentType: 'image/png' });
        await summary.focus();
        await summary.press('Space');
        await expect(details).not.toHaveAttribute('open', '');
        await expect(summary).toBeFocused();
        expect(requests.length).toBe(requestCount);
        expect(requests.filter((request) => !request.allowed)).toEqual([]);
        expect(errors).toEqual([]);
        expect(sockets.every((socket) => socket.sameOrigin && socket.path === '/ws')).toBe(true);
      } finally {
        try {
          await info.attach('isolated-infrastructure-evidence', {
            body: JSON.stringify(
              {
                isolatedEnvironment: app.isolatedEnvironment,
                emptyPath: app.emptyPath,
                scope: 'Test process only; not an OS sandbox or authenticated Provider proof',
                requests,
                sockets,
                errors,
                metrics,
              },
              null,
              2,
            ),
            contentType: 'application/json',
          });
        } finally {
          try {
            await context?.close();
          } finally {
            await app.close();
          }
        }
      }
    });
  }
}
