import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { apiData, seedWorkspace } from './baseline-support.js';
import { expect, test } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
const markerPrefix = 'agenthub.existing-task-start.v1:';
const privateTitle = '原任务启动恢复：正文不应进入浏览器保护记录';
type Started = { task: { id: string }; session: { id: string }; run: { id: string } };
type Task = { id: string; status: string; sessionId: string | null };
type Attempt = {
  attemptId: string;
  taskId: string;
  sessionId: string;
  runId: string;
  phase: string;
};

async function observeLoss(
  context: BrowserContext,
  origin: string,
  taskId: string,
  stage: 'start' | 'transition',
) {
  const endpoint = `/api/v1/tasks/${taskId}/${stage}`;
  const writes: string[] = [];
  const reads: string[] = [];
  const errors: string[] = [];
  let injected = false;
  let committed: Started | Task | undefined;
  const attach = (page: Page) => {
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (!path.startsWith('/api/v1/')) return;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(path);
      if (request.method() === 'GET' && path.startsWith(`/api/v1/tasks/${taskId}`))
        reads.push(path);
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (
        injected &&
        message.location().url === `${origin}${endpoint}` &&
        message.text() === 'Failed to load resource: net::ERR_FAILED'
      )
        return;
      errors.push(`${message.location().url}: ${message.text()}`);
    });
  };
  context.pages().forEach(attach);
  context.on('page', attach);
  await context.route(`${origin}${endpoint}`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (!injected) {
      const response = await route.fetch({ maxRetries: 0 });
      expect(response.status()).toBe(stage === 'start' ? 201 : 200);
      committed = ((await response.json()) as { data: Started | Task }).data;
      injected = true;
    }
    // Any accidental repeated browser POST is counted but cannot duplicate fixture work.
    await route.abort('failed');
  });
  return { writes, reads, errors, committed: () => committed, endpoint };
}
async function marker(page: Page, projectId: string, taskId: string, stage: string) {
  const records = await page.evaluate(
    (prefix) =>
      Object.entries(localStorage)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({
          key: JSON.parse(key.slice(prefix.length)) as unknown[],
          value: JSON.parse(value) as Record<string, unknown>,
        })),
    markerPrefix,
  );
  expect(records).toHaveLength(1);
  expect(records[0]!.key).toEqual(['local-trusted', projectId, taskId]);
  expect(Object.keys(records[0]!.value).sort()).toEqual(['phase', 'stage']);
  expect(records[0]!.value).toMatchObject({ phase: 'unknown', stage });
  expect(JSON.stringify(records)).not.toContain(privateTitle);
}
async function checkOnly(
  page: Page,
  observed: Awaited<ReturnType<typeof observeLoss>>,
  expectedSession: string | null,
) {
  const panel = page.getByRole('region', { name: '原任务启动核对' });
  await expect(panel).toBeVisible();
  const before = observed.writes.slice();
  const readCount = observed.reads.length;
  const check = panel.getByRole('button', { name: '核对原任务启动', exact: true });
  await check.scrollIntoViewIfNeeded();
  await check.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toContainText('这不证明本次请求成功，未重新启动');
  await expect(check).toBeEnabled();
  expect(observed.reads.length).toBeGreaterThan(readCount);
  expect(observed.reads).toContain(
    `${observed.endpoint.slice(0, observed.endpoint.lastIndexOf('/'))}/start-attempts`,
  );
  expect(observed.writes).toEqual(before);
  await expect(page.getByRole('button', { name: '启动 Session', exact: true })).toBeDisabled();
  await expect(panel).not.toContainText('本次启动已确认');
  const link = panel.getByRole('link', { name: '打开已核对的关联会话', exact: true });
  if (expectedSession) await expect(link).toHaveAttribute('href', `/workspace/${expectedSession}`);
  else await expect(link).toHaveCount(0);
  return panel;
}
async function capture(page: Page, info: TestInfo, name: string) {
  const panel = page.getByRole('region', { name: '原任务启动核对' });
  await panel.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}
async function finishTurn(context: BrowserContext, taskId: string, started: Started) {
  let approvalId: string | undefined;
  await expect
    .poll(
      async () => {
        const rows = await apiData<Array<{ id: string; runId: string; status: string }>>(
          context,
          'get',
          `/approvals?sessionId=${started.session.id}`,
        );
        approvalId = rows.find(
          (row) => row.runId === started.run.id && row.status === 'PENDING',
        )?.id;
        return approvalId;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();
  await apiData(context, 'post', `/approvals/${approvalId!}/resolve`, { optionId: 'allow-once' });
  await expect
    .poll(async () => (await apiData<Task>(context, 'get', `/tasks/${taskId}`)).status, {
      timeout: 15_000,
    })
    .toBe('WAITING_REVIEW');
}

for (const width of [390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`真实启动已提交但丢响应，刷新重开只读核对 ${width} ${theme}`, async ({
      page,
      context,
      app,
    }, info) => {
      const { project, agent } = await seedWorkspace(context, app);
      const task = await apiData<Task>(context, 'post', '/tasks', {
        projectId: project.id,
        title: privateTitle,
      });
      await apiData(context, 'post', `/tasks/${task.id}/transition`, { status: 'READY' });
      const baselineSessions = await apiData<Array<{ id: string }>>(
        context,
        'get',
        `/sessions?projectId=${project.id}`,
      );
      await context.addInitScript(
        ({ origin, theme }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { origin: app.origin, theme },
      );
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const observed = await observeLoss(context, app.origin, task.id, 'start');
      const path = `/projects/${project.id}/work?task=${task.id}&agentId=${agent.id}`;
      await page.goto(path);
      const start = page.getByRole('button', { name: '启动 Session', exact: true });
      await expect(start).toBeEnabled();
      await start.click();
      const panel = page.getByRole('region', { name: '原任务启动核对' });
      await expect(panel).toContainText('原操作结果未知');
      await expect(start).toBeDisabled();
      const committed = observed.committed() as Started;
      expect(committed.task.id).toBe(task.id);
      const stored = await apiData<Task>(context, 'get', `/tasks/${task.id}`);
      expect(stored.sessionId).toBe(committed.session.id);
      await expect(page).toHaveURL(`${app.origin}${path}`);
      await marker(page, project.id, task.id, 'start');
      await checkOnly(page, observed, committed.session.id);
      await page.goto('/home');
      await page.goto(path);
      await checkOnly(page, observed, committed.session.id);
      await page.reload();
      await checkOnly(page, observed, committed.session.id);
      await marker(page, project.id, task.id, 'start');
      await page.close();
      const reopened = await context.newPage();
      await reopened.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await reopened.goto(path);
      await checkOnly(reopened, observed, committed.session.id);
      await marker(reopened, project.id, task.id, 'start');
      await expect(reopened.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
      await capture(reopened, info, `task-start-unknown-${width}-${theme}`);
      const attempts = await apiData<Attempt[]>(context, 'get', `/tasks/${task.id}/start-attempts`);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        taskId: task.id,
        sessionId: committed.session.id,
        runId: committed.run.id,
        phase: 'RUN_ADMITTED',
      });
      const sessions = await apiData<Array<{ id: string }>>(
        context,
        'get',
        `/sessions?projectId=${project.id}`,
      );
      expect(sessions).toHaveLength(baselineSessions.length + 1);
      const runs = await apiData<Array<{ id: string }>>(
        context,
        'get',
        `/sessions/${committed.session.id}/runs`,
      );
      expect(runs.map((run) => run.id)).toEqual([committed.run.id]);
      expect(observed.writes).toEqual([observed.endpoint]);
      const open = reopened
        .getByRole('region', { name: '原任务启动核对' })
        .getByRole('link', { name: '打开已核对的关联会话' });
      await open.focus();
      await reopened.keyboard.press('Enter');
      await expect(reopened).toHaveURL(`${app.origin}/workspace/${committed.session.id}`);
      expect(observed.writes).toEqual([observed.endpoint]);
      expect(observed.errors).toEqual([]);
    });
  }
}

for (const history of [false, true]) {
  test(`准备READY响应丢失绝不继续start，历史不解锁 ${history ? '有历史' : '空历史'}`, async ({
    page,
    context,
    app,
  }, info) => {
    const { project, agent } = await seedWorkspace(context, app);
    const task = await apiData<Task>(context, 'post', '/tasks', {
      projectId: project.id,
      title: privateTitle,
    });
    let oldSession: string | null = null;
    if (history) {
      await apiData(context, 'post', `/tasks/${task.id}/transition`, { status: 'READY' });
      const started = await apiData<Started>(context, 'post', `/tasks/${task.id}/start`, {
        agentId: agent.id,
      });
      await finishTurn(context, task.id, started);
      await apiData(context, 'post', `/tasks/${task.id}/transition`, { status: 'BLOCKED' });
      oldSession = started.session.id;
    }
    const attemptsBefore = await apiData<Attempt[]>(
      context,
      'get',
      `/tasks/${task.id}/start-attempts`,
    );
    const sessionsBefore = await apiData<Array<{ id: string }>>(
      context,
      'get',
      `/sessions?projectId=${project.id}`,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    const observed = await observeLoss(context, app.origin, task.id, 'transition');
    const path = `/projects/${project.id}/work?task=${task.id}&agentId=${agent.id}`;
    await page.goto(path);
    const start = page.getByRole('button', { name: '启动 Session', exact: true });
    await expect(start).toBeEnabled();
    await start.click();
    await expect(page.getByRole('region', { name: '原任务启动核对' })).toContainText(
      '原操作结果未知',
    );
    expect((observed.committed() as Task).status).toBe('READY');
    await checkOnly(page, observed, oldSession);
    await page.reload();
    await checkOnly(page, observed, oldSession);
    await marker(page, project.id, task.id, 'prepare');
    await expect(page).toHaveURL(`${app.origin}${path}`);
    expect((await apiData<Task>(context, 'get', `/tasks/${task.id}`)).status).toBe('READY');
    expect(await apiData<Attempt[]>(context, 'get', `/tasks/${task.id}/start-attempts`)).toEqual(
      attemptsBefore,
    );
    expect(
      await apiData<Array<{ id: string }>>(context, 'get', `/sessions?projectId=${project.id}`),
    ).toHaveLength(sessionsBefore.length);
    expect(observed.writes).toEqual([observed.endpoint]);
    await capture(page, info, `task-prepare-unknown-history-${history}`);
    expect(observed.errors).toEqual([]);
  });
}
