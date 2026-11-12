import { apiData, seedWorkspace } from './baseline-support.js';
import { expect, initializeGitProject, test } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
for (const width of [390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`手工任务合法两步开始且不启动Agent ${width} ${theme}`, async ({
      page,
      context,
      app,
    }, info) => {
      await initializeGitProject(app.projectRoot);
      const target = await apiData<{ id: string }>(context, 'post', '/execution-targets', {
        name: '手工任务环境',
        kind: 'LOCAL_HOST',
        hostname: '127.0.0.1',
        os: process.platform,
        arch: process.arch,
      });
      const project = await apiData<{ id: string }>(context, 'post', '/projects', {
        name: '手工工作项目',
        targetId: target.id,
        rootPath: app.projectRoot,
        kind: 'STANDARD',
      });
      const task = await apiData<{ id: string; status: string }>(context, 'post', '/tasks', {
        projectId: project.id,
        title: '人工整理验收清单',
      });
      expect(task.status).toBe('BACKLOG');
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await context.addInitScript(
        ({ origin, theme }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { origin: app.origin, theme },
      );
      const errors: string[] = [];
      const transitions: unknown[] = [];
      const runtimeRequests: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('request', (request) => {
        if (request.method() !== 'POST') return;
        const path = new URL(request.url()).pathname;
        if (path === `/api/v1/tasks/${task.id}/transition`)
          transitions.push(request.postDataJSON());
        if (path.endsWith('/start') || path.endsWith('/runs') || path === '/api/v1/sessions')
          runtimeRequests.push(path);
      });
      await page.goto(`/projects/${project.id}/work?task=${task.id}`);
      const begin = page.getByRole('button', { name: '开始手工任务', exact: true });
      await expect(begin).toBeEnabled();
      await expect(
        page.getByText('手工开始仅更新任务进度，不会启动 Agent。', { exact: true }),
      ).toBeVisible();
      await begin.scrollIntoViewIfNeeded();
      await expect(begin).toBeInViewport({ ratio: 1 });
      await begin.click();
      await expect(
        page.getByText('任务已标记为进行中；没有启动 Agent。', { exact: true }),
      ).toBeVisible();
      await expect
        .poll(
          async () =>
            (await apiData<{ status: string }>(context, 'get', `/tasks/${task.id}`)).status,
        )
        .toBe('IN_PROGRESS');
      expect(transitions).toEqual([{ status: 'READY' }, { status: 'IN_PROGRESS' }]);
      expect(runtimeRequests).toEqual([]);
      const stored = await apiData<{
        sessionId: string | null;
        assignedAgentId: string | null;
        finalRunId: string | null;
      }>(context, 'get', `/tasks/${task.id}`);
      expect(stored).toMatchObject({ sessionId: null, assignedAgentId: null, finalRunId: null });
      const sessions = await apiData<Array<{ id: string }>>(
        context,
        'get',
        `/sessions?projectId=${project.id}`,
      );
      expect(sessions).toEqual([]);
      // Every Run has a required Session FK. Also count any unexpected Session's real Runs.
      const runs = (
        await Promise.all(
          sessions.map((session) =>
            apiData<unknown[]>(context, 'get', `/sessions/${session.id}/runs`),
          ),
        )
      ).flat();
      expect(runs).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const path = info.outputPath(`manual-task-start-${width}-${theme}.png`);
      await page.screenshot({ path, fullPage: true });
      await info.attach('手工任务已开始', { path, contentType: 'image/png' });
      expect(errors).toEqual([]);
    });
  }
}

for (const width of [390, 768, 1024, 1440]) {
  test(`阻塞任务可通过合法转换重新启动 Agent ${width}`, async ({ page, context, app }, info) => {
    const { project } = await seedWorkspace(context, app);
    const task = await apiData<{ id: string }>(context, 'post', '/tasks', {
      projectId: project.id,
      title: '恢复被阻塞的工作',
    });
    for (const status of ['READY', 'IN_PROGRESS', 'BLOCKED']) {
      await apiData(context, 'post', `/tasks/${task.id}/transition`, { status });
    }
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const requests: Array<{ path: string; body: unknown }> = [];
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && path.startsWith(`/api/v1/tasks/${task.id}/`))
        requests.push({ path, body: request.postDataJSON() });
    });
    await page.goto(`/projects/${project.id}/work?task=${task.id}`);
    await page.getByRole('combobox', { name: '运行 Agent' }).click();
    await page.getByRole('option', { name: 'v1 baseline agent', exact: true }).click();
    const start = page.getByRole('button', { name: '启动 Session', exact: true });
    await expect(start).toBeEnabled();
    await start.scrollIntoViewIfNeeded();
    await start.click();
    await expect(page).toHaveURL(/\/workspace\/[^/?]+$/);
    expect(requests.map((request) => request.path)).toEqual([
      `/api/v1/tasks/${task.id}/transition`,
      `/api/v1/tasks/${task.id}/start`,
    ]);
    expect(requests[0]?.body).toEqual({ status: 'READY' });
    const stored = await apiData<{ sessionId: string }>(context, 'get', `/tasks/${task.id}`);
    expect(page.url()).toContain(`/workspace/${stored.sessionId}`);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const screenshot = info.outputPath(`blocked-task-restarted-${width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await info.attach('阻塞任务已恢复工作区', { path: screenshot, contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
}
