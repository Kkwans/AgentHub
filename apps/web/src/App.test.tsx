// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentHubProvider } from '@agenthub/ui';

import { App } from './App';

configure({ asyncUtilTimeout: 5_000 });

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'AgentHub',
  description: 'AI Engineering Workbench',
  targetId: '22222222-2222-4222-8222-222222222222',
  rootPath: '/volume2/Project/AgentHub',
  realRootPath: '/volume2/Project/AgentHub',
  repoKind: 'GIT',
  kind: 'STANDARD',
  status: 'ACTIVE',
};

const auth = {
  mode: 'local_trusted',
  localTrusted: true,
  setupRequired: false,
  authenticated: true,
  user: null,
};

const session = {
  id: '33333333-3333-4333-8333-333333333333',
  projectId: project.id,
  agentId: '44444444-4444-4444-8444-444444444444',
  taskId: null,
  title: 'v0.9 Workspace',
  cwd: project.rootPath,
  branch: 'main',
  status: 'READY',
  model: null,
  mode: null,
  reasoningEffort: null,
  lastActiveAt: '2026-08-23T00:00:00.000Z',
};

vi.mock('./lib/realtime', () => ({
  realtime: {
    onState(listener: (state: '已断开') => void) {
      listener('已断开');
      return () => undefined;
    },
    subscribe() {
      return () => undefined;
    },
    reconnect() {},
    disconnect() {},
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

function renderApp(initialEntries: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <AgentHubProvider initialPreference="light">
          <App />
        </AgentHubProvider>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubApi() {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      let data: unknown = [];
      if (url.endsWith('/auth/status')) data = auth;
      else if (url.endsWith('/projects')) data = [project];
      else if (url.includes(`/projects/${project.id}`)) data = project;
      else if (url.endsWith(`/sessions/${session.id}`)) data = session;
      else if (url.endsWith(`/sessions/${session.id}/messages`)) data = [];
      else if (url.endsWith(`/sessions/${session.id}/runs`)) data = [];
      else if (url.includes(`/sessions/${session.id}/events`)) data = [];
      else if (url.includes(`/approvals?sessionId=${session.id}`)) data = [];
      else if (url.includes('/discovery/agents')) data = [];
      else if (url.endsWith('/agents'))
        data = [
          {
            id: session.agentId,
            targetId: 'target',
            name: 'Codex',
            agentKind: 'CODEX',
            adapterKind: 'ACP',
            status: 'READY',
            enabled: true,
            detectedVersion: '1.0',
            defaultModel: null,
            defaultMode: null,
            capabilitiesJson: {},
            lastPreflightAt: null,
          },
        ];
      else if (url.endsWith(`/sessions/${session.id}/configuration`))
        data = {
          supported: false,
          current: { model: null, mode: null, reasoningEffort: null },
          options: { models: [], modes: [], reasoningEfforts: [] },
        };
      else if (url.endsWith('/prompt-context/resolve'))
        data = { ready: true, finalContext: '', missingVariables: [], items: [] };
      else if (url.includes('/dashboard'))
        data = {
          runningSessions: [],
          attentionTasks: [],
          pendingApprovals: [],
          recentResults: [],
          agentHealth: [],
        };
      return new Response(JSON.stringify({ data, requestId: 'v07-test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

describe('v0.9 App', () => {
  it('renders Home as the new default and exposes the product IA', async () => {
    stubApi();
    renderApp(['/']);
    expect(
      await screen.findByRole('heading', { name: '把注意力放在工作本身。' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '首页' })).toHaveAttribute('href', '/home');
    expect(screen.getByRole('link', { name: '项目' })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: 'Prompt 库' })).toHaveAttribute('href', '/prompts');
    expect(screen.queryByRole('link', { name: '任务' })).not.toBeInTheDocument();
  });

  it('provides the command palette with product entities and keyboard navigation', async () => {
    stubApi();
    renderApp(['/projects']);
    await screen.findByRole('heading', { name: '项目' });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: '搜索与跳转' });
    expect(dialog).toBeInTheDocument();
    const input = screen.getByRole('combobox', { name: '搜索' });
    fireEvent.change(input, { target: { value: 'Prompt' } });
    expect(screen.getByRole('option', { name: /Prompt 库/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Prompt 库/ }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Prompt 库' })).toBeInTheDocument(),
    );
  });

  it('keeps legacy deep links as redirects into the new context routes', async () => {
    stubApi();
    renderApp([`/tasks?projectId=${project.id}`]);
    await waitFor(() =>
      expect(screen.getByLabelText('当前地址')).toHaveTextContent(`/projects/${project.id}/work`),
    );
    expect(await screen.findByRole('link', { name: '工作', current: 'page' })).toBeInTheDocument();
  });

  it('renders the Prompt Library states from the real API envelope', async () => {
    stubApi();
    renderApp(['/promptos']);
    expect(await screen.findByRole('heading', { name: 'Prompt 库' })).toBeInTheDocument();
    expect(await screen.findByText('还没有 Prompt')).toBeInTheDocument();
  });

  it('keeps infrastructure and settings as first-class routes', async () => {
    stubApi();
    renderApp(['/settings/runtime']);
    expect(await screen.findByRole('heading', { name: 'Runtime' })).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('link', { name: '设置' })
        .some((link) => link.getAttribute('href') === '/settings/appearance'),
    ).toBe(true);
  });

  it('opens a real workspace composition with composer and inspector capabilities', async () => {
    stubApi();
    renderApp([`/workspace/${session.id}`]);
    expect(await screen.findByText('消息与执行记录')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '给 Agent 发送工程指令' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab', { name: '文件' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
  });

  it('renders creation flows as responsive overlay contracts', async () => {
    stubApi();
    renderApp(['/projects/new']);
    expect(await screen.findByRole('dialog', { name: '创建项目' })).toBeInTheDocument();
    expect(screen.getByTestId('create-project-dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '项目' })).toBeInTheDocument();
  });

  it('keeps New Work focused on the task description and current Project context', async () => {
    stubApi();
    renderApp([`/projects/${project.id}/work/new`]);
    expect(await screen.findByRole('dialog', { name: '描述一项工作' })).toBeInTheDocument();
    expect(screen.getByTestId('new-work-dialog')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '你想完成什么？' })).toBeInTheDocument();
    expect(screen.getAllByText(project.name).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('link', { name: '工作', current: 'page' })).toBeInTheDocument();
  });

  it('presents Agent discovery as a two-zone modal with real candidate state', async () => {
    stubApi();
    renderApp(['/agents/agents/discover']);
    expect(await screen.findByRole('dialog', { name: '发现 Agent' })).toBeInTheDocument();
    expect(screen.getByTestId('discover-agents-dialog')).toBeInTheDocument();
    expect(screen.getByText('Local Host')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: '候选 Agent' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('heading', { name: 'Agent 中心' })).toBeInTheDocument();
  });
});
