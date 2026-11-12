import { test, expect } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
for (const width of [390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`设置页头内容高度 ${width} ${theme}`, async ({ page, context, app }, info) => {
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
      await expect(page.getByRole('heading', { name: '外观偏好', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: '设置分区' })).toBeVisible();
      const geometry = await page.locator('.navigation-page-header').evaluate((outer) => {
        const inner = outer.querySelector('.page-header-row');
        if (!inner) throw new Error('Settings header content is missing');
        return {
          outer: outer.getBoundingClientRect().height,
          inner: inner.getBoundingClientRect().height,
        };
      });
      expect(geometry.inner).toBeGreaterThan(0);
      expect(geometry.outer - geometry.inner).toBeGreaterThanOrEqual(0);
      expect(geometry.outer - geometry.inner).toBeLessThanOrEqual(2);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const path = info.outputPath(`settings-header-${width}-${theme}.png`);
      await page.screenshot({ path, fullPage: true });
      await info.attach('settings-header', { path, contentType: 'image/png' });
      await info.attach('settings-header-geometry', {
        body: JSON.stringify(geometry),
        contentType: 'application/json',
      });
      expect(errors).toEqual([]);
    });
  }
}
