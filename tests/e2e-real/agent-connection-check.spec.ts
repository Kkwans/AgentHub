import { resolve } from 'node:path';
import { test, expect, initializeGitProject } from './fixtures.js';
import { apiData } from './baseline-support.js';
test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
for (const theme of ['light', 'dark']) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`真实本机连接检查与响应丢失不重投 ${width} ${theme}`, async ({
      page,
      context,
      app,
    }, info) => {
      const errors: string[] = [];
      let injected = false;
      let checkUrl = '';
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        if (
          injected &&
          message.location().url === checkUrl &&
          message.text() === 'Failed to load resource: net::ERR_FAILED'
        )
          return;
        errors.push(`${message.location().url}: ${message.text()}`);
      });
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await initializeGitProject(app.projectRoot);
      const target = await apiData<{ id: string }>(context, 'post', '/execution-targets', {
        name: '连接检查本机',
        kind: 'LOCAL_HOST',
        hostname: '127.0.0.1',
        os: process.platform,
        arch: process.arch,
      });
      const project = await apiData<{ id: string }>(context, 'post', '/projects', {
        name: '连接检查已登记项目',
        targetId: target.id,
        rootPath: app.projectRoot,
        kind: 'TEST',
      });
      const agent = await apiData<{ id: string }>(context, 'post', '/agents', {
        name: '隔离fixture连接检查',
        targetId: target.id,
        agentKind: 'CUSTOM_ACP',
        executable: process.execPath,
        args: [resolve('tests/fixtures/acp/fake-agent.mjs')],
        defaultModel: 'initial-model',
      });
      checkUrl = `${app.origin}/api/v1/agents/${agent.id}/connection-check`;
      const posts: unknown[] = [];
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          request.url().includes(`/agents/${agent.id}/connection-check`)
        )
          posts.push(request.postDataJSON());
      });
      await page.goto(`/agents/${agent.id}`);
      await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
      const model = page.getByRole('textbox', { name: '默认模型' });
      await model.fill('unsaved-draft');
      const section = page.getByRole('region', { name: 'Agent 连接检查' });
      await section.getByRole('combobox', { name: '检查项目' }).click();
      await page.getByRole('option', { name: '连接检查已登记项目', exact: true }).click();
      const responsePromise = page.waitForResponse(
        (r) =>
          r.url().includes(`/agents/${agent.id}/connection-check`) &&
          r.request().method() === 'POST',
      );
      await section.getByRole('button', { name: '检查连接', exact: true }).click();
      const response = await responsePromise;
      expect(response.ok()).toBe(true);
      const report = (await response.json()).data;
      expect(report).toMatchObject({
        agentId: agent.id,
        targetId: target.id,
        projectId: project.id,
        cwd: app.projectRoot,
        smokeSession: false,
        status: 'READY',
      });
      expect(report.checks).toContainEqual({ id: 'session', status: 'SKIP' });
      expect(Object.keys(report).sort()).toEqual(
        [
          'agentId',
          'targetId',
          'projectId',
          'cwd',
          'smokeSession',
          'status',
          'checkedAt',
          'checks',
        ].sort(),
      );
      await expect(section.getByText('连接检查通过', { exact: true })).toBeVisible();
      await section.getByRole('button', { name: '读取已保存状态' }).click();
      await expect(model).toHaveValue('unsaved-draft');
      await expect(page.getByText('最近检查就绪', { exact: true })).toBeVisible();
      expect(posts).toEqual([{ projectId: project.id, expectedTargetId: target.id }]);
      await section.scrollIntoViewIfNeeded();
      expect(
        await section.evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
      await info.attach(`connection-check-ready-${theme}-${width}`, {
        body: await section.screenshot(),
        contentType: 'image/png',
      });
      await info.attach(`connection-check-page-${theme}-${width}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
      // The second request actually executes on the isolated server; only the
      // response is lost. Do not replace the report with a mocked success.
      await page.route(checkUrl, async (route) => {
        const result = await route.fetch({ maxRetries: 0 });
        expect(result.ok()).toBe(true);
        injected = true;
        await route.abort('failed');
      });
      await section.getByRole('button', { name: '准备新的检查' }).click();
      await section.getByRole('button', { name: '检查连接', exact: true }).click();
      await expect(section.getByText(/检查结果待核对/)).toBeVisible();
      await section.getByRole('button', { name: '读取已保存状态' }).click();
      await expect(section.getByRole('button', { name: '检查连接', exact: true })).toBeDisabled();
      await expect(section.getByRole('button', { name: '准备新的检查' })).toHaveCount(0);
      await expect(model).toHaveValue('unsaved-draft');
      expect(posts).toHaveLength(2);
      expect(
        await apiData<unknown[]>(context, 'get', `/sessions?projectId=${project.id}`),
      ).toHaveLength(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      expect(
        await section.evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
      await info.attach(`connection-check-unknown-${theme}-${width}`, {
        body: await section.screenshot(),
        contentType: 'image/png',
      });
    });
  }
}
