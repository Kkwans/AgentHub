import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrowserContext } from '@playwright/test';

import { initializeGitProject, test, expect, type RealApp } from './fixtures.js';

const fixtureAgentPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/acp/fake-agent.mjs',
);

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
  const target = await apiData<Identified>(context, 'post', '/execution-targets', {
    name: '真实 E2E 宿主机',
    kind: 'LOCAL_HOST',
    hostname: '127.0.0.1',
    os: process.platform,
    arch: process.arch,
  });
  const project = await apiData<Identified>(context, 'post', '/projects', {
    name: '真实 E2E Project',
    targetId: target.id,
    rootPath: app.projectRoot,
  });
  const agent = await apiData<Identified>(context, 'post', '/agents', {
    name: '真实 ACP Fixture',
    targetId: target.id,
    agentKind: 'CUSTOM_ACP',
    executable: process.execPath,
    args: [fixtureAgentPath, '--write-fixture'],
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

test.skip('legacy token mode 首次创建管理员、真实 Cookie/WS 登录、退出与恢复', async ({ page, app }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: '创建管理员账号' })).toBeVisible();

  await page.getByLabel('用户名').fill('abc');
  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByLabel('确认密码').fill('123456');
  await page.getByRole('button', { name: '创建账号并进入' }).click();

  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole('heading', { name: '概览' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '今天需要处理什么' })).toBeVisible();
  await expect(page.getByRole('status', { name: '实时连接已连接' })).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole('link', { name: '设置' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: '设置与诊断' })).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();

  await expect(page.getByRole('heading', { name: '登录 AgentHub' })).toBeVisible();
  await page.getByLabel('用户名').fill('abc');
  await page.getByLabel('密码', { exact: true }).fill('wrong1');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('alert')).toContainText('用户名或密码不正确');

  await page.getByLabel('密码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '设置与诊断' })).toBeVisible();
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
  expect(page.url()).toContain(app.origin);
});

test.describe.skip('legacy local_trusted 项目注册', () => {
  test.use({ authMode: 'local_trusted' });

  test('通过真实 UI 注册宿主机 target、添加 Git Project 并在 reload 后持久', async ({
    page,
    app,
  }) => {
    await initializeGitProject(app.projectRoot);
    await page.goto('/agents');
    await expect(page.getByRole('heading', { name: 'Agent 与执行目标' })).toBeVisible();

    await page.getByRole('button', { name: '注册 Execution Target' }).click();
    await expect(page.getByRole('heading', { name: '注册 Execution Target' })).toBeVisible();
    await page.getByLabel('类型').selectOption('LOCAL_HOST');
    await page.getByLabel('名称').fill('E2E 宿主机');
    await page.getByLabel('hostname').fill('127.0.0.1');
    await page.getByLabel('os', { exact: true }).fill(process.platform);
    await page.getByLabel('arch', { exact: true }).fill(process.arch);
    await page.getByRole('button', { name: '核验并注册' }).click();

    await expect(page.getByText('E2E 宿主机', { exact: true })).toBeVisible();
    await expect(page.getByText('就绪', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: '项目' }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await page.getByRole('button', { name: '添加 Project' }).click();
    await page.getByLabel('名称').fill('真实 E2E Project');
    await page.getByLabel('Project root').fill(app.projectRoot);
    await page.getByLabel('Execution Target').selectOption({ label: 'E2E 宿主机 · LOCAL_HOST' });
    await page.getByRole('button', { name: '预检并添加' }).click();

    const projectRow = page.locator('.project-row').filter({ hasText: '真实 E2E Project' });
    await expect(projectRow).toBeVisible();
    await expect(projectRow).toContainText(app.projectRoot);
    await expect(projectRow).toContainText('GIT');
    await expect(projectRow).toContainText('使用中');

    await page.reload();
    const persistedRow = page.locator('.project-row').filter({ hasText: '真实 E2E Project' });
    await expect(persistedRow).toBeVisible();
    await expect(persistedRow).toContainText(app.projectRoot);
    await expect(persistedRow).toContainText('GIT');
    await expect(persistedRow).toContainText('使用中');
  });

  test('真实 PromptOS → Task → ACP Approval → Git commit → 人工审阅闭环', async ({
    page,
    context,
    app,
  }) => {
    test.setTimeout(120_000);
    await initializeGitProject(app.projectRoot);
    const { project } = await seedRealControlPlane(context, app);

    await page.goto(`/tasks?projectId=${project.id}`);
    await expect(page.getByRole('heading', { name: 'Goal 与 Task' })).toBeVisible();

    await page.getByRole('button', { name: '创建 Goal' }).click();
    const goalForm = page.locator('form.task-create-form').filter({
      has: page.getByLabel('Goal 标题'),
    });
    await goalForm.getByLabel('Goal 标题').fill('真实 E2E Goal');
    await goalForm.getByLabel('说明').fill('验证普通用户真实业务闭环');
    await goalForm.getByLabel('成功标准').fill('Task 经 Approval、Git 与人工审阅后完成');
    await goalForm.getByRole('button', { name: '创建 Goal' }).click();
    await expect(page.getByText('真实 E2E Goal', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '创建 Task' }).click();
    const taskForm = page.locator('form.task-create-form').filter({
      has: page.getByLabel('Task 标题'),
    });
    await taskForm.getByLabel('Task 标题').fill('真实 E2E Task');
    await taskForm.getByLabel('所属 Goal').selectOption({ label: '真实 E2E Goal' });
    await taskForm.getByPlaceholder('Agent 要完成的工作').fill('通过真实 ACP fixture 写入文件');
    await taskForm.getByPlaceholder('验收标准').fill('Approval、Git commit 与最终 Run 均有证据');
    await taskForm.getByRole('button', { name: '创建 Task' }).click();
    let taskCard = page.locator('.task-card').filter({ hasText: '真实 E2E Task' });
    await expect(taskCard).toBeVisible();

    const tasks = await apiData<Array<Identified & { title: string }>>(
      context,
      'get',
      `/tasks?projectId=${project.id}`,
    );
    const taskId = tasks.find((task) => task.title === '真实 E2E Task')?.id;
    expect(taskId).toBeTruthy();

    await page.getByRole('link', { name: 'PromptOS' }).click();
    await page.getByRole('button', { name: '新建 Prompt' }).click();
    const promptForm = page.locator('form.management-form').filter({
      has: page.getByLabel('key'),
    });
    await promptForm.getByLabel('key').fill('e2e/task-guidance');
    await promptForm.getByLabel('名称').fill('真实 E2E 指令');
    await promptForm.getByLabel('Project 范围').selectOption({ label: '真实 E2E Project' });
    await promptForm.getByLabel('说明').fill('用于真实浏览器闭环验证');
    await promptForm.getByRole('button', { name: '创建 Prompt 标识' }).click();
    await expect(page).toHaveURL(/\/promptos\?prompt=/);

    const versionForm = page.locator('form.version-form');
    await versionForm
      .locator('textarea[name="content"]')
      .fill('执行真实 E2E Task，并保留 Git 证据。');
    await versionForm.getByLabel('变更说明').fill('创建第一个真实版本');
    await versionForm.getByRole('button', { name: '创建新版本' }).click();
    await expect(page.locator('.version-list')).toContainText('v1');

    await page.getByRole('tab', { name: '绑定' }).click();
    const bindingForm = page.locator('form.binding-form');
    await bindingForm.getByLabel('目标类型').selectOption('TASK');
    await bindingForm.getByLabel('Project 范围').selectOption({ label: '真实 E2E Project' });
    await bindingForm
      .locator('select[name="targetId"]')
      .selectOption({ label: '真实 E2E Task · BACKLOG' });
    await bindingForm.getByLabel('Slot').selectOption('TASK_PRIMER');
    await bindingForm.getByRole('button', { name: '创建绑定' }).click();
    await expect(page.locator('.binding-list')).toContainText('真实 E2E Task');
    await expect(page.locator('.binding-list')).toContainText('latest');

    await page.getByRole('tab', { name: '渲染演练' }).click();
    await page.getByRole('button', { name: '渲染' }).click();
    await expect(page.getByText('变量完整')).toBeVisible();

    await page.getByRole('link', { name: '任务' }).click();
    taskCard = page.locator('.task-card').filter({ hasText: '真实 E2E Task' });
    await taskCard.getByRole('button', { name: '设为就绪' }).click();
    await expect(taskCard.getByText('就绪', { exact: true })).toBeVisible();
    await taskCard.getByRole('button', { name: '直接运行' }).click();

    await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/);
    const sessionId = page.url().split('/').at(-1)!;
    await expect(
      page.locator('.composer-context').getByText('真实 ACP Fixture', { exact: true }),
    ).toBeVisible();
    const promptContextButton = page
      .locator('.composer-context button')
      .filter({ hasText: 'PromptOS' });
    await expect(promptContextButton).toContainText('1 项');
    await promptContextButton.click();
    await expect(page.getByText('e2e/task-guidance@latest')).toBeVisible();

    await expect(page.getByRole('button', { name: '允许一次' })).toBeVisible({ timeout: 15_000 });
    const pendingApprovals = await apiData<Array<{ id: string; status: string }>>(
      context,
      'get',
      `/approvals?sessionId=${sessionId}`,
    );
    const approvalId = pendingApprovals.find((approval) => approval.status === 'PENDING')?.id;
    expect(approvalId).toBeTruthy();
    await page.getByRole('button', { name: '允许一次' }).click();
    await expect(page.getByText('Fixture 已完成')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('没有活动 Run')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tab', { name: 'Git' }).click();
    await expect(page).toHaveURL(new RegExp(`/sessions/${sessionId}\\?view=git`));
    const outputPath = page.getByLabel('选择 fixture-output.md');
    await expect(outputPath).toBeVisible({ timeout: 15_000 });
    await outputPath.check();
    const commitForm = page.locator('form.git-commit-form');
    await commitForm.getByLabel('提交说明').fill('test: 提交真实 ACP 输出');
    await commitForm.getByRole('button', { name: '提交所选文件 (1)' }).click();
    // The receipt is rendered alongside (not inside) the form so it remains visible
    // after the selected-file list is cleared on successful commit.
    await expect(page.locator('.git-commit-receipt')).toContainText(/提交完成/, {
      timeout: 15_000,
    });

    await page.getByRole('link', { name: '任务' }).click();
    taskCard = page.locator('.task-card').filter({ hasText: '真实 E2E Task' });
    await expect(taskCard.getByText('待审阅', { exact: true })).toBeVisible({ timeout: 15_000 });
    await taskCard.getByRole('button', { name: '审阅结果' }).click();
    const reviewDialog = page.getByRole('dialog');
    await expect(reviewDialog.getByRole('heading', { name: '真实 E2E Task' })).toBeVisible();
    await expect(reviewDialog).toContainText('Approval、Git commit 与最终 Run 均有证据');
    await expect(reviewDialog).toContainText('当前 Git 现场');
    await expect(reviewDialog).toContainText('0 个路径');
    await reviewDialog.getByRole('button', { name: '确认达到验收标准' }).click();
    await expect(reviewDialog).toBeHidden();
    await expect(taskCard.getByText('完成', { exact: true })).toBeVisible();

    const persistedTask = await apiData<{
      status: string;
      finalRunId: string | null;
      sessionId: string | null;
    }>(context, 'get', `/tasks/${taskId!}`);
    const persistedRuns = await apiData<Array<{ status: string }>>(
      context,
      'get',
      `/sessions/${sessionId}/runs`,
    );
    const persistedApproval = await apiData<{
      status: string;
      selectedOptionId: string | null;
      deliveryState: string | null;
    }>(context, 'get', `/approvals/${approvalId!}`);
    const commits = await apiData<Array<{ subject: string }>>(
      context,
      'get',
      `/projects/${project.id}/git/commits?limit=10`,
    );
    expect(persistedTask).toMatchObject({
      status: 'DONE',
      sessionId,
    });
    expect(persistedTask.finalRunId).toBeTruthy();
    expect(persistedRuns.at(-1)?.status).toBe('COMPLETED');
    expect(persistedApproval).toMatchObject({
      status: 'APPROVED',
      selectedOptionId: 'allow-once',
      deliveryState: 'DELIVERED',
    });
    expect(commits.some((commit) => commit.subject === 'test: 提交真实 ACP 输出')).toBe(true);
  });
});
