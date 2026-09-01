import { seedWorkspace } from './baseline-support.js';
import { expect, test } from './fixtures.js';

test.describe('v1 Workspace Composer controls', () => {
  test.describe.configure({ timeout: 120_000 });
  test.use({ authMode: 'local_trusted' });

  test('将 Session 配置集中到 Composer，并把 Terminal launcher 放在顶栏', async ({
    context,
    app,
  }) => {
    const fixture = await seedWorkspace(context, app);
    const page = await context.newPage();
    await page.goto(`/workspace/${fixture.session.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.workspace-shell')).toBeVisible();

    const terminalLauncher = page.locator('.workspace-context-terminal .terminal-launcher');
    await expect(terminalLauncher).toBeVisible();
    await expect(page.locator('.composer .terminal-launcher')).toHaveCount(0);

    const configurationTrigger = page.getByRole('button', { name: 'Session 配置' });
    await expect(configurationTrigger).toBeVisible();
    await configurationTrigger.click();
    const configuration = page.getByRole('dialog', { name: 'Session 配置' });
    await expect(configuration).toBeVisible();
    await expect(configuration.getByRole('combobox', { name: '模型' })).toBeVisible();
    await expect(configuration.getByRole('combobox', { name: '运行模式' })).toBeVisible();
    await expect(configuration.getByRole('combobox', { name: '推理强度' })).toBeVisible();
  });
});
