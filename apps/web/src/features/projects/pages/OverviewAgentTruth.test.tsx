// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AgentHubProvider } from '@agenthub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import type * as ApiModule from '../../../lib/api';
import { ProjectOverviewPage } from './ProjectOverviewPage';
vi.mock('../../../lib/api', async (original) => ({
  ...(await original<typeof ApiModule>()),
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));
vi.mock('./ProjectContextLayout', () => ({
  useProjectContext: () => ({ id: 'p1', name: '项目', repoKind: 'NONE' }),
}));
vi.mock('../hooks/useProjectEligibility', () => ({
  useProjectEligibility: () => ({ isSuccess: true, isFetching: false, data: [], error: null }),
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.resetAllMocks();
});
const agent = { id: 'a1', name: '实际执行者' };
function mount(cache = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  client.setQueryData(['project-preflight', 'p1'], { status: 'READY' });
  client.setQueryData(
    ['tasks', 'p1'],
    [
      { id: 'assigned', title: '已分配工作', status: 'READY', assignedAgentId: 'a1' },
      { id: 'unassigned', title: '未分配工作', status: 'BACKLOG', assignedAgentId: null },
    ],
  );
  client.setQueryData(
    ['sessions', 'p1'],
    [{ id: 's1', title: '原会话', agentId: 'a1', status: 'READY' }],
  );
  if (cache) client.setQueryData(['agents'], [agent]);
  render(
    <AgentHubProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProjectOverviewPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AgentHubProvider>,
  );
  return client;
}
function assigned() {
  return screen.getByRole('link', { name: /已分配工作/ });
}
function session() {
  return screen.getByRole('link', { name: /原会话/ });
}
function noWrites() {
  expect(api.post).not.toHaveBeenCalled();
  expect(api.patch).not.toHaveBeenCalled();
}
it('pending不把有ID工作称为未分配，真实无ID仍明确未分配', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  mount();
  expect(assigned()).toHaveTextContent('正在读取 Agent 信息');
  expect(session()).toHaveTextContent('正在读取 Agent 信息');
  expect(screen.getByRole('link', { name: /未分配工作/ })).toHaveTextContent('尚未分配 Agent');
  await act(async () => finish([agent]));
  await waitFor(() => expect(assigned()).toHaveTextContent(agent.name));
  expect(session()).toHaveTextContent(agent.name);
  noWrites();
});
it.each([false, true])('失败含旧缓存不冒充已知姓名，GET恢复（cache=%s）', async (cache) => {
  let failed = true;
  vi.mocked(api.get).mockImplementation(async () => {
    if (failed) throw new Error('offline');
    return [agent] as never;
  });
  const client = mount(cache);
  if (cache)
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['agents'] });
    });
  const error = await screen.findByRole('alert', { name: 'Agent 姓名读取状态' });
  expect(assigned()).toHaveTextContent('Agent 信息未知');
  expect(session()).toHaveTextContent('Agent 信息未知');
  expect(screen.queryByText(agent.name, { exact: true })).not.toBeInTheDocument();
  expect(assigned()).toHaveAttribute('href', '/projects/p1/work?task=assigned');
  expect(session()).toHaveAttribute('href', '/workspace/s1');
  failed = false;
  fireEvent.click(within(error).getByRole('button', { name: '重新读取 Agent 信息' }));
  await waitFor(() => expect(assigned()).toHaveTextContent(agent.name));
  expect(session()).toHaveTextContent(agent.name);
  expect(screen.queryByRole('alert', { name: 'Agent 姓名读取状态' })).not.toBeInTheDocument();
  noWrites();
});
it('成功但缺记录与真正未分配不同', async () => {
  vi.mocked(api.get).mockResolvedValue([]);
  mount();
  await waitFor(() => expect(assigned()).toHaveTextContent('Agent 记录未找到'));
  expect(session()).toHaveTextContent('Agent 记录未找到');
  expect(screen.getByRole('link', { name: /未分配工作/ })).toHaveTextContent('尚未分配 Agent');
  noWrites();
});
