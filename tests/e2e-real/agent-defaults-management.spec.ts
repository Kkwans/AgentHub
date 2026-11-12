import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { apiData } from './baseline-support.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
type Agent = { id: string; name: string; defaultModel: string | null; defaultMode: string | null };
async function seed(context: BrowserContext) {
  const target = await apiData<{ id: string }>(context, 'post', '/execution-targets', {
    name: '默认设置验收环境',
    kind: 'LOCAL_HOST',
    hostname: '127.0.0.1',
    os: process.platform,
    arch: process.arch,
  });
  const register = (name: string) =>
    apiData<Agent>(context, 'post', '/agents', {
      name,
      targetId: target.id,
      agentKind: 'CUSTOM_ACP',
      executable: process.execPath,
      args: ['--version'],
      defaultModel: 'initial-model',
      defaultMode: 'initial-mode',
    });
  const other = await register('不应被修改的 Agent');
  const selected = await register('明确选中的 Agent：默认配置管理与身份核对');
  return { other, selected };
}
async function capture(page: Page, info: TestInfo, name: string, region?: Locator) {
  // AppShell scrolls its main pane, not the document. fullPage alone cannot
  // reveal an off-screen editor or recovery panel inside that scroll container.
  if (region) {
    await region.scrollIntoViewIfNeeded();
    await expect(region).toBeVisible();
    await expect(region).toBeInViewport({ ratio: 1 });
    const geometry = await region.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        viewportWidth: innerWidth,
        overflow: node.scrollWidth - node.clientWidth,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    await info.attach(`${name}-geometry`, {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}
for (const theme of ['light', 'dark']) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`Agent 默认设置真实读写 ${width} ${theme}`, async ({ page, context, app }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      const { selected, other } = await seed(context);
      await context.addInitScript(
        ({ theme, origin }) => {
          if (location.origin === origin) localStorage.setItem('agenthub-theme', theme);
        },
        { theme, origin: app.origin },
      );
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto('/agents');
      const card = page.getByRole('group', { name: new RegExp(selected.name) });
      const manage = card.getByRole('link', { name: '管理 Agent', exact: true });
      await expect(manage).toHaveAttribute('href', `/agents/${selected.id}`);
      await manage.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${app.origin}/agents/${selected.id}`);
      await expect(page.getByRole('heading', { name: selected.name, exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: '默认模型' })).toHaveValue('initial-model');
      // Primary editing must be available in the initial viewport, not only
      // after capture() scrolls the settings card into view.
      const primaryInput = page.getByRole('textbox', { name: '默认模型' });
      await expect(primaryInput).toBeInViewport({ ratio: 1 });
      await info.attach(`agent-primary-input-${theme}-${width}`, {
        body: JSON.stringify(
          await primaryInput.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight };
          }),
        ),
        contentType: 'application/json',
      });
      await capture(page, info, `agent-defaults-${theme}-${width}-initial`);
      const settings = page.getByRole('heading', { name: '默认设置', exact: true }).locator('..');
      await capture(page, info, `agent-defaults-${theme}-${width}-editor`, settings);
      await expect(page.getByRole('textbox', { name: '默认模型' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('textbox', { name: '默认模式' })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('button', { name: '保存默认设置' })).toBeInViewport({ ratio: 1 });
      await page.getByRole('textbox', { name: '默认模型' }).fill('matrix-model');
      await page.getByRole('textbox', { name: '默认模式' }).fill('');
      await page.getByRole('button', { name: '保存默认设置' }).click();
      await expect(
        page.getByText('默认设置已保存。仅影响后续会话的默认选择。', { exact: true }),
      ).toBeVisible();
      const agents = await apiData<Agent[]>(context, 'get', '/agents');
      expect(agents.find((agent) => agent.id === selected.id)).toMatchObject({
        defaultModel: 'matrix-model',
        defaultMode: null,
      });
      expect(agents.find((agent) => agent.id === other.id)).toMatchObject({
        defaultModel: 'initial-model',
        defaultMode: 'initial-mode',
      });
      await page.reload();
      await expect(page.getByRole('textbox', { name: '默认模型' })).toHaveValue('matrix-model');
      await expect(page.getByRole('textbox', { name: '默认模式' })).toHaveValue('');
      await capture(page, info, `agent-defaults-${theme}-${width}-saved`, settings);
      const summary = page.locator('summary').filter({ hasText: '技术信息与能力报告' });
      const details = page.locator('details').filter({ has: summary });
      await expect(details).not.toHaveAttribute('open', '');
      await summary.scrollIntoViewIfNeeded();
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(details).toHaveAttribute('open', '');
      await expect(details).toContainText(selected.id);
      await expect(
        details.getByRole('link', { name: '服务器诊断（不是此 Agent 专属诊断）' }),
      ).toHaveAttribute('href', '/agents/diagnostics');
      await capture(page, info, `agent-defaults-${theme}-${width}-technical`, details);
      await summary.focus();
      await page.keyboard.press('Space');
      await expect(details).not.toHaveAttribute('open', '');
      await expect(page.getByRole('textbox', { name: '默认模型' })).toHaveValue('matrix-model');

      expect(await apiData<unknown[]>(context, 'get', '/sessions')).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test('Agent 保存响应丢失后只读核对，不自动重放 PATCH', async ({ page, context, app }, info) => {
  const { selected } = await seed(context);
  const url = `${app.origin}/api/v1/agents/${selected.id}`;
  let injected = false;
  let patches = 0;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (
      injected &&
      message.location().url === url &&
      message.text() === 'Failed to load resource: net::ERR_FAILED'
    )
      return;
    errors.push(`${message.location().url}: ${message.text()}`);
  });
  await context.route(url, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    patches += 1;
    if (injected) return route.continue();
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.status()).toBe(200);
    expect((await response.json()).data).toMatchObject({
      id: selected.id,
      defaultModel: 'committed-model',
    });
    injected = true;
    await route.abort('failed');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/agents/${selected.id}`);
  await page.getByRole('textbox', { name: '默认模型' }).fill('committed-model');
  await page.getByRole('button', { name: '保存默认设置' }).click();
  await expect(page.getByRole('heading', { name: '保存结果待核对' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存默认设置' })).toBeDisabled();
  const recovery = page.getByRole('region', { name: '核对默认设置', exact: true });
  await capture(page, info, 'agent-defaults-unknown', recovery);
  await page.getByRole('button', { name: '读取服务器当前值' }).click();
  await expect(page.getByText('当前值与本次提交一致。', { exact: true })).toBeVisible();
  expect(patches).toBe(1);
  await capture(page, info, 'agent-defaults-readback', recovery);
  await page.getByRole('button', { name: '采用服务器值继续编辑' }).click();
  await expect(page.getByRole('textbox', { name: '默认模型' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '保存默认设置' })).toBeDisabled();
  expect(patches).toBe(1);
  expect(errors).toEqual([]);
});
