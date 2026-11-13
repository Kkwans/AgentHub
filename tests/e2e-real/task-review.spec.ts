import type { BrowserContext } from '@playwright/test';
import { apiData, seedWorkspace } from './baseline-support.js';
import { expect, test } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);

type Started = { session: { id: string }; run: { id: string } };
type Task = {
  id: string;
  status: string;
  sessionId: string | null;
  assignedAgentId: string | null;
  finalRunId: string | null;
  completedAt: string | null;
};

async function finishFixtureTurn(context: BrowserContext, taskId: string, started: Started) {
  let approvalId: string | undefined;
  await expect
    .poll(
      async () => {
        const pending = await apiData<Array<{ id: string; runId: string; status: string }>>(
          context,
          'get',
          `/approvals?sessionId=${started.session.id}`,
        );
        approvalId = pending.find(
          (item) => item.runId === started.run.id && item.status === 'PENDING',
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
          `/sessions/${started.session.id}/runs`,
        );
        return runs.find((run) => run.id === started.run.id)?.status;
      },
      { timeout: 15_000 },
    )
    .toBe('COMPLETED');
  await expect
    .poll(async () => (await apiData<Task>(context, 'get', `/tasks/${taskId}`)).status, {
      timeout: 15_000,
    })
    .toBe('WAITING_REVIEW');
}

for (const width of [390, 768, 1024, 1440]) {
  test(`真实任务审阅反馈返工后确认完成 ${width}`, async ({ page, context, app }, info) => {
    const { project, agent } = await seedWorkspace(context, app);
    const task = await apiData<Task>(context, 'post', '/tasks', {
      projectId: project.id,
      title: '审阅主目标保持不变',
      description: '保留原始验收上下文',
      acceptanceCriteria: '结果符合要求且回归通过',
    });
    await apiData(context, 'post', `/tasks/${task.id}/transition`, { status: 'READY' });
    const first = await apiData<Started>(context, 'post', `/tasks/${task.id}/start`, {
      agentId: agent.id,
    });
    await finishFixtureTurn(context, task.id, first);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const errors: string[] = [];
    const reviews: unknown[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === `/api/v1/tasks/${task.id}/review`
      )
        reviews.push(request.postDataJSON());
    });
    await page.goto(`/projects/${project.id}/work?task=${task.id}`);
    const feedback = page.getByRole('textbox', { name: '继续修改说明' });
    const rework = page.getByRole('button', { name: '提交继续修改', exact: true });
    await expect(rework).toBeDisabled();
    await feedback.fill('请补齐边界条件回归，再按原验收标准检查');
    await expect(rework).toBeEnabled();
    await rework.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const reviewShot = info.outputPath(`task-review-feedback-${width}.png`);
    await page.screenshot({ path: reviewShot, fullPage: true });
    await info.attach('原任务审阅及返工反馈', { path: reviewShot, contentType: 'image/png' });
    const reworkResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v1/tasks/${task.id}/review`,
    );
    await rework.click();
    const response = await reworkResponse;
    expect(response.ok()).toBe(true);
    const second = ((await response.json()) as { data: Started }).data;
    expect(second.session.id).not.toBe(first.session.id);
    expect(second.run.id).not.toBe(first.run.id);
    await expect(page).toHaveURL(new RegExp(`/workspace/${second.session.id}$`));
    const messages = await apiData<Array<{ role: string; text: string }>>(
      context,
      'get',
      `/sessions/${second.session.id}/messages`,
    );
    const instruction = messages.find((item) => item.role === 'USER')?.text;
    expect(instruction).toContain('请补齐边界条件回归，再按原验收标准检查');
    expect(instruction).toContain('审阅主目标保持不变');
    expect(instruction).toContain('保留原始验收上下文');
    await finishFixtureTurn(context, task.id, second);
    await page.goto(`/projects/${project.id}/work?task=${task.id}`);
    const approve = page.getByRole('button', { name: '确认达到验收标准', exact: true });
    await expect(approve).toBeEnabled();
    await approve.scrollIntoViewIfNeeded();
    await approve.click();
    await expect
      .poll(async () => (await apiData<Task>(context, 'get', `/tasks/${task.id}`)).status)
      .toBe('DONE');
    const completed = await apiData<Task>(context, 'get', `/tasks/${task.id}`);
    expect(completed).toMatchObject({
      assignedAgentId: agent.id,
      sessionId: second.session.id,
      finalRunId: second.run.id,
    });
    expect(completed.completedAt).toBeTruthy();
    expect(reviews).toEqual([
      { decision: 'REWORK', feedback: '请补齐边界条件回归，再按原验收标准检查' },
      { decision: 'APPROVE' },
    ]);
    expect(await apiData<Task[]>(context, 'get', `/tasks?projectId=${project.id}`)).toHaveLength(1);
    expect(
      await apiData<Array<{ id: string }>>(context, 'get', `/sessions?projectId=${project.id}`),
    ).toHaveLength(3); // seed Session plus two legitimate task rounds
    await page.reload();
    await expect(page.getByRole('button', { name: '确认达到验收标准', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: '提交继续修改', exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const doneShot = info.outputPath(`task-review-done-${width}.png`);
    await page.screenshot({ path: doneShot, fullPage: true });
    await info.attach('审阅完成及持久状态', { path: doneShot, contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
}
