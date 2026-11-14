import { test, expect } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
const sections = [
  ['appearance', '外观', '外观偏好'],
  ['account', '账号', '账户'],
  ['security', '安全', '登录安全'],
  ['integrations', '集成', '外部集成'],
  ['system', '系统', 'Terminal'],
  ['advanced', '高级', '高权限能力'],
] as const;
for (const width of [390, 760, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`设置六分区可发现 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const errors: string[] = [];
      const writes: string[] = [];
      const unexpectedReads: string[] = [];
      const allowedReads = new Set([
        '/api/v1/auth/status',
        '/api/v1/auth/tokens',
        '/api/v1/settings/capabilities',
      ]);
      page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (!pathname.startsWith('/api/v1/')) return;
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
          writes.push(`${request.method()} ${pathname}`);
        else if (!allowedReads.has(pathname))
          unexpectedReads.push(`${request.method()} ${pathname}`);
      });
      const captureSection = async (name: string, dialog = false) => {
        if (width === 760) return; // Retain boundary behavior; visual matrix uses four standard widths.
        if (!dialog) {
          await page.locator('main.app-main').evaluate((main) => {
            main.scrollTop = 0;
          });
          await expect
            .poll(() => page.locator('main.app-main').evaluate((main) => main.scrollTop))
            .toBe(0);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
        const path = info.outputPath(`settings-${name}-${theme}-${width}.png`);
        await page.screenshot({ path, fullPage: true, animations: 'disabled' });
        await info.attach(`settings-${name}`, { path, contentType: 'image/png' });
        if (!dialog) {
          const main = page.locator('main.app-main');
          const scroll = await main.evaluate((element) => ({
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
            scrollTop: element.scrollTop,
          }));
          await info.attach(`settings-${name}-scroll`, {
            body: JSON.stringify(scroll),
            contentType: 'application/json',
          });
          if (scroll.scrollHeight > scroll.clientHeight + 1) {
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
            const bottomPath = info.outputPath(`settings-${name}-bottom-${theme}-${width}.png`);
            await page.screenshot({ path: bottomPath, fullPage: true, animations: 'disabled' });
            await info.attach(`settings-${name}-bottom`, {
              path: bottomPath,
              contentType: 'image/png',
            });
            await main.evaluate((element) => {
              element.scrollTop = 0;
            });
            await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(0);
          }
        }
      };
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      const settingsReads = [
        '/api/v1/auth/status',
        '/api/v1/auth/tokens',
        '/api/v1/settings/capabilities',
      ].map((path) =>
        page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === path && response.request().method() === 'GET',
        ),
      );
      await page.goto('/settings/appearance');
      for (const response of await Promise.all(settingsReads)) expect(response.ok()).toBe(true);
      const nav = page.getByRole('navigation', { name: '设置分区' });
      const links = nav.getByRole('link');
      await expect(links).toHaveCount(6);
      // Capture first-paint discoverability before any focus/click can scroll a hidden item into view.
      const boxes = await links.evaluateAll((items) =>
        items.map((item) => {
          const box = item.getBoundingClientRect();
          const nav = item.closest('nav')!.getBoundingClientRect();
          return {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            left: box.left,
            inside:
              box.left >= nav.left &&
              box.right <= nav.right + 1 &&
              box.top >= 0 &&
              box.bottom <= innerHeight,
          };
        }),
      );
      await info.attach('settings-navigation-raw-rects', {
        body: JSON.stringify({ width, theme, boxes }),
        contentType: 'application/json',
      });
      expect(boxes.every((box) => box.inside)).toBe(true);
      if (width <= 760) {
        // e866e28 Chromium trace measured 43.99998474121094 CSS px for a
        // 44px target. Allow only 0.001px floating-point noise, not a smaller
        // touch target; preserve raw rectangles above for every future run.
        const geometryEpsilon = 0.001;
        expect(boxes.every((box) => box.height + geometryEpsilon >= 44)).toBe(true);
        expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(2);
        expect(new Set(boxes.map((box) => Math.round(box.x))).size).toBe(3);
      } else expect(new Set(boxes.map((box) => Math.round(box.x))).size).toBe(1);
      const path = info.outputPath(`settings-navigation-${theme}-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      await info.attach('settings-navigation', { path, contentType: 'image/png' });
      for (const [id, label, heading] of sections) {
        const link = nav.getByRole('link', { name: new RegExp(label) });
        await expect(link).toHaveAttribute('href', `/settings/${id}`);
        await link.click();
        await expect(page).toHaveURL(new RegExp(`/settings/${id}$`));
        await expect(link).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        if (id === 'account')
          await expect(page.getByText('本地可信模式', { exact: true })).toBeVisible();
        if (id === 'integrations')
          await expect(page.getByText('还没有 API token。', { exact: true })).toBeVisible();
        if (id === 'system') {
          await expect(page.getByText('运行平台', { exact: true })).toBeVisible();
          await expect(page.getByText('正在读取 Terminal 状态', { exact: true })).toHaveCount(0);
          await expect(
            page.getByRole('link', { name: '打开运行环境', exact: true }),
          ).toHaveAttribute('href', '/agents/runtime');
          await expect(
            page.getByRole('link', { name: '打开远程节点', exact: true }),
          ).toHaveAttribute('href', '/agents/nodes');
        }
        if (id === 'security' || id === 'advanced')
          await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeDisabled();
        if (id !== 'appearance') await captureSection(id);
        if (id === 'security') {
          const passwordTrigger = page.getByRole('button', { name: '修改密码', exact: true });
          await passwordTrigger.focus();
          await page.keyboard.press('Enter');
          const dialog = page.getByRole('dialog', { name: '修改管理员密码', exact: true });
          await expect(dialog).toBeVisible();
          for (const field of ['当前密码', '新密码', '确认新密码'])
            await expect(dialog.getByLabel(field, { exact: true })).toHaveValue('');
          await captureSection('password-dialog-empty', true);
          await dialog.getByRole('button', { name: '取消', exact: true }).click();
          await expect(dialog).toHaveCount(0);
          await expect(passwordTrigger).toBeFocused();
        }
      }
      await page.getByRole('link', { name: /^集成/ }).click();
      const createToken = page.getByRole('button', { name: '创建 token', exact: true });
      await createToken.focus();
      await page.keyboard.press('Enter');
      const tokenDialog = page.getByRole('dialog', { name: '创建 API token' });
      await expect(tokenDialog).toBeVisible();
      await tokenDialog.getByRole('textbox', { name: 'token 名称' }).fill('仅测试取消，不创建凭据');
      await captureSection('token-dialog-cancel-only', true);
      await tokenDialog.getByRole('button', { name: '取消', exact: true }).click();
      await expect(tokenDialog).toHaveCount(0);
      await expect(createToken).toBeFocused();
      await page.goto('/settings/appearance');
      const advanced = nav.getByRole('link', { name: /高级/ });
      await advanced.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/settings\/advanced$/);
      await page.goBack();
      await expect(nav.getByRole('link', { name: /外观/ })).toHaveAttribute('aria-current', 'page');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      expect(writes).toEqual([]);
      expect(unexpectedReads).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
