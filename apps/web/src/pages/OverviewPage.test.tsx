// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OverviewPage } from './OverviewPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const emptyDashboard = {
  pendingApprovals: [],
  attentionTasks: [],
  runningSessions: [],
  recentResults: [],
  agentHealth: [],
};

function renderOverview(responses: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input), 'http://agenthub.test').pathname;
      return new Response(
        JSON.stringify({ data: responses[pathname] ?? [], requestId: 'overview-test' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OverviewPage 首次使用旅程', () => {
  it('从真实缺失状态给出按依赖排序的下一步', async () => {
    renderOverview({ '/api/v1/dashboard': emptyDashboard });

    const progress = await screen.findByRole('navigation', { name: '首次使用进度' });
    expect(progress).toBeInTheDocument();
    const targetStep = screen.getByRole('link', { name: /准备 Execution Target/ });
    expect(targetStep).toHaveAttribute('href', '/agents');
    expect(targetStep).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('添加 Project').closest('[aria-disabled="true"]')).toBeInTheDocument();
  });

  it('已有 Target 与 Project 时把接入 Agent 标记为下一步', async () => {
    renderOverview({
      '/api/v1/dashboard': emptyDashboard,
      '/api/v1/execution-targets': [
        { id: 'target-1', name: 'AgentHub NAS 宿主机', status: 'READY' },
      ],
      '/api/v1/projects': [
        { id: 'project-1', name: 'AgentHub', status: 'ACTIVE', realRootPath: '/project' },
      ],
    });

    await screen.findByRole('navigation', { name: '首次使用进度' });
    expect(screen.getByRole('link', { name: /接入 Agent/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.getByText('2 / 4 已完成')).toBeInTheDocument();
  });

  it('已有完整准备与 Session 时隐藏首次使用引导', async () => {
    renderOverview({
      '/api/v1/dashboard': {
        ...emptyDashboard,
        agentHealth: [{ id: 'agent-1', name: 'Codex', status: 'READY' }],
      },
      '/api/v1/execution-targets': [{ id: 'target-1', name: '本机', status: 'READY' }],
      '/api/v1/projects': [
        { id: 'project-1', name: 'AgentHub', status: 'ACTIVE', realRootPath: '/project' },
      ],
      '/api/v1/sessions': [{ id: 'session-1', title: '首次 Session' }],
    });

    expect(await screen.findByRole('heading', { name: '今天需要处理什么' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '首次使用进度' })).not.toBeInTheDocument();
  });
});
