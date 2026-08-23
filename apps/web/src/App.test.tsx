// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'AgentHub',
  description: 'AI Engineering Workbench',
  targetId: '22222222-2222-4222-8222-222222222222',
  rootPath: '/volume2/Project/AgentHub',
  realRootPath: '/volume2/Project/AgentHub',
  repoKind: 'GIT',
  status: 'ACTIVE',
};

const auth = {
  mode: 'local_trusted',
  localTrusted: true,
  setupRequired: false,
  authenticated: true,
  user: null,
};

vi.mock('./lib/realtime', () => ({
  realtime: {
    onState(listener: (state: '已断开') => void) { listener('已断开'); return () => undefined; },
    subscribe() { return () => undefined; },
    reconnect() {},
    disconnect() {},
  },
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="当前地址">{location.pathname}{location.search}</output>;
}

function renderApp(initialEntries: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubApi() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    let data: unknown = [];
    if (url.endsWith('/auth/status')) data = auth;
    else if (url.endsWith('/projects')) data = [project];
    else if (url.includes(`/projects/${project.id}`)) data = project;
    else if (url.includes('/dashboard')) data = { runningSessions: [], attentionTasks: [], pendingApprovals: [], recentResults: [], agentHealth: [] };
    return new Response(JSON.stringify({ data, requestId: 'v07-test' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}

describe('v0.7 App', () => {
  it('renders Home as the new default and exposes the product IA', async () => {
    stubApi();
    renderApp(['/']);
    expect(await screen.findByRole('heading', { name: '今天需要处理什么' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '首页' })).toHaveAttribute('href', '/home');
    expect(screen.getByRole('link', { name: '项目' })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: 'Prompt Library' })).toHaveAttribute('href', '/prompts');
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
    expect(screen.getByRole('option', { name: /Prompt Library/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Prompt Library/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Prompt 资产' })).toBeInTheDocument());
  });

  it('keeps legacy deep links as redirects into the new context routes', async () => {
    stubApi();
    renderApp([`/tasks?projectId=${project.id}`]);
    await waitFor(() => expect(screen.getByLabelText('当前地址')).toHaveTextContent(`/projects/${project.id}/work`));
    expect(await screen.findByRole('heading', { name: 'Work' })).toBeInTheDocument();
  });

  it('renders the Prompt Library states from the real API envelope', async () => {
    stubApi();
    renderApp(['/promptos']);
    expect(await screen.findByRole('heading', { name: 'Prompt 资产' })).toBeInTheDocument();
    expect(await screen.findByText('还没有 Prompt')).toBeInTheDocument();
  });

  it('keeps infrastructure and settings as first-class routes', async () => {
    stubApi();
    renderApp(['/settings/runtime']);
    expect(await screen.findByRole('heading', { name: 'Runtime' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '设置' }).some((link) => link.getAttribute('href') === '/settings/appearance')).toBe(true);
  });
});
