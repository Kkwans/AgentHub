import { test, expect } from './fixtures.js';
import { apiData } from './baseline-support.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
test('版本草稿历史导航后不串写 A/B 资产', async ({ page, context }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const create = (name: string) =>
    apiData<{ id: string }>(context, 'post', '/prompts', {
      key: `ownership/${name}`,
      name: `资产 ${name}`,
      type: 'TEXT',
      kind: 'TASK',
    });
  const a = await create('A');
  const b = await create('B');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/prompts?promptId=${b.id}`);
  await expect(page.getByRole('heading', { name: '资产 B', exact: true })).toBeVisible();
  // Seed browser history with two real routes. The user can leave a modal via
  // browser Back even when its backdrop prevents background pointer interaction.
  await page.goto(`/prompts?promptId=${a.id}`);
  await page.getByRole('button', { name: '创建第一个版本', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建新版本', exact: true });
  await expect(dialog.getByText('目标 Prompt：资产 A', { exact: true })).toBeVisible();
  await dialog
    .getByRole('textbox', { name: 'Prompt 内容', exact: true })
    .fill('A 的未提交正文，不能写入 B');
  await page.goBack();
  await expect(page.getByRole('heading', { name: '资产 B', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(await apiData<unknown[]>(context, 'get', `/prompts/${a.id}/versions`)).toEqual([]);
  expect(await apiData<unknown[]>(context, 'get', `/prompts/${b.id}/versions`)).toEqual([]);
  await page.getByRole('button', { name: '创建第一个版本', exact: true }).click();
  await expect(dialog.getByText('目标 Prompt：资产 B', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Prompt 内容', exact: true })).toHaveValue('');
  await dialog
    .getByRole('textbox', { name: 'Prompt 内容', exact: true })
    .fill('只属于 B 的真实正文');
  await dialog.getByRole('button', { name: '创建版本', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('只属于 B 的真实正文', { exact: true })).toBeVisible();
  const versions = await apiData<{ promptId: string; contentJson: unknown }[]>(
    context,
    'get',
    `/prompts/${b.id}/versions`,
  );
  expect(versions).toHaveLength(1);
  expect(versions[0]).toMatchObject({
    promptId: b.id,
    contentJson: { text: '只属于 B 的真实正文' },
  });
  expect(await apiData<unknown[]>(context, 'get', `/prompts/${a.id}/versions`)).toEqual([]);
  await page.getByText('只属于 B 的真实正文', { exact: true }).scrollIntoViewIfNeeded();
  const path = info.outputPath('prompt-version-owner-b.png');
  await page.screenshot({ path, fullPage: true });
  await info.attach('prompt-version-owner-b', { path, contentType: 'image/png' });
  expect(errors).toEqual([]);
});
