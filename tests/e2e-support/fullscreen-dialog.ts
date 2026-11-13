import { expect, type Locator, type Page } from '@playwright/test';

/** Browser geometry, not DOM visibility: controls must stay inside the viewport after body scroll. */
export async function assertFullscreenScroll(page: Page, dialog: Locator, requireScroll = false) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Viewport required');
  await expect(dialog).toHaveClass(/ah-dialog-fullscreen/);
  const body = dialog.locator('.ah-dialog-body');
  await expect(body).toHaveCSS('overflow-y', 'auto');
  await expect(body).toHaveCSS('align-content', 'start');
  const before = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  expect(Math.abs(before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.height - viewport.height)).toBeLessThanOrEqual(1);
  const scroll = await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return { top: element.scrollTop, height: element.clientHeight, content: element.scrollHeight };
  });
  if (requireScroll) expect(scroll.top).toBeGreaterThan(0);
  for (const part of [dialog.locator('.ah-dialog-header'), dialog.locator('.ah-dialog-footer')]) {
    const rect = await part.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height + 1);
  }
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  for (const button of await dialog
    .locator('.ah-dialog-header button, .ah-dialog-footer button')
    .all()) {
    const rect = await button.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.height).toBeGreaterThanOrEqual(44);
  }
  return { viewport, dialog: before, body: scroll };
}
