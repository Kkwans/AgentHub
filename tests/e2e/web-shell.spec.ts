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

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', fulfillFixture);
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

test('Home 以工作续接为主舞台', async ({ page }, testInfo) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: '继续工作' })).toBeVisible();
  await expect(page.getByRole('link', { name: '继续最近会话' })).toHaveAttribute(
    'href',
    `/workspace/${session.id}`,
  );
  await expect(page.getByText('需要处理', { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'home');
});

test('Agent Center 收敛 Discovery、Runtime 与 Remote Nodes', async ({ page }, testInfo) => {
  await page.goto('/agents');
  await expect(page.getByRole('heading', { name: 'Agent 中心' })).toBeVisible();
  await expect(page.getByText('Codex', { exact: true }).first()).toBeVisible();
  if ((page.viewportSize()?.width ?? 1_000) >= 641) {
    await expect(page.getByRole('link', { name: '运行环境' })).toHaveAttribute(
      'href',
      '/agents/runtime',
    );
  }

  await page.getByRole('link', { name: '发现 Agent' }).click();
  await expect(page).toHaveURL('/agents/agents/discover');
  await expect(page.getByRole('dialog', { name: '发现 Agent' })).toContainText('Codex Local');
  await page.goBack();
  await expect(page.getByRole('dialog', { name: '发现 Agent' })).toBeHidden();

  await page.goto('/agents/runtime');
  await expect(page.getByRole('heading', { name: 'Runtime' })).toBeVisible();
  await expect(page.getByText('Local Host', { exact: true })).toBeVisible();
  await page.goto('/agents/nodes');
  await expect(page.getByRole('heading', { name: 'Remote Nodes' })).toBeVisible();
  await expect(page.getByText('NAS-01')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'agent-nodes');
});

test('Workspace 保持 Conversation 主舞台并恢复面板状态', async ({ page }, testInfo) => {
  await page.goto(`/workspace/${session.id}`);
  await expect(page.getByText(session.title, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: '给 Agent 发送工程指令' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
  await expect(page.locator('.tool-execution-group')).toHaveCount(1);
  await expect(page.locator('.tool-event-group-list li')).toHaveCount(4);
  await expect(page.locator('.tool-summary')).toHaveCount(0);
  await expect(page.locator('.message.assistant').last().locator('strong')).toHaveText(
    '关键校正已完成：',
  );
  const thought = page.locator('.thought-event-row');
  await expect(thought).toHaveCount(1);
  await expect(thought).not.toHaveAttribute('open', '');
  await expect(thought.getByText('思考了 32 秒')).toBeVisible();
  await thought.locator('summary').click();
  await expect(thought).toHaveAttribute('open', '');
  await expect(thought.getByText(/先对照 Codex 的主舞台宽度/)).toBeVisible();
  await thought.locator('summary').click();
  const firstTool = page.locator('.tool-event-row').first();
  await expect(firstTool).not.toHaveAttribute('open', '');
  await firstTool.locator('summary').click();
  await expect(firstTool).toHaveAttribute('open', '');
  await firstTool.locator('summary').click();
  const userMessageBox = await page.locator('.message.user').last().boundingBox();
  const assistantMessageBox = await page.locator('.message.assistant').last().boundingBox();
  expect(userMessageBox, '用户消息应可见').not.toBeNull();
  expect(assistantMessageBox, 'Agent 消息应可见').not.toBeNull();
  expect(userMessageBox!.x).toBeGreaterThan(assistantMessageBox!.x + 32);
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
  if (viewportWidth < 1_180) {
    expect(conversationGeometry?.left).toBeLessThanOrEqual(4);
  }
  if (viewportWidth < 900) {
    expect(conversationGeometry?.width).toBeGreaterThanOrEqual(viewportWidth - 1);
  }
  if (viewportWidth < 768) {
    await expect(page.locator('.composer-select-reasoning')).toBeHidden();
    await expect(page.locator('.composer-permission')).toBeHidden();
  }
  await attachViewportScreenshot(page, testInfo, 'workspace-initial');

  if (viewportWidth >= 1_280) {
    await expect(page.getByRole('button', { name: '折叠检查器' })).toBeVisible();
    const inspector = page.getByRole('tablist', { name: '检查器视图' });
    await expect(inspector.getByRole('tab', { name: '变更' })).toBeVisible();
    await expect(inspector.getByRole('tab', { name: '文件' })).toBeVisible();
    await expect(inspector.getByRole('tab', { name: '活动' })).toBeVisible();
    await expect(inspector.getByRole('tab', { name: 'Run' })).toBeVisible();
    await attachViewportScreenshot(page, testInfo, 'workspace-three-column');
    await inspector.getByRole('tab', { name: '文件' }).click();
    const appsDirectory = page.getByRole('button', { name: 'apps', exact: true });
    await expect(appsDirectory).toHaveAttribute('aria-expanded', 'true');
    await appsDirectory.click();
    await expect(appsDirectory).toHaveAttribute('aria-expanded', 'false');
    await appsDirectory.click();
    await page.getByRole('button', { name: 'workspace.module.css', exact: true }).click();
    await expect(page.locator('.file-preview-header')).toContainText('workspace.module.css');
    await attachViewportScreenshot(page, testInfo, 'workspace-files');
    await page.getByRole('button', { name: '折叠会话列表' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: '展开会话列表' })).toBeVisible();
    await page.getByRole('button', { name: '展开会话列表' }).click();
  } else if (viewportWidth >= 900) {
    const inspector = page.getByRole('tablist', { name: '检查器视图' });
    await inspector.getByRole('tab', { name: '文件' }).click();
    await expect(page).toHaveURL(new RegExp(`workspace/${session.id}\\?view=files`));
  } else if (viewportWidth >= 680) {
    await page.getByRole('button', { name: '打开检查器' }).click();
    await expect(page.getByRole('button', { name: '关闭检查器' })).toBeVisible();
    await page
      .getByRole('tablist', { name: '检查器视图' })
      .getByRole('tab', { name: '文件' })
      .click();
    await expect(page).toHaveURL(new RegExp(`workspace/${session.id}\\?view=files`));
  } else {
    const views = page.getByRole('tablist', { name: 'Workspace 视图' });
    await views.getByRole('tab', { name: '文件' }).click();
    await expect(page).toHaveURL(new RegExp(`workspace/${session.id}\\?view=files`));
  }

  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'workspace');
});

test('Projects 使用高密度实体列表并打开路由弹层', async ({ page }, testInfo) => {
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
  await expect(list.locator('a').filter({ hasText: project.name }).first()).toBeVisible();
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

test('Prompt Library 保持两栏主舞台并将生命周期移入临时面板', async ({ page }, testInfo) => {
  await page.goto(`/prompts?projectId=${project.id}&tab=bindings`);
  await expect(page.getByRole('heading', { name: 'Prompt 库' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Prompt 资产分区' });
  await expect(tabs.getByRole('tab')).toHaveText(['内容', '变量', 'Playground', '绑定']);
  await expect(tabs.getByRole('tab', { name: '绑定' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Prompt 编辑器' })).toContainText(project.name);
  await expect(tabs.getByRole('tab', { name: '版本' })).toHaveCount(0);

  await page.getByRole('button', { name: '版本与标签' }).click();
  const lifecycle = page.getByRole('dialog', { name: '版本与标签' });
  await expect(lifecycle.getByRole('heading', { name: '版本历史' })).toBeVisible();
  await expect(lifecycle.getByText('production', { exact: true })).toBeVisible();
  await expect(lifecycle.getByRole('heading', { name: '版本比较' })).toBeVisible();
  await expect(lifecycle.getByText('+请优先识别安全、数据一致性和回归风险。')).toBeVisible();
  await lifecycle.press('Escape');
  await expect(lifecycle).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await attachViewportScreenshot(page, testInfo, 'prompts');
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
