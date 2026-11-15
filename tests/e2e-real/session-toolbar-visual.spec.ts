import type { Locator, Page, TestInfo } from '@playwright/test';
import { seedWorkspace } from './baseline-support.js';
import { test, expect } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(180_000);

type Box = { x: number; y: number; width: number; height: number };
const sameRow = (boxes: Box[]) =>
  Math.min(...boxes.map((box) => box.y + box.height)) > Math.max(...boxes.map((box) => box.y));

async function captureToolbar(page: Page, info: TestInfo, state: string, expanded: boolean) {
  const toolbar = page.locator('[aria-label="会话筛选"]');
  const controls: Record<string, Locator> = {
    search: toolbar.getByRole('textbox', { name: '搜索会话', exact: true }),
    count: toolbar.getByText('1 个会话', { exact: true }),
    create: toolbar.getByRole('button', { name: '新建会话', exact: true }),
  };
  const width = page.viewportSize()!.width;
  if (width >= 768 || expanded) {
    controls.agent = toolbar.getByRole('combobox', { name: '会话 Agent', exact: true });
    controls.status = toolbar.getByRole('combobox', { name: '会话状态', exact: true });
  }
  if (width < 768) {
    controls.toggle = toolbar.getByRole('button', { name: /^筛选/ });
    const clear = toolbar.getByRole('button', { name: '清除条件', exact: true });
    if (await clear.count()) controls.clear = clear;
  }
  const boxes: Record<string, Box> = {};
  const text: Record<
    string,
    Array<{ left: number; right: number; top: number; bottom: number }>
  > = {};
  for (const [name, control] of Object.entries(controls)) {
    await expect(control).toBeVisible();
    boxes[name] = (await control.boundingBox())!;
    text[name] = await control.evaluate((node) => {
      const result = [];
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let child = walker.nextNode(); child; child = walker.nextNode()) {
        if (!child.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        for (const rect of range.getClientRects())
          result.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
      }
      return result;
    });
  }
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  const path = info.outputPath(`session-toolbar-${state}.png`);
  await page.screenshot({ path });
  await info.attach(`session-toolbar-${state}`, { path, contentType: 'image/png' });
  await info.attach(`session-toolbar-${state}-geometry`, {
    body: JSON.stringify({ boxes, text, viewport }),
    contentType: 'application/json',
  });
  expect(viewport.overflow).toBeLessThanOrEqual(1);
  const entries = Object.entries(boxes);
  for (const [name, box] of entries) {
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(viewport.width + 1);
    for (const rect of text[name]!) {
      expect(rect.left, name).toBeGreaterThanOrEqual(box.x - 1);
      expect(rect.right, name).toBeLessThanOrEqual(box.x + box.width + 1);
      expect(rect.top, name).toBeGreaterThanOrEqual(box.y - 1);
      expect(rect.bottom, name).toBeLessThanOrEqual(box.y + box.height + 1);
    }
  }
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const [aName, a] = entries[i]!,
        [bName, b] = entries[j]!;
      expect(
        a.x + a.width <= b.x + 1 ||
          b.x + b.width <= a.x + 1 ||
          a.y + a.height <= b.y + 1 ||
          b.y + b.height <= a.y + 1,
        `${aName}/${bName} overlap`,
      ).toBe(true);
    }
  if (width >= 960) {
    expect(sameRow([boxes.search!, boxes.agent!, boxes.status!, boxes.count!, boxes.create!])).toBe(
      true,
    );
  } else if (width >= 768) {
    expect(sameRow([boxes.search!, boxes.count!, boxes.create!])).toBe(true);
    expect(sameRow([boxes.agent!, boxes.status!])).toBe(true);
    expect(Math.min(boxes.agent!.y, boxes.status!.y)).toBeGreaterThanOrEqual(
      Math.max(...[boxes.search!, boxes.count!, boxes.create!].map((box) => box.y + box.height)),
    );
  }
  if (width < 768) {
    for (const name of [
      'create',
      'toggle',
      ...(expanded ? ['agent', 'status'] : []),
      ...(controls.clear ? ['clear'] : []),
    ]) {
      expect(boxes[name]!.height, name).toBeGreaterThanOrEqual(44);
      expect(boxes[name]!.width, name).toBeGreaterThanOrEqual(44);
    }
  }
}

for (const width of [390, 768, 1024, 1440])
  for (const theme of ['light', 'dark']) {
    test(`真实项目会话工具栏 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const { project, session } = await seedWorkspace(context, app);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.addInitScript((theme) => localStorage.setItem('agenthub-theme', theme), theme);
      await page.goto(`/projects/${project.id}/sessions`);
      await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
      const sessionLink = page.locator(`a[href="/workspace/${session.id}"]`);
      await expect(sessionLink).toBeVisible();
      const toolbar = page.locator('[aria-label="会话筛选"]');
      const status = toolbar.getByRole('combobox', { name: '会话状态', exact: true });
      await captureToolbar(page, info, 'default', false);
      if (width < 768) {
        await expect(status).toBeHidden();
        const toggle = toolbar.getByRole('button', { name: '筛选', exact: true });
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await captureToolbar(page, info, 'expanded', true);
      }
      // The real seeded session contributes its actual status; choose that option
      // rather than inventing another server state or intercepting the response.
      const label = (await sessionLink.getByRole('status').innerText()).trim();
      expect(label).not.toBe('');
      expect(label).not.toBe('全部状态');
      expect(label).not.toBe('清除选择');
      await status.click();
      const choice = page.getByRole('option', { name: label, exact: true });
      await expect(choice).toHaveCount(1);
      await choice.click();
      await expect(status).toContainText(label);
      await expect(sessionLink).toBeVisible();
      if (width < 768) {
        await expect(toolbar.getByRole('button', { name: '筛选（1）', exact: true })).toBeVisible();
        await expect(toolbar.getByRole('button', { name: '清除条件', exact: true })).toBeVisible();
        await captureToolbar(page, info, 'filtered', true);
      }
      await status.click();
      await page.getByRole('option', { name: '全部状态', exact: true }).click();
      await expect(status).toContainText('全部状态');
      if (width < 768) {
        const toggle = toolbar.getByRole('button', { name: '筛选', exact: true });
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(status).toBeHidden();
        await expect(toggle).toBeFocused();
      }
      await expect(sessionLink).toBeVisible();
      await captureToolbar(page, info, 'restored', false);
    });
  }
