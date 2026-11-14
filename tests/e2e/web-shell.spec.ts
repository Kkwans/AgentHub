import { assertFullscreenScroll } from '../e2e-support/fullscreen-dialog.js';
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

const sessionHistory = [
  session,
  {
    ...session,
    id: '55555555-5555-4555-8555-555555555551',
    taskId: '44444444-4444-4444-8444-444444444441',
    title: 'Workspace 三栏视觉校准',
    branch: 'main',
    status: 'READY',
    lastActiveAt: '2026-08-28T00:40:00.000Z',
  },
  {
    ...session,
    id: '55555555-5555-4555-8555-555555555552',
    taskId: '44444444-4444-4444-8444-444444444442',
    title: 'PromptOS 绑定审阅',
    branch: 'feature/prompt-bindings',
    status: 'CLOSED',
    lastActiveAt: '2026-08-27T09:20:00.000Z',
  },
  {
    ...session,
    id: '55555555-5555-4555-8555-555555555553',
    taskId: '44444444-4444-4444-8444-444444444443',
    title: 'Real Codex 恢复门禁',
    branch: 'main',
    status: 'COMPLETED',
    lastActiveAt: '2026-08-26T16:10:00.000Z',
  },
];

const conversationMessages = [
  {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
    runId: task.finalRunId,
    role: 'USER',
    kind: 'TEXT',
    text: '请审阅 Agent Discovery 页面，收敛信息层级并完成四档视口校正。',
    sequence: 1,
    createdAt: '2026-08-28T01:10:00.000Z',
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd02',
    runId: task.finalRunId,
    role: 'ASSISTANT',
    kind: 'TEXT',
    text: '已完成第一轮布局审计。问题集中在主舞台宽度、面板层级与 Composer 控件密度。\n\n我把 Workspace 重构为 Session Rail、Conversation 和 Review Inspector 三个稳定区域。右侧检查器默认收起，展开后仍是可调整宽度的真实第三列；中栏不再被底部 Terminal 和全宽 Composer 切碎。\n\n视觉层改为中性灰阶与单一光学尺寸：正文保持舒适行长，工具活动降级为辅助信息，运行配置收进 Composer 底栏。',
    sequence: 2,
    createdAt: '2026-08-28T01:20:00.000Z',
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd03',
    runId: task.finalRunId,
    role: 'USER',
    kind: 'TEXT',
    text: '右侧文件区要默认折叠，但展开后必须保持第三列，不要做成弹窗。',
    sequence: 3,
    createdAt: '2026-08-28T01:24:00.000Z',
  },
  {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd04',
    runId: task.finalRunId,
    role: 'ASSISTANT',
    kind: 'TEXT',
    text: '**关键校正已完成：**\n\n- 桌面首次进入保持右栏收起，点击“变更”后展开独立第三列。\n- 左右面板支持拖拽和折叠，并记住最后一次布局。\n- 1024 以下使用临时覆盖层；移动端复用同一组检查器视图。',
    sequence: 4,
    createdAt: '2026-08-28T01:28:00.000Z',
  },
];

const conversationEvents = [
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee00',
    sessionId: session.id,
    runId: task.finalRunId,
    seq: 1,
    type: 'agent.thought.delta',
    payloadJson: {
      messageId: 'thought-workspace-audit',
      text: '先对照 Codex 的主舞台宽度与左右面板比例，',
    },
    createdAt: '2026-08-28T01:10:28.000Z',
  },
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10',
    sessionId: session.id,
    runId: task.finalRunId,
    seq: 2,
    type: 'agent.thought.delta',
    payloadJson: {
      messageId: 'thought-workspace-audit',
      text: '再检查字体层级、工具流水和 Composer 的信息密度。',
    },
    createdAt: '2026-08-28T01:11:00.000Z',
  },
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
    sessionId: session.id,
    runId: task.finalRunId,
    seq: 3,
    type: 'tool.call.completed',
    payloadJson: { tool: 'read_file', path: 'apps/web/src/features/workspace/WorkspacePage.tsx' },
    createdAt: '2026-08-28T01:12:00.000Z',
  },
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02',
    sessionId: session.id,
    runId: task.finalRunId,
    seq: 4,
    type: 'tool.call.completed',
    payloadJson: { tool: 'search', query: 'workspace panel composer inspector' },
    createdAt: '2026-08-28T01:14:00.000Z',
  },
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03',
    sessionId: session.id,
    runId: task.finalRunId,
    seq: 5,
    type: 'tool.call.completed',
    payloadJson: { tool: 'apply_patch', path: 'workspace.module.css' },
    createdAt: '2026-08-28T01:17:00.000Z',
  },
  {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04',
    sessionId: session.id,
    runId: task.finalRunId,
    seq: 6,
    type: 'tool.call.completed',
    payloadJson: { tool: 'run_tests', command: 'playwright test --project=desktop-1440' },
    createdAt: '2026-08-28T01:19:00.000Z',
  },
];

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

const prompt = {
  id: '88888888-8888-4888-8888-888888888888',
  projectId: project.id,
  key: 'review/safe-change',
  name: '安全变更审阅',
  description: '基于仓库规范审阅当前变更',
  kind: 'REVIEW',
  type: 'TEXT',
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-28T01:00:00.000Z',
};

const promptVersion = {
  id: '99999999-9999-4999-8999-999999999999',
  promptId: prompt.id,
  version: 8,
  contentJson: { text: '你是一名资深代码审阅者。\n\n请优先识别安全、数据一致性和回归风险。' },
  variablesJson: { project: { type: 'string' }, task: { type: 'string' } },
  configJson: {},
  changelog: '收敛审阅输出格式',
  source: 'MANUAL',
  contentHash: 'a'.repeat(64),
  createdBy: 'admin',
  createdAt: '2026-08-28T01:00:00.000Z',
};

const priorPromptVersion = {
  ...promptVersion,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  version: 7,
  contentJson: { text: '你是一名代码审阅者。\n\n请识别安全和回归风险。' },
  changelog: '建立审阅基线',
  contentHash: 'b'.repeat(64),
  createdAt: '2026-08-27T01:00:00.000Z',
};

const promptLabel = {
  promptId: prompt.id,
  label: 'production',
  versionId: promptVersion.id,
  version: 8,
  updatedAt: promptVersion.createdAt,
};

const promptBinding = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  targetType: 'PROJECT',
  targetId: project.id,
  slot: 'SYSTEM',
  promptId: prompt.id,
  selectorType: 'LABEL',
  label: 'production',
  versionId: null,
  priority: 0,
  enabled: true,
};

const agentCandidate = {
  candidateId: 'codex-local',
  agentKind: 'CODEX',
  displayName: 'Codex Local',
  targetCandidateId: 'local-host',
  targetId: project.targetId,
  state: 'READY',
  adapterKind: 'ACP_STDIO',
  detectedVersion: '1.1.14',
  registeredAgentId: agent.id,
  adoptable: false,
};

const runtimeCandidate = {
  candidateId: 'runtime-local',
  kind: 'LOCAL_HOST',
  displayName: 'Local Host',
  state: 'READY',
  targetId: project.targetId,
  statusText: 'arm64 · Ready',
  workspaceMappings: [],
  adoptable: false,
};

const remoteNode = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  targetId: project.targetId,
  name: 'NAS-01',
  hostname: 'DH4300Plus',
  os: 'linux',
  arch: 'arm64',
  fingerprint: 'sha256:test',
  protocolVersion: '1',
  daemonVersion: 'fixture-1.0',
  allowedRootsJson: ['/volume2/Project'],
  inventoryJson: [],
  status: 'ONLINE',
  lastSeenAt: '2026-08-28T01:30:00.000Z',
  revokedAt: null,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-28T01:30:00.000Z',
};

const SHELL_READY_TIMEOUT = 30_000;

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', fulfillFixture);
  await page.addInitScript(() => {
    class FixtureWebSocket extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      readonly readyState = FixtureWebSocket.CLOSED;
      readonly url: string;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
      }

      send(): void {}

      close(): void {}
    }

    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: FixtureWebSocket,
    });
  });
});

test('全局 IA、单一 Sidebar 折叠入口与主题可恢复', async ({ page }) => {
  await page.goto('/projects');
  const viewportWidth = page.viewportSize()?.width ?? 1_000;
  if (viewportWidth < 768) {
    await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible();
    await page.getByRole('button', { name: '打开导航' }).click();
  }
  const navigations = page.getByRole('navigation', { name: '主导航' });
  const navigation = viewportWidth < 768 ? navigations.last() : navigations.first();
  const destinations = [
    ['首页', '/home'],
    ['项目', '/projects'],
    ['Agent 中心', '/agents'],
    ['Prompt 库', '/prompts'],
    ['设置', '/settings/appearance'],
  ] as const;
  const links = navigation.getByRole('link');
  await expect(links).toHaveCount(destinations.length);
  for (const [index, [name, href]] of destinations.entries()) {
    await expect(links.nth(index)).toHaveAccessibleName(name);
    await expect(links.nth(index)).toHaveAttribute('href', href);
  }
  // Compact desktop keeps icon links accessible; mobile drawer and wide
  // desktop retain visible labels. Do not confuse absent text with absent IA.
  await expect(links).toHaveText(
    viewportWidth >= 768 && viewportWidth < 1320
      ? destinations.map(() => '')
      : destinations.map(([name]) => name),
  );
  await expect(navigation.getByRole('link', { name: 'Workspace' })).toHaveCount(0);
  if (viewportWidth >= 768) {
    if (viewportWidth < 1320) {
      await expect(page.getByRole('button', { name: '展开侧边栏' })).toBeDisabled();
    } else {
      const collapse = page.getByRole('button', { name: '折叠侧边栏' });
      await expect(collapse).toHaveCount(1);
      await collapse.click();
      await expect(links).toHaveText(destinations.map(() => ''));
      await page.getByRole('button', { name: '展开侧边栏' }).click();
      await expect(links).toHaveText(destinations.map(([name]) => name));
    }
    await page.getByRole('button', { name: '深色主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', 'dark');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', 'dark');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  }
  await expectNoHorizontalOverflow(page);
});

test('Home 深色主题同步 PinHarness 画布与文字层级', async ({ page }, testInfo) => {
  const viewportWidth = page.viewportSize()?.width ?? 1_000;
  await page.goto(viewportWidth < 768 ? '/settings/appearance' : '/home');
  if (viewportWidth < 768) {
    const themeSelect = page.getByRole('combobox', { name: '主题' });
    await themeSelect.click();
    await page.getByRole('option', { name: '深色' }).click();
    await page.goto('/home');
  } else {
    await page.getByRole('button', { name: '深色主题' }).click();
  }
  await expect(page.getByRole('heading', { name: '继续工作' })).toBeVisible();
  const homeCanvas = await page.locator('.page-content').boundingBox();
  expect(homeCanvas).not.toBeNull();
  expect(homeCanvas!.width).toBeLessThanOrEqual(961);

  await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', 'dark');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  const bodyBackground = await page
    .locator('body')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(bodyBackground).not.toBe('rgb(255, 255, 255)');
  await expect(page.getByRole('heading', { name: '继续工作' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'home-dark');
});

test('Home 以工作续接为主舞台', async ({ page }, testInfo) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: '继续工作' })).toBeVisible();
  await expect(page.getByRole('link', { name: '新建工作', exact: true })).toHaveAttribute(
    'href',
    `/projects/${project.id}/work/new`,
  );
  const recentWork = page.getByRole('region', { name: '继续最近工作' });
  await expect(recentWork).toBeVisible();
  const recentLinks = recentWork.getByRole('link');
  await expect(recentLinks).toHaveCount(sessionHistory.length);
  for (const [index, recentSession] of sessionHistory.entries()) {
    await expect(recentLinks.nth(index)).toContainText(recentSession.title);
    await expect(recentLinks.nth(index)).toHaveAttribute('href', `/workspace/${recentSession.id}`);
  }
  const attention = page.getByRole('region', { name: '需要你处理 1' });
  await expect(attention).toBeVisible();
  const reviewLink = attention.getByRole('link');
  await expect(reviewLink).toHaveCount(1);
  await expect(attention).toContainText(task.title);
  await expect(attention).toContainText(task.description);
  await expect(reviewLink).toHaveAccessibleName(`审阅：${task.title}`);
  await expect(reviewLink).toContainText('审阅');
  await expect(reviewLink).toHaveAttribute('href', `/workspace/${task.sessionId}`);
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'home');
});

test('Agent 辅助信息失败保持未知并可恢复，不隐藏已登记身份', async ({ page }, testInfo) => {
  let failing = true;
  for (const endpoint of ['execution-targets', 'discovery/agents']) {
    await page.route(`**/api/v1/${endpoint}`, async (route) => {
      if (!failing) return route.fallback();
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '辅助数据暂时不可用' } }),
      });
    });
  }
  await page.goto('/agents');
  const row = page.getByRole('group', { name: 'Codex，Codex，登记就绪' });
  await expect(row).toBeVisible({ timeout: SHELL_READY_TIMEOUT });
  const targets = page.getByRole('region', { name: '运行环境读取状态' });
  const candidates = page.getByRole('region', { name: '发现结果读取状态' });
  await expect(targets).toBeVisible();
  await expect(candidates).toBeVisible();
  await expect(page.getByText('未知', { exact: true })).toBeVisible();
  await expect(row).toContainText('运行环境读取失败');
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'agent-center-source-error');
  failing = false;
  await targets.getByRole('button', { name: '重新加载' }).click();
  await candidates.getByRole('button', { name: '重新加载' }).click();
  await expect(targets).toBeHidden();
  await expect(candidates).toBeHidden();
  await expect(page.getByText('未知', { exact: true })).toBeHidden();
  await expect(row).toContainText('未找到关联运行环境');
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'agent-center-source-recovered');
});

test('Agent Center 收敛 Discovery、Runtime 与 Remote Nodes', async ({ page }, testInfo) => {
  await page.goto('/agents');
  await expect(page.getByRole('heading', { name: 'Agent 中心' })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await expect(page.getByText('Codex', { exact: true }).first()).toBeVisible();
  const agentRow = page.getByRole('group', { name: 'Codex，Codex，登记就绪' });
  await expect(agentRow.getByRole('link', { name: '管理 Agent' })).toHaveAttribute(
    'href',
    `/agents/${agent.id}`,
  );
  await expect(agentRow).toContainText('能力待确认');
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'agent-center');
  if ((page.viewportSize()?.width ?? 1_000) >= 641) {
    await expect(page.getByRole('link', { name: '运行环境' })).toHaveAttribute(
      'href',
      '/agents/runtime',
    );
  }

  await page.getByRole('link', { name: '发现 Agent' }).click();
  await expect(page).toHaveURL('/agents/agents/discover');
  await expect(page.getByRole('dialog', { name: '发现 Agent' })).toContainText('Codex Local');
  if (page.viewportSize()?.width === 390) {
    const originalViewport = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 600 });
    const geometry = await assertFullscreenScroll(
      page,
      page.getByRole('dialog', { name: '发现 Agent' }),
    );
    await testInfo.attach('agent-discovery-fullscreen-short-geometry', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    await attachViewportScreenshot(page, testInfo, 'agent-discovery-fullscreen-short');
    await page.setViewportSize(originalViewport);
  }
  await page.goBack();
  await expect(page.getByRole('dialog', { name: '发现 Agent' })).toBeHidden();

  await page.goto('/agents/runtime');
  await expect(page.getByRole('heading', { name: 'Runtime' })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await expect(page.getByText('Local Host', { exact: true })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'agent-runtime');
  await page.goto('/agents/nodes');
  await expect(page.getByRole('heading', { name: 'Remote Nodes' })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await expect(page.getByText('NAS-01')).toBeVisible({ timeout: SHELL_READY_TIMEOUT });
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'agent-nodes');
});

test('Workspace 保持 Conversation 主舞台并恢复面板状态', async ({ page }, testInfo) => {
  // Workspace screenshots include the editor/font payload; keep the visual
  // matrix deterministic on the NAS without weakening the assertions.
  test.setTimeout(120_000);
  // CI's empty tool detail yields only 101px overflow at 1440px. Supply
  // realistic history output for this test rather than relaxing the 120px gate.
  const historyOutput = Array.from(
    { length: 30 },
    (_, index) => `历史测试输出第 ${index + 1} 行：Workspace 面板与滚动行为验收通过。`,
  ).join('\n');
  await page.route(`**/api/v1/sessions/${session.id}/events*`, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: conversationEvents.map((event) =>
          event.id === 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04'
            ? { ...event, payloadJson: { ...event.payloadJson, rawOutput: historyOutput } }
            : event,
        ),
        requestId: 'workspace-history-fixture',
      }),
    });
  });
  await page.goto(`/workspace/${session.id}`, { waitUntil: 'domcontentloaded' });
  // The Workspace waits for a dozen independent session resources before
  // replacing its bootstrap shell; allow the local fixture server that time
  // without weakening the interaction assertions that follow.
  await expect(page.getByText(session.title, { exact: true }).first()).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await expect(page.getByRole('textbox', { name: '给 Agent 发送工程指令' })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
  // Live PinHarness turns deliberately render ordered independent tool rows.
  const toolRows = page.locator('.tool-event-row');
  const toolEvents = conversationEvents.filter((event) => event.type === 'tool.call.completed');
  await expect(toolRows).toHaveCount(4);
  for (const [index, event] of toolEvents.entries()) {
    await expect(toolRows.nth(index)).toHaveAttribute('data-event-id', event.id);
    await expect(toolRows.nth(index).getByRole('button', { name: /工具调用完成/ })).toBeVisible();
  }
  await expect(page.locator('.tool-summary')).toHaveCount(0);
  await expect(page.locator('.message.assistant').last().locator('strong')).toHaveText(
    '关键校正已完成：',
  );
  const clippedTurns = await page.locator('.conversation-scroll').evaluate((scroll) => {
    const boundary = scroll.getBoundingClientRect();
    return [...scroll.querySelectorAll('.conversation-turn')].filter((turn) => {
      const bounds = turn.getBoundingClientRect();
      return bounds.left < boundary.left - 1 || bounds.right > boundary.right + 1;
    }).length;
  });
  expect(clippedTurns).toBe(0);
  const contextDisclosure = page.locator('.workspace-context-disclosure');
  const mobileMore = page.getByRole('button', { name: '更多会话操作', exact: true });
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await expect(contextDisclosure.locator('summary')).toBeHidden();
    await mobileMore.focus();
    await page.keyboard.press('Enter');
    await expect(mobileMore).toHaveAttribute('aria-expanded', 'true');
  }
  await contextDisclosure.locator('summary').click();
  await expect(contextDisclosure.locator('code')).toBeVisible();
  await expect(contextDisclosure.locator('code')).toHaveText(project.rootPath);
  if ((page.viewportSize()?.width ?? 0) >= 1180) {
    const popup = await contextDisclosure.locator('.ah-workbench-disclosure-content').boundingBox();
    const pane = await page.locator('.conversation-panel').boundingBox();
    expect(popup).not.toBeNull();
    expect(pane).not.toBeNull();
    expect(popup!.x).toBeGreaterThanOrEqual(pane!.x);
    expect(popup!.x + popup!.width).toBeLessThanOrEqual(pane!.x + pane!.width + 1);
  }
  await contextDisclosure.locator('summary').click();
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.keyboard.press('Escape');
    await expect(mobileMore).toHaveAttribute('aria-expanded', 'false');
    await expect(mobileMore).toBeFocused();
  }
  const thought = page.locator('.thinking-event-row');
  await expect(thought).toHaveCount(1);
  await expect(thought).not.toHaveAttribute('open', '');
  await expect(thought.getByText('Agent 思考内容', { exact: true })).toBeVisible();
  await expect(thought.getByText('思考了 32 秒', { exact: true })).toHaveCount(0);
  const thoughtSummary = thought.locator('summary');
  await expect(
    thoughtSummary.locator('button, a, input, select, textarea, [tabindex]'),
  ).toHaveCount(0);
  await expect(thoughtSummary).toHaveAttribute('aria-expanded', 'false');
  await thoughtSummary.focus();
  await page.keyboard.press('Enter');
  await expect(thought).toHaveAttribute('open', '');
  await expect(thoughtSummary).toHaveAttribute('aria-expanded', 'true');
  await expect(thoughtSummary).toHaveAttribute('aria-label', /收起思考内容/);
  await expect(thought.getByText(/先对照 Codex 的主舞台宽度/)).toBeVisible();
  await page.keyboard.press('Space');
  await expect(thought).not.toHaveAttribute('open', '');
  await expect(thoughtSummary).toBeFocused();
  await expect(thoughtSummary).toHaveAttribute('aria-label', /展开思考内容/);
  const firstTool = page.locator('.tool-event-row').first();
  const firstToolTrigger = firstTool.getByRole('button', { name: /工具调用完成/ });
  await expect(firstToolTrigger).toHaveAttribute('aria-expanded', 'false');
  await firstToolTrigger.click();
  await expect(firstToolTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(firstTool.locator('.tool-entry-detail-body')).toBeVisible();
  await expect(firstTool.getByText('Agent 未返回可展开内容。')).toBeVisible();
  await firstToolTrigger.click();
  await expect(firstToolTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(firstTool.locator('.tool-entry-detail-body')).toBeHidden();
  const userMessageBox = await page.locator('.message.user').last().boundingBox();
  const assistantMessageBox = await page.locator('.message.assistant').last().boundingBox();
  expect(userMessageBox, '用户消息应可见').not.toBeNull();
  expect(assistantMessageBox, 'Agent 消息应可见').not.toBeNull();
  expect(userMessageBox!.x).toBeGreaterThan(assistantMessageBox!.x + 32);
  // Inspecting an older tool can legitimately scroll the conversation away
  // from its tail (Playwright also scrolls controls into view before clicking).
  // Keep its detail open so every viewport has a real scrollable history, then
  // test the user action and resulting position rather than assuming follow.
  await firstToolTrigger.click();
  await expect(firstToolTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(firstTool.locator('.tool-entry-detail-body')).toBeVisible();
  const historyTool = toolRows.last();
  const historyTrigger = historyTool.getByRole('button', { name: /工具调用完成/ });
  await expect(historyTrigger).toHaveAttribute('aria-expanded', 'false');
  await historyTrigger.click();
  await expect(historyTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(historyTool.locator('.tool-entry-detail-body')).toContainText(
    '历史测试输出第 30 行',
  );
  const conversationLog = page.getByRole('log');
  await expect
    .poll(
      () => conversationLog.evaluate((element) => element.scrollHeight - element.clientHeight),
      { message: '展开工具后应有足够历史验证滚动恢复' },
    )
    .toBeGreaterThan(120);
  // Target log padding, not the nested output scroller.
  await conversationLog.hover({ position: { x: 2, y: 2 } });
  await page.mouse.wheel(0, -10_000);
  await expect
    .poll(() => conversationLog.evaluate((element) => element.scrollTop), {
      message: '用户向上滚动后应停留在历史记录顶部',
    })
    .toBeLessThanOrEqual(2);
  await expect
    .poll(() =>
      conversationLog.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeGreaterThan(120);
  const jumpLatest = page.getByRole('button', { name: '回到最新' });
  await expect(jumpLatest).toBeVisible();
  await jumpLatest.click();
  await expect
    .poll(
      () =>
        conversationLog.evaluate((element) =>
          Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
        ),
      { message: '回到最新必须实际滚到底部，不能只隐藏按钮' },
    )
    .toBeLessThanOrEqual(2);
  await expect(jumpLatest).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  const geometry = await page
    .locator('.workspace-panels, .workspace-panel, .resize-handle')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const element = node as HTMLElement;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          className: element.className,
          display: style.display,
          flex: style.flex,
          minWidth: style.minWidth,
          maxWidth: style.maxWidth,
          position: style.position,
          inlineStyle: element.getAttribute('style'),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
        };
      }),
    );
  await testInfo.attach(`workspace-geometry-${testInfo.project.name}.json`, {
    body: Buffer.from(JSON.stringify(geometry, null, 2)),
    contentType: 'application/json',
  });
  const viewportWidth = page.viewportSize()?.width ?? 0;
  const conversationGeometry = geometry.find(({ className }) =>
    className.includes('conversation-panel'),
  );
  const panels = page.locator('.workspace-panels');
  const conversationPanel = page.locator('.conversation-panel');
  const captureRailActivity = async () => {
    const rail = page.locator('.session-rail');
    const link = rail.locator(`a[href="/workspace/${session.id}"]`);
    const time = link.locator('time');
    await expect(time).toBeVisible();
    await expect(time).toHaveAttribute('datetime', new Date(session.lastActiveAt).toISOString());
    await expect(time).toHaveAttribute('title', /最近活动：.*2026/);
    await expect(time).not.toHaveText('');
    await expect(link.locator('strong')).toHaveAttribute('title', session.title);
    const meta = link.locator('.session-entry-meta');
    const branchBox = (await meta.locator('code').boundingBox())!;
    const timeBox = (await time.boundingBox())!;
    const rowBox = (await link.boundingBox())!;
    expect(branchBox.x + branchBox.width).toBeLessThanOrEqual(timeBox.x + 1);
    expect(timeBox.x + timeBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
    await expect
      .poll(() => rail.evaluate((node) => node.scrollWidth - node.clientWidth))
      .toBeLessThanOrEqual(1);
    await attachViewportScreenshot(page, testInfo, 'workspace-session-activity');
  };
  const assertMediumOpenGeometry = async () => {
    const [host, side, conversation] = await Promise.all([
      panels.boundingBox(),
      page.locator('.three-column-split--medium aside').boundingBox(),
      conversationPanel.boundingBox(),
    ]);
    expect(host).not.toBeNull();
    expect(side).not.toBeNull();
    expect(conversation).not.toBeNull();
    // Workspace opts into a readable modal auxiliary panel on medium widths.
    // Keep the underlying conversation full-width instead of compressing code
    // into the old 240px side column. This changes the layout contract, not
    // merely the threshold of the old inline-column assertion.
    expect(side!.width).toBeGreaterThanOrEqual(360);
    expect(side!.width).toBeLessThanOrEqual(420);
    expect(side!.x).toBeGreaterThanOrEqual(host!.x - 1);
    expect(side!.x + side!.width).toBeLessThanOrEqual(host!.x + host!.width + 1);
    expect(Math.abs(conversation!.x - host!.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(conversation!.width - host!.width)).toBeLessThanOrEqual(2);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = dialog.getByRole('button', { name: /关闭会话列表|关闭检查器/ });
    const closeBox = await close.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(closeBox!.x).toBeGreaterThanOrEqual(side!.x);
    expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(side!.x + side!.width + 1);
    expect(closeBox!.width).toBeGreaterThanOrEqual(44);
    expect(closeBox!.height).toBeGreaterThanOrEqual(44);
    await expect
      .poll(() => conversationPanel.evaluate((node) => Boolean(node.closest('[inert]'))))
      .toBe(true);
    return { host, side, conversation };
  };
  if (viewportWidth >= 768 && viewportWidth < 1_180) {
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '打开辅助栏' }).click();
    const mediumGeometry = await assertMediumOpenGeometry();
    await captureRailActivity();
    await testInfo.attach(`workspace-medium-open-${testInfo.project.name}.json`, {
      body: Buffer.from(JSON.stringify(mediumGeometry, null, 2)),
      contentType: 'application/json',
    });
  } else if (viewportWidth < 768) {
    expect(conversationGeometry?.left).toBeLessThanOrEqual(4);
    expect(conversationGeometry?.width).toBeGreaterThanOrEqual(viewportWidth - 8);
  }
  if (viewportWidth < 768) {
    await expect(page.locator('.composer-select-reasoning')).toBeHidden();
    await expect(page.locator('.composer-permission')).toBeHidden();
  }
  const assertWorkspaceTabRelations = async () => {
    const invalid = await page.getByRole('tab').evaluateAll((tabs) =>
      tabs
        .filter((tab) => {
          if (!tab.getClientRects().length) return false;
          const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
          return (
            !panel ||
            panel.getAttribute('role') !== 'tabpanel' ||
            (tab.getAttribute('aria-selected') === 'true' &&
              panel.getAttribute('aria-labelledby') !== tab.id)
          );
        })
        .map((tab) => ({ id: tab.id, controls: tab.getAttribute('aria-controls') })),
    );
    expect(invalid, 'visible Workspace tabs must control real, correctly labelled panels').toEqual(
      [],
    );
  };
  const assertSelectedDiffNames = async () => {
    const editorInputs = page.locator('.git-diff-editor [role="textbox"]');
    await expect(editorInputs).toHaveCount(2);
    await expect
      .poll(() =>
        editorInputs.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('aria-label') ?? ''),
        ),
      )
      .toEqual(
        expect.arrayContaining([
          expect.stringContaining('更改前：apps/web/src/features/workspace/workspace.module.css'),
          expect.stringContaining('更改后：apps/web/src/features/workspace/workspace.module.css'),
        ]),
      );
  };
  const captureReviewHierarchy = async () => {
    await page
      .getByRole('tablist', { name: '检查器视图' })
      .getByRole('tab', { name: '变更', exact: true })
      .click();
    const metadata = page.locator('.git-metadata');
    await expect(metadata).not.toHaveAttribute('open', '');
    await expect(page.locator('.git-summary strong')).toHaveText('feature/agent-discovery');
    await expect(page.getByText('有未提交变更', { exact: true })).toBeVisible();
    await metadata.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(metadata).toHaveAttribute('open', '');
    await expect(metadata.getByText('abcdef1234567890', { exact: true })).toBeVisible();
    await expect(
      metadata.getByText('origin/feature/agent-discovery', { exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Space');
    await expect(metadata).not.toHaveAttribute('open', '');
    await page
      .getByRole('button', {
        name: '查看 apps/web/src/features/workspace/workspace.module.css Diff',
        exact: true,
      })
      .click();
    await expect(page.getByRole('button', { name: '切换为分栏 Diff' })).toBeVisible();
    // Unified Monaco keeps a hidden gutter with class monaco-editor before
    // the actual modified editor. Assert visible source, not DOM order.
    const modifiedLines = page.locator(
      '.git-diff-editor .editor.modified .view-lines[role="presentation"]',
    );
    await expect(modifiedLines).toBeVisible();
    await expect(modifiedLines).toContainText(/display:\s*grid/);
    await assertSelectedDiffNames();
    const diffHeader = await page.locator('.git-selected-diff-heading').boundingBox();
    const diffOptions = page
      .locator('.git-selected-diff')
      .getByRole('group', { name: '文件 Diff 显示选项' });
    await expect(diffOptions).toHaveCount(1);
    const diffControls = await diffOptions.boundingBox();
    const diffEditor = await page.locator('.git-selected-diff > .git-diff-editor').boundingBox();
    if (viewportWidth >= 1180) {
      expect(diffHeader!.height).toBeLessThanOrEqual(64);
      expect(diffControls!.height).toBeLessThanOrEqual(56);
      expect(diffEditor!.height).toBeGreaterThanOrEqual(260);
    }

    const summary = await page.locator('.git-summary').boundingBox();
    const viewbar = await page.locator('.git-viewbar').boundingBox();
    const source = await modifiedLines.boundingBox();
    expect(source?.height).toBeGreaterThan(0);
    await testInfo.attach(`review-hierarchy-${testInfo.project.name}`, {
      body: JSON.stringify({
        viewportWidth,
        summary,
        viewbar,
        diffHeader,
        diffControls,
        diffEditor,
        source,
      }),
      contentType: 'application/json',
    });
    await expectNoHorizontalOverflow(page);
    await attachViewportScreenshot(page, testInfo, 'workspace-review-diff');
  };
  await assertWorkspaceTabRelations();
  await attachViewportScreenshot(page, testInfo, 'workspace-initial');

  if (viewportWidth >= 1_180) {
    await expect(page.getByRole('button', { name: '隐藏检查器' })).toBeVisible();
    const inspector = page.getByRole('tablist', { name: '检查器视图' });
    await expect(inspector.getByRole('tab', { name: '变更' })).toBeVisible();
    await expect(inspector.getByRole('tab', { name: '文件' })).toBeVisible();
    await expect(inspector.getByRole('tab', { name: '活动' })).toBeVisible();
    await expect(inspector.getByRole('tab', { name: 'Run' })).toBeVisible();
    await captureRailActivity();
    await attachViewportScreenshot(page, testInfo, 'workspace-three-column');
    await expect(page.getByRole('button', { name: '按目录显示变更' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await captureReviewHierarchy();
    await page.getByRole('button', { name: '展开文件清单' }).click();
    await page.getByRole('button', { name: '按目录显示变更' }).click();
    await expect(page.getByRole('button', { name: '按目录显示变更' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: '按目录显示变更' }).click();
    await inspector.getByRole('tab', { name: '文件' }).click();
    const appsDirectory = page.getByRole('button', { name: 'apps', exact: true });
    await expect(appsDirectory).toHaveAttribute('aria-expanded', 'true');
    await appsDirectory.click();
    await expect(appsDirectory).toHaveAttribute('aria-expanded', 'false');
    await appsDirectory.click();
    await page.getByRole('button', { name: 'workspace.module.css', exact: true }).click();
    await expect(page.locator('.file-preview-header')).toContainText('workspace.module.css');
    await attachViewportScreenshot(page, testInfo, 'workspace-files');
    const beforeCollapse = await conversationPanel.boundingBox();
    expect(beforeCollapse).not.toBeNull();
    await page.getByRole('button', { name: '隐藏会话列表' }).click();
    await expect(page.locator('.session-rail-panel')).toBeHidden();
    await expect
      .poll(async () => (await conversationPanel.boundingBox())?.width ?? 0)
      .toBeGreaterThan(beforeCollapse!.width);
    await page.reload();
    await expect(page.getByRole('button', { name: '显示会话列表' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('.session-rail-panel')).toBeHidden();
    await expect
      .poll(async () => (await conversationPanel.boundingBox())?.width ?? 0)
      .toBeGreaterThan(beforeCollapse!.width);
    await page.getByRole('button', { name: '显示会话列表' }).click();
    await expect(page.locator('.session-rail-panel')).toBeVisible();
    await expect(page.getByRole('button', { name: '隐藏检查器' })).toBeVisible();
    await expect
      .poll(async () => (await conversationPanel.boundingBox())?.width ?? Infinity)
      .toBeLessThanOrEqual(beforeCollapse!.width + 2);
  } else if (viewportWidth >= 768) {
    // The background toolbar is inert while the modal is open. Close from
    // inside the actual auxiliary dialog, not through a background control.
    await page.getByRole('dialog').getByRole('button', { name: '关闭会话列表' }).click();
    await expect(page.getByRole('button', { name: '打开辅助栏' })).toBeVisible();
    await expect
      .poll(
        async () => {
          const host = await panels.boundingBox();
          const conversation = await conversationPanel.boundingBox();
          return host && conversation
            ? Math.max(Math.abs(conversation.x - host.x), Math.abs(conversation.width - host.width))
            : Infinity;
        },
        { message: '关闭辅助栏后对话应占满实际工作区容器' },
      )
      .toBeLessThanOrEqual(2);
    await expect(page.locator('.workspace-mobile-tabs')).toBeHidden();
    await page.getByRole('button', { name: '打开辅助栏' }).click();
    await expect(page.getByRole('button', { name: '关闭会话列表' })).toBeVisible();
    await assertMediumOpenGeometry();
    const auxiliary = page.getByRole('tablist', { name: '辅助栏视图' });
    await auxiliary.getByRole('tab', { name: '检查器' }).click();
    await expect(page.getByRole('button', { name: '关闭检查器' })).toBeVisible();
    await assertMediumOpenGeometry();
    await captureReviewHierarchy();
    const drawerAudit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const drawerViolations = drawerAudit.violations.filter((entry) =>
      ['serious', 'critical'].includes(entry.impact ?? ''),
    );
    await testInfo.attach(`workspace-medium-drawer-axe-${testInfo.project.name}`, {
      body: JSON.stringify(drawerViolations),
      contentType: 'application/json',
    });
    expect(drawerViolations).toEqual([]);
    if (viewportWidth === 1024) {
      const originalViewport = page.viewportSize()!;
      const staged = page.getByRole('checkbox', { name: 'staged', exact: true });
      await staged.check();
      await page.setViewportSize({ ...originalViewport, width: 1179 });
      await assertMediumOpenGeometry();
      await expect(staged).toBeChecked();
      await assertSelectedDiffNames();
      await attachViewportScreenshot(page, testInfo, 'workspace-review-medium-1179');
      await page.setViewportSize({ ...originalViewport, width: 1180 });
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect
        .poll(() => conversationPanel.evaluate((node) => Boolean(node.closest('[inert]'))))
        .toBe(false);
      await expect(staged).toBeChecked();
      await assertSelectedDiffNames();
      await page.setViewportSize(originalViewport);
      await assertMediumOpenGeometry();
      await expect(staged).toBeChecked();
      await assertSelectedDiffNames();
      await staged.uncheck();
    }
    await page
      .getByRole('tablist', { name: '检查器视图' })
      .getByRole('tab', { name: '文件' })
      .click();
    await expect(page).toHaveURL(new RegExp(`workspace/${session.id}\\?view=files`));
    const drawer = page.getByRole('dialog');
    const drawerClose = drawer.getByRole('button', { name: '关闭检查器' });
    await drawerClose.focus();
    await page.keyboard.press('Shift+Tab');
    await expect
      .poll(() => drawer.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
    // Walk through the auxiliary tabs, native disclosures and file controls,
    // including wrapping at the end, rather than proving only one adjacent Tab.
    for (let step = 0; step < 24; step += 1) {
      await page.keyboard.press('Tab');
      await expect
        .poll(() => drawer.evaluate((node) => node.contains(document.activeElement)))
        .toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole('button', { name: '打开辅助栏' })).toBeFocused();
    await expect
      .poll(() => conversationPanel.evaluate((node) => Boolean(node.closest('[inert]'))))
      .toBe(false);
    await page.getByRole('button', { name: '打开辅助栏' }).click();
    await expect(page.getByRole('dialog', { name: '工作区辅助栏' })).toBeVisible();
    // The scrim spans the host behind the right-hand dialog; on768 its center
    // is covered. Click the genuinely exposed left strip, never force-click.
    const scrim = page.getByRole('button', { name: '关闭辅助栏遮罩' });
    const scrimBox = await scrim.boundingBox();
    expect(scrimBox).not.toBeNull();
    await scrim.click({ position: { x: 8, y: scrimBox!.height / 2 } });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '打开辅助栏' })).toBeFocused();
    await page.getByRole('button', { name: '打开辅助栏' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // Leave the known Files view active for the remainder of the journey.
    await page
      .getByRole('tablist', { name: '辅助栏视图' })
      .getByRole('tab', { name: '检查器' })
      .click();
    await page
      .getByRole('tablist', { name: '检查器视图' })
      .getByRole('tab', { name: '文件' })
      .click();
  } else {
    const views = page.getByRole('tablist', { name: 'Workspace 视图' });
    await expect(views.getByRole('tab', { name: '会话' })).toBeVisible();
    await expect(page.locator('.workspace-support-toggle')).toBeHidden();
    await views.getByRole('tab', { name: '会话' }).click();
    await expect(page.getByRole('button', { name: '关闭会话列表' })).toBeVisible();
    await captureRailActivity();
    await page.getByRole('button', { name: '关闭会话列表' }).click();
    await expect(views.getByRole('tab', { name: '对话', exact: true })).toBeVisible();
    await expect(views.getByRole('tab', { name: '对话', exact: true })).toBeFocused();
    await views.getByRole('tab', { name: '文件' }).click();
    await expect(page).toHaveURL(new RegExp(`workspace/${session.id}\\?view=files`));
    await expect(views).toBeHidden();
    const inspectorViews = page.getByRole('tablist', { name: '检查器视图' });
    await expect(inspectorViews).toBeVisible();
    await captureReviewHierarchy();
    await inspectorViews.getByRole('tab', { name: '文件', exact: true }).click();
    // Use the Inspector's keyboard-accessible tabs inside its focus trap.
    await inspectorViews.getByRole('tab', { name: '文件', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: '会话活动', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: '运行详情', exact: true })).toBeVisible();
    await inspectorViews.getByRole('tab', { name: '文件', exact: true }).click();
    await expect(page.getByRole('heading', { name: '项目文件', exact: true })).toBeVisible();
    await attachViewportScreenshot(page, testInfo, 'workspace-inspector-single-navigation');
    await page.getByRole('button', { name: '关闭检查器' }).click();
    await expect(views).toBeVisible();
    await expect(views.getByRole('tab', { name: '对话', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(views.getByRole('tab', { name: '对话', exact: true })).toBeFocused();
    await views.getByRole('tab', { name: '文件', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(views.getByRole('tab', { name: '对话', exact: true })).toBeFocused();
    await views.getByRole('tab', { name: '文件', exact: true }).click();
  }

  await expectNoHorizontalOverflow(page);
  await assertWorkspaceTabRelations();
  await attachViewportScreenshot(page, testInfo, 'workspace');
});

test('深色选中 Diff 在统一与请求分栏时保持可读名称和对比度', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  let gitWrites = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.includes('/git/') &&
      !['GET', 'HEAD'].includes(request.method())
    )
      gitWrites += 1;
  });
  // Change the actual application preference, not just the HTML class. Monaco
  // reads the theme context and must select the registered dark diff theme.
  await page.goto('/settings/appearance');
  await page.getByRole('combobox', { name: '主题' }).click();
  await page.getByRole('option', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', 'dark');
  await page.goto(`/workspace/${session.id}?view=changes`);
  await expect(page.getByRole('heading', { name: '审阅更改', exact: true })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  const path = 'apps/web/src/features/workspace/workspace.module.css';
  await page.getByRole('button', { name: `查看 ${path} Diff`, exact: true }).click();
  const modifiedLines = page.locator(
    '.git-diff-editor .editor.modified .view-lines[role="presentation"]',
  );
  await expect(modifiedLines).toBeVisible();
  await expect(modifiedLines).toContainText(/display:\s*grid/);
  const editorInputs = page.locator('.git-diff-editor [role="textbox"]');
  await expect(editorInputs).toHaveCount(2);
  const modeViolations: Array<{ mode: string; violations: unknown[] }> = [];
  for (const mode of ['unified', 'split-requested'] as const) {
    if (mode === 'split-requested') {
      await page.getByRole('button', { name: '切换为分栏 Diff' }).click();
      await expect(page.getByRole('button', { name: '切换为统一 Diff' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      const originalPane = page.locator('.git-diff-editor .editor.original');
      const modifiedPane = page.locator('.git-diff-editor .editor.modified');
      await expect
        .poll(async () => (await originalPane.boundingBox())?.width ?? 0)
        .toBeGreaterThanOrEqual(100);
      await expect
        .poll(async () => (await modifiedPane.boundingBox())?.width ?? 0)
        .toBeGreaterThanOrEqual(100);
      const originalBox = (await originalPane.boundingBox())!;
      const modifiedBox = (await modifiedPane.boundingBox())!;
      expect(originalBox.x + originalBox.width).toBeLessThanOrEqual(modifiedBox.x + 1);
      await expect(originalPane.locator('.view-lines[role="presentation"]')).toBeVisible();
      await expect(originalPane.locator('.view-lines[role="presentation"]')).toContainText(
        /display:\s*block/,
      );
    }
    await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', 'dark');
    await expect
      .poll(() =>
        editorInputs.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('aria-label') ?? ''),
        ),
      )
      .toEqual(
        expect.arrayContaining([
          expect.stringContaining(`更改前：${path}`),
          expect.stringContaining(`更改后：${path}`),
        ]),
      );
    await expect(modifiedLines).toContainText(/display:\s*grid/);
    await expectNoHorizontalOverflow(page);
    await attachViewportScreenshot(page, testInfo, `workspace-diff-dark-${mode}`);
    // Keep actual pane evidence: explicit split must not silently become inline.
    const paneGeometry = await page
      .locator('.git-diff-editor .editor.original, .git-diff-editor .editor.modified')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return {
            className: node.className,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            display: getComputedStyle(node).display,
          };
        }),
      );
    await testInfo.attach(`workspace-diff-dark-layout-${mode}-${testInfo.project.name}`, {
      body: JSON.stringify(paneGeometry),
      contentType: 'application/json',
    });
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const violations = audit.violations.filter((entry) =>
      ['serious', 'critical'].includes(entry.impact ?? ''),
    );
    await testInfo.attach(`workspace-diff-dark-${mode}-axe-${testInfo.project.name}`, {
      body: JSON.stringify(violations),
      contentType: 'application/json',
    });
    // Capture both requested presentations even if the first has contrast issues.
    // The same strict failure gate applies to every collected serious/critical node.
    if (violations.length) modeViolations.push({ mode, violations });
  }
  await page.getByRole('button', { name: '切换为统一 Diff' }).click();
  await expect(page.getByRole('button', { name: '切换为分栏 Diff' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect
    .poll(
      async () =>
        (await page.locator('.git-diff-editor .editor.original').boundingBox())?.width ?? Infinity,
    )
    .toBeLessThanOrEqual(40);
  expect(gitWrites).toBe(0);
  expect(errors).toEqual([]);
  expect(modeViolations).toEqual([]);
});

test('深色 TSX 选中 Diff 使用真实词法内容并保持可读', async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 0) !== 390, 'Focused narrow dark token audit');
  test.setTimeout(120_000);
  const errors: string[] = [];
  let gitWrites = 0;
  let tsxReads = 0;
  let stagedReads = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.includes('/git/') &&
      !['GET', 'HEAD'].includes(request.method())
    )
      gitWrites += 1;
  });
  const path = 'apps/web/src/features/workspace/pages/WorkspacePage.tsx';
  // The common fixture returns CSS for every path. Override only this file so
  // TSX assertions inspect actual TypeScript/JSX tokens, never renamed CSS.
  const patch = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,5 +1,5 @@',
    ' export function WorkspacePage() {',
    '-  let count = 1;',
    '+  const count = 2;',
    "-  const label = 'idle';",
    "+  const label = 'ready';",
    '   return <span>{label}: {count}</span>;',
    ' }',
    '',
  ].join('\n');
  await page.route(`**/api/v1/projects/${project.id}/git/diff?**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('path') !== path) return route.fallback();
    tsxReads += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { patch, truncated: false, staged: url.searchParams.get('staged') === 'true' },
      }),
    });
    if (url.searchParams.get('staged') === 'true') stagedReads += 1;
  });
  await page.goto('/settings/appearance');
  await page.getByRole('combobox', { name: '主题' }).click();
  await page.getByRole('option', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', 'dark');
  await page.goto(`/workspace/${session.id}?view=changes`);
  await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', 'dark');
  await expect(page.getByRole('heading', { name: '审阅更改', exact: true })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await page.getByRole('button', { name: `查看 ${path} Diff`, exact: true }).click();
  const staged = page.getByRole('checkbox', { name: 'staged', exact: true });
  await staged.check();
  await expect(staged).toBeChecked();
  await expect.poll(() => stagedReads).toBeGreaterThan(0);
  const lines = page.locator('.git-diff-editor .editor.modified .view-lines[role="presentation"]');
  await expect(lines).toBeVisible();
  await expect(lines).toContainText(/const\s+count\s*=\s*2/);
  await expect(lines).toContainText(/label\s*=\s*'ready'/);
  await expect(page.locator('.git-diff-editor-toolbar small')).toHaveText('typescript');
  await expect.poll(() => tsxReads).toBeGreaterThan(0);
  const editors = page.locator('.git-diff-editor [role="textbox"]');
  await expect(editors).toHaveCount(2);
  await expect
    .poll(() =>
      editors.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? '')),
    )
    .toEqual(
      expect.arrayContaining([
        expect.stringContaining(`更改前：${path}`),
        expect.stringContaining(`更改后：${path}`),
      ]),
    );
  // Monaco can expose the right text before asynchronous syntax tokenization.
  // e0f10ea passed a retry after a real token contrast failure; do not let
  // a pre-tokenization fallback count as evidence of the syntax palette.
  // Require both actual changed string tokens to have the intended palette.
  // Inline Monaco retains hidden original/deletion mirrors. Only inspect the
  // visible modified pane, including its displayed inline deletion view zone.
  for (const word of ['idle', 'ready']) {
    const stringTokens = page.locator(
      word === 'idle'
        ? '.git-diff-editor .editor.modified .view-line span.char-delete:visible'
        : '.git-diff-editor .editor.modified .view-line span[class*="mtk"]:visible',
    );
    await expect
      .poll(() =>
        stringTokens.evaluateAll((nodes, expectedWord) => {
          const colors = nodes
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              const pane = node.closest('.editor.modified')?.getBoundingClientRect();
              return (
                node.children.length === 0 &&
                node.textContent?.replace(/^['"]|['"]$/g, '') === expectedWord &&
                pane !== undefined &&
                rect.width > 0 &&
                rect.height > 0 &&
                rect.left >= Math.max(pane.left, 0) &&
                rect.right <= Math.min(pane.right, innerWidth) &&
                rect.top >= Math.max(pane.top, 0) &&
                rect.bottom <= Math.min(pane.bottom, innerHeight)
              );
            })
            .map((node) => getComputedStyle(node).color);
          return [...new Set(colors)];
        }, word),
      )
      .toEqual(['rgb(244, 199, 175)']);
  }
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'workspace-diff-dark-tsx');
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = audit.violations.filter((entry) =>
    ['serious', 'critical'].includes(entry.impact ?? ''),
  );
  await testInfo.attach(`workspace-diff-dark-tsx-axe-${testInfo.project.name}`, {
    body: JSON.stringify(violations),
    contentType: 'application/json',
  });
  expect(gitWrites).toBe(0);
  expect(errors).toEqual([]);
  expect(violations).toEqual([]);
});

test('浅色 TSX 中性词法在真实增删背景保持可读', async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 0) !== 390, 'Focused narrow light token audit');
  test.setTimeout(120_000);
  const errors: string[] = [];
  let gitWrites = 0;
  let tsxReads = 0;
  let stagedReads = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.includes('/git/') &&
      !['GET', 'HEAD'].includes(request.method())
    )
      gitWrites += 1;
  });
  const path = 'apps/web/src/features/workspace/pages/WorkspacePage.tsx';
  // The common fixture returns CSS for every path. Override only this file so
  // TSX assertions inspect actual TypeScript/JSX tokens, never renamed CSS.
  const patch = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,4 +1,4 @@',
    '-const n=1;',
    '+const n=2;',
    "-const s='idle';",
    "+const s='ready';",
    '-type Old=number;',
    '+type New=number;',
    '-// old',
    '+// new',
    '',
  ].join('\n');
  await page.route(`**/api/v1/projects/${project.id}/git/diff?**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('path') !== path) return route.fallback();
    tsxReads += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { patch, truncated: false, staged: url.searchParams.get('staged') === 'true' },
      }),
    });
    if (url.searchParams.get('staged') === 'true') stagedReads += 1;
  });
  await page.goto('/settings/appearance');
  await page.getByRole('combobox', { name: '主题' }).click();
  await page.getByRole('option', { name: '浅色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', 'light');
  await page.goto(`/workspace/${session.id}?view=changes`);
  await expect(page.locator('html')).toHaveAttribute('data-agenthub-theme', 'light');
  await expect(page.getByRole('heading', { name: '审阅更改', exact: true })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await page.getByRole('button', { name: `查看 ${path} Diff`, exact: true }).click();
  const staged = page.getByRole('checkbox', { name: 'staged', exact: true });
  await staged.check();
  await expect(staged).toBeChecked();
  await expect.poll(() => stagedReads).toBeGreaterThan(0);
  const lines = page.locator('.git-diff-editor .editor.modified .view-lines[role="presentation"]');
  await expect(lines).toBeVisible();
  await expect(lines).toContainText(/const\s+n\s*=\s*2/);
  await expect(lines).toContainText(/s\s*=\s*'ready'/);
  await expect(page.locator('.git-diff-editor-toolbar small')).toHaveText('typescript');
  await expect.poll(() => tsxReads).toBeGreaterThan(0);
  const editors = page.locator('.git-diff-editor [role="textbox"]');
  await expect(editors).toHaveCount(2);
  await expect
    .poll(() =>
      editors.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? '')),
    )
    .toEqual(
      expect.arrayContaining([
        expect.stringContaining(`更改前：${path}`),
        expect.stringContaining(`更改后：${path}`),
      ]),
    );
  // Every family must have painted its real palette: fallback black and hidden
  // Monaco mirrors cannot satisfy this gate. The inline deleted spans belong
  // to the visible modified pane, not the hidden original editor.
  const samples = [
    ['const', 'rgb(61, 72, 89)', false],
    ['idle', 'rgb(85, 66, 54)', true],
    ['ready', 'rgb(85, 66, 54)', false],
    ['1', 'rgb(55, 75, 66)', true],
    ['2', 'rgb(55, 75, 66)', false],
    ['Old', 'rgb(77, 64, 87)', true],
    ['New', 'rgb(77, 64, 87)', false],
    ['old', 'rgb(66, 75, 69)', true],
    ['new', 'rgb(66, 75, 69)', false],
  ] as const;
  for (const [text, color, deleted] of samples) {
    const tokens = page.locator(
      deleted
        ? '.git-diff-editor .editor.modified .view-line span.char-delete:visible'
        : '.git-diff-editor .editor.modified .view-line span[class*="mtk"]:visible',
    );
    await expect
      .poll(() =>
        tokens.evaluateAll((nodes, expected) => {
          return [
            ...new Set(
              nodes
                .filter((node) => {
                  const rect = node.getBoundingClientRect();
                  const pane = node.closest('.editor.modified')?.getBoundingClientRect();
                  return (
                    node.children.length === 0 &&
                    node.textContent
                      ?.replace(/\u00a0/g, ' ')
                      .replace(/^['"]|['"]$/g, '')
                      .replace(/^\/\/\s*/, '')
                      .trim() === expected &&
                    pane !== undefined &&
                    rect.width > 0 &&
                    rect.height > 0 &&
                    rect.left >= Math.max(pane.left, 0) &&
                    rect.right <= Math.min(pane.right, innerWidth) &&
                    rect.top >= Math.max(pane.top, 0) &&
                    rect.bottom <= Math.min(pane.bottom, innerHeight)
                  );
                })
                .map((node) => getComputedStyle(node).color),
            ),
          ];
        }, text),
      )
      .toEqual([color]);
  }
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'workspace-diff-light-tsx');
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = audit.violations.filter((entry) =>
    ['serious', 'critical'].includes(entry.impact ?? ''),
  );
  await testInfo.attach(`workspace-diff-light-tsx-axe-${testInfo.project.name}`, {
    body: JSON.stringify(violations),
    contentType: 'application/json',
  });
  expect(gitWrites).toBe(0);
  expect(errors).toEqual([]);
  expect(violations).toEqual([]);
});

test('专注审阅保留未提交草稿和编辑器并恢复原布局', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  let gitWrites = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.includes('/git/') &&
      !['GET', 'HEAD'].includes(request.method())
    )
      gitWrites += 1;
  });
  await page.goto(`/workspace/${session.id}?view=changes`);
  await expect(page.getByRole('heading', { name: '审阅更改', exact: true })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  const viewportWidth = page.viewportSize()!.width;
  const enterFocus = page.getByRole('button', { name: '专注审阅', exact: true });
  if (viewportWidth < 768) {
    // A phone is already full-width. Do not offer an ineffective enlargement.
    await expect(enterFocus).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    expect(gitWrites).toBe(0);
    expect(errors).toEqual([]);
    return;
  }
  const path = 'apps/web/src/features/workspace/workspace.module.css';
  await page.getByRole('button', { name: `查看 ${path} Diff`, exact: true }).click();
  await expect(
    page.locator('.git-diff-editor .editor.modified .view-lines[role="presentation"]'),
  ).toContainText(/display:\s*grid/);
  await page.getByRole('button', { name: '展开文件清单', exact: true }).click();
  const selected = page.getByRole('checkbox', { name: `选择 ${path}`, exact: true });
  await selected.check();
  const draft = page.getByRole('textbox', { name: '提交说明', exact: true });
  await expect(draft).toBeVisible();
  await draft.fill('专注切换必须保留这份未提交草稿');
  await draft.evaluate((node) => {
    node.dataset.focusIdentity = 'same-draft-node';
  });
  const editor = page.locator('.git-diff-editor .monaco-diff-editor');
  await expect(editor).toHaveCount(1);
  await editor.evaluate((node) => {
    node.dataset.focusIdentity = 'same-editor-node';
  });
  await page.getByRole('button', { name: '切换为分栏 Diff' }).click();
  const inspector = page.locator('.inspector-panel');
  const layout = page.locator('.three-column-split');
  const initialWidth = (await inspector.boundingBox())!.width;
  const preferences = async () =>
    page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage)
          .filter(([key]) => key.startsWith('agenthub.workspace.layout-'))
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
  const previousPreferences = await preferences();
  await enterFocus.click();
  const exitFocus = page.getByRole('button', { name: '退出专注审阅', exact: true });
  await expect(exitFocus).toHaveAttribute('aria-pressed', 'true');
  await expect(layout).toHaveAttribute('data-right-focused', 'true');
  await expect
    .poll(async () => (await inspector.boundingBox())!.width)
    .toBeGreaterThanOrEqual(viewportWidth - 34);
  const focusedPanes = page.locator(
    '.git-diff-editor .editor.original, .git-diff-editor .editor.modified',
  );
  await expect(focusedPanes).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    await expect
      .poll(async () => (await focusedPanes.nth(index).boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual((viewportWidth - 32) * 0.4);
  }
  await testInfo.attach(`workspace-review-focused-geometry-${testInfo.project.name}`, {
    body: JSON.stringify({
      viewportWidth,
      initialWidth,
      focusedInspector: await inspector.boundingBox(),
      panes: await focusedPanes.evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return { x: box.x, width: box.width, height: box.height };
        }),
      ),
    }),
    contentType: 'application/json',
  });
  await expect(draft).toHaveValue('专注切换必须保留这份未提交草稿');
  await expect(draft).toHaveAttribute('data-focus-identity', 'same-draft-node');
  await expect(editor).toHaveAttribute('data-focus-identity', 'same-editor-node');
  await expect(selected).toBeChecked();
  if (viewportWidth >= 1180) {
    const conversation = page.locator('.conversation-panel');
    await expect(conversation).toHaveCount(1);
    await expect(conversation).toBeHidden();
    await expect
      .poll(() => conversation.evaluate((node) => Boolean(node.closest('[inert]'))))
      .toBe(true);
  } else {
    await expect(page.getByRole('dialog', { name: '工作区辅助栏' })).toHaveCount(1);
  }
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'workspace-review-focused');
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = audit.violations.filter((entry) =>
    ['serious', 'critical'].includes(entry.impact ?? ''),
  );
  await testInfo.attach(`workspace-review-focused-axe-${testInfo.project.name}`, {
    body: JSON.stringify(violations),
    contentType: 'application/json',
  });
  // Escape leaves focus mode first, not the existing medium drawer itself.
  await exitFocus.focus();
  await page.keyboard.press('Escape');
  await expect(layout).not.toHaveAttribute('data-right-focused', 'true');
  await expect(enterFocus).toBeFocused();
  await expect
    .poll(async () => Math.abs((await inspector.boundingBox())!.width - initialWidth))
    .toBeLessThanOrEqual(2);
  if (viewportWidth < 1180)
    await expect(page.getByRole('dialog', { name: '工作区辅助栏' })).toHaveCount(1);
  await expect(draft).toHaveValue('专注切换必须保留这份未提交草稿');
  await expect(draft).toHaveAttribute('data-focus-identity', 'same-draft-node');
  await expect(editor).toHaveAttribute('data-focus-identity', 'same-editor-node');
  await page.keyboard.press('Enter');
  await expect(exitFocus).toHaveAttribute('aria-pressed', 'true');
  await exitFocus.click();
  await expect(enterFocus).toBeFocused();
  await expect(layout).not.toHaveAttribute('data-right-focused', 'true');
  expect(await preferences()).toEqual(previousPreferences);
  await expect(selected).toBeChecked();
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'workspace-review-focus-restored');
  expect(gitWrites).toBe(0);
  expect(errors).toEqual([]);
  expect(violations).toEqual([]);
});

test('只读预览的专注审阅保留默认统一模式并提供真实分栏阅读证据', async ({ page }, testInfo) => {
  test.skip(page.viewportSize()!.width < 768, '手机已有全宽阅读，不提供专注入口');
  test.setTimeout(120_000);
  const errors: string[] = [];
  let gitWrites = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.includes('/git/') &&
      !['GET', 'HEAD'].includes(request.method())
    )
      gitWrites += 1;
  });
  await page.goto(`/workspace/${session.id}?view=changes`);
  await expect(page.getByRole('heading', { name: '审阅更改', exact: true })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  const path = 'apps/web/src/features/workspace/workspace.module.css';
  await page.getByRole('button', { name: `查看 ${path} Diff`, exact: true }).click();
  const lines = page.locator('.git-diff-editor .editor.modified .view-lines[role="presentation"]');
  await expect(lines).toContainText(/display:\s*grid/);
  await page.getByRole('button', { name: '展开文件清单', exact: true }).click();
  const choices = page.getByRole('checkbox', { name: /^选择 / });
  expect(await choices.count()).toBeGreaterThan(0);
  const assertReadingOnly = async () => {
    for (const choice of await choices.all()) await expect(choice).not.toBeChecked();
    await expect(page.getByRole('textbox', { name: '提交说明', exact: true })).toBeHidden();
  };
  await assertReadingOnly();
  await expect(page.getByRole('button', { name: '切换为分栏 Diff', exact: true })).toBeVisible();
  const preferences = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage)
          .filter(([key]) => key.startsWith('agenthub.workspace.layout-'))
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
  const beforePreferences = await preferences();
  const inspector = page.locator('.inspector-panel');
  const initialWidth = (await inspector.boundingBox())!.width;
  const layout = page.locator('.three-column-split');
  await page.getByRole('button', { name: '专注审阅', exact: true }).click();
  await expect(layout).toHaveAttribute('data-right-focused', 'true');
  await expect
    .poll(async () => (await inspector.boundingBox())!.width)
    .toBeGreaterThanOrEqual(page.viewportSize()!.width - 34);
  const original = page.locator('.git-diff-editor .editor.original');
  const modified = page.locator('.git-diff-editor .editor.modified');
  const audits: Array<{ mode: string; violations: unknown[] }> = [];
  for (const mode of ['unified', 'split'] as const) {
    if (mode === 'split') {
      await page.getByRole('button', { name: '切换为分栏 Diff', exact: true }).click();
      await expect(
        page.getByRole('button', { name: '切换为统一 Diff', exact: true }),
      ).toBeVisible();
      for (const pane of [original, modified]) {
        await expect
          .poll(async () => (await pane.boundingBox())?.width ?? 0)
          .toBeGreaterThanOrEqual((page.viewportSize()!.width - 32) * 0.4);
      }
      const originalBox = (await original.boundingBox())!;
      const modifiedBox = (await modified.boundingBox())!;
      expect(originalBox.x + originalBox.width).toBeLessThanOrEqual(modifiedBox.x + 1);
      await expect(original.locator('.view-lines[role="presentation"]')).toBeVisible();
      await expect(original.locator('.view-lines[role="presentation"]')).toContainText(
        /display:\s*block/,
      );
    } else {
      // A real geometry assertion, not just a label: unified does not allocate half the width to original.
      await expect.poll(async () => (await original.boundingBox())?.width ?? 0).toBeLessThan(40);
      await expect
        .poll(async () => (await modified.boundingBox())!.width)
        .toBeGreaterThan(page.viewportSize()!.width * 0.75);
    }
    const inputs = page.locator('.git-diff-editor [role="textbox"]');
    await expect(inputs).toHaveCount(2);
    await expect
      .poll(() =>
        inputs.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? '')),
      )
      .toEqual(
        expect.arrayContaining([
          expect.stringContaining(`更改前：${path}`),
          expect.stringContaining(`更改后：${path}`),
        ]),
      );
    await assertReadingOnly();
    await expectNoHorizontalOverflow(page);
    await testInfo.attach(`workspace-reading-${mode}-geometry-${testInfo.project.name}`, {
      body: JSON.stringify({
        viewport: page.viewportSize(),
        initialWidth,
        inspector: await inspector.boundingBox(),
        original: await original.boundingBox(),
        modified: await modified.boundingBox(),
        code: await lines.boundingBox(),
      }),
      contentType: 'application/json',
    });
    // No scroll, content removal, or draft expansion: capture the natural preview-only reading state.
    await attachViewportScreenshot(page, testInfo, `workspace-reading-focused-${mode}`);
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const violations = audit.violations.filter((entry) =>
      ['serious', 'critical'].includes(entry.impact ?? ''),
    );
    audits.push({ mode, violations });
    await testInfo.attach(`workspace-reading-${mode}-axe-${testInfo.project.name}`, {
      body: JSON.stringify(violations),
      contentType: 'application/json',
    });
  }
  await page.getByRole('button', { name: '退出专注审阅', exact: true }).click();
  await expect(layout).not.toHaveAttribute('data-right-focused', 'true');
  await expect(page.getByRole('button', { name: '专注审阅', exact: true })).toBeFocused();
  await expect
    .poll(async () => Math.abs((await inspector.boundingBox())!.width - initialWidth))
    .toBeLessThanOrEqual(2);
  await assertReadingOnly();
  expect(await preferences()).toEqual(beforePreferences);
  expect(gitWrites).toBe(0);
  expect(errors).toEqual([]);
  expect(audits).toEqual([
    { mode: 'unified', violations: [] },
    { mode: 'split', violations: [] },
  ]);
});

test('大量变更文件在专注态保留代码首屏与末项键盘可达', async ({ page }, testInfo) => {
  test.skip(page.viewportSize()!.width < 768, '手机无专注入口，规模验证限三非手机视口');
  test.setTimeout(120_000);
  const path = 'apps/web/src/features/workspace/workspace.module.css';
  const paths = [
    path,
    ...Array.from(
      { length: 39 },
      (_, index) => `zz-review/file-${String(index + 1).padStart(2, '0')}.css`,
    ),
  ];
  const errors: string[] = [];
  let gitWrites = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.includes('/git/') &&
      !['GET', 'HEAD'].includes(request.method())
    )
      gitWrites += 1;
  });
  // This is an isolated status fixture, not evidence from a real 40-file repository.
  await page.route(`**/api/v1/projects/${project.id}/git/status`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          branch: 'feature/large-review',
          headSha: 'abcdef1234567890',
          clean: false,
          entries: paths.map((entry) => ({
            index: ' ',
            worktree: 'M',
            path: entry,
            worktreeStats: { additions: 3, deletions: 1 },
          })),
        },
      }),
    });
  });
  await page.goto(`/workspace/${session.id}?view=changes`);
  await expect(page.getByRole('heading', { name: '审阅更改', exact: true })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await page.getByRole('button', { name: `查看 ${path} Diff`, exact: true }).click();
  const code = page.locator('.git-diff-editor .editor.modified .view-lines[role="presentation"]');
  await expect(code).toContainText(/display:\s*grid/);
  const preferences = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage)
          .filter(([key]) => key.startsWith('agenthub.workspace.layout-'))
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
  const previousPreferences = await preferences();
  const inspector = page.locator('.inspector-panel');
  const initialWidth = (await inspector.boundingBox())!.width;
  await page.getByRole('button', { name: '展开文件清单', exact: true }).click();
  const initialListHeight = (await page
    .getByRole('tree', { name: 'Git 文件变更树', exact: true })
    .boundingBox())!.height;
  await page.getByRole('button', { name: '专注审阅', exact: true }).click();
  await expect(page.locator('.three-column-split')).toHaveAttribute('data-right-focused', 'true');
  await expect
    .poll(async () => (await page.locator('.inspector-panel').boundingBox())!.width)
    .toBeGreaterThanOrEqual(page.viewportSize()!.width - 34);
  const tree = page.getByRole('tree', { name: 'Git 文件变更树', exact: true });
  await expect(tree.getByRole('checkbox')).toHaveCount(40);
  await expect(page.getByRole('textbox', { name: '提交说明', exact: true })).toBeHidden();
  await expectNoHorizontalOverflow(page);
  // The 959 baseline put code at y2279/2369. Require real first-screen reading now,
  // before any scrolling, rather than deleting the 40-file sample or moving the viewport.
  await expect
    .poll(() => tree.evaluate((node) => node.scrollHeight > node.clientHeight))
    .toBe(true);
  await expect.poll(async () => (await tree.boundingBox())!.height).toBeLessThanOrEqual(241);
  const visibleReadingHeight = () =>
    page.locator('.git-diff-editor .editor.modified').evaluate((node) => {
      const editorBox = node.getBoundingClientRect();
      const clipBox = node.closest('.inspector-body')!.getBoundingClientRect();
      return Math.max(
        0,
        Math.min(editorBox.bottom, clipBox.bottom, window.innerHeight) -
          Math.max(editorBox.top, clipBox.top, 0),
      );
    });
  await expect.poll(visibleReadingHeight).toBeGreaterThanOrEqual(180);
  expect((await code.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  expect(await page.locator('.inspector-body').evaluate((node) => node.scrollTop)).toBe(0);
  await testInfo.attach(`workspace-large-reading-geometry-${testInfo.project.name}`, {
    body: JSON.stringify({
      viewport: page.viewportSize(),
      fileCount: paths.length,
      visibleReadingHeight: await visibleReadingHeight(),
      list: await tree.boundingBox(),
      code: await code.boundingBox(),
      inspectorScroll: await page.locator('.inspector-body').evaluate((node) => ({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
      })),
      listScroll: await tree.evaluate((node) => ({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
      })),
    }),
    contentType: 'application/json',
  });
  await attachViewportScreenshot(page, testInfo, 'workspace-large-reading-natural');
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = audit.violations.filter((entry) =>
    ['serious', 'critical'].includes(entry.impact ?? ''),
  );
  await testInfo.attach(`workspace-large-reading-axe-${testInfo.project.name}`, {
    body: JSON.stringify(violations),
    contentType: 'application/json',
  });
  // Real Tab progression traverses all 40 rows; no focusing/scrolling straight to the last item.
  const choices = tree.getByRole('checkbox');
  await choices.first().focus();
  for (let index = 0; index < paths.length * 2 - 1; index += 1) await page.keyboard.press('Tab');
  const lastPath = paths.at(-1)!;
  const lastPreview = page.getByRole('button', { name: `查看 ${lastPath} Diff`, exact: true });
  await expect(lastPreview).toBeFocused();
  const listBox = (await tree.boundingBox())!;
  const lastBox = (await lastPreview.boundingBox())!;
  expect(lastBox.y).toBeGreaterThanOrEqual(listBox.y - 1);
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1);
  expect(await tree.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Shift+Tab');
  const lastChoice = page.getByRole('checkbox', { name: `选择 ${lastPath}`, exact: true });
  await expect(lastChoice).toBeFocused();
  await page.keyboard.press('Space');
  await expect(lastChoice).toBeChecked();
  const directory = page.getByRole('button', { name: '按目录显示变更', exact: true });
  await directory.click();
  await expect(tree).toHaveAttribute('data-layout', 'tree');
  await expect(lastChoice).toBeChecked();
  await directory.click();
  await expect(tree).toHaveAttribute('data-layout', 'list');
  await expect(lastChoice).toBeChecked();
  await page.getByRole('button', { name: '全选', exact: true }).click();
  await expect(tree.locator('input:checked')).toHaveCount(40);
  await page.getByRole('button', { name: '取消全选', exact: true }).click();
  await expect(tree.locator('input:checked')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '提交说明', exact: true })).toBeHidden();
  await expect(page.locator('.git-selected-diff-heading code')).toHaveAttribute('aria-label', path);
  await page.getByRole('button', { name: '退出专注审阅', exact: true }).click();
  await expect(page.getByRole('button', { name: '专注审阅', exact: true })).toBeFocused();
  await expect
    .poll(async () => Math.abs((await inspector.boundingBox())!.width - initialWidth))
    .toBeLessThanOrEqual(2);
  await expect
    .poll(async () => Math.abs((await tree.boundingBox())!.height - initialListHeight))
    .toBeLessThanOrEqual(2);
  expect(await preferences()).toEqual(previousPreferences);
  expect(gitWrites).toBe(0);
  expect(errors).toEqual([]);
  expect(violations).toEqual([]);
});

test('手机大量变更文件首屏可读且目录末项可达', async ({ page }, testInfo) => {
  test.skip(page.viewportSize()!.width >= 768, '独立手机调查，非手机由专注态用例覆盖');
  test.setTimeout(120_000);
  const path = 'apps/web/src/features/workspace/workspace.module.css';
  const paths = [
    path,
    ...Array.from(
      { length: 39 },
      (_, index) => `zz-review/file-${String(index + 1).padStart(2, '0')}.css`,
    ),
  ];
  const errors: string[] = [];
  let gitWrites = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.includes('/git/') &&
      !['GET', 'HEAD'].includes(request.method())
    )
      gitWrites += 1;
  });
  // This is an isolated status fixture, not evidence from a real 40-file repository.
  await page.route(`**/api/v1/projects/${project.id}/git/status`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          branch: 'feature/large-review',
          headSha: 'abcdef1234567890',
          clean: false,
          entries: paths.map((entry) => ({
            index: ' ',
            worktree: 'M',
            path: entry,
            worktreeStats: { additions: 3, deletions: 1 },
          })),
        },
      }),
    });
  });
  await page.goto(`/workspace/${session.id}?view=changes`);
  await expect(page.getByRole('heading', { name: '审阅更改', exact: true })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await page.getByRole('button', { name: `查看 ${path} Diff`, exact: true }).click();
  const code = page.locator('.git-diff-editor .editor.modified .view-lines[role="presentation"]');
  await expect(code).toContainText(/display:\s*grid/);
  await expect(page.getByRole('button', { name: '专注审阅', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '切换为分栏 Diff', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '展开文件清单', exact: true }).click();
  const tree = page.getByRole('tree', { name: 'Git 文件变更树', exact: true });
  await expect(tree.getByRole('checkbox')).toHaveCount(40);
  for (const choice of await tree.getByRole('checkbox').all())
    await expect(choice).not.toBeChecked();
  await expect(page.getByRole('textbox', { name: '提交说明', exact: true })).toBeHidden();
  await expectNoHorizontalOverflow(page);
  expect(await page.locator('.inspector-body').evaluate((node) => node.scrollTop)).toBe(0);
  // The 977 baseline needed 1745px outer scrolling. Keep that 40-file sample,
  // and require actual initial reading space before any pointer scrolling.
  const visibleReadingHeight = () =>
    page.locator('.git-diff-editor .editor.modified').evaluate((node) => {
      const editorBox = node.getBoundingClientRect();
      const clipBox = node.closest('.inspector-body')!.getBoundingClientRect();
      return Math.max(
        0,
        Math.min(editorBox.bottom, clipBox.bottom, window.innerHeight) -
          Math.max(editorBox.top, clipBox.top, 0),
      );
    });
  await expect.poll(visibleReadingHeight).toBeGreaterThanOrEqual(180);
  await expect
    .poll(() => tree.evaluate((node) => node.scrollHeight > node.clientHeight))
    .toBe(true);
  await expect.poll(async () => (await tree.boundingBox())!.height).toBeLessThanOrEqual(241);
  await testInfo.attach(`workspace-phone-large-reading-geometry-${testInfo.project.name}`, {
    body: JSON.stringify({
      viewport: page.viewportSize(),
      windowScrollY: await page.evaluate(() => window.scrollY),
      fileCount: paths.length,
      visibleReadingHeight: await visibleReadingHeight(),
      list: await tree.boundingBox(),
      code: await code.boundingBox(),
      inspectorScroll: await page.locator('.inspector-body').evaluate((node) => ({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
      })),
      listScroll: await tree.evaluate((node) => ({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
      })),
    }),
    contentType: 'application/json',
  });
  await attachViewportScreenshot(page, testInfo, 'workspace-phone-large-reading-natural');
  const editorInputs = page.locator('.git-diff-editor [role="textbox"]');
  await expect(editorInputs).toHaveCount(2);
  await expect
    .poll(() =>
      editorInputs.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('aria-label') ?? ''),
      ),
    )
    .toEqual(
      expect.arrayContaining([
        expect.stringContaining(`更改前：${path}`),
        expect.stringContaining(`更改后：${path}`),
      ]),
    );
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = audit.violations.filter((entry) =>
    ['serious', 'critical'].includes(entry.impact ?? ''),
  );
  await testInfo.attach(`workspace-phone-large-reading-axe-${testInfo.project.name}`, {
    body: JSON.stringify(violations),
    contentType: 'application/json',
  });
  // Browser wheel input proves inner-directory reachability, not physical touchscreen behavior.
  const outer = page.locator('.inspector-body');
  const listBox = (await tree.boundingBox())!;
  const beforeScroll = await tree.evaluate((node) => node.scrollTop);
  await page.mouse.move(
    listBox.x + listBox.width / 2,
    listBox.y + Math.min(100, listBox.height / 2),
  );
  await page.mouse.wheel(0, 3000);
  await expect.poll(() => tree.evaluate((node) => node.scrollTop)).toBeGreaterThan(beforeScroll);
  const lastPath = paths.at(-1)!;
  const lastPreview = page.getByRole('button', { name: `查看 ${lastPath} Diff`, exact: true });
  await expect
    .poll(async () => {
      const lastBox = await lastPreview.boundingBox();
      const currentList = await tree.boundingBox();
      return Boolean(
        lastBox &&
        currentList &&
        lastBox.y >= Math.max(currentList.y - 1, 0) &&
        lastBox.y + lastBox.height <=
          Math.min(currentList.y + currentList.height + 1, page.viewportSize()!.height),
      );
    })
    .toBe(true);
  await expect(page.getByRole('button', { name: '关闭检查器', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭检查器', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await testInfo.attach(
    `workspace-phone-large-reading-after-scroll-geometry-${testInfo.project.name}`,
    {
      body: JSON.stringify({
        viewport: page.viewportSize(),
        code: await code.boundingBox(),
        listScroll: await tree.evaluate((node) => ({
          scrollTop: node.scrollTop,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
        })),
        inspectorScroll: await outer.evaluate((node) => ({
          scrollTop: node.scrollTop,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
        })),
      }),
      contentType: 'application/json',
    },
  );
  await attachViewportScreenshot(page, testInfo, 'workspace-phone-large-reading-after-scroll');
  const lastChoice = page.getByRole('checkbox', { name: `选择 ${lastPath}`, exact: true });
  await lastChoice.check();
  await expect(lastChoice).toBeChecked();
  const directory = page.getByRole('button', { name: '按目录显示变更', exact: true });
  await directory.click();
  await expect(tree).toHaveAttribute('data-layout', 'tree');
  await expect(lastChoice).toBeChecked();
  await directory.click();
  await expect(tree).toHaveAttribute('data-layout', 'list');
  await expect(lastChoice).toBeChecked();
  await page.getByRole('button', { name: '全选', exact: true }).click();
  await expect(tree.locator('input:checked')).toHaveCount(40);
  await page.getByRole('button', { name: '取消全选', exact: true }).click();
  await expect(tree.locator('input:checked')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '提交说明', exact: true })).toBeHidden();
  await expect(page.locator('.git-selected-diff-heading code')).toHaveAttribute('aria-label', path);
  await expectNoHorizontalOverflow(page);
  expect(gitWrites).toBe(0);
  expect(errors).toEqual([]);
  expect(violations).toEqual([]);
});

test('Git 提交响应丢失保留未知记录且修改或只读刷新不能重复提交', async ({ page }, testInfo) => {
  test.skip(![390, 1440].includes(page.viewportSize()!.width), '独立手机与桌面未知结果证据');
  test.setTimeout(120_000);
  const path = `src/${'long-path-segment-'.repeat(12)}.ts`;
  const message = `未知提交原始说明${'LongUnbrokenCommitMessage'.repeat(20)}`;
  const commitEndpoint = `/api/v1/projects/${project.id}/git/commit`;
  const errors: string[] = [];
  let posts = 0;
  let reads = 0;
  let recoveryReads = 0;
  let operationId = '';
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => {
    // The sole injected transport failure is expected; no other console errors are ignored.
    if (
      entry.type() === 'error' &&
      !(
        entry.location().url.endsWith(commitEndpoint) && entry.text().includes('net::ERR_FAILED')
      ) &&
      !(entry.location().url.includes('/git/commit-operations/') && entry.text().includes('404'))
    )
      errors.push(entry.text());
  });
  await page.route(`**/api/v1/projects/${project.id}/git/status`, async (route) => {
    reads += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          branch: 'feature/unknown-commit',
          headSha: 'a'.repeat(40),
          clean: false,
          entries: [{ index: ' ', worktree: 'M', path }],
        },
      }),
    });
  });
  // Isolated browser transport fixture only: the POST is intercepted before any server
  // or repository receives it. This does not prove a real commit succeeded before loss.
  await page.route(`**${commitEndpoint}`, async (route) => {
    expect(route.request().method()).toBe('POST');
    posts += 1;
    const payload = route.request().postDataJSON();
    expect(payload).toEqual({
      mode: 'SELECTED',
      paths: [path],
      message,
      protocolVersion: 1,
      operationId: expect.any(String),
      expectedHead: 'a'.repeat(40),
    });
    operationId = payload.operationId;
    expect(operationId).toMatch(/^[a-f0-9-]{36}$/);
    await route.abort('failed');
  });
  await page.route(`**/api/v1/projects/${project.id}/git/commit-operations/*`, async (route) => {
    expect(route.request().method()).toBe('GET');
    expect(route.request().url()).toContain(operationId);
    recoveryReads += 1;
    // No server saw the intercepted POST; 404 is NOT safe-to-retry proof.
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'GIT_OPERATION_NOT_FOUND', message: '操作未找到，不证明未执行' },
      }),
    });
  });
  await page.goto(`/workspace/${session.id}?view=changes`);
  await expect(page.getByRole('heading', { name: '审阅更改', exact: true })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await page.getByRole('checkbox', { name: `选择 ${path}`, exact: true }).check();
  const draft = page.getByRole('textbox', { name: '提交说明', exact: true });
  await draft.fill(message);
  await page.getByRole('button', { name: '提交所选文件 (1)', exact: true }).click();
  const alert = page.locator('.workspace-query-error').filter({ hasText: '提交结果未知' });
  await expect(alert).toBeVisible();
  const retry = page.getByRole('button', { name: '重试提交', exact: true });
  await expect(retry).toBeDisabled();
  await expect(draft).toHaveValue(message);
  await alert.getByText('本次提交记录与保护范围', { exact: true }).click();
  await expect(alert.locator('code')).toHaveText(path);
  await expect(alert).toContainText(message);
  await expect(alert).toContainText('提交仅在浏览器恢复记录写入成功后发送');
  await expectNoHorizontalOverflow(page);
  const geometry = await alert.evaluate((node) => {
    const panel = node.closest('.inspector-body')!;
    return {
      alertWidth: node.clientWidth,
      alertScrollWidth: node.scrollWidth,
      panelWidth: panel.clientWidth,
      panelScrollWidth: panel.scrollWidth,
    };
  });
  expect(geometry.alertScrollWidth).toBeLessThanOrEqual(geometry.alertWidth + 1);
  expect(geometry.panelScrollWidth).toBeLessThanOrEqual(geometry.panelWidth + 1);
  await alert.scrollIntoViewIfNeeded();
  await attachViewportScreenshot(page, testInfo, 'workspace-git-unknown-expanded');
  await testInfo.attach(`workspace-git-unknown-geometry-${testInfo.project.name}`, {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  await testInfo.attach(`workspace-git-unknown-axe-${testInfo.project.name}`, {
    body: JSON.stringify(audit.violations),
    contentType: 'application/json',
  });
  expect(audit.violations).toEqual([]);
  await draft.fill('修改后的说明不会解锁原提交');
  await page.getByRole('checkbox', { name: `选择 ${path}`, exact: true }).uncheck();
  await page.getByRole('checkbox', { name: `选择 ${path}`, exact: true }).check();
  await expect(page.getByRole('button', { name: '提交所选文件 (1)', exact: true })).toBeDisabled();
  // Exercise the handler guard even when native disabled controls cannot be clicked.
  await page.locator('.git-commit-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(alert).toContainText(message);
  await page.getByRole('button', { name: '刷新 Git 数据', exact: true }).click();
  await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
  await page.getByText('更多 Git', { exact: true }).click();
  await page.getByRole('menuitem', { name: '提交历史', exact: true }).click();
  await expect(retry).toBeDisabled();
  await expect(alert).toContainText(message);
  const inspectorTabs = page.getByRole('tablist', { name: '检查器视图' });
  await inspectorTabs.getByRole('tab', { name: '文件', exact: true }).click();
  await expect(alert).toHaveCount(0);
  await inspectorTabs.getByRole('tab', { name: '变更', exact: true }).click();
  await expect(alert).toContainText(message);
  await expect(retry).toBeDisabled();
  await alert.getByText('本次提交记录与保护范围', { exact: true }).click();
  await expect(alert.locator('code')).toHaveText(path);
  await expect(alert).toContainText(project.id);
  await attachViewportScreenshot(page, testInfo, 'workspace-git-unknown-reopened');
  await page.reload();
  await expect(alert).toBeVisible();
  await expect(retry).toBeDisabled();
  await expect.poll(() => recoveryReads).toBeGreaterThanOrEqual(1);
  const markers = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('agenthub:git-commit:v1:'))
      .map((key) => localStorage.getItem(key)),
  );
  expect(markers).toHaveLength(1);
  expect(JSON.parse(markers[0]!)).toMatchObject({ operationId, projectId: project.id });
  expect(posts).toBe(1);
  expect(errors).toEqual([]);
});

test('Git 状态读取失败不沿用干净缓存且恢复只读', async ({ page }, testInfo) => {
  let failing = false;
  let reads = 0;
  let writes = 0;
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !(
        message.location().url.endsWith(`/api/v1/projects/${project.id}/git/status`) &&
        message.text().includes('409')
      )
    )
      pageErrors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.includes('/git/') &&
      !['GET', 'HEAD'].includes(request.method())
    )
      writes += 1;
  });
  await page.route(`**/api/v1/projects/${project.id}/git/status`, async (route) => {
    reads += 1;
    await route.fulfill({
      status: failing ? 409 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        failing
          ? { error: { code: 'GIT_STATUS_FAILED', message: 'Git 状态读取失败' } }
          : { data: { branch: 'main', headSha: 'abcdef1234567890', clean: true, entries: [] } },
      ),
    });
  });
  await page.goto(`/workspace/${session.id}?view=changes`);
  await expect(page.getByRole('heading', { name: '审阅更改', exact: true })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await expect(page).toHaveURL(new RegExp(`workspace/${session.id}\\?view=changes$`));
  if ((page.viewportSize()?.width ?? 0) < 1180) {
    await expect(page.getByRole('button', { name: '关闭检查器' })).toBeFocused();
  }
  await expect(page.locator('.git-clean-state')).toHaveText('工作区干净');
  failing = true;
  await page.getByRole('button', { name: '刷新 Git 数据', exact: true }).click();
  await expect(page.getByText(/是否干净尚未确认/)).toBeVisible();
  await expect(page.getByText('工作区干净', { exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator('.git-clean-state').evaluate((node) => node.classList.contains('clean')),
    )
    .toBe(false);
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'workspace-git-status-error');
  failing = false;
  await page.getByRole('button', { name: '刷新 Git 数据', exact: true }).click();
  await expect(page.locator('.git-clean-state')).toHaveText('工作区干净');
  await expect(page.getByText(/是否干净尚未确认/)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'workspace-git-status-recovered');
  expect(reads).toBeGreaterThanOrEqual(3);
  expect(writes).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('Projects 辅助来源失败不伪装为空且可以只读恢复', async ({ page }, testInfo) => {
  let failing = true;
  let writes = 0;
  await page.route(/\/api\/v1\/(tasks|sessions|agents)$/, async (route) => {
    if (route.request().method() !== 'GET') {
      writes += 1;
      await route.fallback();
      return;
    }
    if (failing)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '辅助来源暂时不可用' } }),
      });
    else await route.fallback();
  });
  await page.goto('/projects');
  const status = page.getByRole('alert', { name: '工作统计读取状态' });
  await expect(status).toBeVisible({ timeout: SHELL_READY_TIMEOUT });
  await expect(page.getByRole('link').filter({ hasText: project.name }).first()).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) >= 1024)
    await expect(
      page.getByRole('region', { name: '项目列表' }).getByText('未知').first(),
    ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const sourceGroup = page.getByRole('group', { name: '项目辅助数据读取状态' });
  const buttonHeights: number[] = [];
  for (const label of ['工作统计', '会话记录', 'Agent 登记']) {
    const error = page.getByRole('alert', { name: `${label}读取状态` });
    await expect(error).toBeVisible();
    await expect(error).toHaveAccessibleDescription(
      '读取失败不代表没有记录；重试只重新读取对应数据。',
    );
    const retry = error.getByRole('button', { name: `重新读取${label}`, exact: true });
    await expect(retry).toBeVisible();
    const visibleLabel = (await retry.innerText()).trim();
    expect(await retry.getAttribute('aria-label')).toContain(visibleLabel);
    const box = await retry.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    buttonHeights.push(box!.height);
  }
  const sourceBox = await sourceGroup.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(sourceBox!.height).toBeLessThan((page.viewportSize()?.height ?? 844) * 0.3);
  await testInfo.attach('projects-source-layout', {
    body: JSON.stringify({ group: sourceBox, buttonHeights }),
    contentType: 'application/json',
  });
  await attachViewportScreenshot(page, testInfo, 'projects-source-error');
  failing = false;
  for (const label of ['工作统计', '会话记录', 'Agent 登记']) {
    await page.getByRole('button', { name: `重新读取${label}`, exact: true }).click();
    await expect(page.getByRole('alert', { name: `${label}读取状态` })).toHaveCount(0);
  }
  if ((page.viewportSize()?.width ?? 1440) >= 1024)
    await expect(page.getByText('全局登记就绪', { exact: true })).toBeVisible();
  expect(writes).toBe(0);
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'projects-source-recovered');
});

test('Projects 使用高密度实体列表并打开路由弹层', async ({ page }, testInfo) => {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: '项目' })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  const list = page.getByRole('region', { name: '项目列表' });
  await expect(list).toBeVisible({ timeout: SHELL_READY_TIMEOUT });
  if ((page.viewportSize()?.width ?? 1_000) >= 768) {
    await expect(list.getByText('最近会话分支')).toBeVisible({ timeout: SHELL_READY_TIMEOUT });
    await expect(list.getByText('工作')).toBeVisible({ timeout: SHELL_READY_TIMEOUT });
    await expect(list.getByText('最近活动', { exact: true }).first()).toBeVisible({
      timeout: SHELL_READY_TIMEOUT,
    });
    await expect(list.getByText('feature/agent-discovery')).toBeVisible({
      timeout: SHELL_READY_TIMEOUT,
    });
  }
  if ((page.viewportSize()?.width ?? 1_000) >= 1_024)
    await expect(list.getByText('Agent', { exact: true })).toBeVisible();
  await expect(list.locator('a').filter({ hasText: project.name }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page
    .getByRole('link', { name: /新建项目/ })
    .first()
    .click();
  await expect(page).toHaveURL('/projects/new');
  await expect(page.getByRole('dialog', { name: '创建项目' })).toBeVisible();
  if (page.viewportSize()?.width === 390) {
    const originalViewport = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 600 });
    const geometry = await assertFullscreenScroll(
      page,
      page.getByRole('dialog', { name: '创建项目' }),
    );
    await testInfo.attach('project-create-fullscreen-short-geometry', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    await attachViewportScreenshot(page, testInfo, 'project-create-fullscreen-short');
    await page.setViewportSize(originalViewport);
  }
  await page.goBack();
  await expect(page.getByRole('dialog', { name: '创建项目' })).toBeHidden();
  await attachViewportScreenshot(page, testInfo, 'projects');
});

test('Overview Agent来源失败保持工作会话入口并可只读恢复', async ({ page }, testInfo) => {
  let failing = true;
  let agentWrites = 0;
  await page.route('**/api/v1/agents', async (route) => {
    if (route.request().method() !== 'GET') {
      agentWrites += 1;
      await route.fallback();
      return;
    }
    if (failing)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Agent来源暂时不可用' } }),
      });
    else await route.fallback();
  });
  await page.route('**/api/v1/tasks?*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ ...task, status: 'IN_PROGRESS' }] }),
    });
  });
  await page.goto(`/projects/${project.id}/overview`);
  const error = page.getByRole('alert', { name: 'Agent 姓名读取状态' });
  await expect(error).toBeVisible({ timeout: SHELL_READY_TIMEOUT });
  const assigned = page
    .getByRole('link')
    .filter({ hasText: task.title })
    .filter({ hasText: 'Agent 信息未知' })
    .first();
  await expect(assigned).toBeVisible();
  await expect(assigned).toHaveAttribute('href', `/projects/${project.id}/work?task=${task.id}`);
  const sessionLink = page
    .locator(`a[href="/workspace/${session.id}"]`)
    .filter({ hasText: session.title });
  await expect(sessionLink).toContainText('Agent 信息未知');
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'project-overview-agent-error');
  failing = false;
  await error.getByRole('button', { name: '重新读取 Agent 信息' }).click();
  await expect(error).toHaveCount(0);
  await expect(sessionLink).toContainText(agent.name);
  expect(agentWrites).toBe(0);
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'project-overview-agent-recovered');
});

test('Project Context 仅保留 Overview、Work、Sessions', async ({ page }, testInfo) => {
  await page.goto(`/projects/${project.id}/overview`);
  const compactHeader = (page.viewportSize()?.width ?? 1_000) < 768;
  if (compactHeader) {
    const summary = page.locator('summary').filter({ hasText: '项目详情' });
    await expect(summary).toBeVisible();
    await expect(page.getByRole('link', { name: '编辑类型' })).toHaveCount(0);
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: '编辑类型' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await attachViewportScreenshot(page, testInfo, 'project-header-expanded');
  }
  await expect(page.getByText('1 个登记可用 Agent', { exact: true })).toBeVisible();
  if (compactHeader) {
    const summary = page.locator('summary').filter({ hasText: '项目详情' });
    await summary.focus();
    await page.keyboard.press('Space');
    await expect(page.getByText('1 个登记可用 Agent', { exact: true })).toBeHidden();
    const tabs = await page.getByRole('navigation', { name: '项目上下文' }).boundingBox();
    expect(tabs).not.toBeNull();
    expect(tabs!.y + tabs!.height).toBeLessThan(270);
  }
  await expect(
    page.getByText('登记状态下 1 个可用；运行前仍需预检', { exact: true }),
  ).toBeVisible();
  const context = page.getByRole('navigation', { name: '项目上下文' });
  await expect(context.getByRole('link')).toHaveText(['概览', '工作', '会话'], {
    timeout: SHELL_READY_TIMEOUT,
  });
  await expect(context.getByRole('link', { name: 'Prompt' })).toHaveCount(0);
  await expect(context.getByRole('link', { name: '设置' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '待审阅' })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await expect(page.getByRole('link', { name: /feature\/agent-discovery/ })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'project-overview');
  if (compactHeader) {
    await page.route(`**/api/v1/projects/${project.id}/agent-eligibility`, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '资格服务暂时不可用' } }),
      });
    });
    await page.reload();
    await expect(page.getByText('Agent 资格读取失败', { exact: true })).toBeVisible({
      timeout: SHELL_READY_TIMEOUT,
    });
    await expect(page.getByRole('link', { name: '编辑类型' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '新建工作', exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await attachViewportScreenshot(page, testInfo, 'project-header-warning');
  }
});

test('Work 保持 List-first、可恢复审阅筛选且中屏不横向溢出', async ({ page }, testInfo) => {
  await page.goto(`/projects/${project.id}/work?status=WAITING_REVIEW`);
  // ProjectContextLayout loads the project shell before the nested Work route;
  // wait for that real readiness boundary instead of racing the 5s assertion
  // against the context skeleton on slower NAS workers.
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await expect(page.getByRole('link', { name: '工作', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('button', { name: '列表' })).toHaveAttribute('aria-pressed', 'true');
  const compactWork = (page.viewportSize()?.width ?? 1_000) < 768;
  const singlePaneWork = (page.viewportSize()?.width ?? 1_000) < 1024;
  const workFilters = page.getByRole('button', { name: '筛选（1）', exact: true });
  if (compactWork) {
    await expect(workFilters).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('combobox', { name: '工作状态' })).toHaveCount(0);
    await workFilters.click();
    await expect(workFilters).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(page.getByRole('combobox', { name: '工作状态' })).toContainText('待审阅');
  if (compactWork) {
    await attachViewportScreenshot(page, testInfo, 'project-work-filters-open');
    await workFilters.click();
    await expect(workFilters).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(page.getByRole('region', { name: '工作列表' })).toContainText(task.title);
  if (singlePaneWork) {
    await expect(page.getByRole('complementary', { name: '工作 Inspector' })).toBeHidden();
    await attachViewportScreenshot(page, testInfo, 'project-work-list');
    await page
      .getByRole('region', { name: '工作列表' })
      .getByRole('button', { name: new RegExp(task.title) })
      .click();
    await expect(page.getByRole('button', { name: '返回工作列表' })).toBeVisible();
    await expect(page.getByRole('region', { name: '工作列表' })).toBeHidden();
  }
  await expect(page.getByRole('complementary', { name: '工作 Inspector' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'project-work');
  if (singlePaneWork) {
    const inspector = page.getByRole('complementary', { name: '工作 Inspector' });
    const back = page.getByRole('button', { name: '返回工作列表' });
    await expect(back).toHaveCSS('margin-left', '16px');
    if (compactWork) {
      const backBox = await back.boundingBox();
      expect(backBox).not.toBeNull();
      expect(backBox!.x).toBeGreaterThanOrEqual(16);
      await expect(inspector).toHaveCSS('border-left-width', '0px');
    }
    await back.click();
    await expect(page.getByRole('region', { name: '工作列表' })).toBeVisible();
    await expect(inspector).toBeHidden();
    const returnedURL = new URL(page.url());
    expect(returnedURL.searchParams.has('task')).toBe(false);
    expect(returnedURL.searchParams.get('status')).toBe('WAITING_REVIEW');
    if (compactWork) await expect(workFilters).toHaveAttribute('aria-expanded', 'false');
    else await expect(page.getByRole('combobox', { name: '工作状态' })).toContainText('待审阅');
    const selectedRow = page
      .getByRole('region', { name: '工作列表' })
      .getByRole('button', { name: new RegExp(task.title) });
    await expect(selectedRow).toBeVisible();
    await expect(selectedRow).toBeFocused();
    await expectNoHorizontalOverflow(page);
    await attachViewportScreenshot(page, testInfo, 'project-work-back-list');

    await selectedRow.click();
    await expect(inspector).toBeVisible();
    await page.route(`**/api/v1/projects/${project.id}/agent-eligibility`, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '资格服务暂时不可用' } }),
      });
    });
    await page.reload();
    await expect(inspector).toBeVisible({ timeout: SHELL_READY_TIMEOUT });
    await expect(page.getByText('Agent 资格读取失败', { exact: true })).toBeVisible({
      timeout: SHELL_READY_TIMEOUT,
    });
    await expect(page.getByRole('navigation', { name: '项目上下文' })).toBeHidden();
    await expect(back).toBeVisible();
    await back.focus();
    await expect(back).toBeFocused();
    await expect(back).toHaveCSS('box-shadow', 'none');
    await expect(back).toHaveCSS('outline-width', '2px');
    await expect(back).toHaveCSS('border-radius', '6px');
    // Warnings must remain accessible in detail, but may legitimately increase page height.
    await expectNoHorizontalOverflow(page);
    await attachViewportScreenshot(page, testInfo, 'project-work-detail-warning');
  }
});

test('Sessions 按时间组织并可恢复 Workspace', async ({ page }, testInfo) => {
  await page.goto(`/projects/${project.id}/sessions`);
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  const sessionLink = page.getByRole('link', { name: /Agent Discovery 交互优化/ });
  await expect(sessionLink).toBeVisible({ timeout: SHELL_READY_TIMEOUT });
  await expect(page.getByRole('link', { name: '会话', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(sessionLink).toContainText('Codex');
  await expect(sessionLink).toHaveAttribute('href', `/workspace/${session.id}`);
  await expectNoHorizontalOverflow(page);
  await expect(sessionLink.locator('time')).toBeVisible();
  await expect(sessionLink.locator('time')).toHaveAttribute('datetime', session.lastActiveAt);
  const sessionStatus = await sessionLink.getByRole('status').boundingBox();
  const sessionDate = await sessionLink.locator('time').boundingBox();
  expect(sessionStatus).not.toBeNull();
  expect(sessionDate).not.toBeNull();
  expect(
    sessionDate!.x >= sessionStatus!.x + sessionStatus!.width + 6 ||
      sessionDate!.y >= sessionStatus!.y + sessionStatus!.height + 6,
    'session status and activity time must not overlap',
  ).toBe(true);
  await attachViewportScreenshot(page, testInfo, 'project-sessions');
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    const toggle = page.getByRole('button', { name: /^筛选(?:（\d+）)?$/ });
    const status = page.getByRole('combobox', { name: '会话状态', exact: true });
    await expect(status).toBeHidden();
    await expect(page.getByRole('button', { name: '新建会话', exact: true })).toBeVisible();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await status.click();
    await page.getByRole('option', { name: '待审阅', exact: true }).click();
    await expect(toggle).toHaveText('筛选（1）');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(status).toBeHidden();
    await expect(sessionLink).toBeVisible();
    await attachViewportScreenshot(page, testInfo, 'project-sessions-filtered');
    await page.getByRole('button', { name: '清除条件', exact: true }).click();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveText('筛选');
    await expect(page.getByRole('link', { name: /Workspace 三栏视觉校准/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await attachViewportScreenshot(page, testInfo, 'project-sessions-cleared');
  } else {
    await expect(page.getByRole('combobox', { name: '会话 Agent', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '会话状态', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '筛选', exact: true })).toHaveCount(0);
  }
});

test('Prompt Library 保持两栏主舞台并将生命周期移入临时面板', async ({ page }, testInfo) => {
  await page.goto(`/prompts?projectId=${project.id}&tab=bindings`);
  await expect(page.getByRole('heading', { name: 'Prompt 库' })).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  if ((page.viewportSize()?.width ?? 1_000) < 768) {
    await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
  } else {
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  }
  const tabs = page.getByRole('tablist', { name: 'Prompt 资产分区' });
  await expect(tabs.getByRole('tab')).toHaveText(['内容', '变量', 'Playground', '绑定']);
  await expect(tabs.getByRole('tab', { name: '绑定' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Prompt 编辑器' })).toContainText(project.name);
  await expect(tabs.getByRole('tab', { name: '版本' })).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1_000) < 768) {
    const toggle = page.getByRole('button', { name: '展开目录', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('textbox', { name: '搜索 Prompt' })).toHaveCount(0);
    const directoryBox = await page
      .getByRole('complementary', { name: 'Prompt 目录' })
      .boundingBox();
    expect(directoryBox).not.toBeNull();
    expect(directoryBox!.height).toBeLessThanOrEqual(100);
    const tabsBox = await tabs.boundingBox();
    expect(tabsBox).not.toBeNull();
    expect(tabsBox!.y + tabsBox!.height).toBeLessThan(620);
    await toggle.focus();
    await page.keyboard.press('Enter');
    const search = page.getByRole('textbox', { name: '搜索 Prompt' });
    await expect(search).toBeVisible();
    await search.fill('安全');
    await expect(search).toHaveCSS('box-shadow', 'none');
    await expect(search.locator('..')).not.toHaveCSS('box-shadow', 'none');
    await attachViewportScreenshot(page, testInfo, 'prompts-directory-open');
    await search.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Space');
    await expect(search).toHaveValue('安全');
    await search.fill('');
    await search.press('Escape');
    await expect(tabs.getByRole('tab', { name: '绑定' })).toHaveAttribute('aria-selected', 'true');
  }

  const editor = page.getByRole('region', { name: 'Prompt 编辑器' });
  const assetDetails = editor.locator('details').filter({
    has: page.locator('summary', { hasText: '资产详情与操作' }),
  });
  const detailsToggle = assetDetails.locator('summary');
  await expect(assetDetails).not.toHaveAttribute('open', '');
  await detailsToggle.focus();
  await detailsToggle.press('Enter');
  await expect(assetDetails).toHaveAttribute('open', '');
  const lifecycleTrigger = assetDetails.getByRole('button', { name: '版本与标签', exact: true });
  await expect(lifecycleTrigger).toBeVisible();
  await lifecycleTrigger.click();
  const lifecycle = page.getByRole('dialog', { name: '版本与标签' });
  await expect(lifecycle.getByRole('heading', { name: '版本历史' })).toBeVisible();
  await expect(lifecycle).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(lifecycle).toHaveCSS('opacity', '1');
  await expect(lifecycle.getByText('production', { exact: true })).toBeVisible();
  await expect(lifecycle.getByRole('heading', { name: '版本比较' })).toBeVisible();
  await expect(lifecycle.getByText('+请优先识别安全、数据一致性和回归风险。')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'prompts-lifecycle');
  await page.keyboard.press('Escape');
  await expect(lifecycle).toBeHidden({ timeout: SHELL_READY_TIMEOUT });
  await expect(lifecycleTrigger).toBeVisible();
  await expect(lifecycleTrigger).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'prompts');
});

test('Settings token读取失败不伪装为空，重试只读恢复', async ({ page }, testInfo) => {
  let failing = true;
  let writes = 0;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.startsWith('/api/v1/auth/tokens') &&
      request.method() !== 'GET'
    )
      writes += 1;
  });
  await page.route('**/api/v1/auth/tokens', async (route) => {
    if (!failing) return route.fallback();
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'token列表暂时不可用' } }),
    });
  });
  await page.goto('/settings/integrations');
  const tokenReadError = page.getByRole('alert').filter({ hasText: '无法确认现有 API token' });
  await expect(tokenReadError).toBeVisible({
    timeout: SHELL_READY_TIMEOUT,
  });
  await expect(page.getByText('读取失败不代表没有已生效的 token。', { exact: true })).toBeVisible();
  await expect(page.getByText('还没有 API token。', { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'settings-token-read-error');
  failing = false;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByText('还没有 API token。', { exact: true })).toBeVisible();
  await expect(tokenReadError).toHaveCount(0);
  expect(writes).toBe(0);
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'settings-token-read-recovered');
});

test('Settings 使用窄本地导航和单一内容列', async ({ page }, testInfo) => {
  await page.goto('/settings/appearance');
  const navigation = page.getByRole('navigation', { name: '设置分区' });
  await expect(navigation.locator('strong')).toHaveText([
    '外观',
    '账号',
    '安全',
    '集成',
    '系统',
    '高级',
  ]);
  await expect(page.getByRole('heading', { name: '外观' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '账户' })).toBeHidden();

  const viewportWidth = page.viewportSize()?.width ?? 0;
  if (viewportWidth > 1_060) {
    const width = await navigation.evaluate((element) => element.getBoundingClientRect().width);
    expect(width).toBeGreaterThanOrEqual(180);
    expect(width).toBeLessThanOrEqual(192);
  } else if (viewportWidth >= 761) {
    const width = await navigation.evaluate((element) => element.getBoundingClientRect().width);
    expect(width).toBeGreaterThanOrEqual(164);
    expect(width).toBeLessThanOrEqual(172);
  }

  await navigation.getByRole('link').filter({ hasText: '安全' }).click();
  await expect(page).toHaveURL('/settings/security');
  await expect(page.getByRole('heading', { name: '安全' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '外观' })).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'settings-security');
});

test('核心页面没有 serious 或 critical axe 问题', async ({ page }, testInfo) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const routes = [
    '/home',
    '/projects',
    '/agents',
    '/agents/runtime',
    '/agents/nodes',
    `/projects/${project.id}/overview`,
    `/projects/${project.id}/work`,
    `/projects/${project.id}/sessions`,
    '/prompts',
    '/settings/appearance',
  ];
  const violations: Array<Record<string, unknown>> = [];

  for (const path of routes) {
    await page.goto(path);
    await page.locator('#main-content').waitFor();
    // Avoid sampling a control mid-transition, which can create a transient false contrast failure.
    await page.waitForTimeout(250);
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
  } else if (path.endsWith(`/projects/${project.id}/agent-eligibility`)) {
    data = {
      projectId: project.id,
      basis: 'REGISTERED_STATE',
      livePreflight: false,
      agents: [
        {
          agentId: agent.id,
          eligible: true,
          reason: null,
          agentStatus: 'READY',
          targetStatus: 'READY',
        },
      ],
    };
  } else if (path.endsWith(`/projects/${project.id}/preflight`)) {
    data = {
      status: 'READY',
      git: { detected: true, branch: 'main', dirty: false },
      permissions: { readable: true, writable: true },
      checks: [],
    };
  } else if (path.endsWith(`/projects/${project.id}`)) data = project;
  else if (path.endsWith(`/sessions/${session.id}/configuration`)) {
    data = {
      supported: true,
      current: { model: 'gpt-5.6-sol', mode: 'code', reasoningEffort: 'high' },
      options: {
        models: [{ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }],
        modes: [{ id: 'code', label: 'Code' }],
        reasoningEfforts: [{ id: 'high', label: 'High' }],
      },
    };
  } else if (path.endsWith(`/sessions/${session.id}/messages`)) data = conversationMessages;
  else if (path.endsWith(`/sessions/${session.id}/runs`)) data = [];
  else if (path.endsWith(`/sessions/${session.id}/events`)) data = conversationEvents;
  else if (path.endsWith(`/sessions/${session.id}`)) data = session;
  else if (path.endsWith(`/projects/${project.id}/git/status`))
    data = {
      branch: 'feature/agent-discovery',
      upstream: 'origin/feature/agent-discovery',
      headSha: 'abcdef1234567890',
      clean: false,
      entries: [
        {
          index: ' ',
          worktree: 'M',
          path: 'apps/web/src/features/workspace/workspace.module.css',
          worktreeStats: { additions: 164, deletions: 97 },
        },
        {
          index: 'M',
          worktree: ' ',
          path: 'apps/web/src/features/workspace/pages/WorkspacePage.tsx',
          stagedStats: { additions: 28, deletions: 14 },
        },
        {
          index: ' ',
          worktree: 'M',
          path: 'tests/e2e/web-shell.spec.ts',
          worktreeStats: { additions: 42, deletions: 8 },
        },
      ],
    };
  else if (path.endsWith(`/projects/${project.id}/git/diff`))
    data = {
      patch:
        'diff --git a/workspace.module.css b/workspace.module.css\n--- a/workspace.module.css\n+++ b/workspace.module.css\n@@ -1,3 +1,4 @@\n .workspace {\n-  display: block;\n+  display: grid;\n+  min-width: 0;\n }\n',
      truncated: false,
      staged: url.searchParams.get('staged') === 'true',
    };
  else if (path.endsWith(`/projects/${project.id}/files/content`))
    data = {
      path: url.searchParams.get('path') ?? '',
      content: '.workspace {\n  display: grid;\n  grid-template-columns: auto 1fr auto;\n}\n',
    };
  else if (path.endsWith(`/projects/${project.id}/files`))
    data = [
      {
        name: 'apps',
        path: 'apps',
        type: 'DIRECTORY',
        children: [
          {
            name: 'workspace.module.css',
            path: 'apps/web/src/features/workspace/workspace.module.css',
            type: 'FILE',
          },
          {
            name: 'WorkspacePage.tsx',
            path: 'apps/web/src/features/workspace/pages/WorkspacePage.tsx',
            type: 'FILE',
          },
        ],
      },
      { name: 'package.json', path: 'package.json', type: 'FILE' },
    ];
  else if (path.endsWith('/prompt-context/resolve'))
    data = { ready: true, finalContext: '', missingVariables: [], items: [] };
  else if (path.endsWith(`/prompts/${prompt.id}/versions`))
    data = [promptVersion, priorPromptVersion];
  else if (path.endsWith(`/prompts/${prompt.id}/diff`)) {
    data = {
      fromContent: priorPromptVersion.contentJson,
      toContent: promptVersion.contentJson,
      patch:
        '@@ -1,3 +1,3 @@\n-你是一名代码审阅者。\n+你是一名资深代码审阅者。\n-请识别安全和回归风险。\n+请优先识别安全、数据一致性和回归风险。',
    };
  } else if (path.endsWith(`/prompts/${prompt.id}/labels`)) data = [promptLabel];
  else if (path.endsWith('/prompt-bindings')) data = [promptBinding];
  else if (path.endsWith('/discovery/agents')) data = [agentCandidate];
  else if (path.endsWith('/discovery/runtimes')) data = [runtimeCandidate];
  else if (path.endsWith('/remote-nodes')) data = [remoteNode];
  else if (path.endsWith('/projects')) data = [project];
  else if (path.endsWith('/tasks')) data = [task];
  else if (path.endsWith('/sessions')) data = sessionHistory;
  else if (path.endsWith('/agents')) data = [agent];
  else if (path.endsWith('/goals')) data = [];
  else if (path.endsWith('/worktree-executions')) data = [worktree];
  else if (path.endsWith('/prompts')) data = [prompt];
  else if (path.endsWith('/auth/tokens')) data = [];
  else if (path.endsWith('/settings/capabilities')) {
    data = {
      terminal: { available: true, message: 'Terminal 可用', platform: 'linux', arch: 'arm64' },
      remoteNode: { available: true },
    };
  } else if (path.endsWith('/execution-targets')) data = [];
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
