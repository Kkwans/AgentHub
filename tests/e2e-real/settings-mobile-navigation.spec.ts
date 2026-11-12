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
      await page.goto('/settings/appearance');
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
      }
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
      expect(errors).toEqual([]);
    });
  }
}
