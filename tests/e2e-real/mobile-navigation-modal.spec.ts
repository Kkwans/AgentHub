import { seedWorkspace } from './baseline-support.js';
import { expect, test } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
// Real browser/native-dialog and isolated service fixture, not real-provider evidence.
for (const theme of ['light', 'dark']) {
  test(`手机导航原生模态、焦点与历史 ${theme}`, async ({ page, app }, info) => {
    const { project } = await seedWorkspace(page.context(), app);
    await page.addInitScript((value) => localStorage.setItem('agenthub-theme', value), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/projects/${project.id}/overview`);
    const opener = page.getByRole('button', { name: '打开导航', exact: true });
    const dialog = page.getByRole('dialog', { name: '导航', exact: true });
    const open = async () => {
      await opener.click();
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((node) => node.matches(':modal'))).toBe(true);
      await expect
        .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
        .toBe(true);
    };
    await open();
    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 844)).toBeLessThanOrEqual(1);
    // Even programmatic focus cannot enter the browser-inert background.
    await opener.evaluate((node) => node.focus());
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    const focusables = dialog
      .locator('a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]')
      .filter({ visible: true });
    const first = focusables.first();
    const last = focusables.last();
    await first.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();
    await info.attach(`native-navigation-${theme}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => history.state?.mobileDrawer)).toBeUndefined();
    await open();
    // Hit the native ::backdrop, not a sibling overlay under the top layer.
    await page.mouse.click(380, 420);
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await open();
    const beforeBack = page.url();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toBe(beforeBack);
    await expect(opener).toBeFocused();
    await open();
    await dialog.getByRole('link', { name: 'Prompt 库', exact: true }).click();
    await expect(page).toHaveURL(/\/prompts$/);
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => history.state?.mobileDrawer)).toBeUndefined();
    await open();
    const account = dialog.getByRole('link', { name: '本地受信任访问，账号设置', exact: true });
    const accountBox = (await account.boundingBox())!;
    expect(accountBox.height).toBeGreaterThanOrEqual(43.99);
    expect(accountBox.width).toBeGreaterThanOrEqual(43.99);
    await account.click();
    await expect(page).toHaveURL(/\/settings\/account$/);
    await expect(dialog).toHaveCount(0);
    await open();
    await page.keyboard.press('Control+k');
    await expect(dialog).toHaveCount(0);
    const command = page.getByRole('combobox', { name: '搜索', exact: true });
    await expect(command).toBeVisible();
    await expect(command).toBeFocused();
    await command.fill('项目');
    await expect(command).toHaveValue('项目');
    await expect(command).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(command).toHaveCount(0);
    // Reopen/close repeatedly: a stale deferred-focus frame cannot steal focus.
    for (let index = 0; index < 2; index += 1) {
      await opener.click();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(opener).toBeFocused();
    }
  });
}
