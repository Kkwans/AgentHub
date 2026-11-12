import { test, expect } from './fixtures.js';
import { apiData, seedWorkspace } from './baseline-support.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);

test('真实会话创建：Back与重新打开不被旧成功导航抢走', async ({ page, context, app }) => {
  const seeded = await seedWorkspace(context, app);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let created: { id: string; projectId: string } | undefined;
  let posts = 0;
  await context.route(`${app.origin}/api/v1/sessions`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts += 1;
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.ok()).toBe(true);
    created = (await response.json()).data;
    await held;
    await route.fulfill({ response });
  });
  await page.goto(`/projects/${seeded.project.id}/sessions`);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('textbox', { name: '会话名称' }).fill('只创建一次的原项目会话');
  await page.getByRole('button', { name: '创建并进入 Workspace', exact: true }).click();
  await expect.poll(() => created?.projectId).toBe(seeded.project.id);
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '创建并进入 Workspace', exact: true }),
  ).toBeDisabled();
  release();
  const savedLink = page.getByRole('link', {
    name: '打开已创建的会话：只创建一次的原项目会话',
    exact: true,
  });
  await expect(savedLink).toHaveAttribute('href', `/workspace/${created!.id}`);
  await expect(
    page.getByRole('button', { name: '创建并进入 Workspace', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('dialog', { name: '新建会话', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '会话名称' })).toHaveValue(
    '只创建一次的原项目会话',
  );
  await expect(page).toHaveURL(new RegExp(`/projects/${seeded.project.id}/sessions\\?new=1$`));
  const rows = await apiData<Array<{ id: string; title: string }>>(
    context,
    'get',
    `/sessions?projectId=${seeded.project.id}`,
  );
  expect(rows.filter((row) => row.title === '只创建一次的原项目会话')).toHaveLength(1);
  expect(posts).toBe(1);
  await page.getByRole('button', { name: '创建另一会话', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '会话名称' })).toHaveValue('新 Session');
  await expect(
    page.getByRole('button', { name: '创建并进入 Workspace', exact: true }),
  ).toBeEnabled();
  await expect(savedLink).toHaveCount(0);
  expect(posts).toBe(1);
  expect(errors).toEqual([]);
});

test('真实已创建但响应丢失：只读核对不重放POST', async ({ page, context, app }, info) => {
  const seeded = await seedWorkspace(context, app);
  const url = `${app.origin}/api/v1/sessions`;
  let injected = false;
  let posts = 0;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (
      injected &&
      message.location().url === url &&
      message.text() === 'Failed to load resource: net::ERR_FAILED'
    )
      return;
    errors.push(message.text());
  });
  await context.route(url, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts += 1;
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.ok()).toBe(true);
    expect((await response.json()).data.projectId).toBe(seeded.project.id);
    injected = true;
    await route.abort('failed');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/projects/${seeded.project.id}/sessions`);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('textbox', { name: '会话名称' }).fill('已保存但响应丢失');
  await page.getByRole('button', { name: '创建并进入 Workspace', exact: true }).click();
  await expect(page.getByText(/创建结果尚未确认/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: '创建并进入 Workspace', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '读取原项目会话', exact: true }).click();
  const saved = page
    .getByRole('dialog')
    .getByRole('link', { name: '已保存但响应丢失', exact: true });
  await expect(saved).toBeVisible();
  const rows = await apiData<Array<{ title: string }>>(
    context,
    'get',
    `/sessions?projectId=${seeded.project.id}`,
  );
  expect(rows.filter((row) => row.title === '已保存但响应丢失')).toHaveLength(1);
  expect(posts).toBe(1);
  const screenshot = info.outputPath('session-creation-unknown-readback.png');
  await page.getByRole('dialog').screenshot({ path: screenshot });
  await info.attach('session-creation-unknown-readback', {
    path: screenshot,
    contentType: 'image/png',
  });
  await saved.click();
  await expect(page).toHaveURL(/\/workspace\/[0-9a-f-]+$/);
  expect(posts).toBe(1);
  expect(errors).toEqual([]);
});
