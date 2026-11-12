import { test, expect } from './fixtures.js';
import { apiData } from './baseline-support.js';

test.use({ authMode: 'local_trusted' });
for (const theme of ['light', 'dark']) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`Runtime 已知状态不显示未知 ${theme} ${width}`, async ({ page, context }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      const rows = await apiData<
        Array<{ candidateId: string; state: string; statusText?: string }>
      >(context, 'get', '/discovery/runtimes');
      const local = rows.find((row) => row.candidateId === 'host:local');
      expect(local?.state).toBe('READY');
      expect(local?.statusText).toBeUndefined();
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto('/agents/runtime');
      await page.evaluate((value) => localStorage.setItem('agenthub-theme', value), theme);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Runtime', exact: true })).toBeVisible();
      const detail = page.getByText('Local Host · 就绪', { exact: true });
      await expect(detail).toBeVisible();
      await expect(detail.locator('../..').getByText('就绪', { exact: true })).toBeVisible();
      await expect(detail.locator('../..').getByText(/状态待确认/)).toHaveCount(0);
      await page.getByRole('button', { name: '重新扫描' }).click();
      await expect(page.getByRole('button', { name: '重新扫描' })).toBeEnabled();
      await expect(detail).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const path = info.outputPath(`runtime-status-${theme}-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      await info.attach(`runtime-status-${theme}-${width}`, { path, contentType: 'image/png' });
      expect(errors).toEqual([]);
    });
  }
}
