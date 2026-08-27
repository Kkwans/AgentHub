import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'AgentHub',
  description: '智能 Agent 管理与协作平台',
  targetId: '22222222-2222-4222-8222-222222222222',
  rootPath: '/volume2/Project/AgentHub',
  realRootPath: '/volume2/Project/AgentHub',
  repoKind: 'GIT',
  status: 'ACTIVE',
};

const agent = {
  id: '33333333-3333-4333-8333-333333333333',
  targetId: project.targetId,
  name: 'Codex',
  agentKind: 'CODEX',
  adapterKind: 'ACP_STDIO',
  status: 'READY',
  enabled: true,
  detectedVersion: '1.1.14',
  defaultModel: null,
  defaultMode: null,
  capabilitiesJson: {},
  lastPreflightAt: '2026-08-28T01:00:00.000Z',
};

const task = {
  id: '44444444-4444-4444-8444-444444444444',
  projectId: project.id,
  goalId: null,
  parentId: null,
  title: 'Agent Discovery 交互优化',
  description: '收敛发现流程并完成响应式校正',
  acceptanceCriteria: '四视口无横向溢出\n键盘可以完成审阅',
  status: 'WAITING_REVIEW',
  priority: 1,
  assignedAgentId: agent.id,
  sessionId: '55555555-5555-4555-8555-555555555555',
  finalRunId: '66666666-6666-4666-8666-666666666666',
  branch: 'feature/agent-discovery',
  position: '0',
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T01:30:00.000Z',
  completedAt: null,
};

const session = {
  id: task.sessionId,
  projectId: project.id,
  agentId: agent.id,
  taskId: task.id,
  title: 'Agent Discovery 交互优化',
  cwd: project.rootPath,
  branch: task.branch,
  status: 'WAITING_REVIEW',
  model: 'gpt-5.6',
  mode: 'default',
  lastActiveAt: '2026-08-28T01:30:00.000Z',
};

const worktree = {
  id: '77777777-7777-4777-8777-777777777777',
  taskId: task.id,
  projectId: project.id,
  agentId: agent.id,
  status: 'REVIEW',
  baseBranch: 'main',
  baseSha: 'a'.repeat(40),
  taskBranch: task.branch,
  worktreePath: '/volume2/Project/.agenthub/worktrees/77777777',
  sessionId: session.id,
  runId: task.finalRunId,
  mergeCommitSha: null,
  configJson: {},
  errorCode: null,
  errorMessage: null,
  queuedAt: task.createdAt,
  startedAt: task.createdAt,
  reviewReadyAt: task.updatedAt,
  mergeStartedAt: null,
  completedAt: null,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', fulfillFixture);
});

test('v0.8 全局 IA、单一 Sidebar 折叠入口与主题可恢复', async ({ page }) => {
  await page.goto('/projects');
  const viewportWidth = page.viewportSize()?.width ?? 1_000;
  if (viewportWidth < 768) {
    await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible();
    await page.getByRole('button', { name: '打开导航' }).click();
  }
  const navigations = page.getByRole('navigation', { name: '主导航' });
  const navigation = viewportWidth < 768 ? navigations.last() : navigations.first();
  await expect(navigation.getByRole('link')).toHaveText([
    '首页',
    '项目',
    'Agent 中心',
    'Prompt 库',
    '设置',
  ]);
  await expect(navigation.getByRole('link', { name: 'Workspace' })).toHaveCount(0);
  if (viewportWidth >= 900) {
    await expect(page.getByRole('button', { name: '折叠侧边栏' })).toHaveCount(1);
    await page.getByRole('button', { name: '深色主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', 'dark');
  }
  await expectNoHorizontalOverflow(page);
});

test('Projects 使用 v0.8 高密度实体列表并打开路由弹层', async ({ page }, testInfo) => {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: '项目' })).toBeVisible();
  const list = page.getByRole('region', { name: '项目列表' });
  if ((page.viewportSize()?.width ?? 1_000) >= 768) {
    await expect(list.getByText('分支')).toBeVisible();
    await expect(list.getByText('工作')).toBeVisible();
    await expect(list.getByText('最近活动', { exact: true }).first()).toBeVisible();
    await expect(list.getByText('feature/agent-discovery')).toBeVisible();
  }
  if ((page.viewportSize()?.width ?? 1_000) >= 1_024)
    await expect(list.getByText('Agent', { exact: true })).toBeVisible();
  await expect(list.getByRole('link', { name: /AgentHub/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page
    .getByRole('link', { name: /新建项目/ })
    .first()
    .click();
  await expect(page).toHaveURL('/projects/new');
  await expect(page.getByRole('dialog', { name: '创建项目' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: '创建项目' })).toBeHidden();
  await attachViewportScreenshot(page, testInfo, 'projects');
});

test('Project Context 仅保留 Overview、Work、Sessions', async ({ page }, testInfo) => {
  await page.goto(`/projects/${project.id}/overview`);
  const context = page.getByRole('navigation', { name: '项目上下文' });
  await expect(context.getByRole('link')).toHaveText(['概览', '工作', '会话']);
  await expect(context.getByRole('link', { name: 'Prompt' })).toHaveCount(0);
  await expect(context.getByRole('link', { name: '设置' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
  await expect(page.getByRole('link', { name: /feature\/agent-discovery/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'project-overview');
});

test('Work 保持 List-first、可恢复审阅筛选且中屏不横向溢出', async ({ page }, testInfo) => {
  await page.goto(`/projects/${project.id}/work?status=WAITING_REVIEW`);
  await expect(page.getByRole('link', { name: '工作', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('button', { name: '列表' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: '工作状态' })).toHaveValue('待审阅');
  await expect(page.getByRole('region', { name: '工作列表' })).toContainText(task.title);
  await expect(page.getByRole('complementary', { name: '工作 Inspector' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'project-work');
});

test('Sessions 按时间组织并可恢复 Workspace', async ({ page }, testInfo) => {
  await page.goto(`/projects/${project.id}/sessions`);
  await expect(page.getByRole('link', { name: '会话', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const sessionLink = page.getByRole('link', { name: /Agent Discovery 交互优化/ });
  await expect(sessionLink).toContainText('Codex');
  await expect(sessionLink).toHaveAttribute('href', `/workspace/${session.id}`);
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'project-sessions');
});

test('核心 v0.8 页面没有 serious 或 critical axe 问题', async ({ page }, testInfo) => {
  test.slow();
  const routes = [
    '/projects',
    `/projects/${project.id}/overview`,
    `/projects/${project.id}/work`,
    `/projects/${project.id}/sessions`,
  ];
  const violations: Array<Record<string, unknown>> = [];

  for (const path of routes) {
    await page.goto(path);
    await page.locator('#main-content').waitFor();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    violations.push(
      ...result.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map((violation) => ({
          path,
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

async function fulfillFixture(route: Route) {
  const url = new URL(route.request().url());
  const path = url.pathname;
  let data: unknown = [];

  if (path.endsWith('/auth/status')) {
    data = {
      mode: 'local_trusted',
      localTrusted: true,
      setupRequired: false,
      authenticated: true,
      user: null,
    };
  } else if (path.endsWith(`/projects/${project.id}/preflight`)) {
    data = {
      status: 'READY',
      git: { detected: true, branch: 'main', dirty: false },
      permissions: { readable: true, writable: true },
      checks: [],
    };
  } else if (path.endsWith(`/projects/${project.id}`)) data = project;
  else if (path.endsWith('/projects')) data = [project];
  else if (path.endsWith('/tasks')) data = [task];
  else if (path.endsWith('/sessions')) data = [session];
  else if (path.endsWith('/agents')) data = [agent];
  else if (path.endsWith('/goals')) data = [];
  else if (path.endsWith('/worktree-executions')) data = [worktree];
  else if (path.endsWith('/prompts')) data = [];
  else if (path.endsWith('/execution-targets')) data = [];
  else if (path.endsWith('/dashboard')) {
    data = {
      runningSessions: [],
      attentionTasks: [task],
      pendingApprovals: [],
      recentResults: [],
      agentHealth: [agent],
    };
  }

  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data, requestId: 'v08-playwright' }),
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function attachViewportScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForTimeout(250);
  await testInfo.attach(`${name}-${testInfo.project.name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
}
