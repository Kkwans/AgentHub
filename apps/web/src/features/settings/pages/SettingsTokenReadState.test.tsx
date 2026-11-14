// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { AgentHubProvider } from '@agenthub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import type * as ApiModule from '../../../lib/api';
import { SettingsPage } from './SettingsPageView';
vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});
const allowed = {
  mode: 'local_trusted',
  localTrusted: true,
  authenticated: true,
  setupRequired: false,
  user: null,
};
const token = { id: 'token-1', name: '现有集成', revokedAt: null, lastUsedAt: null };
function mount(section = 'integrations') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <AgentHubProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/settings/${section}`]}>
          <Routes>
            <Route path="/settings/:section" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AgentHubProvider>,
  );
  return client;
}
function noWrites() {
  expect(api.post).not.toHaveBeenCalled();
  expect(api.put).not.toHaveBeenCalled();
  expect(api.delete).not.toHaveBeenCalled();
}
it('权限与列表加载中不显示空token，成功空数组才显示空态', async () => {
  let finishAuth!: (value: unknown) => void;
  let finishTokens!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementation(<T,>(path: string) => {
    if (path === '/auth/status')
      return new Promise<unknown>((resolve) => {
        finishAuth = resolve;
      }) as Promise<T>;
    if (path === '/auth/tokens')
      return new Promise<unknown>((resolve) => {
        finishTokens = resolve;
      }) as Promise<T>;
    return Promise.resolve({} as T);
  });
  mount();
  expect(await screen.findByText('正在确认 token 访问权限…')).toBeVisible();
  expect(screen.queryByText('还没有 API token。')).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalledWith('/auth/tokens');
  await act(async () => finishAuth(allowed));
  expect(await screen.findByText('正在读取 API token…')).toBeVisible();
  expect(screen.queryByText('还没有 API token。')).not.toBeInTheDocument();
  await act(async () => finishTokens([]));
  expect(await screen.findByText('还没有 API token。')).toBeVisible();
  noWrites();
});
it.each([false, true])('token读取失败不宣称为空（旧缓存=%s），只读重试恢复', async (cached) => {
  let failed = !cached;
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path === '/auth/status') return allowed as T;
    if (path === '/auth/tokens') {
      if (failed) throw new Error('unavailable');
      return [token] as T;
    }
    return {} as T;
  });
  const client = mount();
  if (cached) {
    await screen.findByText('现有集成');
    failed = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['api-tokens'] });
    });
  }
  expect(await screen.findByText('无法确认现有 API token')).toBeVisible();
  expect(screen.getByText('读取失败不代表没有已生效的 token。')).toBeVisible();
  expect(screen.queryByText('还没有 API token。')).not.toBeInTheDocument();
  expect(screen.queryByText('现有集成')).not.toBeInTheDocument();
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(await screen.findByText('现有集成')).toBeVisible();
  expect(screen.queryByText('无法确认现有 API token')).not.toBeInTheDocument();
  noWrites();
});
it('未启用token查询显示权限未确认，重新确认仅GET并恢复列表', async () => {
  let authenticated = false;
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) =>
    path === '/auth/status'
      ? ({ ...allowed, localTrusted: false, authenticated } as T)
      : path === '/auth/tokens'
        ? ([token] as T)
        : ({} as T),
  );
  mount();
  expect(
    await screen.findByText('尚未确认 API token 访问权限，不能判断是否存在 token。'),
  ).toBeVisible();
  expect(api.get).not.toHaveBeenCalledWith('/auth/tokens');
  expect(screen.queryByText('还没有 API token。')).not.toBeInTheDocument();
  authenticated = true;
  fireEvent.click(screen.getByRole('button', { name: '重新确认登录状态' }));
  expect(await screen.findByText('现有集成')).toBeVisible();
  noWrites();
});
it('认证状态读取失败不展示空列表，重试认证后再读取token', async () => {
  let failed = true;
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path === '/auth/status') {
      if (failed) throw new Error('auth unavailable');
      return allowed as T;
    }
    return (path === '/auth/tokens' ? [token] : {}) as T;
  });
  mount();
  expect(await screen.findByText('无法确认 token 访问权限')).toBeVisible();
  expect(api.get).not.toHaveBeenCalledWith('/auth/tokens');
  expect(screen.queryByText('还没有 API token。')).not.toBeInTheDocument();
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await waitFor(() => expect(screen.getByText('现有集成')).toBeVisible());
  noWrites();
});

it('settings hierarchy keeps six routes and preferences without duplicate badge or current chip', async () => {
  vi.mocked(api.get).mockResolvedValue({});
  mount('appearance');
  expect(screen.queryByText('SETTINGS')).not.toBeInTheDocument();
  expect(screen.getAllByText('外观', { exact: true })).toHaveLength(1);
  expect(screen.getByRole('navigation', { name: '设置分区' }).querySelectorAll('a')).toHaveLength(
    6,
  );
  expect(screen.getByRole('region', { name: '外观偏好' })).toBeVisible();
  expect(screen.getByRole('combobox', { name: '主题' })).toBeVisible();
  const motion = screen.getByRole('switch', { name: '减少动效' });
  expect(motion.closest('label')).toHaveAttribute('for', motion.id);
  const before = (motion as HTMLInputElement).checked;
  fireEvent.click(motion.closest('label')!);
  expect((motion as HTMLInputElement).checked).toBe(!before);
  expect(motion).toHaveAttribute('aria-checked', String(!before));
  fireEvent.click(motion.closest('label')!);
  expect((motion as HTMLInputElement).checked).toBe(before);
  expect(motion).toHaveAttribute('aria-checked', String(before));
  noWrites();
});
