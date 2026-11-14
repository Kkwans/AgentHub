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
      await expect(page.getByText('SETTINGS', { exact: true })).toHaveCount(0);
      const preferences = page.getByRole('region', { name: '外观偏好' });
      const themeControl = preferences.getByRole('combobox', { name: '主题', exact: true });
      const sidebarControl = preferences.getByRole('combobox', { name: '侧边栏行为', exact: true });
      const themeBox = (await themeControl.boundingBox())!;
      const sidebarBox = (await sidebarControl.boundingBox())!;
      expect(themeBox.height).toBeGreaterThanOrEqual(43.99);
      if (width === 390) {
        expect(themeBox.y).toBeLessThan(360);
        expect(sidebarBox.y + sidebarBox.height).toBeLessThan(844);
        const themeLabel = (await preferences.getByText('主题', { exact: true }).boundingBox())!;
        expect(themeBox.x).toBeGreaterThanOrEqual(themeLabel.x + themeLabel.width);
        expect(themeBox.y).toBeLessThan(themeLabel.y + themeLabel.height + 10);
        expect(Math.abs(themeLabel.x - 16)).toBeLessThanOrEqual(1);
        const motion = preferences.getByRole('switch', { name: '减少动效' });
        const target = await motion.evaluate((node) => {
          const b = node.closest('label')!.getBoundingClientRect();
          return { width: b.width, height: b.height };
        });
        expect(target.width).toBeGreaterThanOrEqual(43.99);
        expect(target.height).toBeGreaterThanOrEqual(43.99);
      }
      const navAxis = await page.getByRole('navigation', { name: '设置分区' }).evaluate((node) => {
        const b = node.getBoundingClientRect();
        const h = document.querySelector('.page-header-row')!.getBoundingClientRect();
        return { left: b.left, headerLeft: h.left };
      });
      expect(Math.abs(navAxis.left - navAxis.headerLeft)).toBeLessThanOrEqual(1);
      await info.attach('settings-controls-geometry', {
        body: JSON.stringify({ themeBox, sidebarBox, navAxis }),
        contentType: 'application/json',
      });
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
