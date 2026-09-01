import { apiData, seedWorkspace } from './baseline-support.js';
import { expect, test } from './fixtures.js';

test.describe('v1 PromptOS lifecycle drawer', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ authMode: 'local_trusted' });

  test('在右侧抽屉中查看版本、标签与差异入口', async ({ context, app }) => {
    const fixture = await seedWorkspace(context, app);
    const prompt = await apiData<{ id: string }>(context, 'post', '/prompts', {
      projectId: fixture.project.id,
      key: 'e2e/lifecycle-drawer',
      name: '生命周期抽屉验证',
      kind: 'TASK',
      type: 'TEXT',
    });
    await apiData(context, 'post', `/prompts/${prompt.id}/versions`, {
      content: { text: '第一版 Prompt 内容。' },
      changelog: '初始版本',
    });
    await apiData(context, 'post', `/prompts/${prompt.id}/versions`, {
      content: { text: '第二版 Prompt 内容，增加验收说明。' },
      changelog: '增加验收说明',
    });

    const page = await context.newPage();
    await page.goto(`/prompts/${prompt.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '生命周期抽屉验证' })).toBeVisible();
    await page.getByRole('button', { name: '版本与标签' }).click();

    const drawer = page.getByRole('dialog', { name: '版本与标签' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('版本不可变；标签是指向已发布版本的可移动指针。');
    await expect(drawer).toContainText('版本历史');
    await expect(drawer).toContainText('版本比较');
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox?.width).toBeGreaterThanOrEqual(400);
    expect(drawerBox?.width).toBeLessThanOrEqual(440);
  });
});
