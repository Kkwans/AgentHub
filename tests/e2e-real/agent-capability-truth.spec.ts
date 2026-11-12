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
      name: `能力验收 ${state}`,
      targetId: target.id,
      agentKind: 'CUSTOM_ACP',
      executable: process.execPath,
      args: [resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/acp/fake-agent.mjs')],
      config: { files: state !== 'false', terminal: false },
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
  expect(agents.find((agent) => agent.name === '能力验收 unknown')?.capabilitiesJson).toEqual({});
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
      for (const card of [known, unknown, denied]) {
        await expect(card.getByText('Run', { exact: true })).toHaveCount(0);
        await expect(card.getByText('Sessions', { exact: true })).toHaveCount(0);
        await expect(card.getByText('Terminal', { exact: true })).toHaveCount(0);
        await expect(card).not.toHaveAttribute('tabindex');
        await expect(card.getByRole('link', { name: '服务器诊断' })).toHaveAttribute(
          'href',
          '/agents/diagnostics',
        );
      }
      await expect(denied.getByText('文件', { exact: true })).toHaveCount(0);
      await expect(unknown.getByText('Session', { exact: true })).toHaveCount(0);
      await known.getByRole('heading').click();
      await expect(page).toHaveURL(/\/agents$/);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const path = info.outputPath(`agent-capability-${theme}-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      await info.attach(`agent-capability-${theme}-${width}`, { path, contentType: 'image/png' });
      const diagnostic = known.getByRole('link', { name: '服务器诊断' });
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
