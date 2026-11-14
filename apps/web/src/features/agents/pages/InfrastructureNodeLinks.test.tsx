// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import { InfrastructurePage } from './InfrastructurePage';
import { RemoteNodeRegistrationPage } from './RemoteNodeRegistrationPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('空节点目录仅保留页头授权入口及完整安全说明，不提交注册', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['remote-nodes'], []);
  const get = vi.spyOn(api, 'get').mockResolvedValue([]);
  const post = vi.spyOn(api, 'post').mockResolvedValue({});
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/agents/nodes']}>
        <Routes>
          <Route path="/agents/nodes" element={<InfrastructurePage kind="nodes" />} />
          <Route path="/agents/nodes/register" element={<h1>注册表单入口</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const links = await screen.findAllByRole('link', { name: '授权 Node' });
  expect(links).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '授权 Node' })).not.toBeInTheDocument();
  for (const link of links) {
    expect(link).toHaveAttribute('href', '/agents/nodes/register');
    expect(link.className).toContain('authorizeLink');
    expect(link.querySelector('button')).toBeNull();
  }
  expect(screen.getByRole('heading', { name: '远程节点', level: 1 })).toBeInTheDocument();
  expect(screen.queryByText('Agent Infrastructure')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '还没有远程节点' })).toBeInTheDocument();
  expect(screen.getByText(/注册码只展示一次，撤销需要明确确认/)).toBeInTheDocument();
  expect(screen.getByText(/在目标设备运行 Node daemon/)).toBeInTheDocument();
  const link = links[0]!;
  await waitFor(() => expect(link).toBeVisible());
  link.focus();
  expect(link).toHaveFocus();
  fireEvent.click(link);
  expect(screen.getByRole('heading', { name: '注册表单入口' })).toBeVisible();
  expect(post).not.toHaveBeenCalled();
  expect(get.mock.calls.every(([path]) => path === '/remote-nodes')).toBe(true);
  client.clear();
});

it('注册页紧凑中文标题保留目录与一次性凭据说明，填写目录不自动提交', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RemoteNodeRegistrationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByRole('heading', { name: '授权远程节点', level: 1 })).toBeInTheDocument();
  expect(screen.queryByText('Remote Nodes', { exact: true })).not.toBeInTheDocument();
  expect(
    screen.getByText('只授权 Agent 实际需要访问的目录。注册码为一次性凭据，生成后只展示一次。'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '返回节点' })).toBeInTheDocument();
  const generate = screen.getByRole('button', { name: '生成一次性注册码' });
  expect(generate).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Node 名称' }), {
    target: { value: '受控测试' },
  });
  const roots = screen.getByRole('textbox', { name: '授权目录' });
  fireEvent.change(roots, { target: { value: '/test/workspace' } });
  fireEvent.keyDown(roots, { key: 'Enter' });
  expect(generate).toBeEnabled();
  expect(screen.getByRole('button', { name: '/test/workspace ×' })).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
  client.clear();
});

it('诊断保留真实scope与完整原始数据，只在显式刷新时重读', async () => {
  const data = {
    message: '仅为受控诊断内容，不代表连接成功',
    longPath: '/test/' + 'long/'.repeat(100),
  };
  const get = vi.spyOn(api, 'get').mockResolvedValue(data);
  const post = vi.spyOn(api, 'post').mockResolvedValue({});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InfrastructurePage kind="diagnostics" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getAllByRole('heading', { name: '服务器诊断' })).toHaveLength(1);
  expect(screen.queryByText('Agent Infrastructure')).not.toBeInTheDocument();
  expect(
    screen.getByText(
      '检查当前 AgentHub 服务器的进程与供应商环境，不代表某个 Agent 或远程执行环境的专属诊断。',
    ),
  ).toBeInTheDocument();
  await screen.findByText(data.message);
  const summary = screen.getByText('查看详细诊断');
  expect(summary.tagName).toBe('SUMMARY');
  expect(summary.parentElement).not.toHaveAttribute('open');
  fireEvent.click(summary);
  expect(summary.parentElement).toHaveAttribute('open');
  expect(summary.parentElement?.querySelector('pre')?.textContent).toBe(
    JSON.stringify(data, null, 2),
  );
  expect(get).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(get.mock.calls.every(([path]) => path === '/agents/diagnostics/host')).toBe(true);
  expect(post).not.toHaveBeenCalled();
  client.clear();
});

it('注册成功仅使用模拟响应，保留一次性展示、复制及完成入口', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({
      token: 'fixture-only-not-a-real-token',
      allowedRoots: ['/test/workspace'],
    });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RemoteNodeRegistrationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Node 名称' }), {
    target: { value: '受控测试' },
  });
  const roots = screen.getByRole('textbox', { name: '授权目录' });
  fireEvent.change(roots, { target: { value: '/test/workspace' } });
  fireEvent.keyDown(roots, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: '生成一次性注册码' }));
  await screen.findByText('fixture-only-not-a-real-token');
  expect(
    screen.getByText('请在目标设备完成 Node daemon 配置。关闭页面后 token 不会再次显示。'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '复制注册码' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument();
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith('/remote-nodes/registration-tokens', {
    name: '受控测试',
    allowedRoots: ['/test/workspace'],
    expiresInMinutes: 15,
  });
  client.clear();
});
