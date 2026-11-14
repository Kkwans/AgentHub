// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import { AgentDiscoveryLayout } from './AgentDiscoveryLayout';
import { DiscoverAgentsPage } from './DiscoverAgentsPage';
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});
let navigateHistory: ReturnType<typeof useNavigate>;
function Navigation() {
  const navigate = useNavigate();
  navigateHistory = navigate;
  return (
    <>
      <button onClick={() => navigate(-1)}>测试后退</button>
      <button onClick={() => navigate(1)}>测试前进</button>
      <button onClick={() => navigate('/other')}>测试切页</button>
    </>
  );
}
function mount(direct = false, rows: unknown[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  vi.spyOn(api, 'get').mockImplementation(
    async <T,>(path: string) => (path === '/discovery/agents' ? rows : []) as T,
  );
  const post = vi.spyOn(api, 'post').mockResolvedValue({});
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[direct ? '/agents/agents/discover' : '/agents']}>
        <Navigation />
        <Routes>
          <Route element={<AgentDiscoveryLayout />}>
            <Route path="/agents" element={null} />
            <Route path="/agents/agents/discover" element={<DiscoverAgentsPage />} />
          </Route>
          <Route path="/other" element={<input aria-label="新页面输入" autoFocus />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return post;
}
it.each(['完成', 'Escape', '后退'])('发现页%s返回同一DOM入口并保留目录筛选', async (method) => {
  const post = mount();
  const trigger = (await screen.findAllByRole('link', { name: '发现 Agent' }))[0]!;
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: '保留草稿' } });
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByRole('dialog', { name: '发现 Agent' });
  if (method === '完成') fireEvent.click(screen.getByRole('button', { name: '完成' }));
  else if (method === 'Escape') fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  else fireEvent.click(screen.getByRole('button', { name: '测试后退', hidden: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(trigger.isConnected).toBe(true);
  expect(screen.getByRole('searchbox')).toBe(search);
  expect(search).toHaveValue('保留草稿');
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(post).not.toHaveBeenCalled();
});
it('直接进入完成返回目录，不依赖站外历史', async () => {
  const post = mount(true);
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Agent 中心' })).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
it('快速切换新页面不被旧弹窗恢复焦点抢回', async () => {
  const post = mount();
  fireEvent.click((await screen.findAllByRole('link', { name: '发现 Agent' }))[0]!);
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: '测试切页', hidden: true }));
  const input = await screen.findByRole('textbox', { name: '新页面输入' });
  await waitFor(() => expect(input).toHaveFocus());
  expect(post).not.toHaveBeenCalled();
});

it('空目录次级发现入口也恢复原DOM而非抢到页头入口', async () => {
  mount();
  const trigger = await screen.findByRole('link', { name: '开始发现' });
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(trigger.isConnected).toBe(true);
});
it('已安装和需授权的添加统计与真实动作一致，来源数量不冒充健康', async () => {
  const post = mount(true, [
    {
      candidateId: 'host:codex',
      agentKind: 'CODEX',
      displayName: 'Codex',
      targetCandidateId: 'host:local',
      state: 'INSTALLED',
      adoptable: true,
    },
    {
      candidateId: 'host:auth',
      agentKind: 'OPENCODE',
      displayName: '登录待处理',
      targetCandidateId: 'host:local',
      state: 'AUTH_REQUIRED',
      adoptable: true,
    },
    {
      candidateId: 'host:missing',
      agentKind: 'OPENCODE',
      displayName: '缺少依赖',
      targetCandidateId: 'host:local',
      state: 'MISSING_DEPENDENCY',
      adoptable: false,
    },
  ]);
  await screen.findByText('3 个候选 · 1 个可添加 · 1 个需授权');
  expect(screen.getAllByRole('button', { name: '添加' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: '去授权' })).toHaveLength(1);
  expect(screen.getByText('已安装', { exact: true })).toBeInTheDocument();
  expect(screen.getByText('已检测到安装，不代表已登录或可运行。')).toBeInTheDocument();
  const disclosure = screen.getByText('来源与隐私说明');
  fireEvent.click(disclosure);
  expect(screen.getAllByText('0 个候选')).toHaveLength(2);
  expect(disclosure.parentElement).not.toHaveTextContent('不可用');
  expect(disclosure.parentElement).not.toHaveTextContent('就绪');
  expect(post).not.toHaveBeenCalled();
});

it.each(['完成', 'Escape'])('secondary后退再前进重开，%s仍恢复原入口', async (method) => {
  const post = mount();
  const secondary = await screen.findByRole('link', { name: '开始发现' });
  secondary.focus();
  fireEvent.click(secondary);
  await screen.findByRole('dialog');
  await act(async () => navigateHistory(-1));
  await waitFor(() => expect(secondary).toHaveFocus());
  await act(async () => navigateHistory(1));
  await screen.findByRole('dialog');
  if (method === '完成') fireEvent.click(screen.getByRole('button', { name: '完成' }));
  else fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(secondary.isConnected).toBe(true);
  await waitFor(() => expect(secondary).toHaveFocus());
  expect(post).not.toHaveBeenCalled();
});
