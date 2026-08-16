// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

let realtimeListener: ((event: Record<string, unknown>) => void) | undefined;
const localTrustedAuthStatus = {
  mode: 'local_trusted',
  localTrusted: true,
  setupRequired: false,
  authenticated: true,
  user: null,
};

vi.mock('./lib/realtime', () => ({
  realtime: {
    onState(listener: (state: '已连接') => void) {
      listener('已连接');
      return () => undefined;
    },
    subscribe(_topic: string, listener: (event: Record<string, unknown>) => void) {
      realtimeListener = listener;
      return () => {
        if (realtimeListener === listener) realtimeListener = undefined;
      };
    },
    reconnect() {},
    disconnect() {},
  },
}));

// App routing tests exercise page behavior, not Monaco itself. Keeping the
// editor runtime out of this suite prevents route-level lazy imports from
// dominating Testing Library's interaction deadlines on the ARM64 NAS.
vi.mock('./lib/monaco', () => ({}));
vi.mock('@monaco-editor/react', () => ({
  default: () => null,
  DiffEditor: () => null,
  loader: { config: () => undefined },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  realtimeListener = undefined;
});

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="当前地址">
      {location.pathname}
      {location.search}
    </output>
  );
}

const journeyProject = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'AgentHub',
  description: 'AgentHub 工程控制台',
  targetId: '22222222-2222-4222-8222-222222222222',
  rootPath: '/volume2/Project/AgentHub',
  realRootPath: '/volume2/Project/AgentHub',
  repoKind: 'GIT',
  status: 'ACTIVE',
};
const journeyTarget = {
  id: journeyProject.targetId,
  name: 'NAS 宿主机',
  kind: 'LOCAL_HOST',
  hostname: 'nas',
  os: 'linux',
  arch: 'arm64',
  status: 'READY',
  containerName: null,
  expectedContainerId: null,
  startPolicy: null,
  workspaceMappingsJson: [],
  capabilitiesJson: {},
  connectionJson: {},
  lastSeenAt: '2026-08-11T00:00:00.000Z',
};
const journeyAgent = {
  id: '33333333-3333-4333-8333-333333333333',
  targetId: journeyProject.targetId,
  name: 'Codex 主力',
  agentKind: 'CODEX',
  adapterKind: 'ACP_STDIO',
  status: 'READY',
  enabled: true,
  detectedVersion: '1.1.14',
  defaultModel: 'gpt-5-codex',
  defaultMode: 'default',
  capabilitiesJson: { configuration: { models: true, modes: true } },
  lastPreflightAt: '2026-08-11T00:00:00.000Z',
};

describe('App', () => {
  it('命令面板支持键盘打开、筛选并跳转', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(
            JSON.stringify({
              data: String(input).endsWith('/auth/status') ? localTrustedAuthStatus : [],
              requestId: 'command-ui-test',
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/projects']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByRole('heading', { name: '项目' }, { timeout: 5_000 });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: '搜索与跳转' })).toBeInTheDocument();
    const input = await screen.findByRole('combobox', { name: '搜索页面' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'Prompt' } });
    fireEvent.click(screen.getByRole('option', { name: /PromptOS/ }));
    expect(await screen.findByRole('heading', { name: 'PromptOS', level: 2 })).toBeInTheDocument();
  });

  it('移动导航使用可关闭的焦点受控 Dialog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(
            JSON.stringify({
              data: String(input).endsWith('/auth/status') ? localTrustedAuthStatus : [],
              requestId: 'mobile-nav-test',
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/projects']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '打开导航' }));
    expect(await screen.findByRole('dialog', { name: '主导航' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭导航' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '主导航' })).not.toBeInTheDocument(),
    );
  });

  it('使用中文导航并渲染目标路由', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(
            JSON.stringify({
              data: String(input).endsWith('/auth/status') ? localTrustedAuthStatus : [],
              requestId: 'task-ui-test',
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/tasks']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('navigation', { name: '一级导航' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '任务' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Goal 与 Task' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建 Task' })).toBeInTheDocument();
  });

  it('PromptOS 空状态来自真实 API 数据层', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: RequestInfo | URL) =>
          new Response(
            JSON.stringify({
              data: String(input).endsWith('/auth/status') ? localTrustedAuthStatus : [],
              requestId: 'ui-test',
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/promptos']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('还没有 Prompt')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'PromptOS', level: 2 })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/v1\/(prompts|projects|agents)$/),
      expect.any(Object),
    );
  });

  it('Workspace 收到实时事件时同步刷新 Session 详情与列表', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const session = {
      id: '55555555-5555-4555-8555-555555555555',
      projectId: '11111111-1111-4111-8111-111111111111',
      agentId: '33333333-3333-4333-8333-333333333333',
      taskId: null,
      externalSessionId: 'external-session',
      title: '实时状态回归',
      cwd: '/volume2/Project/AgentHub',
      branch: 'main',
      status: 'RUNNING',
      model: null,
      mode: null,
      lastSeq: 1,
      createdAt: '2026-08-10T00:00:00.000Z',
      startedAt: '2026-08-10T00:00:00.000Z',
      lastActiveAt: '2026-08-10T00:00:00.000Z',
      closedAt: null,
      archivedAt: null,
    };
    const project = {
      id: session.projectId,
      name: 'AgentHub',
      description: null,
      targetId: '22222222-2222-4222-8222-222222222222',
      rootPath: session.cwd,
      realRootPath: session.cwd,
      repoKind: 'GIT',
      status: 'ACTIVE',
    };
    const agent = {
      id: session.agentId,
      targetId: project.targetId,
      name: 'Codex 主力',
      agentKind: 'CODEX',
      adapterKind: 'ACP_STDIO',
      status: 'READY',
      detectedVersion: '1.1.14',
      defaultModel: null,
      defaultMode: null,
      capabilitiesJson: {},
      lastPreflightAt: '2026-08-10T00:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const pathname = new URL(String(input), 'http://agenthub.test').pathname;
        const data =
          pathname === '/api/v1/auth/status'
            ? localTrustedAuthStatus
            : pathname === `/api/v1/sessions/${session.id}`
              ? session
              : pathname === '/api/v1/sessions'
                ? [session]
                : pathname === '/api/v1/agents'
                  ? [agent]
                  : pathname === '/api/v1/projects'
                    ? [project]
                    : pathname === '/api/v1/settings/capabilities'
                      ? {
                          terminal: {
                            available: false,
                            code: 'PTY_UNAVAILABLE',
                            message: '当前平台不可用',
                            platform: 'linux',
                            arch: 'arm64',
                          },
                        }
                      : pathname === '/api/v1/prompt-context/resolve'
                        ? { ready: true, finalContext: '', missingVariables: [], items: [] }
                        : [];
        return new Response(JSON.stringify({ data, requestId: 'workspace-realtime-test' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/sessions/${session.id}`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect((await screen.findAllByText('实时状态回归')).length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(realtimeListener).toBeTypeOf('function'));
    invalidate.mockClear();
    act(() => realtimeListener?.({ type: 'run.completed' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sessions'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['session', session.id] });
  });

  it('PromptOS 明确呈现创建新版本与中文功能标签', async () => {
    const prompt = {
      id: '11111111-1111-4111-8111-111111111111',
      projectId: null,
      key: 'review/safe-change',
      name: '安全审阅',
      description: '只审阅必要变更',
      kind: 'REVIEW',
      type: 'TEXT',
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        const data = path.endsWith('/auth/status')
          ? localTrustedAuthStatus
          : path.endsWith('/prompts')
            ? [prompt]
            : path.endsWith(`/prompts/${prompt.id}`)
              ? prompt
              : path.endsWith(`/prompts/${prompt.id}/versions`)
                ? []
                : path.endsWith(`/prompts/${prompt.id}/labels`)
                  ? []
                  : [];
        return new Response(JSON.stringify({ data, requestId: 'ui-version-test' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/promptos']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('不可变版本历史');
    expect(screen.getByRole('dialog').textContent).toContain('此操作会创建新版本');
    expect((await screen.findAllByRole('button', { name: '创建新版本' })).length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(await screen.findByRole('tab', { name: '标签' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '上下文预览' })).toBeInTheDocument();
    expect(screen.getByText('不可变版本历史')).toBeInTheDocument();
  });

  it('Prompt 与 Skill 的 Task 绑定使用 Project 内可发现名称，不要求 UUID', async () => {
    const promptId = '11111111-1111-4111-8111-111111111111';
    const versionId = '22222222-2222-4222-8222-222222222222';
    const taskId = '44444444-4444-4444-8444-444444444444';
    const prompt = {
      id: promptId,
      projectId: journeyProject.id,
      key: 'task/review',
      name: 'Task 审阅',
      description: '按 Task 注入验收规则',
      kind: 'REVIEW',
      type: 'TEXT',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    };
    const task = {
      id: taskId,
      projectId: journeyProject.id,
      goalId: null,
      parentId: null,
      title: '可发现绑定目标',
      description: null,
      acceptanceCriteria: null,
      status: 'READY',
      priority: 0,
      assignedAgentId: null,
      sessionId: null,
      finalRunId: null,
      branch: null,
      position: '0',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      completedAt: null,
    };
    const skill = {
      id: '55555555-5555-4555-8555-555555555555',
      projectId: journeyProject.id,
      slug: 'review-skill',
      name: 'Review Skill',
      description: '审阅任务',
      source: 'PROJECT',
      rootPath: '/volume2/Project/AgentHub/.agents/skills/review-skill',
      contentHash: 'a'.repeat(64),
      enabled: true,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input), 'http://agenthub.test').pathname;
      let data: unknown = [];
      if (pathname === '/api/v1/auth/status') data = localTrustedAuthStatus;
      else if (pathname === '/api/v1/prompts') data = [prompt];
      else if (pathname === `/api/v1/prompts/${promptId}`) data = prompt;
      else if (pathname === `/api/v1/prompts/${promptId}/versions`) {
        data = [
          {
            id: versionId,
            promptId,
            version: 1,
            contentJson: { text: '审阅 {{task.title}}' },
            variablesJson: {},
            configJson: {},
            changelog: null,
            source: 'USER',
            contentHash: 'b'.repeat(64),
            createdBy: 'test',
            createdAt: '2026-08-11T00:00:00.000Z',
          },
        ];
      } else if (pathname === `/api/v1/prompts/${promptId}/labels`) {
        data = [
          {
            promptId,
            label: 'latest',
            versionId,
            version: 1,
            updatedAt: '2026-08-11T00:00:00.000Z',
          },
        ];
      } else if (pathname === '/api/v1/projects') data = [journeyProject];
      else if (pathname === '/api/v1/agents') data = [journeyAgent];
      else if (pathname === '/api/v1/tasks') data = [task];
      else if (pathname === '/api/v1/prompt-bindings') {
        data = [
          {
            id: '66666666-6666-4666-8666-666666666666',
            targetType: 'TASK',
            targetId: taskId,
            slot: 'REVIEW',
            promptId,
            selectorType: 'LABEL',
            label: 'latest',
            versionId: null,
            priority: 0,
            enabled: true,
          },
          {
            id: '77777777-7777-4777-8777-777777777777',
            targetType: 'TASK',
            targetId: taskId,
            slot: 'COMMIT',
            promptId,
            selectorType: 'VERSION',
            label: null,
            versionId,
            priority: 2,
            enabled: true,
          },
        ];
      } else if (pathname === '/api/v1/skills') data = [skill];
      else if (pathname === '/api/v1/skill-bindings') data = [];
      return new Response(JSON.stringify({ data, requestId: 'discoverable-binding-test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/promptos?prompt=${promptId}&tab=bindings`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByRole('heading', { name: 'PromptOS', level: 2 }, { timeout: 5_000 });
    await screen.findByRole('tab', { name: '绑定' });
    expect(await screen.findByText('标签：latest')).toBeVisible();
    expect(await screen.findByText('固定版本 v1')).toBeVisible();
    expect(screen.queryByText(`v:${versionId.slice(0, 8)}`)).not.toBeInTheDocument();
    expect(screen.getByText('优先级：2')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '新建绑定' }));
    const bindingDialog = await screen.findByRole('dialog');
    const bindingTargetType = within(bindingDialog).getByRole('combobox', { name: '绑定目标' });
    fireEvent.change(bindingTargetType, { target: { value: 'TASK' } });
    const taskOption = await within(bindingDialog).findByRole('option', {
      name: /可发现绑定目标/,
    });
    expect(taskOption).toBeVisible();
    fireEvent.change(within(bindingDialog).getByRole('combobox', { name: /Task/ }), {
      target: { value: taskId },
    });
    expect(within(bindingDialog).getByText('可发现绑定目标')).toBeVisible();
    expect(screen.queryByPlaceholderText('Task UUID')).not.toBeInTheDocument();
    expect(screen.queryByText(taskId)).not.toBeInTheDocument();

    fireEvent.click(within(bindingDialog).getByRole('button', { name: '取消' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '新建 Prompt 绑定' })).not.toBeInTheDocument(),
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Skill' }), { button: 0 });
    await screen.findByText('扫描 Skill metadata');
    fireEvent.click(await screen.findByRole('button', { name: '新建绑定' }));
    const skillDialog = await screen.findByRole('dialog');
    const skillSelect = within(skillDialog).getByRole('combobox', { name: /Skill/ });
    expect(await within(skillDialog).findByRole('option', { name: 'Review Skill' })).toBeVisible();
    fireEvent.change(skillSelect, { target: { value: skill.id } });
    const skillTargetType = within(skillDialog).getByRole('combobox', { name: '绑定目标' });
    fireEvent.change(skillTargetType, { target: { value: 'TASK' } });
    const skillTaskOption = await within(skillDialog).findByRole('option', {
      name: /可发现绑定目标/,
    });
    expect(skillTaskOption).toBeVisible();
    fireEvent.change(within(skillDialog).getByRole('combobox', { name: /Task/ }), {
      target: { value: taskId },
    });
    expect(screen.queryByPlaceholderText('Task UUID')).not.toBeInTheDocument();
  });

  it('Task 页展示 Worktree 执行轨道与真实 Merge Review 证据', async () => {
    const project = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'AgentHub',
      description: null,
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
      lastPreflightAt: '2026-08-10T00:00:00.000Z',
    };
    const task = {
      id: '44444444-4444-4444-8444-444444444444',
      projectId: project.id,
      goalId: null,
      parentId: null,
      title: '隔离实现 Worktree Runner',
      description: '在任务分支中实现并验证',
      acceptanceCriteria: '人工审阅后合并',
      status: 'WAITING_REVIEW',
      priority: 10,
      assignedAgentId: agent.id,
      sessionId: '55555555-5555-4555-8555-555555555555',
      finalRunId: '66666666-6666-4666-8666-666666666666',
      branch: 'agenthub/task-44444444-77777777',
      position: '0',
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:01:00.000Z',
      completedAt: null,
    };
    const execution = {
      id: '77777777-7777-4777-8777-777777777777',
      taskId: task.id,
      projectId: project.id,
      agentId: agent.id,
      status: 'REVIEW',
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: task.branch,
      worktreePath: '/volume2/Project/.agenthub/worktrees/task',
      sessionId: task.sessionId,
      runId: task.finalRunId,
      mergeCommitSha: null,
      configJson: {},
      errorCode: null,
      errorMessage: null,
      queuedAt: '2026-08-10T00:00:00.000Z',
      startedAt: '2026-08-10T00:00:01.000Z',
      reviewReadyAt: '2026-08-10T00:01:00.000Z',
      mergeStartedAt: null,
      completedAt: null,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:01:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const pathname = new URL(String(input), 'http://agenthub.test').pathname;
        const data =
          pathname === '/api/v1/auth/status'
            ? localTrustedAuthStatus
            : pathname === '/api/v1/projects'
              ? [project]
              : pathname === '/api/v1/tasks'
                ? [task]
                : pathname === '/api/v1/goals'
                  ? []
                  : pathname === '/api/v1/agents'
                    ? [agent]
                    : pathname === '/api/v1/worktree-executions'
                      ? [execution]
                      : pathname === `/api/v1/worktree-executions/${execution.id}/review`
                        ? {
                            worktreePath: execution.worktreePath,
                            baseSha: execution.baseSha,
                            headSha: 'b'.repeat(40),
                            taskBranch: execution.taskBranch,
                            clean: false,
                            aheadBy: 1,
                            entries: [{ index: ' ', worktree: 'M', path: 'src/runner.ts' }],
                            patch: 'diff --git a/src/runner.ts b/src/runner.ts\n+隔离执行',
                            diffStat: '1 file changed',
                            truncated: false,
                          }
                        : [];
        return new Response(JSON.stringify({ data, requestId: 'worktree-ui-test' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/tasks']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /审阅并合并/ }));
    expect(await screen.findByRole('dialog', { name: '隔离实现 Worktree Runner' })).toBeVisible();
    expect(screen.getAllByText('agenthub/task-44444444-77777777').length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText(/\+隔离执行/)).toBeVisible();
    expect(screen.getByRole('button', { name: /批准并合并/ })).toBeVisible();
    expect(screen.getByText(/不会自动清理/)).toBeVisible();
  });

  it('普通 Task 审阅先展示验收、Run 与 Git 证据，返工必须填写反馈并进入新 Session', async () => {
    const taskId = '44444444-4444-4444-8444-444444444444';
    const sessionId = '55555555-5555-4555-8555-555555555555';
    const runId = '66666666-6666-4666-8666-666666666666';
    const nextSessionId = '77777777-7777-4777-8777-777777777777';
    const task = {
      id: taskId,
      projectId: journeyProject.id,
      goalId: null,
      parentId: null,
      title: '普通审阅闭环',
      description: '验证取消与权限竞争',
      acceptanceCriteria: '所有专项测试通过并保留 Git 证据',
      status: 'WAITING_REVIEW',
      priority: 1,
      assignedAgentId: journeyAgent.id,
      sessionId,
      finalRunId: runId,
      branch: 'main',
      position: '0',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:02:00.000Z',
      completedAt: null,
    };
    const run = {
      id: runId,
      sessionId,
      status: 'COMPLETED',
      startedAt: '2026-08-11T00:00:01.000Z',
      finishedAt: '2026-08-11T00:02:00.000Z',
      gitBeforeSha: 'a'.repeat(40),
      gitAfterSha: 'b'.repeat(40),
      errorCode: null,
    };
    let reviewBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input), 'http://agenthub.test').pathname;
      let data: unknown = [];
      if (pathname === '/api/v1/auth/status') data = localTrustedAuthStatus;
      else if (pathname === '/api/v1/projects') data = [journeyProject];
      else if (pathname === '/api/v1/tasks') data = [task];
      else if (pathname === '/api/v1/goals') data = [];
      else if (pathname === '/api/v1/agents') data = [journeyAgent];
      else if (pathname === '/api/v1/worktree-executions') data = [];
      else if (pathname === `/api/v1/sessions/${sessionId}/runs`) data = [run];
      else if (pathname === `/api/v1/projects/${journeyProject.id}/git/status`) {
        data = {
          branch: 'main',
          headSha: 'b'.repeat(40),
          clean: false,
          entries: [{ index: ' ', worktree: 'M', path: 'apps/server/src/tasks/task-service.ts' }],
        };
      } else if (pathname === `/api/v1/projects/${journeyProject.id}/git/diff`) {
        data = { patch: '+创建新的 Session 和 Run', truncated: false };
      } else if (pathname === `/api/v1/tasks/${taskId}/review` && init?.method === 'POST') {
        reviewBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        data = {
          task: { ...task, status: 'IN_PROGRESS' },
          session: { id: nextSessionId },
          run: { id: runId },
        };
      }
      return new Response(JSON.stringify({ data, requestId: 'task-review-ui-test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/tasks?projectId=${journeyProject.id}&review=${taskId}`]}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole('dialog', { name: task.title });
    expect(dialog).toBeVisible();
    expect(dialog).toHaveTextContent(task.acceptanceCriteria);
    expect(await screen.findByText('+创建新的 Session 和 Run')).toBeVisible();
    expect(await screen.findByText('aaaaaaaaaaaa')).toBeVisible();
    const rework = screen.getByRole('button', { name: /继续修改并启动新 Run/ });
    expect(rework).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/明确指出未通过的验收项/), {
      target: { value: '请补充真实 Agent 失败路径' },
    });
    expect(rework).toBeEnabled();
    fireEvent.click(rework);

    await waitFor(() =>
      expect(reviewBody).toEqual({
        decision: 'REWORK',
        feedback: '请补充真实 Agent 失败路径',
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('当前地址')).toHaveTextContent(`/sessions/${nextSessionId}`),
    );
  });

  it('Git Task 可从中文入口加入隔离执行队列', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const taskId = '44444444-4444-4444-8444-444444444444';
    const agentId = '33333333-3333-4333-8333-333333333333';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input), 'http://agenthub.test').pathname;
      const data =
        pathname === '/api/v1/auth/status'
          ? localTrustedAuthStatus
          : pathname === '/api/v1/projects'
            ? [
                {
                  id: projectId,
                  name: 'AgentHub',
                  targetId: '22222222-2222-4222-8222-222222222222',
                  rootPath: '/volume2/Project/AgentHub',
                  realRootPath: '/volume2/Project/AgentHub',
                  repoKind: 'GIT',
                  status: 'ACTIVE',
                },
              ]
            : pathname === '/api/v1/tasks'
              ? [
                  {
                    id: taskId,
                    projectId,
                    goalId: null,
                    parentId: null,
                    title: '加入隔离队列',
                    description: null,
                    acceptanceCriteria: null,
                    status: 'READY',
                    priority: 0,
                    assignedAgentId: null,
                    sessionId: null,
                    finalRunId: null,
                    branch: null,
                    position: '0',
                    createdAt: '2026-08-10T00:00:00.000Z',
                    updatedAt: '2026-08-10T00:00:00.000Z',
                    completedAt: null,
                  },
                ]
              : pathname === '/api/v1/agents'
                ? [
                    {
                      id: agentId,
                      targetId: '22222222-2222-4222-8222-222222222222',
                      name: 'Codex 主力',
                      agentKind: 'CODEX',
                      adapterKind: 'ACP_STDIO',
                      status: 'READY',
                      detectedVersion: '1.1.14',
                      defaultModel: null,
                      defaultMode: null,
                      capabilitiesJson: {},
                      lastPreflightAt: '2026-08-10T00:00:00.000Z',
                    },
                  ]
                : pathname === `/api/v1/tasks/${taskId}/worktree/queue` && init?.method === 'POST'
                  ? { execution: { id: '77777777-7777-4777-8777-777777777777', status: 'QUEUED' } }
                  : [];
      return new Response(JSON.stringify({ data, requestId: 'worktree-queue-ui-test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/tasks']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /隔离执行/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/tasks/${taskId}/worktree/queue`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ agentId }),
        }),
      ),
    );
    expect(screen.getByRole('button', { name: /直接运行/ })).toBeVisible();
  });

  it('token auth 使用账号密码登录并由浏览器携带 HttpOnly Cookie', async () => {
    let authenticated = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const data = path.endsWith('/auth/status')
        ? {
            mode: 'token',
            localTrusted: false,
            setupRequired: false,
            authenticated,
            user: authenticated ? { id: 'account-1', username: 'admin', role: 'ADMIN' } : null,
          }
        : path.endsWith('/auth/login') && init?.method === 'POST'
          ? ((authenticated = true),
            {
              user: { id: 'account-1', username: 'admin', role: 'ADMIN' },
            })
          : path.endsWith('/settings/capabilities')
            ? {
                terminal: {
                  available: false,
                  code: 'PTY_UNAVAILABLE',
                  message: '当前平台不可用',
                  platform: 'linux',
                  arch: 'arm64',
                },
                remoteNode: { available: false },
              }
            : [];
      return new Response(JSON.stringify({ data, requestId: 'auth-ui-test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/settings']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: '登录 AgentHub' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '用户名' }), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: 'administrator-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByRole('heading', { name: '设置与诊断' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
      }),
    );
    expect(
      fetchMock.mock.calls.some(([, init]) =>
        Object.prototype.hasOwnProperty.call((init?.headers ?? {}) as object, 'authorization'),
      ),
    ).toBe(false);
  });

  it('首次访问只需在页面创建管理员账号', async () => {
    let authenticated = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const data = path.endsWith('/auth/status')
        ? {
            mode: 'token',
            localTrusted: false,
            setupRequired: !authenticated,
            authenticated,
            user: authenticated ? { id: 'account-1', username: 'Kkwans', role: 'ADMIN' } : null,
          }
        : path.endsWith('/auth/setup') && init?.method === 'POST'
          ? ((authenticated = true),
            {
              user: { id: 'account-1', username: 'Kkwans', role: 'ADMIN' },
            })
          : path.endsWith('/dashboard')
            ? {
                pendingApprovals: [],
                attentionTasks: [],
                runningSessions: [],
                recentResults: [],
                agentHealth: [],
              }
            : [];
      return new Response(JSON.stringify({ data, requestId: 'setup-ui-test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/overview']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: '创建管理员账号' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '用户名' }), {
      target: { value: 'abc' },
    });
    fireEvent.change(screen.getByLabelText('密码'), {
      target: { value: '123456' },
    });
    fireEvent.change(screen.getByLabelText('确认密码'), {
      target: { value: '123456' },
    });
    const visibilityButtons = screen.getAllByRole('button', { name: '显示密码' });
    expect(visibilityButtons).toHaveLength(2);
    fireEvent.click(visibilityButtons[0]!);
    expect(screen.getByLabelText('密码')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: '隐藏密码' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '创建账号并进入' }));

    expect(await screen.findByRole('heading', { name: '今天需要处理什么' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/setup',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ username: 'abc', password: '123456' }),
      }),
    );
  });

  it('设置页展示 Remote Node 身份、inventory 并创建一次性注册码', async () => {
    const nodeId = '11111111-1111-4111-8111-111111111111';
    const fingerprint = 'a'.repeat(64);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input), 'http://agenthub.test').pathname;
      const data =
        pathname === '/api/v1/auth/status'
          ? { mode: 'local_trusted', localTrusted: true }
          : pathname === '/api/v1/settings/capabilities'
            ? {
                terminal: {
                  available: false,
                  code: 'PTY_UNAVAILABLE',
                  message: '当前平台不可用',
                  platform: 'linux',
                  arch: 'arm64',
                },
                remoteNode: { available: true, transport: 'outbound_websocket' },
              }
            : pathname === '/api/v1/remote-nodes/registration-tokens' && init?.method === 'POST'
              ? {
                  id: '22222222-2222-4222-8222-222222222222',
                  name: 'TX5Pro 开发节点',
                  allowedRoots: ['/srv/projects/AgentHub'],
                  expiresAt: '2026-08-10T01:15:00.000Z',
                  createdAt: '2026-08-10T01:00:00.000Z',
                  token: 'ahrn_once_only_test_token_1234567890',
                }
              : pathname === '/api/v1/remote-nodes'
                ? [
                    {
                      id: nodeId,
                      targetId: '33333333-3333-4333-8333-333333333333',
                      name: 'TX5Pro',
                      hostname: 'tx5pro',
                      os: 'linux',
                      arch: 'arm64',
                      fingerprint,
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
                    },
                  ]
                : [];
      return new Response(JSON.stringify({ data, requestId: 'remote-node-ui-test' }), {
        status: pathname.endsWith('/registration-tokens') ? 201 : 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/settings']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Remote Node' })).toBeInTheDocument();
    expect(await screen.findByText('TX5Pro')).toBeInTheDocument();
    expect(screen.getByText('/srv/projects/AgentHub')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByTitle(fingerprint)).toHaveTextContent(fingerprint);

    fireEvent.click(screen.getByRole('button', { name: '生成一次性注册码' }));
    fireEvent.change(screen.getByLabelText('Node 名称'), {
      target: { value: 'TX5Pro 开发节点' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '授权目录' }), {
      target: { value: '/srv/projects/AgentHub' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加目录' }));
    expect(screen.getByLabelText('已添加的授权目录')).toHaveTextContent('/srv/projects/AgentHub');
    fireEvent.click(screen.getByRole('button', { name: '生成注册码' }));

    expect(await screen.findByText('注册码只显示这一次')).toBeInTheDocument();
    expect(screen.getByLabelText('一次性注册码')).toHaveTextContent(
      'ahrn_once_only_test_token_1234567890',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/remote-nodes/registration-tokens',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'TX5Pro 开发节点',
          allowedRoots: ['/srv/projects/AgentHub'],
          expiresInMinutes: 15,
        }),
      }),
    );
  });

  it('Project 主操作进入带新建状态的 Session URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const pathname = new URL(String(input), 'http://agenthub.test').pathname;
        const data =
          pathname === '/api/v1/auth/status'
            ? localTrustedAuthStatus
            : pathname === '/api/v1/projects'
              ? [journeyProject]
              : [];
        return new Response(JSON.stringify({ data, requestId: 'session-cta-test' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/projects']}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const link = await screen.findByRole('link', { name: /开始会话/ });
    expect(link).toHaveAttribute('href', `/sessions?projectId=${journeyProject.id}&new=1`);
  });

  it('Session URL 可恢复 Project 筛选与新建状态', async () => {
    const session = {
      id: '55555555-5555-4555-8555-555555555555',
      projectId: journeyProject.id,
      agentId: journeyAgent.id,
      taskId: null,
      title: '已有会话',
      cwd: journeyProject.realRootPath,
      branch: 'main',
      status: 'READY',
      model: null,
      mode: null,
      lastActiveAt: '2026-08-11T00:00:00.000Z',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://agenthub.test');
      const data =
        url.pathname === '/api/v1/auth/status'
          ? localTrustedAuthStatus
          : url.pathname === '/api/v1/sessions'
            ? [session]
            : url.pathname === '/api/v1/projects'
              ? [journeyProject]
              : url.pathname === '/api/v1/agents'
                ? [journeyAgent]
                : url.pathname === '/api/v1/execution-targets'
                  ? [journeyTarget]
                  : [];
      return new Response(JSON.stringify({ data, requestId: 'session-url-test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/sessions?projectId=${journeyProject.id}&new=1`]}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: '新建 Session' }, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('combobox', { name: 'Project' }, { timeout: 5_000 }),
    ).toHaveValue(journeyProject.id);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/sessions?projectId=${journeyProject.id}`,
      expect.any(Object),
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByLabelText('当前地址')).toHaveTextContent(
      `/sessions?projectId=${journeyProject.id}`,
    );
    fireEvent.click(screen.getByRole('link', { name: '清除 Project 筛选' }));
    expect(screen.getByLabelText('当前地址')).toHaveTextContent('/sessions');
  });

  it('新建 Session 只筛选同一 Target 且 enabled/READY 的 Agent', async () => {
    const disabledAgent = {
      ...journeyAgent,
      id: '44444444-4444-4444-8444-444444444444',
      name: '已停用 Agent',
      enabled: false,
    };
    const wrongTargetAgent = {
      ...journeyAgent,
      id: '66666666-6666-4666-8666-666666666666',
      name: '其他目标 Agent',
      targetId: '77777777-7777-4777-8777-777777777777',
    };
    const brokenAgent = {
      ...journeyAgent,
      id: '88888888-8888-4888-8888-888888888888',
      name: '未就绪 Agent',
      status: 'BROKEN',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const pathname = new URL(String(input), 'http://agenthub.test').pathname;
        const data =
          pathname === '/api/v1/auth/status'
            ? localTrustedAuthStatus
            : pathname === '/api/v1/projects'
              ? [journeyProject]
              : pathname === '/api/v1/execution-targets'
                ? [journeyTarget]
                : pathname === '/api/v1/agents'
                  ? [journeyAgent, disabledAgent, wrongTargetAgent, brokenAgent]
                  : pathname === '/api/v1/sessions'
                    ? []
                    : [];
        return new Response(JSON.stringify({ data, requestId: 'session-agent-filter-test' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/sessions?projectId=${journeyProject.id}&new=1`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const agentSelect = await screen.findByRole('combobox', { name: 'Agent' }, { timeout: 5_000 });
    expect(agentSelect).toHaveValue(journeyAgent.id);
    expect(screen.getByRole('option', { name: /Codex 主力/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /已停用 Agent/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /其他目标 Agent/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /未就绪 Agent/ })).not.toBeInTheDocument();
  });

  it('创建 Session 使用固定 Project cwd 并成功跳转工作区', async () => {
    const createdSession = {
      id: '99999999-9999-4999-8999-999999999999',
      projectId: journeyProject.id,
      agentId: journeyAgent.id,
      taskId: null,
      title: '首次真实会话',
      cwd: journeyProject.realRootPath,
      branch: 'main',
      status: 'READY',
      model: 'gpt-5-codex',
      mode: 'default',
      lastActiveAt: '2026-08-11T00:00:00.000Z',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://agenthub.test');
      let data: unknown = [];
      let status = 200;
      if (url.pathname === '/api/v1/auth/status') data = localTrustedAuthStatus;
      else if (url.pathname === '/api/v1/projects') data = [journeyProject];
      else if (url.pathname === '/api/v1/execution-targets') data = [journeyTarget];
      else if (url.pathname === '/api/v1/agents') data = [journeyAgent];
      else if (url.pathname === '/api/v1/sessions' && init?.method === 'POST') {
        data = createdSession;
        status = 201;
      } else if (url.pathname === `/api/v1/sessions/${createdSession.id}`) data = createdSession;
      return new Response(JSON.stringify({ data, requestId: 'session-create-test' }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/sessions?projectId=${journeyProject.id}&new=1`]}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByRole('dialog', { name: '新建 Session' }, { timeout: 5_000 });
    fireEvent.click(await screen.findByText('运行参数', {}, { timeout: 5_000 }));
    expect(screen.queryByRole('textbox', { name: 'model' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'mode' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('模型')).toHaveTextContent('gpt-5-codex'));
    await waitFor(() => expect(screen.getByLabelText('模式')).toHaveTextContent('default'));
    fireEvent.change(
      await screen.findByRole('textbox', { name: 'Session 标题' }, { timeout: 5_000 }),
      {
        target: { value: '首次真实会话' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: '创建并进入工作区' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/sessions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            projectId: journeyProject.id,
            agentId: journeyAgent.id,
            title: '首次真实会话',
            cwd: journeyProject.realRootPath,
            model: 'gpt-5-codex',
            mode: 'default',
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('当前地址')).toHaveTextContent(`/sessions/${createdSession.id}`),
    );
  });

  it('断线 Session 可恢复，并在确认后安全关闭', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const disconnectedSession = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      projectId: journeyProject.id,
      agentId: journeyAgent.id,
      taskId: null,
      externalSessionId: 'external-session',
      title: '等待恢复的 Session',
      cwd: journeyProject.realRootPath,
      branch: 'main',
      status: 'DISCONNECTED',
      model: null,
      mode: null,
      lastActiveAt: '2026-08-11T00:00:00.000Z',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://agenthub.test');
      let data: unknown = [];
      if (url.pathname === '/api/v1/auth/status') data = localTrustedAuthStatus;
      else if (url.pathname === '/api/v1/sessions') data = [disconnectedSession];
      else if (
        url.pathname === `/api/v1/sessions/${disconnectedSession.id}/resume` &&
        init?.method === 'POST'
      ) {
        data = { ...disconnectedSession, status: 'READY' };
      } else if (
        url.pathname === `/api/v1/sessions/${disconnectedSession.id}/close` &&
        init?.method === 'POST'
      ) {
        data = { ...disconnectedSession, status: 'CLOSED' };
      } else if (url.pathname === `/api/v1/sessions/${disconnectedSession.id}`) {
        data = { ...disconnectedSession, status: 'READY' };
      }
      return new Response(JSON.stringify({ data, requestId: 'session-lifecycle-test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/sessions']}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('等待恢复的 Session')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭 Session' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      '关闭后不能恢复，但已有消息、Run 与 Git 记录会保留',
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/v1/sessions/${disconnectedSession.id}/close`,
      expect.any(Object),
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭 Session' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认关闭' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/sessions/${disconnectedSession.id}/close`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: '恢复 Session' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/sessions/${disconnectedSession.id}/resume`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('当前地址')).toHaveTextContent(
        `/sessions/${disconnectedSession.id}`,
      ),
    );
  });

  it('没有兼容 Agent 时提供 Agent 管理下一步', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const pathname = new URL(String(input), 'http://agenthub.test').pathname;
        const data =
          pathname === '/api/v1/auth/status'
            ? localTrustedAuthStatus
            : pathname === '/api/v1/projects'
              ? [journeyProject]
              : pathname === '/api/v1/execution-targets'
                ? [journeyTarget]
                : pathname === '/api/v1/agents'
                  ? []
                  : [];
        return new Response(JSON.stringify({ data, requestId: 'session-empty-agent-test' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/sessions?projectId=${journeyProject.id}&new=1`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: '没有可用的 Agent' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /前往 Agent 管理/ })).toHaveAttribute(
      'href',
      '/agents',
    );
  });
});
