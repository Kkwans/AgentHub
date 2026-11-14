import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';
import { apiData } from './baseline-support.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(180_000);
test('Agent 能力来自真实 preflight，未知与 false 不虚构支持', async ({
  page,
  context,
  app,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const target = await apiData<{ id: string }>(context, 'post', '/execution-targets', {
    name: '能力验收宿主机',
    kind: 'LOCAL_HOST',
    hostname: '127.0.0.1',
    os: process.platform,
    arch: process.arch,
  });
  for (const state of ['known', 'unknown', 'false'] as const) {
    const agent = await apiData<{ id: string }>(context, 'post', '/agents', {
      name: `能力验收 ${state}${state === 'unknown' ? ' · 多项目协作与长名称可读性验收'.repeat(3) : ''}`,
      targetId: target.id,
      agentKind: 'CUSTOM_ACP',
      executable: process.execPath,
      args: [resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/acp/fake-agent.mjs')],
      config: { files: state !== 'false', terminal: false },
      ...(state === 'unknown'
        ? { defaultModel: 'fixture-model/long-model-label-for-directory-readability-only' }
        : {}),
    });
    if (state !== 'unknown') {
      const result = await apiData<{ status: string }>(
        context,
        'post',
        `/agents/${agent.id}/preflight`,
        { cwd: app.projectRoot },
      );
      expect(result.status).toBe('READY');
    }
  }
  const agents = await apiData<Array<{ name: string; capabilitiesJson: Record<string, unknown> }>>(
    context,
    'get',
    '/agents',
  );
  expect(
    agents.find((agent) => agent.name === '能力验收 false')?.capabilitiesJson.workspace,
  ).toMatchObject({ files: false, terminal: false });
  expect(
    agents.find((agent) => agent.name === '能力验收 known')?.capabilitiesJson.workspace,
  ).toMatchObject({ files: true, terminal: false });
  expect(
    agents.find((agent) => agent.name === '能力验收 known')?.capabilitiesJson.sessions,
  ).toMatchObject({ create: true });
  expect(
    agents.find((agent) => agent.name.startsWith('能力验收 unknown'))?.capabilitiesJson,
  ).toEqual({});
  await info.attach('real-capability-reports', {
    body: JSON.stringify(
      agents.map(({ name, capabilitiesJson }) => ({ name, capabilitiesJson })),
      null,
      2,
    ),
    contentType: 'application/json',
  });
  for (const theme of ['light', 'dark']) {
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto('/agents');
      await page.evaluate((theme) => localStorage.setItem('agenthub-theme', theme), theme);
      await page.reload();
      const known = page.getByRole('group', { name: /能力验收 known/ });
      const unknown = page.getByRole('group', { name: /能力验收 unknown/ });
      const denied = page.getByRole('group', { name: /能力验收 false/ });
      await expect(known.getByText('Session', { exact: true })).toHaveCount(1);
      await expect(known.getByText('文件', { exact: true })).toBeVisible();
      await expect(unknown.getByText('能力待确认')).toBeVisible();
      await expect(
        unknown.getByText('fixture-model/long-model-label-for-directory-readability-only'),
      ).toBeVisible();
      for (const card of [known, unknown, denied]) {
        await expect(card.getByText('Run', { exact: true })).toHaveCount(0);
        await expect(card.getByText('Sessions', { exact: true })).toHaveCount(0);
        await expect(card.getByText('Terminal', { exact: true })).toHaveCount(0);
        await expect(card).not.toHaveAttribute('tabindex');
        await expect(card.getByRole('link', { name: '服务器诊断' })).toHaveCount(0);
        await expect(card.getByRole('link', { name: '管理 Agent' })).toBeVisible();
      }
      await expect(denied.getByText('文件', { exact: true })).toHaveCount(0);
      await expect(unknown.getByText('Session', { exact: true })).toHaveCount(0);
      await known.getByRole('heading').click();
      await expect(page).toHaveURL(/\/agents$/);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const search = page.getByRole('searchbox', { name: '搜索 Agent' });
      await search.fill('没有匹配的隔离测试名称');
      await expect(page.getByRole('heading', { name: '没有匹配的 Agent' })).toBeVisible();
      await page.getByRole('button', { name: '清除筛选', exact: true }).click();
      await expect(known).toBeVisible();
      await search.fill('能力验收 known');
      await page.getByRole('combobox', { name: 'Agent 状态' }).click();
      await page.getByRole('option', { name: '登记就绪', exact: true }).click();
      await page.getByRole('button', { name: '刷新', exact: true }).click();
      await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeEnabled();
      await expect(search).toHaveValue('能力验收 known');
      await expect(page.getByRole('combobox', { name: 'Agent 状态' })).toContainText('登记就绪');
      await expect(known).toBeVisible();
      await search.fill('无匹配');
      await page.getByRole('button', { name: '清除筛选', exact: true }).click();
      await expect(unknown).toBeVisible();
      const firstRow = page.getByRole('group', { name: /能力验收/ }).first();
      const rowBox = (await firstRow.boundingBox())!;
      const discovery = page.getByRole('link', { name: '发现 Agent', exact: true });
      const discoveryBox = (await discovery.boundingBox())!;
      expect(discoveryBox.height).toBeGreaterThanOrEqual(43.99);
      if (width === 390) {
        expect(rowBox.y).toBeLessThan(380);
        const statusBox = (await page.getByRole('combobox', { name: 'Agent 状态' }).boundingBox())!;
        const refreshBox = (await page
          .getByRole('button', { name: '刷新', exact: true })
          .boundingBox())!;
        expect(
          Math.abs(statusBox.y + statusBox.height / 2 - refreshBox.y - refreshBox.height / 2),
        ).toBeLessThanOrEqual(1);
        expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(refreshBox.x);
        expect(statusBox.height).toBeGreaterThanOrEqual(43.99);
        expect(refreshBox.height).toBeGreaterThanOrEqual(43.99);

        expect(rowBox.y + rowBox.height).toBeLessThan(844);
        const titleBox = (await page
          .getByRole('heading', { name: 'Agent 中心', exact: true })
          .boundingBox())!;
        expect(
          Math.abs(titleBox.y + titleBox.height / 2 - (discoveryBox.y + discoveryBox.height / 2)),
        ).toBeLessThanOrEqual(4);
      }
      for (const link of await page.getByRole('link', { name: '管理 Agent', exact: true }).all())
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(43.99);
      await info.attach(`agent-directory-geometry-${theme}-${width}`, {
        body: JSON.stringify({ rowBox, discoveryBox }),
        contentType: 'application/json',
      });
      const path = info.outputPath(`agent-capability-${theme}-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      await info.attach(`agent-capability-${theme}-${width}`, { path, contentType: 'image/png' });
      const infrastructure = page.locator('summary').filter({ hasText: /^基础设施$/ });
      await expect(infrastructure).toHaveCount(1);
      await infrastructure.focus();
      await page.keyboard.press('Enter');
      await expect(
        page
          .getByRole('navigation', { name: '基础设施导航' })
          .getByRole('link', { name: '运行环境' }),
      ).toHaveAttribute('href', '/agents/runtime');
      await expect(
        page
          .getByRole('navigation', { name: '基础设施导航' })
          .getByRole('link', { name: '远程节点' }),
      ).toHaveAttribute('href', '/agents/nodes');
      const diagnostic = page
        .getByRole('navigation', { name: '基础设施导航' })
        .getByRole('link', { name: '服务器诊断' });
      await expect(diagnostic).toHaveAttribute('href', '/agents/diagnostics');
      await expect(diagnostic).toHaveAccessibleDescription(
        '当前 AgentHub 服务器，不是此 Agent 专属诊断',
      );
      await diagnostic.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/agents\/diagnostics$/);
      await expect(page.getByRole('heading', { name: '服务器诊断', level: 1 })).toBeVisible();
      await expect(
        page.getByText(
          '检查当前 AgentHub 服务器的进程与供应商环境，不代表某个 Agent 或远程执行环境的专属诊断。',
          { exact: true },
        ),
      ).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});
