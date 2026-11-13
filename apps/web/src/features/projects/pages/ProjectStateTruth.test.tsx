// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectOverviewPage } from './ProjectOverviewPage';
import { ProjectContextLayout } from './ProjectContextLayout';
import { api } from '../../../lib/api';
vi.mock('../../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});
const project = {
  id: 'p1',
  name: '资格审计项目',
  status: 'ACTIVE',
  kind: 'STANDARD',
  repoKind: 'GIT',
  targetId: 'host-A',
};
const incompatible = {
  id: 'a1',
  name: '其他目录Agent',
  targetId: 'docker-B',
  enabled: true,
  status: 'READY',
};
function report(id = 'p1', eligible = false) {
  return {
    projectId: id,
    basis: 'REGISTERED_STATE',
    livePreflight: false,
    agents: [
      {
        agentId: 'a1',
        eligible,
        reason: eligible ? null : 'INCOMPATIBLE_WORKSPACE',
        agentStatus: 'READY',
        targetStatus: 'READY',
      },
    ],
  };
}
function mount(
  options: {
    lists?: 'error' | 'pending';
    preflight?: 'pending' | 'error' | 'no-detected';
    eligibility?: 'pending' | 'error' | 'malformed' | 'eligible';
    firstReport?: Promise<unknown>;
  } = {},
) {
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path === '/projects/p1' || path === '/projects/p2')
      return { ...project, id: path.endsWith('p2') ? 'p2' : 'p1' } as T;
    if (path === '/agents') return [incompatible] as T;
    if (path.includes('agent-eligibility')) {
      if (path.includes('/p1/') && options.firstReport) return (await options.firstReport) as T;
      if (options.eligibility === 'error') throw new Error('资格读取失败');
      if (options.eligibility === 'pending') return await new Promise<T>(() => {});
      if (options.eligibility === 'malformed') return report('wrong-project') as T;
      return report(path.includes('/p2/') ? 'p2' : 'p1', options.eligibility === 'eligible') as T;
    }
    if (options.lists === 'error') throw new Error('工作或会话读取失败');
    if (options.lists === 'pending') return await new Promise<T>(() => {});
    return [] as T;
  });
  vi.mocked(api.post).mockImplementation(async () => {
    if (options.preflight === 'pending') return await new Promise(() => {});
    if (options.preflight === 'error') throw new Error('预检失败');
    return {
      status: 'READY',
      ...(options.preflight === 'no-detected' ? {} : { git: { detected: true } }),
    };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/p1/overview']}>
        <Link to="/projects/p2/overview">切换项目</Link>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectContextLayout />}>
            <Route path="overview" element={<ProjectOverviewPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
it('does not count an incompatible globally READY enabled Agent as project eligible', async () => {
  mount();
  await screen.findByText('登记状态下 0 个可用；运行前仍需预检');
  expect(screen.getByText('0 个登记可用 Agent')).toBeVisible();
  expect(screen.queryByText('1 个已就绪')).not.toBeInTheDocument();
  expect(screen.getByText('项目 Agent 资格').parentElement!.parentElement!).not.toHaveTextContent(
    '✓',
  );
});
it('uses server eligibility, including eligible cross-target Docker mappings, without inventing live health', async () => {
  mount({ eligibility: 'eligible' });
  expect(await screen.findByText('1 个登记可用 Agent')).toBeVisible();
  expect(screen.getByText('登记状态下 1 个可用；运行前仍需预检')).toBeVisible();
});
it.each(['pending', 'error', 'malformed'] as const)(
  'does not turn eligibility %s into zero/success',
  async (eligibility) => {
    const client = mount({ eligibility });
    await screen.findByText('项目 Agent 资格');
    if (eligibility !== 'pending')
      await waitFor(() =>
        expect(client.getQueryState(['agent-eligibility', 'p1'])?.status).toBe('error'),
      );
    expect(screen.queryByText('0 个登记可用 Agent')).not.toBeInTheDocument();
    expect(screen.queryByText(/登记状态下 \d+ 个可用/)).not.toBeInTheDocument();
    expect(screen.getByText('项目 Agent 资格').parentElement!.parentElement!).not.toHaveTextContent(
      '✓',
    );
  },
);
it.each(['error', 'pending'] as const)(
  'does not claim empty lists while queries are %s',
  async (lists) => {
    const client = mount({ lists });
    await screen.findByText('项目 Agent 资格');
    await waitFor(() => expect(client.getQueryState(['tasks', 'p1'])?.status).toBe(lists));
    for (const text of ['没有进行中的 Work', '没有待审阅结果', '还没有 Session'])
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    if (lists === 'error') expect(screen.getAllByText('工作或会话读取失败').length).toBe(3);
  },
);
it.each(['pending', 'error', 'no-detected'] as const)(
  'does not give Git a successful check for preflight %s',
  async (preflight) => {
    const client = mount({ preflight });
    await screen.findByText('项目 Agent 资格');
    if (preflight !== 'pending')
      await waitFor(() =>
        expect(client.getQueryState(['project-preflight', 'p1'])?.status).toBe(
          preflight === 'error' ? 'error' : 'success',
        ),
      );
    const row = screen
      .getAllByText('Git 仓库', { exact: true })
      .find((node) => node.tagName === 'STRONG')!.parentElement!.parentElement!;
    expect(row).not.toHaveTextContent('✓');
    expect(row).not.toHaveTextContent('工作区干净');
  },
);
it('ignores a late eligible response for the previous project', async () => {
  let resolve!: (value: unknown) => void;
  const firstReport = new Promise<unknown>((done) => {
    resolve = done;
  });
  mount({ firstReport });
  await screen.findByText('项目 Agent 资格');
  fireEvent.click(screen.getByRole('link', { name: '切换项目' }));
  await screen.findByText('0 个登记可用 Agent');
  resolve(report('p1', true));
  await waitFor(() =>
    expect(screen.getByText('登记状态下 0 个可用；运行前仍需预检')).toBeVisible(),
  );
  expect(screen.queryByText('1 个登记可用 Agent')).not.toBeInTheDocument();
});

it('does not present retained cached success as current success after refetch failure', async () => {
  const client = mount({ eligibility: 'eligible' });
  await screen.findByText('1 个登记可用 Agent');
  client.setQueryData(
    ['tasks', 'p1'],
    [{ id: 'old', title: '旧缓存工作', status: 'BACKLOG', updatedAt: '2026-11-12T00:00:00Z' }],
  );
  await screen.findByText('旧缓存工作');
  vi.mocked(api.get).mockRejectedValue(new Error('刷新失败'));
  vi.mocked(api.post).mockRejectedValue(new Error('刷新预检失败'));
  await Promise.all([
    client.refetchQueries({ queryKey: ['tasks', 'p1'], exact: true }),
    client.refetchQueries({ queryKey: ['agent-eligibility', 'p1'], exact: true }),
    client.refetchQueries({ queryKey: ['project-preflight', 'p1'], exact: true }),
  ]);
  await waitFor(() => expect(screen.queryByText('1 个登记可用 Agent')).not.toBeInTheDocument());
  expect(client.getQueryData(['tasks', 'p1'])).toHaveLength(1);
  expect(screen.queryByText('旧缓存工作')).not.toBeInTheDocument();
  expect(screen.queryByText('没有进行中的 Work')).not.toBeInTheDocument();
  expect(screen.queryByText('0 个登记可用 Agent')).not.toBeInTheDocument();
  expect(screen.getByText('项目 Agent 资格').parentElement!.parentElement!).not.toHaveTextContent(
    '✓',
  );
  expect(
    screen.getByText('已登记为 Git 项目；当前预检结果待确认').parentElement!.parentElement!,
  ).not.toHaveTextContent('✓');
});

it('keeps review and work in one reading flow before recent sessions and environment details', async () => {
  mount();
  const review = await screen.findByRole('heading', { name: 'Review Queue' });
  const active = screen.getByRole('heading', { name: '正在进行' });
  const sessions = screen.getByRole('heading', { name: '最近会话' });
  const health = screen.getByRole('complementary', { name: '项目环境状态' });
  for (const [before, after] of [
    [review, active],
    [active, sessions],
    [sessions, health],
  ]) {
    expect(before!.compareDocumentPosition(after!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(review.closest('section')?.parentElement).toBe(active.closest('section')?.parentElement);
  expect(active.closest('section')?.parentElement).toBe(sessions.closest('section')?.parentElement);
  expect(screen.getByRole('link', { name: '全部审阅 →' })).toHaveAttribute(
    'href',
    '/projects/p1/work?status=WAITING_REVIEW',
  );
});
