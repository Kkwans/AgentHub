import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures.js';

const prefix = 'agenthub:task-creation:v1:';
const goal = '恢复测试：完整目标不应持久化到浏览器';
test.setTimeout(120_000);
async function post<T>(context: BrowserContext, path: string, data?: object): Promise<T> {
  const response = await context.request.post(`/api/v1${path}`, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return ((await response.json()) as { data: T }).data;
}
async function get<T>(context: BrowserContext, path: string): Promise<T> {
  const response = await context.request.get(`/api/v1${path}`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { data: T }).data;
}
async function seed(context: BrowserContext, rootPath: string) {
  const target = await post<{ id: string }>(context, '/execution-targets', {
    name: '恢复测试宿主机',
    kind: 'LOCAL_HOST',
    hostname: '127.0.0.1',
    os: process.platform,
    arch: process.arch,
  });
  return post<{ id: string; targetId: string }>(context, '/projects', {
    name: '恢复测试项目',
    kind: 'STANDARD',
    targetId: target.id,
    rootPath,
  });
}
async function markers(page: Page) {
  return page.evaluate(
    (prefix) =>
      Object.entries(localStorage)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value: JSON.parse(value) as Record<string, unknown> })),
    prefix,
  );
}
async function expectIdsOnly(page: Page) {
  const records = await markers(page);
  expect(records).toHaveLength(1);
  for (const key of Object.keys(records[0]!.value))
    expect(['version', 'scope', 'projectId', 'operationId', 'stage', 'taskId']).toContain(key);
  expect(JSON.stringify(records)).not.toContain(goal);
  return records[0]!;
}
async function begin(page: Page, projectId: string, start = false) {
  await page.goto(`/projects/${projectId}/work/new`);
  await page.getByRole('textbox', { name: '你想完成什么？' }).fill(goal);
  await page.getByRole('button', { name: start ? '创建并开始' : '创建任务', exact: true }).click();
}
async function observe(context: BrowserContext, origin: string, abortFirst = false) {
  const bodies: Record<string, unknown>[] = [];
  const sideEffects: string[] = [];
  const recoveryGets: string[] = [];
  const errors: string[] = [];
  let taskId = '';
  let injected = false;
  const attach = (page: Page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (
        injected &&
        message.location().url === `${origin}/api/v1/tasks` &&
        message.text() === 'Failed to load resource: net::ERR_FAILED'
      )
        return;
      // A real 404 recovery response is expected only in the explicit unknown-operation test.
      errors.push(`${message.location().url}: ${message.text()}`);
    });
  };
  context.pages().forEach(attach);
  context.on('page', attach);
  context.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && /\/tasks\/[^/]+\/(transition|start)$/.test(path))
      sideEffects.push(path);
    if (request.method() === 'GET' && path.startsWith('/api/v1/tasks/creation-operations/'))
      recoveryGets.push(path);
  });
  await context.route(`${origin}/api/v1/tasks`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    if (abortFirst && !injected) {
      const response = await route.fetch({ maxRetries: 0 });
      expect(response.status()).toBe(201);
      taskId = ((await response.json()) as { data: { id: string } }).data.id;
      injected = true;
      await route.abort('failed');
    } else await route.continue();
  });
  return { bodies, sideEffects, recoveryGets, errors, taskId: () => taskId };
}
async function expectNoExecution(context: BrowserContext, count: number) {
  expect(await get<unknown[]>(context, '/tasks')).toHaveLength(count);
  expect(await get<unknown[]>(context, '/sessions')).toHaveLength(0);
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}

test.describe('真实创建操作恢复', () => {
  test.use({ authMode: 'local_trusted' });
  for (const width of [390, 768, 1024, 1440]) {
    test(`提交后丢响应，刷新和关闭重开只读恢复 ${width}`, async ({ page, context, app }, info) => {
      await page.setViewportSize({ width, height: 900 });
      const project = await seed(context, app.projectRoot);
      const observed = await observe(context, app.origin, true);
      await begin(page, project.id);
      await expect(page.getByRole('button', { name: '同编号重试创建' })).toBeVisible();
      const record = await expectIdsOnly(page);
      expect(record.value.operationId).toBe(observed.bodies[0]!.operationId);
      await page.reload();
      await expect(
        page
          .getByRole('region', { name: '任务创建恢复' })
          .getByText('已找到原任务；请手动查看结果。'),
      ).toBeVisible();
      await screenshot(page, info, `recovery-${width}-reload`);
      await page.close();
      const reopened = await context.newPage();
      await reopened.setViewportSize({ width, height: 900 });
      await reopened.goto(`/projects/${project.id}/work/new`);
      const open = reopened.getByRole('button', { name: '打开原任务', exact: true });
      await expect(open).toBeVisible();
      expect((await expectIdsOnly(reopened)).value.operationId).toBe(record.value.operationId);
      await screenshot(reopened, info, `recovery-${width}-reopened`);
      await open.focus();
      await reopened.keyboard.press('Enter');
      await expect(reopened).toHaveURL(
        `${app.origin}/projects/${project.id}/work?task=${observed.taskId()}`,
      );
      expect(observed.bodies).toHaveLength(1);
      expect(observed.recoveryGets.length).toBeGreaterThanOrEqual(2);
      expect(observed.sideEffects).toEqual([]);
      await expectNoExecution(context, 1);
      expect(observed.errors).toEqual([]);
    });
  }
  test('同页同编号冻结请求重放成功也不自动启动', async ({ page, context, app }) => {
    const project = await seed(context, app.projectRoot);
    const agent = await post<{ id: string }>(context, '/agents', {
      name: '恢复测试 Fixture Agent',
      targetId: project.targetId,
      agentKind: 'CUSTOM_ACP',
      executable: process.execPath,
      args: [new URL('../fixtures/acp/fake-agent.mjs', import.meta.url).pathname],
    });
    expect(
      (
        await post<{ status: string }>(context, `/agents/${agent.id}/preflight`, {
          cwd: app.projectRoot,
        })
      ).status,
    ).toBe('READY');
    const observed = await observe(context, app.origin, true);
    await begin(page, project.id, true);
    await page.getByRole('button', { name: '同编号重试创建' }).click();
    await expect(page.getByRole('button', { name: '查看原任务', exact: true })).toBeVisible();
    expect(observed.bodies).toHaveLength(2);
    expect(observed.bodies[1]).toEqual(observed.bodies[0]);
    await expectNoExecution(context, 1);
    expect(observed.sideEffects).toEqual([]);
    expect(observed.errors).toEqual([]);
  });
  test('恢复记录无法写入时不发送创建请求', async ({ page, context, app }) => {
    const project = await seed(context, app.projectRoot);
    const observed = await observe(context, app.origin);
    await context.addInitScript((prefix) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith(prefix))
          throw new DOMException('Injected quota failure', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    }, prefix);
    await begin(page, project.id);
    await expect(
      page.getByText('无法安全保存创建恢复记录，未发送创建请求。请检查浏览器存储或核对未决记录。'),
    ).toBeVisible();
    expect(observed.bodies).toHaveLength(0);
    expect(observed.sideEffects).toEqual([]);
    await expectNoExecution(context, 0);
    expect(observed.errors).toEqual([]);
  });
  test('真实404保留未决记录并要求确认才移除', async ({ page, context, app }) => {
    const project = await seed(context, app.projectRoot);
    const operationId = randomUUID();
    const marker = {
      version: 1,
      scope: 'local-trusted',
      projectId: project.id,
      operationId,
      stage: 'CREATE_PENDING',
    };
    await page.goto('/home');
    await page.evaluate(
      ({ prefix, marker }) =>
        localStorage.setItem(
          `${prefix}${encodeURIComponent(marker.scope)}:${marker.projectId}:${marker.operationId}`,
          JSON.stringify(marker),
        ),
      { prefix, marker },
    );
    const observed = await observe(context, app.origin);
    await page.goto(`/projects/${project.id}/work/new`);
    await expect(
      page.getByText('尚无已提交结果，不代表原请求未执行。请稍后再次查询，勿重复新建。'),
    ).toBeVisible();
    await page.getByRole('button', { name: '再次查询创建结果' }).click();
    expect((await expectIdsOnly(page)).value).toEqual(marker);
    await page.getByRole('button', { name: '移除此本机恢复记录', exact: true }).click();
    await expect(
      page.getByText(
        '移除本机记录不会取消服务器请求。请先核对任务列表，重新创建可能产生重复任务。',
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: '保留记录', exact: true }).click();
    expect(await markers(page)).toHaveLength(1);
    expect(observed.bodies).toHaveLength(0);
    expect(observed.sideEffects).toEqual([]);
    await expectNoExecution(context, 0);
    // Only the exact intentional GET 404 resource diagnostic is admissible.
    const expectedError = `${app.origin}/api/v1/tasks/creation-operations/${operationId}: Failed to load resource: the server responded with a status of 404 (Not Found)`;
    expect(observed.errors.filter((error) => error !== expectedError)).toEqual([]);
  });
});

test('token模式同账户重新登录仅恢复原Task', async ({ page, context, app }) => {
  const credentials = { username: 'recoveryadmin', password: 'test-only-recovery-password' };
  await post(context, '/auth/setup', credentials);
  const project = await seed(context, app.projectRoot);
  const observed = await observe(context, app.origin, true);
  await begin(page, project.id);
  await expect(page.getByRole('button', { name: '同编号重试创建' })).toBeVisible();
  const original = await expectIdsOnly(page);
  expect(original.value.scope).toMatch(/^account:/);
  await post(context, '/auth/logout');
  await post(context, '/auth/login', credentials);
  await page.reload();
  await expect(page.getByRole('button', { name: '打开原任务', exact: true })).toBeVisible();
  expect((await expectIdsOnly(page)).value.operationId).toBe(original.value.operationId);
  expect(observed.bodies).toHaveLength(1);
  expect(observed.sideEffects).toEqual([]);
  await expectNoExecution(context, 1);
  expect(observed.errors).toEqual([]);
});
