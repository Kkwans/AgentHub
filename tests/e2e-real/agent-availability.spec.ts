import { test, expect } from './fixtures.js';
import { apiData, seedWorkspace } from './baseline-support.js';
import type { Locator, Page, TestInfo } from '@playwright/test';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
type Agent = {
  id: string;
  enabled: boolean;
  enabledRevision: number;
  status: string;
  lastPreflightAt: string | null;
  capabilitiesJson: unknown;
  defaultModel: string | null;
};
async function capture(page: Page, section: Locator, info: TestInfo, name: string) {
  await section.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  expect(await section.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(
    1,
  );
  for (const button of await section.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    // Existing shared PinButton is 34px on desktop and has a 44px mobile hit target.
    expect(box!.height).toBeGreaterThanOrEqual(
      (page.viewportSize()?.width ?? 0) < 768 ? 43.99 : 33.99,
    );
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
  }
  await info.attach(name, { body: await section.screenshot(), contentType: 'image/png' });
  await page.screenshot({ path: info.outputPath(`${name}-page.png`), fullPage: true });
}
for (const theme of ['light', 'dark']) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`真实服务 Agent 启停、草稿与丢失响应恢复 ${width} ${theme}`, async ({
      page,
      context,
      app,
    }, info) => {
      // Isolated PGlite + controlled ACP fixture, not a real provider/account.
      const seed = await seedWorkspace(context, app);
      const read = async () =>
        (await apiData<Agent[]>(context, 'get', '/agents')).find(
          (agent) => agent.id === seed.agent.id,
        )!;
      const original = await read();
      expect(original).toMatchObject({ enabled: true, enabledRevision: 0, status: 'READY' });
      const errors: string[] = [];
      const mutations: Array<{ method: string; url: string; body: unknown }> = [];
      const availabilityUrl = `${app.origin}/api/v1/agents/${seed.agent.id}/availability`;
      let lossInjected = false;
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        if (
          lossInjected &&
          message.location().url === availabilityUrl &&
          message.text() === 'Failed to load resource: net::ERR_FAILED'
        )
          return;
        errors.push(`${message.location().url}: ${message.text()}`);
      });
      page.on('request', (request) => {
        if (['POST', 'PATCH', 'DELETE'].includes(request.method()))
          mutations.push({
            method: request.method(),
            url: request.url(),
            body: request.postDataJSON(),
          });
      });
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(`/agents/${seed.agent.id}`);
      await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', theme);
      const section = page.getByRole('region', { name: 'Agent 启停设置' });
      const model = page.getByRole('textbox', { name: '默认模型' });
      await model.fill('unsaved-availability-draft');
      const disableResponse = page.waitForResponse(
        (response) => response.url() === availabilityUrl && response.request().method() === 'PATCH',
      );
      await section.getByRole('button', { name: '禁用新工作', exact: true }).click();
      const disabled = await disableResponse;
      expect(disabled.status()).toBe(200);
      expect((await disabled.json()).data).toMatchObject({
        enabled: false,
        enabledRevision: 1,
        status: original.status,
      });
      await expect(section.getByText('本次启停设置已保存。', { exact: true })).toBeVisible();
      await expect(model).toHaveValue('unsaved-availability-draft');
      expect(await read()).toMatchObject({
        enabled: false,
        enabledRevision: 1,
        status: original.status,
        capabilitiesJson: original.capabilitiesJson,
        lastPreflightAt: original.lastPreflightAt,
        defaultModel: original.defaultModel,
      });
      const deniedCreate = await context.request.post('/api/v1/sessions', {
        data: {
          projectId: seed.project.id,
          agentId: seed.agent.id,
          title: 'disabled must not create',
          cwd: app.projectRoot,
        },
      });
      expect(deniedCreate.status()).toBe(409);
      expect((await deniedCreate.json()).error.code).toBe('AGENT_NOT_READY');
      const deniedTurn = await context.request.post(`/api/v1/sessions/${seed.session.id}/runs`, {
        data: { text: 'disabled must not send' },
      });
      expect(deniedTurn.status()).toBe(409);
      expect((await deniedTurn.json()).error.code).toBe('AGENT_DISABLED');
      expect(
        await apiData<unknown[]>(context, 'get', `/sessions?projectId=${seed.project.id}`),
      ).toHaveLength(1);
      expect(
        await apiData<unknown[]>(context, 'get', `/sessions/${seed.session.id}/runs`),
      ).toHaveLength(0);
      await capture(page, section, info, `agent-availability-disabled-${theme}-${width}`);
      const enabledResponse = page.waitForResponse(
        (response) => response.url() === availabilityUrl && response.request().method() === 'PATCH',
      );
      const enable = section.getByRole('button', { name: '启用新工作', exact: true });
      await enable.focus();
      await page.keyboard.press('Enter');
      expect((await enabledResponse).status()).toBe(200);
      const details = section.locator('details');
      const detailsSummary = section.getByText('版本与原操作详情', { exact: true });
      await expect(details).not.toHaveAttribute('open', '');
      await detailsSummary.click();
      await expect(section.getByText(/当前设置：已启用 · 版本 2/)).toBeVisible();
      await detailsSummary.click();
      await expect(details).not.toHaveAttribute('open', '');
      await expect(model).toHaveValue('unsaved-availability-draft');
      expect(await read()).toMatchObject({
        enabled: true,
        enabledRevision: 2,
        status: original.status,
        lastPreflightAt: original.lastPreflightAt,
      });
      expect(
        mutations.map((request) => ({
          method: request.method,
          url: request.url,
          body: request.body,
        })),
      ).toEqual([
        { method: 'PATCH', url: availabilityUrl, body: { enabled: false, expectedRevision: 0 } },
        { method: 'PATCH', url: availabilityUrl, body: { enabled: true, expectedRevision: 1 } },
      ]);
      await capture(page, section, info, `agent-availability-current-${theme}-${width}`);
      // The PATCH really commits on the isolated server. Drop only its response.
      await page.route(availabilityUrl, async (route) => {
        const response = await route.fetch({ maxRetries: 0 });
        expect(response.status()).toBe(200);
        expect((await response.json()).data).toMatchObject({ enabled: false, enabledRevision: 3 });
        lossInjected = true;
        await route.abort('failed');
      });
      await section.getByRole('button', { name: '禁用新工作', exact: true }).click();
      await expect(
        section.getByText('启停结果未知，请只读核对；不会自动重试。', { exact: true }),
      ).toBeVisible();
      await expect(model).toHaveValue('unsaved-availability-draft');
      expect(mutations).toHaveLength(3);
      expect(await read()).toMatchObject({ enabled: false, enabledRevision: 3 });
      await expect(section.getByText('待核对', { exact: true })).toBeVisible();
      await expect(details).not.toHaveAttribute('open', '');
      await expect(
        section.getByText(
          '当前状态不是原请求的成功证明。只有核对到更高版本，才能明确发起新操作。',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(section.getByRole('button', { name: '禁用新工作', exact: true })).toBeDisabled();
      await capture(page, section, info, `agent-availability-unknown-${theme}-${width}`);
      await page.unroute(availabilityUrl);
      await page.reload();
      await expect(details).not.toHaveAttribute('open', '');
      await expect(section.getByText('待核对', { exact: true })).toBeVisible();
      await detailsSummary.click();
      await expect(section.getByText(/原操作：版本 2/)).toBeVisible();
      await detailsSummary.click();
      await expect(section.getByText(/原操作：版本 2/)).toBeHidden();
      expect(mutations).toHaveLength(3);
      await section.getByRole('button', { name: '核对启停状态', exact: true }).click();
      await expect(
        section.getByText('已读取当前状态；这不证明原请求成功，未重新提交。', { exact: true }),
      ).toBeVisible();
      await expect(
        section.getByRole('button', { name: '基于当前版本启用（新操作）', exact: true }),
      ).toBeEnabled();
      await expect(section.getByRole('button', { name: '启用新工作', exact: true })).toBeDisabled();
      expect(mutations).toHaveLength(3); // GET/reload never replays the mutation.
      expect(
        await apiData<unknown[]>(context, 'get', `/sessions/${seed.session.id}/runs`),
      ).toHaveLength(0);
      expect(
        await apiData<unknown[]>(context, 'get', `/sessions?projectId=${seed.project.id}`),
      ).toHaveLength(1);
      expect(await read()).toMatchObject({
        status: original.status,
        lastPreflightAt: original.lastPreflightAt,
      });
      await capture(page, section, info, `agent-availability-reconciled-${theme}-${width}`);
      expect(errors).toEqual([]);
    });
  }
}
