import { apiData, seedWorkspace } from './baseline-support.js';
import { test, expect } from './fixtures.js';

test.use({ authMode: 'local_trusted' });
test.setTimeout(120_000);
test('项目概览与页头遵循登记资格而非全局就绪数', async ({ page, context, app }) => {
  const { project, agent } = await seedWorkspace(context, app);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const eligibility = await apiData<{
    basis: string;
    livePreflight: boolean;
    agents: Array<{ agentId: string; eligible: boolean }>;
  }>(context, 'get', `/projects/${project.id}/agent-eligibility`);
  expect(eligibility.basis).toBe('REGISTERED_STATE');
  expect(eligibility.livePreflight).toBe(false);
  expect(eligibility.agents.find((entry) => entry.agentId === agent.id)?.eligible).toBe(true);
  await page.goto(`/projects/${project.id}/overview`);
  await expect(page.getByText('1 个登记可用 Agent', { exact: true })).toBeVisible();
  await expect(
    page.getByText('登记状态下 1 个可用；运行前仍需预检', { exact: true }),
  ).toBeVisible();
  // Agent PATCH only edits defaults. Archive this isolated project through its
  // real API while keeping the global Agent READY, so project eligibility and
  // global readiness deliberately differ without inventing an enable endpoint.
  const archived = await apiData<{ status: string }>(
    context,
    'post',
    `/projects/${project.id}/archive`,
  );
  expect(archived.status).toBe('ARCHIVED');
  const agents = await apiData<Array<{ id: string; enabled: boolean; status: string }>>(
    context,
    'get',
    '/agents',
  );
  expect(agents.find((entry) => entry.id === agent.id)).toMatchObject({
    enabled: true,
    status: 'READY',
  });
  const inactive = await apiData<{
    agents: Array<{ agentId: string; eligible: boolean; reason: string | null }>;
  }>(context, 'get', `/projects/${project.id}/agent-eligibility`);
  expect(inactive.agents.find((entry) => entry.agentId === agent.id)).toMatchObject({
    eligible: false,
    reason: 'PROJECT_INACTIVE',
  });
  await page.reload();
  await expect(page.getByText('0 个登记可用 Agent', { exact: true })).toBeVisible();
  await expect(
    page.getByText('登记状态下 0 个可用；运行前仍需预检', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '全部会话 →' })).toHaveAttribute(
    'href',
    `/projects/${project.id}/sessions`,
  );
  await expect(page.getByRole('link', { name: '全部审阅 →' })).toHaveAttribute(
    'href',
    `/projects/${project.id}/work?status=WAITING_REVIEW`,
  );
  expect(errors).toEqual([]);
});
