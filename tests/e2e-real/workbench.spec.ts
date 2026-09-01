import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { initializeGitProject, test, expect as baseExpect, type RealApp } from './fixtures.js';
import type { BrowserContext } from '@playwright/test';

// NAS-local PGlite/bootstrap and first browser bundle load can exceed the
// default 30s Playwright budget; keep this real integration gate bounded while
// allowing one cold start to finish deterministically.
test.setTimeout(120_000);
const expect = baseExpect.configure({ timeout: 30_000 });
const execFile = promisify(execFileCallback);

type Identified = { id: string };

async function apiData<T>(
  context: BrowserContext,
  method: 'get' | 'post',
  path: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const response = await context.request[method](`/api/v1${path}`, data ? { data } : undefined);
  if (!response.ok()) {
    throw new Error(
      `${method.toUpperCase()} ${path} 返回 ${response.status()}：${await response.text()}`,
    );
  }
  const envelope = (await response.json()) as { data: T };
  return envelope.data;
}

async function seedRealControlPlane(context: BrowserContext, app: RealApp) {
  const target = await seedTarget(context);
  const project = await apiData<Identified & { name: string }>(context, 'post', '/projects', {
    name: 'QA E2E Project',
    targetId: target.id,
    rootPath: app.projectRoot,
    kind: 'TEST',
  });
  const agent = await apiData<Identified & { name: string }>(context, 'post', '/agents', {
    name: 'QA ACP Fixture',
    targetId: target.id,
    agentKind: 'CUSTOM_ACP',
    executable: process.execPath,
    args: [new URL('../fixtures/acp/fake-agent.mjs', import.meta.url).pathname, '--write-fixture'],
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
    name: 'QA E2E 宿主机',
    kind: 'LOCAL_HOST',
    hostname: '127.0.0.1',
    os: process.platform,
    arch: process.arch,
  });
}

test('token 登录进入 Home，并能进入设置分区', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '创建管理员账号' })).toBeVisible();
  await page.getByLabel('用户名').fill('v07admin');
  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByLabel('确认密码').fill('123456');
  await page.getByRole('button', { name: '创建账号并进入' }).click();

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { name: '把注意力放在工作本身。' })).toBeVisible();
  await page.getByRole('link', { name: '设置' }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await expect(page.locator('main').getByRole('heading', { name: '设置与诊断' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Terminal', exact: true })).toBeVisible();
});

test.describe('local_trusted 项目与 Work', () => {
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
    await dialog.getByRole('textbox', { name: '项目名称' }).fill('QA UI Project');
    await expect(dialog.getByText('目录可以使用')).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: '预检并创建' }).click();

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/overview$/);
    await expect(page.getByRole('heading', { name: 'QA UI Project' })).toBeVisible();
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
      title: 'QA E2E Task',
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
      title: 'QA E2E Session',
      cwd: app.projectRoot,
    });

    await page.goto(`/projects/${project.id}/work?task=${task.id}`);
    await expect(page.getByRole('region', { name: '工作列表' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'QA E2E Task' })).toBeVisible();
    await page.goto(`/projects/${project.id}/sessions`);
    await expect(page.getByRole('textbox', { name: '搜索会话' })).toBeVisible();
    await expect(page.getByRole('link', { name: /v0\.7 E2E Session/ })).toBeVisible();
    await page.goto(`/workspace/${session.id}`);
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await expect(page.getByText('对话与执行')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '给 Agent 发送工程指令' })).toBeVisible();
  });

  test('Workspace 真实 ACP Approval、Diff 与 Git commit 可完成', async ({ page, context, app }) => {
    await initializeGitProject(app.projectRoot);
    const { project, agent } = await seedRealControlPlane(context, app);
    const session = await apiData<Identified>(context, 'post', '/sessions', {
      projectId: project.id,
      agentId: agent.id,
      title: 'QA Approval Workspace Session',
      cwd: app.projectRoot,
      branch: 'main',
    });

    await page.goto(`/workspace/${session.id}`);
    await expect(page.locator('.workspace-shell')).toBeVisible();
    const composer = page.getByRole('textbox', { name: '给 Agent 发送工程指令' });
    await expect(composer).toBeVisible();
    await composer.fill('请执行 Fixture 文件变更并等待 Approval。');
    await page.getByRole('button', { name: '发送' }).click();

    await expect(page.getByRole('button', { name: '允许一次' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '允许一次' }).click();
    await expect(page.getByText('Fixture 已完成')).toBeVisible({ timeout: 30_000 });

    // Git treats an untracked file as outside `diff` until intent-to-add; the
    // isolated E2E repo lets us make that state explicit before checking UI.
    await execFile('/usr/bin/git', ['-C', app.projectRoot, 'add', '-N', '--', 'fixture-output.md']);
    const diffResponse = await context.request.get(`/api/v1/projects/${project.id}/git/diff`);
    expect(diffResponse.ok()).toBe(true);
    const diffEnvelope = (await diffResponse.json()) as { data: { patch: string } };
    expect(diffEnvelope.data.patch).toContain('fixture-output.md');

    const inspectorTabs = page.getByRole('tablist', { name: '检查器视图' });
    await inspectorTabs.getByRole('tab', { name: '变更', exact: true }).click();
    const gitTabs = page.getByRole('tablist', { name: 'Git 工作区视图' });
    await gitTabs.getByRole('tab', { name: 'Diff', exact: true }).click();
    await expect(page.locator('.diff-frame')).toBeVisible();
    await gitTabs.getByRole('tab', { name: '变更', exact: true }).click();
    await expect(page.getByLabel('选择 fixture-output.md')).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('选择 fixture-output.md').check();
    const commitForm = page.locator('form.git-commit-form');
    await commitForm.getByLabel('提交说明').fill('test: Workspace ACP 输出');
    await commitForm.getByRole('button', { name: '提交所选文件 (1)' }).click();
    await expect(page.locator('.git-commit-receipt')).toContainText('提交完成', {
      timeout: 30_000,
    });
  });
});
