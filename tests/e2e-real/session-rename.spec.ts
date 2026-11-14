import { apiData, seedWorkspace } from './baseline-support.js';
import { expect, test } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);

type SessionTitle = {
  id: string;
  projectId: string;
  title: string;
  titleRevision: number;
};

// Real HTTP/PGlite plus the controlled ACP fixture. No external provider or prompt is used.
for (const theme of ['light', 'dark']) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`真实会话重命名 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const { session, project } = await seedWorkspace(context, app);
      const original = await apiData<SessionTitle>(context, 'get', `/sessions/${session.id}`);
      expect(Number.isSafeInteger(original.titleRevision)).toBe(true);
      const errors: string[] = [];
      const patches: unknown[] = [];
      const renamePath = `/api/v1/sessions/${session.id}/title`;
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('request', (request) => {
        if (request.method() === 'PATCH' && new URL(request.url()).pathname === renamePath)
          patches.push(request.postDataJSON());
      });
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(`/workspace/${session.id}`);
      await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
      if (width < 768) {
        const more = page.getByRole('button', { name: '更多会话操作', exact: true });
        await more.click();
        await expect(more).toHaveAttribute('aria-expanded', 'true');
      }
      const rename = page.getByRole('button', { name: '重命名会话', exact: true });
      await expect(rename).toBeVisible();
      await rename.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: '重命名会话', exact: true });
      await expect(dialog).toBeVisible();
      const name = dialog.getByRole('textbox', { name: '会话名称', exact: true });
      await expect(name).toHaveValue(original.title);
      const title = `会话名称 · 验证交付 ${width} ${theme}`;
      await name.fill(title);
      const save = dialog.getByRole('button', { name: '保存名称', exact: true });
      await expect(save).toBeEnabled();
      const dialogBox = await dialog.boundingBox();
      expect(dialogBox).not.toBeNull();
      expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(width + 1);
      const editShot = info.outputPath(`session-rename-form-${width}-${theme}.png`);
      await page.screenshot({ path: editShot });
      await info.attach('会话重命名表单', { path: editShot, contentType: 'image/png' });

      const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          new URL(response.url()).pathname === renamePath,
      );
      await save.click();
      const response = await responsePromise;
      expect(response.ok()).toBe(true);
      expect((await response.json()).data).toMatchObject({
        id: session.id,
        projectId: project.id,
        title,
        titleRevision: original.titleRevision + 1,
      });
      await expect(page.getByText('会话名称已更新。', { exact: true })).toBeVisible();
      await expect(page.locator('.codex-session-title strong')).toHaveText(title);
      expect(patches).toEqual([{ title, expectedRevision: original.titleRevision }]);
      const saved = await apiData<SessionTitle>(context, 'get', `/sessions/${session.id}`);
      expect(saved).toMatchObject({ title, titleRevision: original.titleRevision + 1 });
      const listed = await apiData<SessionTitle[]>(
        context,
        'get',
        `/sessions?projectId=${project.id}`,
      );
      expect(listed.find((row) => row.id === session.id)).toMatchObject({
        title,
        titleRevision: original.titleRevision + 1,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await dialog.getByRole('button', { name: '关闭重命名窗口', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(rename).toBeFocused();
      await expect(page.locator('.codex-session-title strong')).toHaveText(title);
      const savedShot = info.outputPath(`session-rename-saved-${width}-${theme}.png`);
      await page.screenshot({ path: savedShot });
      await info.attach('已保存会话名称', { path: savedShot, contentType: 'image/png' });
      expect(errors).toEqual([]);
    });
  }
}

test('重命名草稿从桌面缩至手机：保留弹窗并恢复可见操作焦点', async ({ page, context, app }) => {
  const { session } = await seedWorkspace(context, app);
  const patches: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname === `/api/v1/sessions/${session.id}/title`
    )
      patches.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/workspace/${session.id}`);
  const rename = page.getByRole('button', { name: '重命名会话', exact: true });
  await rename.click();
  const dialog = page.getByRole('dialog', { name: '重命名会话', exact: true });
  const input = dialog.getByRole('textbox', { name: '会话名称', exact: true });
  await input.fill('跨宽度保留的未提交草稿');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await expect(input).toHaveValue('跨宽度保留的未提交草稿');
  await expect(input).toBeFocused();
  await dialog.getByRole('button', { name: '关闭重命名窗口', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rename).toBeVisible();
  await expect(rename).toBeFocused();
  const more = page.getByRole('button', { name: '更多会话操作', exact: true });
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(more).toBeFocused();
  expect(patches).toEqual([]);
});

for (const initialWidth of [390, 1440]) {
  test(`真实会话重命名已提交但响应丢失：核对只GET且不重投PATCH ${initialWidth}`, async ({
    page,
    context,
    app,
  }, info) => {
    const { session } = await seedWorkspace(context, app);
    const original = await apiData<SessionTitle>(context, 'get', `/sessions/${session.id}`);
    const renameUrl = `${app.origin}/api/v1/sessions/${session.id}/title`;
    let patches = 0;
    let injected = false;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (
        injected &&
        message.location().url === renameUrl &&
        message.text() === 'Failed to load resource: net::ERR_FAILED'
      )
        return;
      errors.push(message.text());
    });
    const title = '已写入但尚未确认的名称';
    await context.route(renameUrl, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      patches += 1;
      expect(route.request().postDataJSON()).toEqual({
        title,
        expectedRevision: original.titleRevision,
      });
      const response = await route.fetch({ maxRetries: 0 });
      expect(response.ok()).toBe(true);
      expect((await response.json()).data).toMatchObject({
        id: session.id,
        title,
        titleRevision: original.titleRevision + 1,
      });
      injected = true;
      await route.abort('failed');
    });
    await page.setViewportSize({ width: initialWidth, height: initialWidth === 390 ? 844 : 900 });
    await page.goto(`/workspace/${session.id}`);
    if ((page.viewportSize()?.width ?? 1440) < 768)
      await page.getByRole('button', { name: '更多会话操作', exact: true }).click();
    await page.getByRole('button', { name: '重命名会话', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '重命名会话', exact: true });
    await dialog.getByRole('textbox', { name: '会话名称', exact: true }).fill(title);
    await dialog.getByRole('button', { name: '保存名称', exact: true }).click();
    const readback = dialog.getByRole('button', { name: '核对当前名称', exact: true });
    await expect(readback).toBeEnabled();
    if (initialWidth === 1440) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(dialog).toBeVisible();
      await expect(readback).toBeEnabled();
      await expect(dialog.getByRole('button', { name: '保存名称', exact: true })).toHaveCount(0);
      await dialog.getByRole('button', { name: '关闭重命名窗口', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const rename = page.getByRole('button', { name: '重命名会话', exact: true });
      const more = page.getByRole('button', { name: '更多会话操作', exact: true });
      await expect(rename).toBeVisible();
      await expect(rename).toBeFocused();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await expect(more).toBeFocused();
      await more.click();
      await rename.click();
      await expect(dialog).toBeVisible();
      await expect(readback).toBeEnabled();
      expect(patches).toBe(1);
    }

    await expect(dialog.getByRole('button', { name: '保存名称', exact: true })).toHaveCount(0);
    const readPromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === `/api/v1/sessions/${session.id}`,
    );
    await readback.click();
    expect((await readPromise).ok()).toBe(true);
    await expect(
      dialog.getByText(
        /^当前名称已变化；无法确认是否由本次请求写入。原版本已失效，不会自动重试。$/,
      ),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: '保存名称', exact: true })).toHaveCount(0);
    expect(patches).toBe(1);
    const stored = await apiData<SessionTitle>(context, 'get', `/sessions/${session.id}`);
    expect(stored).toMatchObject({ title, titleRevision: original.titleRevision + 1 });
    await expect(page.getByText('会话名称已更新。', { exact: true })).toHaveCount(0);
    const shot = info.outputPath('session-rename-response-lost-readback.png');
    await page.screenshot({ path: shot });
    await info.attach('重命名未知结果只读核对', { path: shot, contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
}
