// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import { InfrastructurePage } from './InfrastructurePage';

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
