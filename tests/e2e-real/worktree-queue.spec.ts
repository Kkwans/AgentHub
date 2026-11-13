import { execFile as execFileCallback } from 'node:child_process';
import { isAbsolute, relative } from 'node:path';
import { promisify } from 'node:util';
import { apiData, seedWorkspace } from './baseline-support.js';
import { expect, test } from './fixtures.js';

const execFile = promisify(execFileCallback);
test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);

type Execution = {
  id: string;
  taskId: string;
  projectId: string;
  agentId: string;
  status: string;
  sessionId: string | null;
  runId: string | null;
  taskBranch: string;
  worktreePath: string | null;
  configJson: { promptVariables?: Record<string, unknown> };
};
type Task = {
  id: string;
  status: string;
  assignedAgentId: string | null;
  sessionId: string | null;
  finalRunId: string | null;
  branch: string | null;
};

for (const width of [390, 768, 1024, 1440]) {
  test(`真实BACKLOG任务通过UI加入隔离队列 ${width}`, async ({ page, context, app }, info) => {
    const { project, agent } = await seedWorkspace(context, app);
    const variables = { goal: '保留已保存的隔离变量', count: 3 };
    const task = await apiData<Task>(context, 'post', '/tasks', {
      projectId: project.id,
      title: '从已有任务进入隔离执行',
      description: '保留补充说明并使用独立分支',
      acceptanceCriteria: '原任务执行历史与输入完整保留',
      promptVariables: variables,
    });
    expect(task.status).toBe('BACKLOG');
    const mutations: Array<{ path: string; body: unknown }> = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && path.startsWith(`/api/v1/tasks/${task.id}/`))
        mutations.push({ path, body: request.postDataJSON() });
    });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(`/projects/${project.id}/work?task=${task.id}&agentId=${agent.id}`);
    const queue = page.getByRole('button', { name: '加入隔离执行队列', exact: true });
    await expect(queue).toBeEnabled();
    await queue.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const beforeShot = info.outputPath(`worktree-queue-ready-${width}.png`);
    await page.screenshot({ path: beforeShot, fullPage: true });
    await info.attach('已有BACKLOG任务的隔离执行入口', {
      path: beforeShot,
      contentType: 'image/png',
    });
    const queuedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v1/tasks/${task.id}/worktree/queue`,
    );
    await queue.click();
    const response = await queuedResponse;
    expect(response.status()).toBe(202);
    const queued = ((await response.json()) as { data: { execution: Execution; task: Task } }).data;
    expect(queued.execution).toMatchObject({
      taskId: task.id,
      projectId: project.id,
      agentId: agent.id,
    });
    expect(queued.execution.configJson.promptVariables).toEqual(variables);
    expect(mutations).toEqual([
      { path: `/api/v1/tasks/${task.id}/transition`, body: { status: 'READY' } },
      { path: `/api/v1/tasks/${task.id}/worktree/queue`, body: { agentId: agent.id } },
    ]);
    // A 202 enqueue acknowledgment is not proof of a running Session. Wait for
    // the real runner's durable identities rather than asserting transient QUEUED.
    let active: Execution | undefined;
    await expect
      .poll(
        async () => {
          active = await apiData<Execution>(
            context,
            'get',
            `/worktree-executions/${queued.execution.id}`,
          );
          return Boolean(active.sessionId && active.runId);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    const sessionId = active!.sessionId!;
    const runId = active!.runId!;
    const session = await apiData<{ taskId: string; agentId: string; cwd: string }>(
      context,
      'get',
      `/sessions/${sessionId}`,
    );
    expect(session).toMatchObject({
      taskId: task.id,
      agentId: agent.id,
      cwd: active!.worktreePath,
    });
    expect(active!.worktreePath).toBeTruthy();
    const child = relative(app.worktreeRoot, active!.worktreePath!);
    expect(child).not.toBe('');
    expect(isAbsolute(child)).toBe(false);
    expect(child).not.toMatch(/^\.\.(?:[\\/]|$)/);
    expect(
      (
        await execFile('/usr/bin/git', ['-C', active!.worktreePath!, 'branch', '--show-current'], {
          shell: false,
        })
      ).stdout.trim(),
    ).toBe(active!.taskBranch);
    let approvalId: string | undefined;
    await expect
      .poll(
        async () => {
          const approvals = await apiData<Array<{ id: string; runId: string; status: string }>>(
            context,
            'get',
            `/approvals?sessionId=${sessionId}`,
          );
          approvalId = approvals.find(
            (item) => item.runId === runId && item.status === 'PENDING',
          )?.id;
          return approvalId;
        },
        { timeout: 15_000 },
      )
      .toBeTruthy();
    await apiData(context, 'post', `/approvals/${approvalId!}/resolve`, { optionId: 'allow-once' });
    await expect
      .poll(
        async () =>
          (await apiData<Execution>(context, 'get', `/worktree-executions/${queued.execution.id}`))
            .status,
        { timeout: 15_000 },
      )
      .toBe('REVIEW');
    const stored = await apiData<Task>(context, 'get', `/tasks/${task.id}`);
    expect(stored).toMatchObject({
      status: 'WAITING_REVIEW',
      assignedAgentId: agent.id,
      sessionId,
      finalRunId: runId,
      branch: active!.taskBranch,
    });
    const messages = await apiData<Array<{ role: string; text: string }>>(
      context,
      'get',
      `/sessions/${sessionId}/messages`,
    );
    const instruction = messages.find((item) => item.role === 'USER')?.text;
    expect(instruction).toContain('从已有任务进入隔离执行');
    expect(instruction).toContain('保留补充说明并使用独立分支');
    expect(instruction).toContain('原任务执行历史与输入完整保留');
    expect(await apiData<unknown[]>(context, 'get', `/tasks?projectId=${project.id}`)).toHaveLength(
      1,
    );
    expect(
      await apiData<unknown[]>(context, 'get', `/worktree-executions?taskId=${task.id}`),
    ).toHaveLength(1);
    expect(await apiData<unknown[]>(context, 'get', `/sessions/${sessionId}/runs`)).toHaveLength(1);
    await page.goto(`/projects/${project.id}/work?task=${task.id}`);
    await expect(
      page.getByRole('button', { name: '读取隔离工作区审阅', exact: true }),
    ).toBeVisible();
    await expect(queue).toHaveCount(0);
    await expect(page.getByRole('button', { name: '确认达到验收标准', exact: true })).toHaveCount(
      0,
    );
    expect(mutations).toHaveLength(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const afterShot = info.outputPath(`worktree-queue-review-${width}.png`);
    await page.screenshot({ path: afterShot, fullPage: true });
    await info.attach('原任务进入专属隔离审阅且无重复入队', {
      path: afterShot,
      contentType: 'image/png',
    });
    expect(errors).toEqual([]);
  });
}
