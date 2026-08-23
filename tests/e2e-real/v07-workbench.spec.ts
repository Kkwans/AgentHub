import { initializeGitProject, test, expect, type RealApp } from './fixtures.js';
import type { BrowserContext } from '@playwright/test';

type Identified = { id: string };

async function apiData<T>(
  context: BrowserContext,
  method: 'get' | 'post',
  path: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const response = await context.request[method](`/api/v1${path}`, data ? { data } : undefined);
  if (!response.ok()) {
    throw new Error(`${method.toUpperCase()} ${path} 返回 ${response.status()}：${await response.text()}`);
  }
  const envelope = (await response.json()) as { data: T };
  return envelope.data;
}

async function seedRealControlPlane(context: BrowserContext, app: RealApp) {
  const target = await seedTarget(context);
  const project = await apiData<Identified & { name: string }>(context, 'post', '/projects', {
    name: 'v0.7 E2E Project',
    targetId: target.id,
    rootPath: app.projectRoot,
  });
  const agent = await apiData<Identified & { name: string }>(context, 'post', '/agents', {
    name: 'v0.7 ACP Fixture',
    targetId: target.id,
    agentKind: 'CUSTOM_ACP',
    executable: process.execPath,
    args: [
      new URL('../fixtures/acp/fake-agent.mjs', import.meta.url).pathname,
      '--write-fixture',
    ],
  });
  const preflight = await apiData<{ status: string }>(
    context,
    'post',
    `/agents/${agent.id}/preflight`,
    { cwd: app.projectRoot },
  );
  expect(preflight.status).toBe('READY');
  return { target, project, agent };
}

async function seedTarget(context: BrowserContext) {
  return apiData<Identified>(context, 'post', '/execution-targets', {
    name: 'v0.7 E2E 宿主机',
    kind: 'LOCAL_HOST',
    hostname: '127.0.0.1',
    os: process.platform,
    arch: process.arch,
  });
}

test('v0.7 token 登录进入 Home，并能进入设置分区', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '创建管理员账号' })).toBeVisible();
  await page.getByLabel('用户名').fill('v07admin');
  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByLabel('确认密码').fill('123456');
  await page.getByRole('button', { name: '创建账号并进入' }).click();

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { name: '今天需要处理什么' })).toBeVisible();
  await page.getByRole('link', { name: '设置' }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await expect(page.locator('main').getByRole('heading', { name: '设置' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '设置分区' })).toBeVisible();
});

test.describe('v0.7 local_trusted 项目与 Work', () => {
  test.use({ authMode: 'local_trusted' });

  test('通过 Create Project 对话框完成真实 preflight/create，并进入 Project Context', async ({
    page,
    app,
    context,
  }) => {
    await initializeGitProject(app.projectRoot);
    await seedTarget(context);
    await page.goto('/projects/new');
    const dialog = page.getByRole('dialog', { name: '创建项目' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: '运行环境' })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: '允许目录' })).toBeVisible();
    await dialog.getByRole('textbox', { name: '项目名称' }).fill('v0.7 UI Project');
    await expect(dialog.getByText('目录可以使用')).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: '预检并创建' }).click();

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/overview$/);
    await expect(page.getByRole('heading', { name: 'v0.7 UI Project' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '项目上下文' })).toBeVisible();
  });

  test('真实 backend Project/Task/Session 能在 Work 与 Coding Workspace 呈现', async ({
    page,
    context,
    app,
  }) => {
    await initializeGitProject(app.projectRoot);
    const { project, agent } = await seedRealControlPlane(context, app);
    const task = await apiData<Identified & { title: string }>(context, 'post', '/tasks', {
      projectId: project.id,
      title: 'v0.7 E2E Task',
      description: '真实 backend 页面集成验证',
      priority: 2,
    });
    const transitioned = await apiData<{ status: string }>(
      context,
      'post',
      `/tasks/${task.id}/transition`,
      { status: 'READY' },
    );
    expect(transitioned.status).toBe('READY');
    const session = await apiData<Identified>(context, 'post', '/sessions', {
      projectId: project.id,
      agentId: agent.id,
      taskId: task.id,
      title: 'v0.7 E2E Session',
      cwd: app.projectRoot,
    });

    await page.goto(`/projects/${project.id}/work?task=${task.id}`);
    await expect(page.getByRole('heading', { name: 'Work' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'v0.7 E2E Task' })).toBeVisible();
    await page.goto(`/projects/${project.id}/sessions`);
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'v0.7 E2E Session', exact: true })).toBeVisible();
    await page.goto(`/workspace/${session.id}`);
    await expect(page.getByTestId('v07-workspace')).toBeVisible();
    await expect(page.getByText('对话与执行')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '给 Agent 发送工程指令' })).toBeVisible();
  });
});
