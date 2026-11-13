import { stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiData, seedWorkspace } from './baseline-support.js';
import { expect, test } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
type Execution = {
  id: string;
  taskId: string;
  projectId: string;
  status: string;
  sessionId: string | null;
  runId: string | null;
  worktreePath: string | null;
};
type Task = { id: string; status: string; sessionId: string | null };

for (const width of [390, 768, 1024, 1440]) {
  test(`真实隔离取消区分请求与权威终态 ${width}`, async ({ page, context, app }, info) => {
    const { target, project, agent: normalAgent } = await seedWorkspace(context, app);
    const releaseFile = join(app.dataRoot, 'controlled-cancel-release');
    const agent = await apiData<{ id: string }>(context, 'post', '/agents', {
      name: '可控权威取消Fixture',
      targetId: target.id,
      agentKind: 'CUSTOM_ACP',
      executable: process.execPath,
      args: [
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          '../fixtures/acp/controlled-cancel-agent.mjs',
        ),
        releaseFile,
      ],
    });
    expect(
      (
        await apiData<{ status: string }>(context, 'post', `/agents/${agent.id}/preflight`, {
          cwd: app.projectRoot,
        })
      ).status,
    ).toBe('READY');
    const enqueue = async (title: string, agentId: string) => {
      const task = await apiData<Task>(context, 'post', '/tasks', { projectId: project.id, title });
      await apiData(context, 'post', `/tasks/${task.id}/transition`, { status: 'READY' });
      return apiData<{ execution: Execution; task: Task }>(
        context,
        'post',
        `/tasks/${task.id}/worktree/queue`,
        { agentId },
      );
    };
    const first = await enqueue('运行中等待真实取消确认', agent.id);
    let active: Execution | undefined;
    await expect
      .poll(
        async () => {
          active = await apiData<Execution>(
            context,
            'get',
            `/worktree-executions/${first.execution.id}`,
          );
          return Boolean(active.sessionId && active.runId);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    const activeSession = active!.sessionId!;
    const activeRun = active!.runId!;
    const second = await enqueue('排队中可直接取消', normalAgent.id);
    const third = await enqueue('权威取消后才可开始', normalAgent.id);
    expect(second.execution.status).toBe('QUEUED');
    expect(third.execution.status).toBe('QUEUED');
    const errors: string[] = [];
    const mutations: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (
        request.method() === 'POST' &&
        (path.includes('/worktree-executions/') || path.includes('/transition'))
      )
        mutations.push(path);
    });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    try {
      await page.goto(`/projects/${project.id}/work?task=${second.task.id}`);
      const cancel = page.getByRole('button', { name: '取消隔离执行', exact: true });
      await expect(cancel).toBeEnabled();
      await expect(page.getByRole('button', { name: '取消', exact: true })).toHaveCount(0);
      const queuedResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname ===
            `/api/v1/worktree-executions/${second.execution.id}/cancel`,
      );
      await cancel.click();
      const canceledResponse = await queuedResponse;
      expect(canceledResponse.ok()).toBe(true);
      const canceled = (
        (await canceledResponse.json()) as { data: { execution: Execution; task: Task } }
      ).data;
      expect(canceled.execution).toMatchObject({
        id: second.execution.id,
        status: 'CANCELED',
        sessionId: null,
        worktreePath: null,
      });
      expect(canceled.task).toMatchObject({
        id: second.task.id,
        status: 'CANCELED',
        sessionId: null,
      });
      expect(
        (await apiData<Execution>(context, 'get', `/worktree-executions/${third.execution.id}`))
          .status,
      ).toBe('QUEUED');
      await page.goto(`/projects/${project.id}/work?task=${first.task.id}`);
      await expect(cancel).toBeEnabled();
      const stopResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname ===
            `/api/v1/worktree-executions/${first.execution.id}/cancel`,
      );
      await cancel.click();
      const requestedResponse = await stopResponse;
      expect(requestedResponse.ok()).toBe(true);
      const requested = ((await requestedResponse.json()) as { data: Execution }).data;
      expect(['RUNNING', 'AWAITING_INPUT']).toContain(requested.status);
      await expect(page.getByText(/尚未确认取消完成/)).toBeVisible();
      await expect(cancel).toBeDisabled();
      expect((await apiData<Task>(context, 'get', `/tasks/${first.task.id}`)).status).toBe(
        'IN_PROGRESS',
      );
      expect(
        (
          await apiData<Array<{ id: string; status: string }>>(
            context,
            'get',
            `/sessions/${activeSession}/runs`,
          )
        ).find((run) => run.id === activeRun)?.status,
      ).toBe('CANCELING');
      const retained = await apiData<Execution>(
        context,
        'get',
        `/worktree-executions/${third.execution.id}`,
      );
      expect(retained).toMatchObject({ status: 'QUEUED', sessionId: null });
      // Only the real ACP fixture can emit cancelled; releasing this disposable
      // file allows its pending prompt to return the authoritative stop reason.
      await writeFile(releaseFile, 'release genuine ACP cancellation');
      await expect
        .poll(
          async () =>
            (await apiData<Execution>(context, 'get', `/worktree-executions/${first.execution.id}`))
              .status,
          { timeout: 15_000 },
        )
        .toBe('CANCELED');
      expect((await apiData<Task>(context, 'get', `/tasks/${first.task.id}`)).status).toBe(
        'CANCELED',
      );
      expect(
        (
          await apiData<Array<{ id: string; status: string }>>(
            context,
            'get',
            `/sessions/${activeSession}/runs`,
          )
        ).find((run) => run.id === activeRun)?.status,
      ).toBe('CANCELED');
      expect((await stat(active!.worktreePath!)).isDirectory()).toBe(true);
      let next: Execution | undefined;
      await expect
        .poll(
          async () => {
            next = await apiData<Execution>(
              context,
              'get',
              `/worktree-executions/${third.execution.id}`,
            );
            return Boolean(next.sessionId && next.runId);
          },
          { timeout: 15_000 },
        )
        .toBe(true);
      let approvalId: string | undefined;
      await expect
        .poll(
          async () => {
            const approvals = await apiData<Array<{ id: string; runId: string; status: string }>>(
              context,
              'get',
              `/approvals?sessionId=${next!.sessionId}`,
            );
            approvalId = approvals.find(
              (item) => item.runId === next!.runId && item.status === 'PENDING',
            )?.id;
            return approvalId;
          },
          { timeout: 15_000 },
        )
        .toBeTruthy();
      await apiData(context, 'post', `/approvals/${approvalId!}/resolve`, {
        optionId: 'allow-once',
      });
      await expect
        .poll(
          async () =>
            (await apiData<Execution>(context, 'get', `/worktree-executions/${third.execution.id}`))
              .status,
          { timeout: 15_000 },
        )
        .toBe('REVIEW');
      await page.getByRole('button', { name: '核对隔离取消状态', exact: true }).click();
      await expect(page.getByText(/隔离执行已取消/)).toBeVisible();
      await expect(cancel).toBeDisabled();
      expect(mutations).toEqual([
        `/api/v1/worktree-executions/${second.execution.id}/cancel`,
        `/api/v1/worktree-executions/${first.execution.id}/cancel`,
      ]);
      expect(
        await apiData<unknown[]>(context, 'get', `/worktree-executions?projectId=${project.id}`),
      ).toHaveLength(3);
      expect(
        await apiData<unknown[]>(context, 'get', `/sessions/${activeSession}/runs`),
      ).toHaveLength(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const shot = info.outputPath(`worktree-cancel-confirmed-${width}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      await info.attach('排队取消与运行取消权威终态', { path: shot, contentType: 'image/png' });
      expect(errors).toEqual([]);
    } finally {
      // Unblock a pending fixture if an assertion failed; app fixture owns the
      // isolated server/process shutdown and exact temporary-directory cleanup.
      await writeFile(releaseFile, 'release for fixture teardown');
    }
  });
}
