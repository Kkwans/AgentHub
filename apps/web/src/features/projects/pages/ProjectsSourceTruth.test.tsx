// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AgentHubProvider } from '@agenthub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import type * as ApiModule from '../../../lib/api';
import type * as PagePrimitives from '../../shared/page-primitives';
import { ProjectsPage } from './ProjectsPage';
vi.mock('../../../lib/api', async (original) => ({
  ...(await original<typeof ApiModule>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
const viewport = vi.hoisted(() => ({ compact: false }));
vi.mock('../../shared/page-primitives', async (original) => ({
  ...(await original<typeof PagePrimitives>()),
  useCompactViewport: () => viewport.compact,
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.resetAllMocks();
  viewport.compact = false;
});
const project = {
  id: 'p1',
  name: '真实项目',
  status: 'ACTIVE',
  kind: 'STANDARD',
  repoKind: 'GIT',
  rootPath: '/repo',
};
const cached = {
  tasks: [{ id: 't1', projectId: 'p1', status: 'IN_PROGRESS' }],
  sessions: [
    { id: 's1', projectId: 'p1', branch: 'old-branch', lastActiveAt: '2026-08-01T01:00:00Z' },
  ],
  agents: [{ id: 'a1', enabled: true, status: 'READY' }],
};
function mount(withCache = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  client.setQueryData(['projects'], [project]);
  if (withCache)
    for (const [key, value] of Object.entries(cached)) client.setQueryData([key], value);
  const view = render(
    <AgentHubProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProjectsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AgentHubProvider>,
  );
  return { client, view };
}
const sources = [
  ['tasks', '工作统计'],
  ['sessions', '会话记录'],
  ['agents', 'Agent 登记'],
] as const;
for (const withCache of [false, true]) {
  it.each(sources)(`%s失败显示未知并只读恢复（缓存=${withCache}）`, async (key, label) => {
    let failed = true;
    vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
      if (path === `/${key}` && failed) throw new Error('temporary failure');
      return [] as T;
    });
    const { client } = mount(withCache);
    if (withCache)
      await act(async () => {
        await client.invalidateQueries({ queryKey: [key] });
      });
    const status = await screen.findByRole('alert', { name: `${label}读取状态` });
    expect(status).toHaveTextContent('未知');
    const list = screen.getByRole('region', { name: '项目列表' });
    expect(within(list).getAllByText('未知').length).toBeGreaterThan(0);
    if (key === 'sessions') expect(list).not.toHaveTextContent('old-branch');
    expect(
      screen
        .getAllByRole('link', { name: /真实项目/ })
        .find((link) => link.getAttribute('href') === '/projects/p1/overview'),
    ).toHaveAttribute('href', '/projects/p1/overview');
    failed = false;
    fireEvent.click(within(status).getByRole('button', { name: `重新读取${label}` }));
    await waitFor(() =>
      expect(screen.queryByRole('alert', { name: `${label}读取状态` })).not.toBeInTheDocument(),
    );
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });
}
it('加载未完成不报零，成功空会话不捏造main，Agent明确全局登记', async () => {
  let finish!: (value: unknown[]) => void;
  const pending = new Promise<unknown[]>((resolve) => {
    finish = resolve;
  });
  vi.mocked(api.get).mockImplementation(() => pending as never);
  mount();
  expect(await screen.findByRole('status', { name: '工作统计读取状态' })).toHaveTextContent(
    '正在加载',
  );
  expect(screen.getAllByText('加载中').length).toBeGreaterThan(0);
  expect(screen.queryAllByText('0')).toHaveLength(0);
  await act(async () => finish([]));
  expect(await screen.findByText('分支未记录')).toBeVisible();
  expect(screen.getAllByText('0')).toHaveLength(2);
  expect(screen.getByRole('region', { name: '项目列表' })).not.toHaveTextContent('main');
  expect(screen.getByText('全局登记就绪')).toHaveAttribute(
    'title',
    expect.stringContaining('不代表当前项目'),
  );
});

it.each([null, 'invalid-time'])('未知时间%s置末，不盖住真正最近会话分支', async (unknownTime) => {
  vi.mocked(api.get).mockResolvedValue([]);
  const { client } = mount(true);
  await act(async () => {
    client.setQueryData(
      ['sessions'],
      [
        { id: 'unknown', projectId: 'p1', branch: 'unknown-order', lastActiveAt: unknownTime },
        {
          id: 'valid',
          projectId: 'p1',
          branch: 'real-latest',
          lastActiveAt: '2026-09-01T01:00:00Z',
        },
      ],
    );
  });
  expect(await screen.findByText('real-latest')).toBeVisible();
  expect(screen.queryByText('unknown-order')).not.toBeInTheDocument();
  await act(async () => {
    client.setQueryData(
      ['sessions'],
      [{ id: 'unknown', projectId: 'p1', branch: 'unknown-order', lastActiveAt: unknownTime }],
    );
  });
  expect(await screen.findByText('最近会话未知')).toBeVisible();
  expect(screen.queryByText('会话活动')).not.toBeInTheDocument();
});
function tree(client: QueryClient) {
  return (
    <AgentHubProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProjectsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AgentHubProvider>
  );
}
it('resize只迁移隐藏筛选焦点，清除后手机回筛选/桌面回搜索', async () => {
  vi.mocked(api.get).mockResolvedValue([]);
  const { client, view } = mount(true);
  await screen.findByText('old-branch');
  screen.getByRole('combobox', { name: '项目状态' }).focus();
  viewport.compact = true;
  view.rerender(tree(client));
  expect(screen.getByRole('button', { name: '筛选和排序' })).toHaveFocus();
  const search = screen.getByRole('textbox', { name: '搜索项目' });
  search.focus();
  viewport.compact = false;
  view.rerender(tree(client));
  viewport.compact = true;
  view.rerender(tree(client));
  expect(search).toHaveFocus();
  fireEvent.change(search, { target: { value: '真实' } });
  fireEvent.click(screen.getByRole('button', { name: '清除条件' }));
  expect(screen.getByRole('button', { name: '筛选和排序' })).toHaveFocus();
  viewport.compact = false;
  view.rerender(tree(client));
  fireEvent.change(search, { target: { value: '真实' } });
  fireEvent.click(screen.getByRole('button', { name: '清除条件（1）' }));
  expect(search).toHaveFocus();
});
