// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { authTokenStore } from './lib/api';

let realtimeListener: ((event: Record<string, unknown>) => void) | undefined;

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
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  authTokenStore.set('');
  realtimeListener = undefined;
});

describe('App', () => {
  it('使用中文导航并渲染目标路由', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [], requestId: 'task-ui-test' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
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

    expect(screen.getByRole('navigation', { name: '一级导航' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '任务' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Goal 与 Task' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建 Task' })).toBeInTheDocument();
  });

  it('PromptOS 空状态来自真实 API 数据层', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [], requestId: 'ui-test' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
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
          pathname === `/api/v1/sessions/${session.id}`
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
        const data = path.endsWith('/prompts')
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

    expect(
      (await screen.findAllByRole('button', { name: '创建新版本' })).length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('tab', { name: '标签' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '上下文预览' })).toBeInTheDocument();
    expect(screen.getByText('不可变版本历史')).toBeInTheDocument();
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
          pathname === '/api/v1/projects'
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

  it('Git Task 可从中文入口加入隔离执行队列', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const taskId = '44444444-4444-4444-8444-444444444444';
    const agentId = '33333333-3333-4333-8333-333333333333';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input), 'http://agenthub.test').pathname;
      const data =
        pathname === '/api/v1/projects'
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

  it('token auth 设置使用当前浏览器 Session 且 API 自动携带 Bearer token', async () => {
    authTokenStore.set('ui-access-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        const data = path.endsWith('/auth/status')
          ? { mode: 'token', localTrusted: false }
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
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/settings']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: '当前浏览器 token' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/v1\//),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer ui-access-token' }),
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
    fireEvent.change(screen.getByRole('textbox', { name: '授权 roots' }), {
      target: { value: '/srv/projects/AgentHub' },
    });
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
});
