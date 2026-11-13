// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectContextLayout } from './ProjectContextLayout';
import { api } from '../../../lib/api';
vi.mock('../../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});
const project = { id: 'p1', name: '页头审计', status: 'ACTIVE', kind: 'STANDARD', repoKind: 'GIT' };
function mount({
  statuses = [] as string[],
  sessions = [] as Array<{ id: string; branch: string | null; lastActiveAt: string }>,
  state = 'success',
}: {
  statuses?: string[];
  sessions?: Array<{ id: string; branch: string | null; lastActiveAt: string }>;
  state?: 'success' | 'pending' | 'error';
} = {}) {
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path === '/projects/p1') return project as T;
    if (path.endsWith('agent-eligibility'))
      return { projectId: 'p1', basis: 'REGISTERED_STATE', livePreflight: false, agents: [] } as T;
    if (state === 'error') throw new Error('读取失败');
    if (state === 'pending') return await new Promise<T>(() => {});
    return (path.startsWith('/tasks') ? statuses.map((status) => ({ status })) : sessions) as T;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/p1/overview']}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectContextLayout />}>
            <Route path="overview" element={<p>概览内容</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
it('BACKLOG/READY/WAITING_REVIEW count as unfinished work, never active Run', async () => {
  mount({
    statuses: ['BACKLOG', 'READY', 'WAITING_REVIEW', 'BLOCKED', 'IN_PROGRESS', 'DONE', 'CANCELED'],
  });
  expect(await screen.findByText('5 项未结束工作')).toBeVisible();
  expect(screen.queryByText(/个运行中/)).not.toBeInTheDocument();
});
it('successful empty task list is honestly zero unfinished work', async () => {
  mount();
  expect(await screen.findByText('0 项未结束工作')).toBeVisible();
});
it.each(['pending', 'error'] as const)(
  'unknown %s task/session reads are not zero or fabricated main',
  async (state) => {
    const client = mount({ state });
    await screen.findByText('概览内容');
    await waitFor(() => expect(client.getQueryState(['tasks', 'p1'])?.status).toBe(state));
    expect(screen.queryByText('0 项未结束工作')).not.toBeInTheDocument();
    expect(screen.queryByText('main', { exact: true })).not.toBeInTheDocument();
    expect(
      screen.getByText(state === 'pending' ? '工作数量确认中' : '工作数量读取失败'),
    ).toBeVisible();
    expect(
      screen.getByText(state === 'pending' ? '会话分支确认中' : '会话分支读取失败'),
    ).toBeVisible();
  },
);
it('Git project with no Session does not guess its branch', async () => {
  mount();
  expect(await screen.findByText('当前分支未核验')).toBeVisible();
  expect(screen.queryByText('main', { exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '进入 Work' })).toHaveAttribute(
    'href',
    '/projects/p1/work',
  );
});
it('explicitly labels latest Session branch as historical and preserves continue link', async () => {
  mount({
    sessions: [
      { id: 'old', branch: 'main', lastActiveAt: '2026-11-10T00:00:00Z' },
      { id: 'new', branch: 'feature/actual', lastActiveAt: '2026-11-12T00:00:00Z' },
    ],
  });
  expect(await screen.findByText('最近会话分支：feature/actual')).toBeVisible();
  expect(screen.getByRole('link', { name: '继续会话' })).toHaveAttribute('href', '/workspace/new');
  expect(screen.getByRole('link', { name: '新建工作' })).toHaveAttribute(
    'href',
    '/projects/p1/work/new',
  );
  expect(screen.getByText('0 个登记可用 Agent')).toBeVisible();
});
it.each([null, '', '   '])(
  'latest Session missing branch %s does not fall back to main',
  async (branch) => {
    mount({ sessions: [{ id: 'new', branch, lastActiveAt: '2026-11-12T00:00:00Z' }] });
    expect(await screen.findByText('当前分支未核验')).toBeVisible();
    expect(screen.queryByText('main', { exact: true })).not.toBeInTheDocument();
  },
);
it('cached count/branch are not presented as current after refetch error', async () => {
  const client = mount({
    statuses: ['BACKLOG'],
    sessions: [{ id: 's1', branch: 'cached', lastActiveAt: '2026-11-12T00:00:00Z' }],
  });
  await screen.findByText('1 项未结束工作');
  vi.mocked(api.get).mockRejectedValue(new Error('刷新失败'));
  await Promise.all([
    client.refetchQueries({ queryKey: ['tasks', 'p1'], exact: true }),
    client.refetchQueries({ queryKey: ['sessions', 'p1'], exact: true }),
  ]);
  expect(await screen.findByText('工作数量读取失败')).toBeVisible();
  expect(screen.getByText('会话分支读取失败')).toBeVisible();
  expect(screen.queryByText('1 项未结束工作')).not.toBeInTheDocument();
  expect(screen.queryByText('最近会话分支：cached')).not.toBeInTheDocument();
});

it('mobile keeps title, next action and warnings visible while secondary metadata uses native disclosure', async () => {
  const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === '(max-width: 767px)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  try {
    mount({
      sessions: [{ id: 'new', branch: 'feature/mobile', lastActiveAt: '2026-11-12T00:00:00Z' }],
    });
    expect(await screen.findByRole('heading', { name: '页头审计' })).toBeVisible();
    expect(screen.getByRole('link', { name: '新建工作' })).toBeVisible();
    expect(screen.getByRole('link', { name: '继续会话' })).toHaveAttribute(
      'href',
      '/workspace/new',
    );
    const summary = screen.getByText('项目详情');
    const details = summary.closest('details')!;
    expect(summary.tagName).toBe('SUMMARY');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('最近会话分支：feature/mobile').closest('details')).toBe(details);
    expect(screen.getByText('编辑类型').closest('details')).toBe(details);
    expect(screen.getByText('0 个登记可用 Agent').closest('details')).toBeNull();
    expect(screen.getByText('0 个登记可用 Agent')).toBeVisible();
    expect(screen.getByText('0 个登记可用 Agent').closest('[role="status"]')).toHaveAttribute(
      'data-severity',
      'warning',
    );
  } finally {
    media.mockRestore();
  }
});
it.each(['pending', 'error'] as const)(
  'mobile never puts %s metadata behind closed details',
  async (state) => {
    const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      const client = mount({ state });
      await screen.findByText('概览内容');
      await waitFor(() => expect(client.getQueryState(['tasks', 'p1'])?.status).toBe(state));
      for (const text of state === 'error'
        ? ['会话分支读取失败', '工作数量读取失败']
        : ['会话分支确认中', '工作数量确认中']) {
        expect(screen.getByText(text)).toBeVisible();
        expect(screen.getByText(text).closest('details')).toBeNull();
        if (state === 'error')
          expect(screen.getByText(text).closest('[role="status"]')).toHaveAttribute(
            'data-severity',
            'warning',
          );
      }
      expect(screen.queryByRole('link', { name: '进入 Work' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: '新建工作' })).toBeVisible();
    } finally {
      media.mockRestore();
    }
  },
);
