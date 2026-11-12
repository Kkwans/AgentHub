// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';

vi.mock('../../../lib/api', () => ({ api: { get: vi.fn(async () => []) } }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
});
function mount(overrides: Record<string, unknown> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  const data = {
    dashboard: { runningSessions: [], pendingApprovals: [], attentionTasks: [] },
    projects: [],
    sessions: [],
    agents: [],
    ...overrides,
  };
  for (const [key, value] of Object.entries(data)) client.setQueryData([key], value);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const project = { id: 'p1', name: '真实项目', kind: 'STANDARD', status: 'ACTIVE', repoKind: 'GIT' };

describe('首页行动优先', () => {
  it('首次进入只提供一个创建入口与紧凑指南，不渲染重复空卡', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: '让工作有一个落脚点' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '创建项目' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: '创建项目' })).toHaveAttribute('href', '/projects/new');
    expect(screen.queryByText('还没有最近工作')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /需要你处理/ })).not.toBeInTheDocument();
    expect(screen.getByText('0 个 Agent 全局就绪，项目可用性需单独检查。')).toBeInTheDocument();
  });
  it('已有项目保留工作和会话入口，全局就绪不包含禁用的 Agent', async () => {
    mount({
      projects: [project],
      agents: [
        { id: 'a1', name: '测试 Agent', status: 'READY', enabled: true },
        { id: 'a2', status: 'READY', enabled: false },
      ],
      sessions: [
        {
          id: 's1',
          projectId: 'p1',
          agentId: 'a1',
          title: '继续修复',
          status: 'READY',
          lastActiveAt: '2026-11-12T00:00:00Z',
        },
      ],
    });
    expect(await screen.findByRole('link', { name: /继续修复/ })).toHaveAttribute(
      'href',
      '/workspace/s1',
    );
    expect(screen.getByRole('link', { name: '新建工作' })).toHaveAttribute(
      'href',
      '/projects/p1/work/new',
    );
    expect(screen.getByText('1 个 Agent 全局就绪，项目可用性需单独检查。')).toBeInTheDocument();
    expect(screen.queryByText('让工作有一个落脚点')).not.toBeInTheDocument();
  });
  it('没有项目时仍展示可处理的受阻任务', async () => {
    mount({
      dashboard: {
        runningSessions: [],
        pendingApprovals: [],
        attentionTasks: [
          {
            id: 't1',
            projectId: 'p1',
            title: '需要恢复的任务',
            status: 'BLOCKED',
            sessionId: 's1',
          },
        ],
      },
    });
    expect(await screen.findByRole('link', { name: /需要恢复的任务/ })).toHaveAttribute(
      'href',
      '/workspace/s1',
    );
  });
  it('测试项目可展开访问但不混入正式工作', async () => {
    mount({ projects: [{ ...project, kind: 'TEST' }] });
    expect(await screen.findByText('测试项目（1）')).toBeInTheDocument();
    expect(screen.getByText('0 个活跃项目 · 0 个运行中会话')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '创建项目' })).toBeInTheDocument();
  });
  it('仅有归档项目时不提供不可执行的新建工作入口', async () => {
    mount({ projects: [{ ...project, status: 'ARCHIVED' }] });
    expect(await screen.findByRole('heading', { name: '你的项目' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '创建项目' })).toHaveAttribute('href', '/projects/new');
    expect(screen.queryByRole('link', { name: '新建工作' })).not.toBeInTheDocument();
  });
  it('超过五条待处理事项可以原地展开，保留第六条操作入口', async () => {
    mount({
      dashboard: {
        runningSessions: [],
        pendingApprovals: [],
        attentionTasks: Array.from({ length: 6 }, (_, index) => ({
          id: `t${index}`,
          projectId: 'p1',
          title: `受阻任务${index + 1}`,
          status: 'BLOCKED',
          sessionId: `s${index}`,
        })),
      },
    });
    const expand = await screen.findByRole('button', { name: '查看全部 6 项待处理事项' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /受阻任务6/ })).not.toBeInTheDocument();
    fireEvent.click(expand);
    expect(screen.getByRole('link', { name: /受阻任务6/ })).toHaveAttribute(
      'href',
      '/workspace/s5',
    );
    expect(expand).toHaveAttribute('aria-expanded', 'true');
  });
});
