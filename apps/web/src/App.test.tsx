// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
});
