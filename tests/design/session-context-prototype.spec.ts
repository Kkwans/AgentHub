import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

// Simulated standalone HTML prototype, NOT real-service/Agent integration evidence.
async function textGeometry(locator: Locator) {
  return locator.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(node);
    const panel = node.closest('[data-context-fields]')?.getBoundingClientRect() ?? bounds;
    return {
      text: node.textContent,
      bounds: {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      },
      panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      rects: Array.from(range.getClientRects()).map((rect) => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      })),
    };
  });
}
async function screenshot(page: Page, info: TestInfo, state: string) {
  const path = info.outputPath(`prototype-session-context-${state}.png`);
  // Full-page prototype artifact, not a claim that all content fits the viewport.
  await page.screenshot({ path, fullPage: true });
  await info.attach(`prototype-${state}`, { path, contentType: 'image/png' });
}
for (const width of [390, 768, 1024, 1440])
  for (const theme of ['light', 'dark'] as const) {
    test(`HTML原型 会话上下文 ${width} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const html = await readFile(
        new URL('../../docs/rebuild/prototypes/session-context.html', import.meta.url),
        'utf8',
      );
      await page.setContent(html);
      const toggle = page.locator('button[data-theme-toggle]');
      await expect(toggle).toHaveAccessibleName('切换主题');
      const initial = await page.locator('html').getAttribute('data-theme');
      expect(['light', 'dark']).toContain(initial);
      await toggle.click();
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        initial === 'light' ? 'dark' : 'light',
      );
      if ((await page.locator('html').getAttribute('data-theme')) !== theme) await toggle.click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const rows = page.locator('article[data-session-row]');
      await expect(rows).toHaveCount(3);
      const labels = rows.locator('[data-directory-label]');
      await expect(labels).toHaveCount(3);
      const paths = [];
      for (const row of await rows.all()) {
        paths.push((await row.locator('[data-context-fields] dd').last().textContent())!.trim());
      }
      const defaultGeometry = [];
      for (const label of await labels.all()) defaultGeometry.push(await textGeometry(label));
      const summaries = rows.locator('summary[data-context-summary]');
      const summaryGeometry = await summaries.evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
      );
      await screenshot(page, info, 'default');
      await info.attach('prototype-default-geometry', {
        body: JSON.stringify({ defaultGeometry, summaryGeometry, paths }),
        contentType: 'application/json',
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      for (const row of await rows.all()) {
        const link = row.locator('a[data-primary-link]');
        await expect(link).toHaveCount(1);
        await expect(
          link.locator('a,button,input,select,textarea,details,summary,[role="button"],[tabindex]'),
        ).toHaveCount(0);
        await expect(row.locator(':scope > details')).toHaveCount(1);
        await expect(row.locator('details')).not.toHaveAttribute('open', '');
      }
      await expect(labels).toHaveText(['client-web', 'client-web', 'client-web']);
      expect(new Set(paths).size).toBe(3);
      for (const path of paths) expect(path).toMatch(/\/client-web$/);
      for (const box of summaryGeometry) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      for (const item of defaultGeometry) {
        expect(item.text?.trim()).not.toBe('');
        expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth + 1);
        for (const rect of item.rects) {
          expect(rect.left).toBeGreaterThanOrEqual(Math.max(0, item.bounds.left) - 1);
          expect(rect.right).toBeLessThanOrEqual(
            Math.min(item.viewport.width, item.bounds.right) + 1,
          );
        }
      }
      const row = rows.nth(1);
      const summary = row.locator('summary[data-context-summary]');
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(row.locator('details')).toHaveAttribute('open', '');
      const fields = row.locator('dl[data-context-fields]');
      await expect(fields).toBeVisible();
      await screenshot(page, info, 'expanded');
      const fieldGeometry = [];
      for (const field of await fields.locator('dd').all()) {
        // A long expanded panel may scroll normally; each complete field must be
        // readable when brought into view, not clipped to fit the initial screen.
        await field.scrollIntoViewIfNeeded();
        fieldGeometry.push(await textGeometry(field));
      }
      await info.attach('prototype-expanded-geometry', {
        body: JSON.stringify(fieldGeometry),
        contentType: 'application/json',
      });
      expect(fieldGeometry.length).toBeGreaterThanOrEqual(4);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      for (const field of fieldGeometry) {
        expect(field.text?.trim()).not.toBe('');
        expect(field.scrollWidth).toBeLessThanOrEqual(field.clientWidth + 1);
        for (const rect of field.rects) {
          expect(rect.left).toBeGreaterThanOrEqual(
            Math.max(0, field.panel.left, field.bounds.left) - 1,
          );
          expect(rect.right).toBeLessThanOrEqual(
            Math.min(field.viewport.width, field.panel.right, field.bounds.right) + 1,
          );
          expect(rect.top).toBeGreaterThanOrEqual(Math.max(field.panel.top, field.bounds.top) - 1);
          expect(rect.bottom).toBeLessThanOrEqual(
            Math.min(field.panel.bottom, field.bounds.bottom) + 1,
          );
        }
      }
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(row.locator('details')).not.toHaveAttribute('open', '');
      await expect(fields).toBeHidden();
      await expect(summary).toBeFocused();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    });
  }
