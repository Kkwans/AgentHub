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

for (const theme of ['light', 'dark']) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`真实任务审阅反馈返工后确认完成 ${width} ${theme}`, async ({
      page,
      context,
      app,
    }, info) => {
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
      const firstAttempts = await apiData<
        Array<{ attemptId: string; phase: string; sessionId: string; runId: string }>
      >(context, 'get', `/tasks/${task.id}/start-attempts`);
      expect(firstAttempts).toHaveLength(1);
      expect(firstAttempts[0]).toMatchObject({
        phase: 'RUN_ADMITTED',
        sessionId: first.session.id,
        runId: first.run.id,
      });
      expect(firstAttempts[0]).not.toHaveProperty('inputHash');
      await finishFixtureTurn(context, task.id, first);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const errors: string[] = [];
      const reviews: unknown[] = [];
      let pageWrites = 0;
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('request', (request) => {
        if (
          !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
          new URL(request.url()).pathname.startsWith('/api/v1/')
        )
          pageWrites += 1;
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === `/api/v1/tasks/${task.id}/review`
        )
          reviews.push(request.postDataJSON());
      });
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      await page.goto(`/projects/${project.id}/work?task=${task.id}`);
      await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
      const resultEntry = page.getByRole('link', { name: '查看本次任务的工作区结果' });
      await expect(resultEntry).toHaveAttribute('href', `/workspace/${first.session.id}`);
      const criteriaHeading = page.getByRole('heading', { name: '验收标准', exact: true });
      const approveButton = page.getByRole('button', { name: '确认达到验收标准', exact: true });
      const resultBox = await resultEntry.boundingBox();
      const criteriaBox = await criteriaHeading.boundingBox();
      const approveBox = await approveButton.boundingBox();
      expect(resultBox).not.toBeNull();
      expect(criteriaBox).not.toBeNull();
      expect(approveBox).not.toBeNull();
      expect(resultBox!.y + resultBox!.height).toBeLessThan(criteriaBox!.y);
      expect(criteriaBox!.y + criteriaBox!.height).toBeLessThan(approveBox!.y);
      if (width >= 1024) expect(approveBox!.width).toBeLessThan(300);
      expect(approveBox!.height).toBeGreaterThanOrEqual(width < 768 ? 44 : 36);
      const feedbackControl = page.getByRole('textbox', { name: '继续修改说明' });
      await expect(feedbackControl).toHaveAttribute('rows', '2');
      const emptyFeedbackBox = await feedbackControl.boundingBox();
      expect(emptyFeedbackBox).not.toBeNull();
      expect(emptyFeedbackBox!.height).toBeGreaterThanOrEqual(44);
      expect(emptyFeedbackBox!.height).toBeLessThan(90);
      expect(await feedbackControl.evaluate((element) => getComputedStyle(element).resize)).toBe(
        'vertical',
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const evidenceShot = info.outputPath(`ordinary-review-evidence-${theme}-${width}.png`);
      await page.screenshot({ path: evidenceShot, fullPage: true });
      await info.attach('普通审阅结果优先', { path: evidenceShot, contentType: 'image/png' });
      if (width >= 1024) {
        const layout = page.locator('[data-layout="task-review"]');
        await expect(layout).toBeVisible();
        const list = layout.getByRole('region', { name: '工作列表' });
        const inspector = layout.getByRole('complementary', { name: '工作 Inspector' });
        const listBox = await list.boundingBox();
        const inspectorBox = await inspector.boundingBox();
        expect(listBox).not.toBeNull();
        expect(inspectorBox).not.toBeNull();
        expect(inspectorBox!.width).toBeGreaterThan(listBox!.width * 1.5);
        const reviewShot = info.outputPath(`ordinary-review-primary-${theme}-${width}.png`);
        await page.screenshot({ path: reviewShot });
        await info.attach('普通任务审阅主画布', { path: reviewShot, contentType: 'image/png' });
      }
      const attemptsPanel = page.getByRole('region', { name: '任务启动记录' });
      await expect(attemptsPanel).toBeVisible();
      const writesBeforeCheck = pageWrites;
      const queryAttempts = attemptsPanel.getByRole('button', {
        name: '查询启动记录',
        exact: true,
      });
      await queryAttempts.focus();
      await page.keyboard.press('Enter');
      await expect(attemptsPanel).toContainText('已移交运行，不代表任务完成');
      await expect(attemptsPanel).toContainText('以下是历史记录，不代表当前执行状态');
      const identifiers = attemptsPanel.locator('summary');
      await identifiers.focus();
      await page.keyboard.press('Enter');
      await expect(
        attemptsPanel.getByText(firstAttempts[0]!.attemptId, { exact: true }),
      ).toBeVisible();
      await expect(attemptsPanel.getByText(first.session.id, { exact: true })).toBeVisible();
      await expect(attemptsPanel.getByText(first.run.id, { exact: true })).toBeVisible();
      expect(pageWrites).toBe(writesBeforeCheck);
      expect((await apiData<Task>(context, 'get', `/tasks/${task.id}`)).status).toBe(
        'WAITING_REVIEW',
      );
      await attemptsPanel.scrollIntoViewIfNeeded();
      if (width >= 1024) {
        await expect(page.getByRole('region', { name: '工作列表' })).toBeInViewport();
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const panelInsets = await attemptsPanel.evaluate((panel) => {
        const panelRect = panel.getBoundingClientRect();
        const summary = panel.querySelector('summary')!;
        const summaryRect = summary.getBoundingClientRect();
        const fields = panel.querySelector('dl')!.getBoundingClientRect();
        return {
          left: summaryRect.left - panelRect.left,
          right: panelRect.right - summaryRect.right,
          fieldsLeft: fields.left - panelRect.left,
          fieldsRight: panelRect.right - fields.right,
          focusOffset: parseFloat(getComputedStyle(summary).outlineOffset),
        };
      });
      expect(panelInsets.left).toBeGreaterThanOrEqual(16);
      expect(panelInsets.right).toBeGreaterThanOrEqual(16);
      expect(panelInsets.fieldsLeft).toBeGreaterThanOrEqual(16);
      expect(panelInsets.fieldsRight).toBeGreaterThanOrEqual(16);
      expect(panelInsets.focusOffset).toBeLessThanOrEqual(0);
      const attemptsShot = info.outputPath(`task-start-attempts-${theme}-${width}.png`);
      await page.screenshot({ path: attemptsShot });
      await info.attach('原启动记录只读核对', { path: attemptsShot, contentType: 'image/png' });
      await identifiers.focus();
      await page.keyboard.press('Enter');
      const feedback = page.getByRole('textbox', { name: '继续修改说明' });
      const rework = page.getByRole('button', { name: '提交继续修改', exact: true });
      await expect(rework).toBeDisabled();
      await feedback.fill('请补齐边界条件回归，再按原验收标准检查');
      await expect(rework).toBeEnabled();
      await rework.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const reviewShot = info.outputPath(`task-review-feedback-${theme}-${width}.png`);
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
      const beforeOldRun = await apiData(context, 'get', `/sessions/${first.session.id}/runs`);
      const rejectedOld = await context.request.post(`/api/v1/sessions/${first.session.id}/runs`, {
        data: { text: '旧会话不可抢占新返工' },
      });
      expect(rejectedOld.status()).toBe(409);
      expect((await rejectedOld.json()).error.code).toBe('TASK_RUN_OWNERSHIP_CHANGED');
      expect(await apiData(context, 'get', `/sessions/${first.session.id}/runs`)).toEqual(
        beforeOldRun,
      );
      const attempts = await apiData<Array<{ phase: string; sessionId: string; runId: string }>>(
        context,
        'get',
        `/tasks/${task.id}/start-attempts`,
      );
      expect(attempts).toHaveLength(2);
      expect(attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            phase: 'RUN_ADMITTED',
            sessionId: second.session.id,
            runId: second.run.id,
          }),
        ]),
      );
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
      expect(await apiData<Task[]>(context, 'get', `/tasks?projectId=${project.id}`)).toHaveLength(
        1,
      );
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
      const doneShot = info.outputPath(`task-review-done-${theme}-${width}.png`);
      await page.screenshot({ path: doneShot, fullPage: true });
      await info.attach('审阅完成及持久状态', { path: doneShot, contentType: 'image/png' });
      expect(errors).toEqual([]);
    });
  }
}

test('真实390审阅pending返回并重入后晚成功保留结果且不自动导航', async ({
  page,
  context,
  app,
}, info) => {
  const { project, agent } = await seedWorkspace(context, app);
  const title = '手机延迟审阅结果保持原任务归属';
  const task = await apiData<Task>(context, 'post', '/tasks', {
    projectId: project.id,
    title,
    description: '返回列表不会丢失原操作结果',
    acceptanceCriteria: '只提交一次，成功结果可显式打开',
  });
  await apiData(context, 'post', `/tasks/${task.id}/transition`, { status: 'READY' });
  const first = await apiData<Started>(context, 'post', `/tasks/${task.id}/start`, {
    agentId: agent.id,
  });
  await finishFixtureTurn(context, task.id, first);
  await page.setViewportSize({ width: 390, height: 844 });
  const workPath = `/projects/${project.id}/work`;
  const reviewPath = `/api/v1/tasks/${task.id}/review`;
  const reviewURL = new URL(reviewPath, app.origin).href;
  let postCount = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === reviewPath)
      postCount += 1;
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finishHandler!: () => void;
  const handlerDone = new Promise<void>((resolve) => {
    finishHandler = resolve;
  });
  let handlerStarted = false;
  let fetched = false;
  let handlerError: unknown;
  let second: Started | undefined;
  await page.route(reviewURL, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    handlerStarted = true;
    try {
      // The real server performs the operation. Only browser delivery is delayed.
      const response = await route.fetch({ timeout: 15_000 });
      expect(response.ok()).toBe(true);
      second = ((await response.json()) as { data: Started }).data;
      expect(second.session.id).not.toBe(first.session.id);
      expect(second.run.id).not.toBe(first.run.id);
      fetched = true;
      await gate;
      await route.fulfill({ response });
    } catch (error) {
      handlerError = error;
      fetched = true;
      await route.abort().catch(() => {});
    } finally {
      finishHandler();
    }
  });
  const capture = async (state: string) => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const path = info.outputPath(`task-review-mobile-${state}-390.png`);
    await page.screenshot({ path, fullPage: true });
    await info.attach(`真实手机审阅 ${state}`, { path, contentType: 'image/png' });
  };
  try {
    await page.goto(`${workPath}?task=${task.id}`);
    await expect(page.getByRole('complementary', { name: '工作 Inspector' })).toBeVisible();
    await page
      .getByRole('textbox', { name: '继续修改说明' })
      .fill('保留原反馈，完成后由我打开结果');
    await page.getByRole('button', { name: '提交继续修改', exact: true }).click();
    await expect.poll(() => fetched, { timeout: 20_000 }).toBe(true);
    if (handlerError) throw handlerError;
    expect(second).toBeDefined();
    await expect(page.getByText('工作操作正在提交', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回工作列表' }).click();
    await expect(page.getByRole('region', { name: '工作列表' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: '工作 Inspector' })).toBeHidden();
    const originalRow = page
      .getByRole('region', { name: '工作列表' })
      .getByRole('button', { name: new RegExp(title) });
    await expect(originalRow).toBeFocused();
    await capture('pending-list');
    await originalRow.click();
    await expect(page.getByRole('complementary', { name: '工作 Inspector' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: '继续修改说明' })).toHaveValue(
      '保留原反馈，完成后由我打开结果',
    );
    await expect(page.getByRole('button', { name: '提交继续修改', exact: true })).toBeDisabled();
    release();
    await handlerDone;
    if (handlerError) throw handlerError;
    const result = page.getByRole('link', { name: '打开已确认结果', exact: true });
    await expect(result).toHaveAttribute('href', `/workspace/${second!.session.id}`);
    await expect(page).toHaveURL(new URL(`${workPath}?task=${task.id}`, app.origin).href);
    expect(postCount).toBe(1);
    await capture('reentered-result');
    const persisted = await apiData<Task>(context, 'get', `/tasks/${task.id}`);
    expect(persisted.sessionId).toBe(second!.session.id);
    expect(errors).toEqual([]);
  } finally {
    // Failure before release must not leave an intercepted request hanging in teardown.
    release();
    if (handlerStarted) await handlerDone;
    await page.unroute(reviewURL);
  }
});
