// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AgentHubProvider } from '@agenthub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import type * as ApiModule from '../../../lib/api';
import { ProjectSessionsPage } from './ProjectSessionsPage';
vi.mock('../../../lib/api', async (original) => ({
  ...(await original<typeof ApiModule>()),
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('./ProjectContextLayout', () => ({
  useProjectContext: () => ({ id: 'p1', name: '项目', rootPath: '/repo', repoKind: 'NONE' }),
}));
const viewport = vi.hoisted(() => ({ compact: true }));
vi.mock('../../shared/page-primitives', async (original) => ({
  ...(await original()),
  useCompactViewport: () => viewport.compact,
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.clearAllMocks();
  viewport.compact = true;
});
function mount() {
  vi.mocked(api.get).mockImplementation(
    async <T,>(path: string) =>
      (path === '/agents'
        ? [{ id: 'a1', name: 'Codex', status: 'READY' }]
        : path.startsWith('/sessions?')
          ? [
              {
                id: 's1',
                title: '有活动会话',
                agentId: 'a1',
                status: 'READY',
                lastActiveAt: '2026-08-28T01:30:00.000Z',
              },
              { id: 's2', title: '新会话', agentId: 'a1', status: 'READY', lastActiveAt: null },
            ]
          : []) as T,
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const view = render(
    <AgentHubProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProjectSessionsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AgentHubProvider>,
  );
  return { ...view, client };
}
it('保留真实活动时间和无时间状态，选择链接不变', async () => {
  mount();
  const link = await screen.findByRole('link', { name: /有活动会话/ });
  expect(link.querySelector('time')).toHaveAttribute('datetime', '2026-08-28T01:30:00.000Z');
  expect(link).toHaveAttribute('href', '/workspace/s1');
  expect(screen.getByRole('link', { name: /新会话/ })).toHaveTextContent('暂无活动时间');
  expect(screen.getByRole('link', { name: /新会话/ }).querySelector('time')).toBeNull();
});
it('手机折叠保留筛选，清除条件返回焦点，创建入口常驻', async () => {
  mount();
  await screen.findByRole('link', { name: /有活动会话/ });
  const toggle = screen.getByRole('button', { name: '筛选' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('combobox', { name: '会话 Agent' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '新建会话' })).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索会话' }), {
    target: { value: '有活动' },
  });
  expect(toggle).toHaveTextContent('筛选（1）');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(toggle);
  expect(screen.getByRole('textbox', { name: '搜索会话' })).toHaveValue('有活动');
  fireEvent.click(screen.getByRole('button', { name: '清除条件' }));
  expect(toggle).toHaveFocus();
  expect(screen.getByRole('textbox', { name: '搜索会话' })).toHaveValue('');
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(api.post).not.toHaveBeenCalled();
});

it('resize只迁移将被隐藏的筛选焦点，不抢常驻搜索', async () => {
  viewport.compact = false;
  const view = mount();
  await screen.findByRole('link', { name: /有活动会话/ });
  screen.getByRole('combobox', { name: '会话 Agent' }).focus();
  viewport.compact = true;
  // Re-render the same providers and component, preserving the mounted filter controls.
  view.rerender(
    <AgentHubProvider>
      <QueryClientProvider client={view.client}>
        <MemoryRouter>
          <ProjectSessionsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AgentHubProvider>,
  );
  expect(screen.getByRole('button', { name: '筛选' })).toHaveFocus();
  const search = screen.getByRole('textbox', { name: '搜索会话' });
  search.focus();
  viewport.compact = false;
  view.rerender(
    <AgentHubProvider>
      <QueryClientProvider client={view.client}>
        <MemoryRouter>
          <ProjectSessionsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AgentHubProvider>,
  );
  viewport.compact = true;
  view.rerender(
    <AgentHubProvider>
      <QueryClientProvider client={view.client}>
        <MemoryRouter>
          <ProjectSessionsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AgentHubProvider>,
  );
  expect(search).toHaveFocus();
});
it('Agent和状态选择折叠后保留，清除重置全部条件', async () => {
  mount();
  await screen.findByRole('link', { name: /有活动会话/ });
  const toggle = screen.getByRole('button', { name: '筛选' });
  fireEvent.click(toggle);
  fireEvent.keyDown(screen.getByRole('combobox', { name: '会话 Agent' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Codex' }));
  fireEvent.keyDown(screen.getByRole('combobox', { name: '会话状态' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: '就绪' }));
  expect(toggle).toHaveTextContent('筛选（2）');
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  expect(screen.getByRole('combobox', { name: '会话 Agent' })).toHaveTextContent('Codex');
  expect(screen.getByRole('combobox', { name: '会话状态' })).toHaveTextContent('就绪');
  fireEvent.click(screen.getByRole('button', { name: '清除条件' }));
  expect(screen.getByRole('combobox', { name: '会话 Agent' })).toHaveTextContent('全部 Agent');
  expect(screen.getByRole('combobox', { name: '会话状态' })).toHaveTextContent('全部状态');
  expect(toggle).toHaveFocus();
});
