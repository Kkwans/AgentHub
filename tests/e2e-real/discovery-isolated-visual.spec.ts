import { test, expect, type BrowserContext, type Locator } from '@playwright/test';
import { startIsolatedInfrastructureChild } from './infrastructure-child-lifecycle.js';

test.setTimeout(120_000);
const allowedReads = new Set([
  '/api/v1/auth/status',
  '/api/v1/agents',
  '/api/v1/execution-targets',
  '/api/v1/discovery/agents',
]);
for (const width of [390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`隔离发现页只读图证 ${width} ${theme}`, async ({ browser }, info) => {
      // Private absent Docker socket, empty PATH and private HOME; not an OS sandbox.
      // The real discovery GET still performs diagnostic/file/socket checks, not Provider calls.
      const app = await startIsolatedInfrastructureChild();
      let context: BrowserContext | undefined;
      const requests: Array<{ method: string; path: string; allowed: boolean }> = [];
      const errors: string[] = [];
      const sockets: Array<{ path: string; sameOrigin: boolean; expectedProtocol: boolean }> = [];
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
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        page.on('websocket', (socket) => {
          const url = new URL(socket.url());
          sockets.push({
            path: url.pathname,
            sameOrigin: url.host === new URL(app.origin).host,
            expectedProtocol: url.protocol === 'ws:',
          });
        });
        let touchIndex = 0;
        const measureTouch = async (control: Locator) => {
          await expect(control).toBeVisible();
          const box = await control.boundingBox();
          expect(box).not.toBeNull();
          const identity = await control.evaluate((element) => ({
            tag: element.tagName,
            text: element.textContent?.trim(),
            ariaLabel: element.getAttribute('aria-label'),
          }));
          await info.attach(`discovery-touch-${++touchIndex}.json`, {
            body: JSON.stringify({ ...identity, box }),
            contentType: 'application/json',
          });
          expect.soft(box!.width).toBeGreaterThanOrEqual(43.99);
          expect.soft(box!.height).toBeGreaterThanOrEqual(43.99);
        };
        const candidatesResponse = page.waitForResponse(
          (response) => new URL(response.url()).pathname === '/api/v1/discovery/agents',
        );
        const agentsResponse = page.waitForResponse(
          (response) => new URL(response.url()).pathname === '/api/v1/agents',
        );
        await page.goto(`${app.origin}/agents`);
        const candidates = await candidatesResponse;
        expect(candidates.status()).toBe(200);
        const rows = (await candidates.json()).data as Array<{
          candidateId: string;
          state: string;
          adoptable: boolean;
          targetCandidateId: string;
        }>;
        expect(
          rows
            .filter((row) => row.candidateId.startsWith('host:'))
            .map((row) => row.candidateId)
            .sort(),
        ).toEqual(['host:codex', 'host:opencode']);
        expect(rows.find((row) => row.candidateId === 'host:opencode')).toMatchObject({
          state: 'MISSING_DEPENDENCY',
          adoptable: false,
        });
        // A bundled Codex adapter may be installed despite no CLI/authentication. Never treat this as Ready.
        expect(['INSTALLED', 'MISSING_DEPENDENCY']).toContain(
          rows.find((row) => row.candidateId === 'host:codex')?.state,
        );
        expect(rows.some((row) => row.targetCandidateId.startsWith('remote:'))).toBe(false);
        const agents = await agentsResponse;
        expect(agents.status()).toBe(200);
        expect((await agents.json()).data).toEqual([]);
        const trigger = page.getByRole('link', { name: '发现 Agent', exact: true }).first();
        await measureTouch(trigger);
        await trigger.focus();
        await expect(trigger).toBeFocused();
        await trigger.press('Enter');
        await expect(page).toHaveURL(`${app.origin}/agents/agents/discover`);
        const dialog = page.getByRole('dialog', { name: '发现 Agent', exact: true });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.getByRole('heading', { name: '扫描已完成', exact: true }),
        ).toBeVisible();
        await expect(dialog.getByText('正在扫描 Agent', { exact: true })).toHaveCount(0);
        await expect(dialog.getByText('Codex', { exact: true })).toBeVisible();
        await expect(dialog.getByText('OpenCode', { exact: true })).toBeVisible();
        await expect(dialog.getByText('暂时没有候选 Agent', { exact: true })).toHaveCount(0);
        const controls = dialog.locator('button, a[href], input, [role="combobox"]');
        for (let index = 0; index < (await controls.count()); index++) {
          const control = controls.nth(index);
          if (await control.isVisible()) await measureTouch(control);
        }
        const panels = await dialog.evaluate((root) =>
          [root, ...root.querySelectorAll<HTMLElement>('*')].flatMap((element, index) => {
            if (!['auto', 'scroll'].includes(getComputedStyle(element).overflowY)) return [];
            element.scrollTop = 0;
            return [
              {
                index,
                scrollHeight: element.scrollHeight,
                clientHeight: element.clientHeight,
                scrollTop: element.scrollTop,
              },
            ];
          }),
        );
        await info.attach('discovery-scroll-panels.json', {
          body: JSON.stringify(panels),
          contentType: 'application/json',
        });
        expect
          .soft(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
          .toBeLessThanOrEqual(1);
        const top = info.outputPath(`discovery-top-${width}-${theme}.png`);
        await page.screenshot({ path: top, animations: 'disabled' });
        await info.attach('discovery-top', { path: top, contentType: 'image/png' });
        for (const panel of panels.filter((panel) => panel.scrollHeight > panel.clientHeight + 1)) {
          const target = panel.index === 0 ? dialog : dialog.locator('*').nth(panel.index - 1);
          await target.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
          });
          await expect
            .poll(() =>
              target.evaluate((element) =>
                Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
              ),
            )
            .toBeLessThanOrEqual(1);
          const bottom = info.outputPath(`discovery-bottom-${panel.index}-${width}-${theme}.png`);
          await page.screenshot({ path: bottom, animations: 'disabled' });
          await info.attach(`discovery-bottom-${panel.index}`, {
            path: bottom,
            contentType: 'image/png',
          });
          await target.evaluate((element) => {
            element.scrollTop = 0;
          });
          await expect.poll(() => target.evaluate((element) => element.scrollTop)).toBe(0);
        }
        // Only close the read-only dialog. Never activate scan/adopt/authentication controls.
        const done = dialog.getByRole('button', { name: '完成', exact: true });
        await measureTouch(done);
        await done.focus();
        await done.press('Enter');
        await expect(page).toHaveURL(`${app.origin}/agents`);
        await expect(dialog).toHaveCount(0);
        await expect(
          page.getByRole('link', { name: '发现 Agent', exact: true }).first(),
        ).toBeFocused();
        const closed = info.outputPath(`discovery-closed-${width}-${theme}.png`);
        await page.screenshot({ path: closed, animations: 'disabled' });
        await info.attach('discovery-closed', { path: closed, contentType: 'image/png' });
        expect(requests.filter((request) => !request.allowed)).toEqual([]);
        expect(errors).toEqual([]);
        expect(
          sockets.every(
            (socket) => socket.sameOrigin && socket.expectedProtocol && socket.path === '/ws',
          ),
        ).toBe(true);
      } finally {
        try {
          await info.attach('isolated-discovery-evidence', {
            body: JSON.stringify(
              {
                isolatedEnvironment: app.isolatedEnvironment,
                emptyPath: app.emptyPath,
                scope:
                  'Isolated test environment; no Provider/authentication proof; GET is not inherently side-effect-free',
                requests,
                errors,
                sockets,
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
