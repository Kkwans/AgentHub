import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { BrowserContext } from '@playwright/test';
import { apiData, seedWorkspace } from './baseline-support.js';
import { expect, test } from './fixtures.js';

const execFile = promisify(execFileCallback);
test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);

type Execution = {
  id: string;
  taskId: string;
  projectId: string;
  status: string;
  sessionId: string | null;
  runId: string | null;
  taskBranch: string;
  baseBranch: string;
  worktreePath: string | null;
  mergeCommitSha: string | null;
};
type Task = { id: string; status: string; sessionId: string | null; finalRunId: string | null };

async function finishTurn(context: BrowserContext, executionId: string, previousRun?: string) {
  let active: Execution | undefined;
  await expect
    .poll(
      async () => {
        active = await apiData<Execution>(context, 'get', `/worktree-executions/${executionId}`);
        return Boolean(active.sessionId && active.runId && active.runId !== previousRun);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const sessionId = active!.sessionId!;
  const runId = active!.runId!;
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
      async () => {
        const runs = await apiData<Array<{ id: string; status: string }>>(
          context,
          'get',
          `/sessions/${sessionId}/runs`,
        );
        return runs.find((item) => item.id === runId)?.status;
      },
      { timeout: 15_000 },
    )
    .toBe('COMPLETED');
  await expect
    .poll(
      async () =>
        (await apiData<Execution>(context, 'get', `/worktree-executions/${executionId}`)).status,
      { timeout: 15_000 },
    )
    .toBe('REVIEW');
  return apiData<Execution>(context, 'get', `/worktree-executions/${executionId}`);
}

for (const width of [390, 768, 1024, 1440]) {
  test(`真实隔离工作区审阅返工并受管合并 ${width}`, async ({ page, context, app }, info) => {
    const { project, target } = await seedWorkspace(context, app);
    const agent = await apiData<{ id: string }>(context, 'post', '/agents', {
      name: '隔离工作区真实写入Agent',
      targetId: target.id,
      agentKind: 'CUSTOM_ACP',
      executable: process.execPath,
      args: [
        resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/acp/fake-agent.mjs'),
        '--write-fixture',
      ],
    });
    expect(
      (
        await apiData<{ status: string }>(context, 'post', `/agents/${agent.id}/preflight`, {
          cwd: app.projectRoot,
        })
      ).status,
    ).toBe('READY');
    const task = await apiData<Task>(context, 'post', '/tasks', {
      projectId: project.id,
      title: '审阅隔离工作区真实结果',
      acceptanceCriteria: '受管合并后保留真实文件与执行历史',
    });
    await apiData(context, 'post', `/tasks/${task.id}/transition`, { status: 'READY' });
    const queued = await apiData<{ execution: Execution }>(
      context,
      'post',
      `/tasks/${task.id}/worktree/queue`,
      {
        agentId: agent.id,
      },
    );
    const first = await finishTurn(context, queued.execution.id);
    expect(first.taskId).toBe(task.id);
    expect(first.worktreePath).toBeTruthy();
    const child = relative(app.worktreeRoot, first.worktreePath!);
    expect(child).not.toMatch(/^\.\.(?:[\\/]|$)/);
    expect(child).not.toBe('');
    expect(await readFile(join(first.worktreePath!, 'fixture-output.md'), 'utf8')).toContain(
      'Approval 已确认',
    );
    await expect(
      readFile(join(app.projectRoot, 'fixture-output.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    const errors: string[] = [];
    const mutations: Array<{ path: string; body: unknown }> = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (
        request.method() === 'POST' &&
        (path.includes('/worktree-executions/') || path === `/api/v1/tasks/${task.id}/review`)
      )
        mutations.push({ path, body: request.postDataJSON() });
    });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(`/projects/${project.id}/work?task=${task.id}`);
    await expect(page.getByRole('button', { name: '确认达到验收标准', exact: true })).toHaveCount(
      0,
    );
    const load = page.getByRole('button', { name: '读取隔离工作区审阅', exact: true });
    await load.click();
    await expect(page.getByText('fixture-output.md', { exact: true })).toBeVisible();
    await page.getByText('查看隔离工作区差异', { exact: true }).click();
    await expect(page.getByText(/Approval 已确认，真实 ACP fixture 已写入此文件/)).toBeVisible();
    const merge = page.getByRole('button', { name: '提交并合并隔离工作区', exact: true });
    await expect(merge).toBeDisabled();
    const feedback = '再次核对隔离文件内容与验收要求';
    await page.getByRole('textbox', { name: '隔离工作区修改说明', exact: true }).fill(feedback);
    const reworkResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v1/worktree-executions/${first.id}/rework`,
    );
    await page.getByRole('button', { name: '提交隔离工作区返工', exact: true }).click();
    const response = await reworkResponse;
    expect(response.ok()).toBe(true);
    const second = ((await response.json()) as { data: Execution }).data;
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.runId).not.toBe(first.runId);
    await expect(page).toHaveURL(new RegExp(`/workspace/${first.sessionId}$`));
    await finishTurn(context, first.id, first.runId!);
    const messages = await apiData<Array<{ role: string; text: string }>>(
      context,
      'get',
      `/sessions/${first.sessionId}/messages`,
    );
    expect(messages.some((item) => item.role === 'USER' && item.text === feedback)).toBe(true);
    await page.goto(`/projects/${project.id}/work?task=${task.id}`);
    await load.click();
    await expect(page.getByText('fixture-output.md', { exact: true })).toBeVisible();
    await expect(merge).toBeDisabled();
    await page
      .getByRole('checkbox', { name: '我已审阅改动，确认提交并合并到基础分支', exact: true })
      .check();
    await expect(merge).toBeEnabled();
    await merge.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const reviewShot = info.outputPath(`worktree-review-${width}.png`);
    await page.screenshot({ path: reviewShot, fullPage: true });
    await info.attach('受管隔离工作区审阅和明确合并确认', {
      path: reviewShot,
      contentType: 'image/png',
    });
    const mergeResponse = page.waitForResponse(
      (result) =>
        result.request().method() === 'POST' &&
        new URL(result.url()).pathname === `/api/v1/worktree-executions/${first.id}/merge`,
    );
    await merge.click();
    const mergedResponse = await mergeResponse;
    expect(mergedResponse.ok()).toBe(true);
    const merged = (
      (await mergedResponse.json()) as {
        data: { execution: Execution; task: Task; merge: { mergeCommitSha: string } };
      }
    ).data;
    expect(merged.execution.status).toBe('DONE');
    expect(merged.task).toMatchObject({
      id: task.id,
      status: 'DONE',
      sessionId: first.sessionId,
      finalRunId: second.runId,
    });
    expect(merged.execution.mergeCommitSha).toBe(merged.merge.mergeCommitSha);
    expect(await readFile(join(app.projectRoot, 'fixture-output.md'), 'utf8')).toContain(
      'Approval 已确认',
    );
    const git = (args: string[]) =>
      execFile('/usr/bin/git', ['-C', app.projectRoot, ...args], { shell: false });
    expect((await git(['rev-parse', 'HEAD'])).stdout.trim()).toBe(merged.merge.mergeCommitSha);
    expect((await git(['branch', '--show-current'])).stdout.trim()).toBe(first.baseBranch);
    expect((await git(['status', '--porcelain'])).stdout.trim()).toBe('');
    expect(mutations).toEqual([
      { path: `/api/v1/worktree-executions/${first.id}/rework`, body: { feedback } },
      { path: `/api/v1/worktree-executions/${first.id}/merge`, body: {} },
    ]);
    expect(
      await apiData<unknown[]>(context, 'get', `/sessions/${first.sessionId}/runs`),
    ).toHaveLength(2);
    expect(await apiData<unknown[]>(context, 'get', `/tasks?projectId=${project.id}`)).toHaveLength(
      1,
    );
    await page.reload();
    await expect(
      page.getByRole('button', { name: '提交并合并隔离工作区', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: '确认达到验收标准', exact: true })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const doneShot = info.outputPath(`worktree-merged-${width}.png`);
    await page.screenshot({ path: doneShot, fullPage: true });
    await info.attach('隔离任务受管合并完成后的持久状态', {
      path: doneShot,
      contentType: 'image/png',
    });
    expect(errors).toEqual([]);
  });
}
