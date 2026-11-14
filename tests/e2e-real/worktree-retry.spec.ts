import { randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { access, chmod, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { BrowserContext } from '@playwright/test';
import { apiData, seedWorkspace } from './baseline-support.js';
import { expect, test, initializeGitProject } from './fixtures.js';

const execFile = promisify(execFileCallback);
test.use({ authMode: 'local_trusted', secondGitProject: true });
test.setTimeout(120_000);
type Execution = {
  id: string;
  taskId: string;
  projectId: string;
  status: string;
  sessionId: string | null;
  runId: string | null;
  worktreePath: string | null;
  gitMergeGeneration: number;
  mergeCommitSha: string | null;
};
type Admission = {
  expectedRunId: string;
  expectedOperationId: string;
  retryEligible: boolean;
  mergeAllowed: boolean;
};
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
  test(`真实 Git claim 竞争后显式重新审阅并重试 ${width}`, async ({ page, context, app }, info) => {
    const { project, target } = await seedWorkspace(context, app);
    const agent = await apiData<{ id: string }>(context, 'post', '/agents', {
      name: '真实重试验证 Agent',
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
    const task = await apiData<{ id: string }>(context, 'post', '/tasks', {
      projectId: project.id,
      title: '真实 Git 重试',
      acceptanceCriteria: '旧键不重放，新意图只合并一次',
    });
    await apiData(context, 'post', `/tasks/${task.id}/transition`, { status: 'READY' });
    const queued = await apiData<{ execution: Execution }>(
      context,
      'post',
      `/tasks/${task.id}/worktree/queue`,
      { agentId: agent.id },
    );
    const execution = await finishTurn(context, queued.execution.id);
    const review = await apiData<{ mergeAdmission: Admission }>(
      context,
      'get',
      `/worktree-executions/${execution.id}/review`,
    );
    const initial = review.mergeAdmission;
    expect(initial.retryEligible).toBe(false);
    const git = async (root: string, args: string[]) =>
      (await execFile('/usr/bin/git', ['-C', root, ...args], { shell: false })).stdout.trim();
    const originalHead = await git(app.projectRoot, ['rev-parse', 'HEAD']);
    const originalWorktreeHead = await git(execution.worktreePath!, ['rev-parse', 'HEAD']);
    await initializeGitProject(app.secondaryProjectRoot);
    const holderProject = await apiData<{ id: string }>(context, 'post', '/projects', {
      name: '独立真实 Git claim holder',
      targetId: target.id,
      rootPath: app.secondaryProjectRoot,
      kind: 'TEST',
    });
    const holderHead = await git(app.secondaryProjectRoot, ['rev-parse', 'HEAD']);
    const entered = join(app.dataRoot, 'holder-entered');
    const release = join(app.dataRoot, 'holder-release');
    const hook = join(app.secondaryProjectRoot, '.git/hooks/pre-commit');
    await writeFile(
      hook,
      `#!/bin/sh\nset -eu\n: > ${JSON.stringify(entered)}\ni=0\nwhile [ ! -f ${JSON.stringify(release)} ]; do\n i=$((i + 1))\n if [ "$i" -ge 400 ]; then exit 1; fi\n sleep 0.1\ndone\n`,
    );
    await chmod(hook, 0o700);
    await writeFile(join(app.secondaryProjectRoot, 'holder.txt'), 'real independent commit\n');
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    const mergeRequests: unknown[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().endsWith(`/worktree-executions/${execution.id}/merge`)
      )
        mergeRequests.push(request.postDataJSON());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      // Chromium logs the deliberately asserted 409 HTTP response as a console
      // error; only that exact transport message is expected below.
      if (
        message.type() === 'error' &&
        !(
          message.location().url.endsWith(`/worktree-executions/${execution.id}/merge`) &&
          /^Failed to load resource: the server responded with a status of 409 \(Conflict\)$/.test(
            message.text(),
          )
        )
      )
        errors.push(message.text());
    });
    await page.goto(`/projects/${project.id}/work?task=${task.id}`);
    const load = page.getByRole('button', { name: '读取隔离工作区审阅', exact: true });
    const merge = page.getByRole('button', { name: '提交并合并隔离工作区', exact: true });
    const confirm = page.getByRole('checkbox', {
      name: '我已审阅改动，确认提交并合并到基础分支',
      exact: true,
    });
    await load.click();
    await expect(page.getByText('fixture-output.md', { exact: true })).toBeVisible();
    const inspector = page.getByRole('complementary', { name: '工作 Inspector' });
    const heading = inspector.getByRole('heading', { name: '真实 Git 重试', exact: true });
    // Audit the initial review as well as the later scrolled confirmation state.
    await heading.scrollIntoViewIfNeeded();
    if (width >= 1024) {
      const list = page.getByRole('region', { name: '工作列表' });
      await expect(list).toBeVisible();
      const listBox = await list.boundingBox();
      const reviewBox = await inspector.boundingBox();
      expect(listBox).not.toBeNull();
      expect(reviewBox).not.toBeNull();
      expect(listBox!.width).toBeGreaterThanOrEqual(230);
      expect(listBox!.width).toBeLessThanOrEqual(290);
      expect(reviewBox!.width).toBeGreaterThanOrEqual(listBox!.width * 2);
    }
    const initialShot = info.outputPath(`worktree-review-primary-${width}.png`);
    await page.screenshot({ path: initialShot, fullPage: true });
    await info.attach('隔离审阅主内容布局', { path: initialShot, contentType: 'image/png' });
    await confirm.check();
    const holderId = randomUUID();
    const holder = context.request.post(`/api/v1/projects/${holderProject.id}/git/commit`, {
      data: {
        protocolVersion: 1,
        operationId: holderId,
        expectedHead: holderHead,
        mode: 'SELECTED',
        paths: ['holder.txt'],
        message: 'test: real claim holder',
      },
    });
    // Attach an immediate rejection handler; cleanup always releases the real hook.
    const holderResult = holder.then(
      (response) => ({ response }),
      (error) => ({ error }),
    );
    let rejectedRecord: unknown;
    let holderOutcome: Awaited<typeof holderResult> | undefined;
    try {
      await expect
        .poll(
          async () =>
            access(entered).then(
              () => true,
              () => false,
            ),
          { timeout: 10_000 },
        )
        .toBe(true);
      const holderOperation = await apiData<{ phase: string }>(
        context,
        'get',
        `/projects/${holderProject.id}/git/commit-operations/${holderId}`,
      );
      expect(holderOperation.phase).toBe('DISPATCHED');
      const rejected = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/worktree-executions/${execution.id}/merge`),
      );
      await merge.click();
      const response = await rejected;
      expect(response.status()).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: 'WORKTREE_GIT_PREWRITE_REJECTED' },
      });
      rejectedRecord = await apiData(
        context,
        'get',
        `/projects/${project.id}/git/commit-operations/${initial.expectedOperationId}`,
      );
      expect(rejectedRecord).toMatchObject({
        phase: 'REJECTED_PREWRITE',
        errorCode: 'GIT_REPOSITORY_CLAIMED',
      });
      expect(await git(app.projectRoot, ['rev-parse', 'HEAD'])).toBe(originalHead);
      expect(await git(execution.worktreePath!, ['rev-parse', 'HEAD'])).toBe(originalWorktreeHead);
      await expect(page.getByRole('button', { name: '核对原隔离执行', exact: true })).toBeVisible();
      await expect(load).toBeDisabled();
    } finally {
      await writeFile(release, 'release\n');
      holderOutcome = await holderResult;
    }
    if (!holderOutcome) throw new Error('Git holder request did not settle');
    if ('error' in holderOutcome) throw holderOutcome.error;
    expect(holderOutcome.response.status(), await holderOutcome.response.text()).toBe(201);
    // Desktop uses the route-independent recovery surface while the form stays
    // mounted; smaller widths retain the local recovery path. Both must unlock
    // fresh review after one authoritative check, never dispatch automatically.
    await page
      .getByRole('button', {
        name: width >= 1024 ? '核对原操作' : '核对原隔离执行',
        exact: true,
      })
      .click();
    await expect(page.getByText(/原合并操作已确认未写入/)).toBeVisible();
    await expect(merge).toBeDisabled();
    await expect(load).toBeEnabled();
    await load.click();
    await expect(page.getByText(/旧操作已确认未写入；本次确认将创建新的合并尝试/)).toBeVisible();
    expect(mergeRequests).toEqual([
      { expectedRunId: initial.expectedRunId, expectedOperationId: initial.expectedOperationId },
    ]);
    await expect(confirm).not.toBeChecked();
    await expect(merge).toBeDisabled();
    await confirm.check();
    const shot = info.outputPath(`worktree-explicit-retry-${width}.png`);
    await expect(merge).toBeEnabled();
    await merge.scrollIntoViewIfNeeded();
    if (width >= 1024) {
      await expect(heading).toBeInViewport();
      const titleBox = await heading.boundingBox();
      const buttonBox = await merge.boundingBox();
      expect(titleBox).not.toBeNull();
      expect(buttonBox).not.toBeNull();
      expect(titleBox!.y + titleBox!.height).toBeLessThanOrEqual(buttonBox!.y);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: shot, fullPage: true });
    await info.attach('真实 Git 前置拒绝后重新确认重试', { path: shot, contentType: 'image/png' });
    const completed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/worktree-executions/${execution.id}/merge`),
    );
    await merge.click();
    const response = await completed;
    expect(response.status(), await response.text()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({
      expectedRunId: initial.expectedRunId,
      expectedOperationId: initial.expectedOperationId,
      retryOfOperationId: initial.expectedOperationId,
    });
    expect(mergeRequests).toHaveLength(2);
    const result = ((await response.json()) as { data: { execution: Execution } }).data;
    expect(result.execution.status).toBe('DONE');
    expect(result.execution.gitMergeGeneration).toBe(1);
    const mergedHead = await git(app.projectRoot, ['rev-parse', 'HEAD']);
    expect(mergedHead).toBe(result.execution.mergeCommitSha);
    expect(mergedHead).not.toBe(originalHead);
    expect(await git(app.projectRoot, ['show', 'HEAD:fixture-output.md'])).toContain(
      'Approval 已确认',
    );
    const count = await git(app.projectRoot, ['rev-list', '--count', 'HEAD']);
    for (const data of [
      initial,
      {
        expectedRunId: initial.expectedRunId,
        expectedOperationId: initial.expectedOperationId,
        retryOfOperationId: initial.expectedOperationId,
      },
    ]) {
      const replay = await context.request.post(
        `/api/v1/worktree-executions/${execution.id}/merge`,
        {
          data: {
            expectedRunId: data.expectedRunId,
            expectedOperationId: data.expectedOperationId,
            ...('retryOfOperationId' in data
              ? { retryOfOperationId: data.retryOfOperationId }
              : {}),
          },
        },
      );
      expect(replay.status()).toBe(409);
    }
    expect(await git(app.projectRoot, ['rev-parse', 'HEAD'])).toBe(mergedHead);
    expect(await git(app.projectRoot, ['rev-list', '--count', 'HEAD'])).toBe(count);
    expect(
      await apiData(
        context,
        'get',
        `/projects/${project.id}/git/commit-operations/${initial.expectedOperationId}`,
      ),
    ).toEqual(rejectedRecord);
    expect(errors).toEqual([]);
  });
}
