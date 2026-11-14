import { test, expect } from './fixtures.js';

test.use({ authMode: 'token' });

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`空库初始化只读品牌 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const violations: string[] = [];
      const requests: string[] = [];
      const errors: string[] = [];
      const sockets: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('websocket', (socket) => sockets.push(new URL(socket.url()).pathname));
      let safetyAssertionsCompleted = false;
      try {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await context.route('**/api/**', async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          const identity = `${request.method()} ${url.pathname}`;
          requests.push(identity);
          if (
            url.origin !== app.origin ||
            url.pathname !== '/api/v1/auth/status' ||
            url.search !== '' ||
            request.method() !== 'GET'
          ) {
            violations.push(identity);
            await route.abort();
            return;
          }
          await route.continue();
        });
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await context.addInitScript(
          ({ origin, theme }) => {
            if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
          },
          { origin: app.origin, theme },
        );
        const statusResponse = page.waitForResponse(
          (response) => new URL(response.url()).pathname === '/api/v1/auth/status',
        );
        await page.goto(`${app.origin}/`);
        await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
        const status = await statusResponse;
        expect(status.status()).toBe(200);
        expect((await status.json()).data).toMatchObject({
          mode: 'token',
          setupRequired: true,
          authenticated: false,
          user: null,
        });
        await expect(
          page.getByRole('heading', { name: '创建管理员账号', exact: true }),
        ).toBeVisible();
        const gate = page.locator('main.app-access-gate');
        await expect(gate.locator('[data-brand-wordmark="true"]')).toHaveText('AgentHub');
        await expect(
          gate.locator('[data-brand-initials], [data-brand-glyph], [data-brand-monogram]'),
        ).toHaveCount(0);
        for (const label of ['用户名', '密码', '确认密码']) {
          await expect(gate.getByLabel(label, { exact: true })).toHaveValue('');
        }
        const controls = gate.locator('input, button, a[href], [role="combobox"]');
        const boxes = await controls.evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return {
              tag: element.tagName,
              name:
                element.getAttribute('aria-label') ??
                element.getAttribute('name') ??
                element.textContent?.trim(),
              width: box.width,
              height: box.height,
            };
          }),
        );
        await info.attach('初始化真实触点', {
          body: JSON.stringify(boxes),
          contentType: 'application/json',
        });
        // Soft geometry still fails the case, but preserves screenshots for diagnosing real UI defects.
        for (const box of boxes) {
          expect.soft(box.width, `${box.name} width`).toBeGreaterThanOrEqual(43.99);
          expect.soft(box.height, `${box.name} height`).toBeGreaterThanOrEqual(43.99);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        const scrolls = await page.evaluate(() => {
          const scrolling = document.scrollingElement;
          return [
            ...document.querySelectorAll<HTMLElement>(
              'html, body, main.app-access-gate, main.app-access-gate *',
            ),
          ].flatMap((element, index) => {
            if (
              element !== scrolling &&
              !['auto', 'scroll'].includes(getComputedStyle(element).overflowY)
            )
              return [];
            element.scrollTop = 0;
            return [
              {
                index,
                tag: element.tagName,
                className: element.className,
                scrollHeight: element.scrollHeight,
                clientHeight: element.clientHeight,
                scrollTop: element.scrollTop,
              },
            ];
          });
        });
        const containers = page.locator('html, body, main.app-access-gate, main.app-access-gate *');
        for (const scroll of scrolls)
          await expect
            .poll(() => containers.nth(scroll.index).evaluate((element) => element.scrollTop))
            .toBe(0);
        await info.attach('初始化滚动宿主', {
          body: JSON.stringify(scrolls),
          contentType: 'application/json',
        });
        const capture = async (name: string) => {
          const path = info.outputPath(`${name}-${width}-${theme}.png`);
          await page.screenshot({ path, fullPage: true, animations: 'disabled' });
          await info.attach(name, { path, contentType: 'image/png' });
        };
        await capture('access-setup-top');
        for (const scroll of scrolls.filter((item) => item.scrollHeight > item.clientHeight + 1)) {
          const container = containers.nth(scroll.index);
          await container.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
          });
          await expect
            .poll(() =>
              container.evaluate((element) =>
                Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
              ),
            )
            .toBeLessThanOrEqual(1);
          await capture(`access-setup-bottom-${scroll.index}`);
          await container.evaluate((element) => {
            element.scrollTop = 0;
          });
          await expect.poll(() => container.evaluate((element) => element.scrollTop)).toBe(0);
        }
        expect(requests.length).toBeGreaterThan(0);
        expect(violations).toEqual([]);
        expect(sockets).toEqual([]);
        expect(errors).toEqual([]);
        safetyAssertionsCompleted = true;
        // Never submit, fill credentials, seed an account, or enter the authenticated shell.
        await expect(
          page.getByRole('button', { name: '创建账号并进入', exact: true }),
        ).toBeVisible();
      } finally {
        await info.attach('只读观测（不代表未执行断言通过）', {
          body: JSON.stringify({
            requests,
            violations,
            sockets,
            errors,
            safetyAssertionsCompleted,
          }),
          contentType: 'application/json',
        });
      }
    });
  }
}
