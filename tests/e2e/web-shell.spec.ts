import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'AgentHub',
  description: '本地 Agent 控制平面',
  targetId: '22222222-2222-4222-8222-222222222222',
  rootPath: '/volume2/Project/AgentHub',
  realRootPath: '/volume2/Project/AgentHub',
  repoKind: 'GIT',
  status: 'ACTIVE',
};
const agent = {
  id: '33333333-3333-4333-8333-333333333333',
  targetId: project.targetId,
  name: 'Codex 主力',
  agentKind: 'CODEX',
  adapterKind: 'ACP_STDIO',
  status: 'READY',
  detectedVersion: '1.1.14',
  defaultModel: null,
  defaultMode: null,
  capabilitiesJson: {},
  lastPreflightAt: '2026-08-09T00:00:00.000Z',
};
const task = {
  id: '44444444-4444-4444-8444-444444444444',
  projectId: project.id,
  goalId: null,
  parentId: null,
  title: '审阅 AgentHub v0.1',
  description: '核验真实工程闭环',
  acceptanceCriteria: '用户确认后完成',
  status: 'WAITING_REVIEW',
  priority: 10,
  assignedAgentId: agent.id,
  sessionId: '55555555-5555-4555-8555-555555555555',
  finalRunId: '66666666-6666-4666-8666-666666666666',
  branch: 'agenthub/task-44444444-77777777',
  position: '0',
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
  completedAt: null,
};
const worktreeExecution = {
  id: '77777777-7777-4777-8777-777777777777',
  taskId: task.id,
  projectId: project.id,
  agentId: agent.id,
  status: 'REVIEW',
  baseBranch: 'main',
  baseSha: 'a'.repeat(40),
  taskBranch: task.branch,
  worktreePath: '/volume2/Project/.agenthub/worktrees/77777777',
  sessionId: task.sessionId,
  runId: task.finalRunId,
  mergeCommitSha: null,
  configJson: {},
  errorCode: null,
  errorMessage: null,
  queuedAt: '2026-08-09T00:00:00.000Z',
  startedAt: '2026-08-09T00:00:01.000Z',
  reviewReadyAt: '2026-08-09T00:01:00.000Z',
  mergeStartedAt: null,
  completedAt: null,
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:01:00.000Z',
};
const remoteNode = {
  id: '88888888-8888-4888-8888-888888888888',
  targetId: '99999999-9999-4999-8999-999999999999',
  name: 'TX5Pro Remote Node',
  hostname: 'tx5pro',
  os: 'linux',
  arch: 'arm64',
  fingerprint: 'c'.repeat(64),
  protocolVersion: 'agenthub-node-v1',
  daemonVersion: '0.2.0',
  allowedRootsJson: ['/srv/projects/AgentHub'],
  inventoryJson: [
    {
      key: 'codex',
      name: 'Codex',
      agentKind: 'CODEX',
      adapterKind: 'ACP_STDIO',
      status: 'AVAILABLE',
      capabilities: {
        sessions: true,
        streaming: true,
        approvals: true,
        files: true,
        terminal: true,
      },
    },
  ],
  status: 'ONLINE',
  lastSeenAt: '2026-08-10T01:00:00.000Z',
  revokedAt: null,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T01:00:00.000Z',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/dashboard')
      ? {
          runningSessions: [],
          attentionTasks: [task],
          pendingApprovals: [],
          recentResults: [
            {
              id: task.finalRunId,
              sessionId: task.sessionId,
              status: 'COMPLETED',
              startedAt: '2026-08-09T00:00:00.000Z',
              finishedAt: '2026-08-09T00:01:00.000Z',
              gitBeforeSha: 'before',
              gitAfterSha: 'after',
              errorCode: null,
              gitOutcome: 'CHANGED',
            },
          ],
          agentHealth: [agent],
        }
      : path.endsWith('/projects')
        ? [project]
        : path.endsWith(`/worktree-executions/${worktreeExecution.id}/review`)
          ? {
              worktreePath: worktreeExecution.worktreePath,
              baseSha: worktreeExecution.baseSha,
              headSha: 'b'.repeat(40),
              taskBranch: worktreeExecution.taskBranch,
              clean: false,
              aheadBy: 1,
              entries: [{ index: ' ', worktree: 'M', path: 'apps/web/src/App.tsx' }],
              patch: 'diff --git a/apps/web/src/App.tsx b/apps/web/src/App.tsx\n+Worktree Review',
              diffStat: '1 file changed',
              truncated: false,
            }
          : path.endsWith('/worktree-executions')
            ? [worktreeExecution]
            : path.endsWith('/tasks')
              ? [task]
              : path.endsWith('/goals')
                ? []
                : path.endsWith('/agents')
                  ? [agent]
                  : path.endsWith('/auth/status')
                    ? {
                        mode: 'local_trusted',
                        localTrusted: true,
                        setupRequired: false,
                        authenticated: true,
                        user: null,
                      }
                    : path.endsWith('/remote-nodes')
                      ? [remoteNode]
                      : path.endsWith('/settings/capabilities')
                        ? {
                            terminal: {
                              available: false,
                              code: 'PTY_NATIVE_BINDING_UNAVAILABLE',
                              message: '当前平台未提供可用的 node-pty native binding',
                              platform: 'linux',
                              arch: 'arm64',
                            },
                            remoteNode: { available: true, transport: 'outbound_websocket' },
                          }
                        : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, requestId: 'playwright-e2e' }),
    });
  });
});

test('概览展示待审阅、Agent 健康和 Git outcome', async ({ page }) => {
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: '今天需要处理什么' })).toBeVisible();
  await expect(page.getByText('等待用户审阅')).toBeVisible();
  await expect(page.getByText('Git 有变更')).toBeVisible();
  await expect(page.locator('.health-row').getByText('Codex 主力')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('任务看板明确保留人工审阅门禁', async ({ page }) => {
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Goal 与 Task' })).toBeVisible();
  await expect(page.locator('[aria-label="Task 看板"]')).toBeVisible();
  await page.getByRole('button', { name: /审阅并合并/ }).click();
  await expect(page.getByRole('dialog', { name: task.title })).toBeVisible();
  await expect(page.getByText('审阅证据')).toBeVisible();
  await expect(page.getByText(/Worktree Review/)).toBeVisible();
  await expect(page.getByRole('button', { name: /批准并合并/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /继续修改/ })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
});

test('设置页呈现认证与 Docker 高权限边界', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '设置与诊断' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本机管理员' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '外部集成' })).toBeVisible();
  await expect(page.getByText(/网页登录不需要 API token/)).toBeVisible();
  await expect(page.getByText('不会修改 Compose、镜像或 volume')).toBeVisible();
  await expect(page.getByText('loopback 默认模式')).toBeVisible();
});

test('Remote Node 管理在当前 viewport 无水平溢出', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Remote Node' })).toBeVisible();
  await expect(page.getByText('TX5Pro Remote Node')).toBeVisible();
  await expect(page.getByText('/srv/projects/AgentHub')).toBeVisible();
  await expect(page.getByText('Codex')).toBeVisible();
  await page.getByRole('button', { name: '生成一次性注册码' }).click();
  await expect(page.getByRole('textbox', { name: '授权目录' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('关键视图可由 URL 恢复并支持键盘返回主流程', async ({ page }) => {
  test.slow();
  await page.goto(`/tasks?projectId=${project.id}&execution=${worktreeExecution.id}`);
  const reviewDialog = page.getByRole('dialog', { name: task.title });
  await expect(reviewDialog).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('审阅证据')).toBeVisible();

  if ((page.viewportSize()?.width ?? 1_000) <= 620) {
    const targetSizes = await page
      .locator('.worktree-review-header button:visible, .worktree-review-actions button:visible')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
      );
    expect(targetSizes.length).toBeGreaterThan(0);
    for (const size of targetSizes) {
      expect(size.width).toBeGreaterThanOrEqual(44);
      expect(size.height).toBeGreaterThanOrEqual(44);
    }
  }

  await page.getByRole('button', { name: '关闭执行详情' }).click();
  await expect(page).not.toHaveURL(/execution=/);
  await expect(reviewDialog).toBeHidden();

  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: '搜索与跳转' })).toBeVisible();
  const search = page.getByRole('combobox', { name: '搜索页面' });
  await expect(search).toBeFocused();
  await search.fill('PromptOS');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/promptos$/);
  await expect(page.getByRole('heading', { name: 'PromptOS', level: 2 })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('核心控制面没有 serious 或 critical axe 问题', async ({ page }, testInfo) => {
  test.slow();
  const routes = ['/overview', '/tasks', '/settings'];
  const violations: Array<Record<string, unknown>> = [];

  for (const route of routes) {
    await page.goto(route);
    await page.locator('#main-content').waitFor();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    violations.push(
      ...result.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map((violation) => ({
          route,
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            summary: node.failureSummary,
          })),
        })),
    );
  }

  if (violations.length) {
    await testInfo.attach('axe-serious-critical.json', {
      body: Buffer.from(JSON.stringify(violations, null, 2)),
      contentType: 'application/json',
    });
  }
  expect(violations).toEqual([]);
});

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}
