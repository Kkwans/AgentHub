// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { authApi } from '../lib/auth-api';
import { AccessGate, useAuthMode, useAuthUser, type AuthStatus } from './AccessGate';

function IdentityProbe() {
  const mode = useAuthMode();
  const user = useAuthUser();
  return <output data-testid="identity">{JSON.stringify({ mode, user })}</output>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each<AuthStatus>([
  {
    mode: 'local_trusted',
    localTrusted: true,
    setupRequired: false,
    authenticated: true,
    user: null,
  },
  {
    mode: 'token',
    localTrusted: false,
    setupRequired: false,
    authenticated: true,
    user: { id: 'user-1', username: '实际用户', role: 'ADMIN' },
  },
])('exposes only the resolved $mode identity to the shell', (status) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['auth-status'], status);
  render(
    <QueryClientProvider client={client}>
      <AccessGate>
        <IdentityProbe />
      </AccessGate>
    </QueryClientProvider>,
  );
  expect(JSON.parse(screen.getByTestId('identity').textContent!)).toEqual({
    mode: status.mode,
    user: status.user,
  });
  client.clear();
});

it('does not invent a user or access mode without a resolved gate', () => {
  render(<IdentityProbe />);
  expect(JSON.parse(screen.getByTestId('identity').textContent!)).toEqual({ user: null });
});

it.each([false, true])(
  '认证页保留明确主标题且只有一个完整品牌字标（setup=%s）',
  (setupRequired) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth-status'], {
      mode: 'token',
      localTrusted: false,
      authenticated: false,
      setupRequired,
      user: null,
    });
    const { container } = render(
      <QueryClientProvider client={client}>
        <AccessGate>
          <IdentityProbe />
        </AccessGate>
      </QueryClientProvider>,
    );
    expect(
      screen.getByRole('heading', {
        name: setupRequired ? '创建管理员账号' : '登录 AgentHub',
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('[data-brand-wordmark]')).toHaveLength(1);
    expect(container.querySelector('[data-brand-wordmark]')?.textContent).toBe('AgentHub');
    expect(
      container.querySelector('.agenthub-logo, [data-brand-glyph], [data-brand-monogram]'),
    ).toBeNull();
    client.clear();
  },
);

it('本页密码可独立显隐且不提交，保留原安全说明', () => {
  const post = vi.spyOn(authApi, 'post');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['auth-status'], {
    mode: 'token',
    localTrusted: false,
    authenticated: false,
    setupRequired: true,
    user: null,
  });
  render(
    <QueryClientProvider client={client}>
      <AccessGate>
        <IdentityProbe />
      </AccessGate>
    </QueryClientProvider>,
  );
  expect(screen.queryByText('工程控制平面')).not.toBeInTheDocument();
  expect(screen.queryByText('首次设置')).not.toBeInTheDocument();
  const password = screen.getByLabelText('密码', { exact: true });
  const confirmation = screen.getByLabelText('确认密码', { exact: true });
  fireEvent.change(password, { target: { value: 'synthetic-password' } });
  fireEvent.change(confirmation, { target: { value: 'synthetic-confirmation' } });
  for (const input of [password, confirmation]) {
    const wrapper = input.parentElement!.parentElement!;
    const toggle = within(wrapper).getByRole('button', { name: '显示密码' });
    expect(toggle).toHaveAttribute('type', 'button');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  }
  expect(password).toHaveValue('synthetic-password');
  expect(confirmation).toHaveValue('synthetic-confirmation');
  expect(post).not.toHaveBeenCalled();
  expect(
    screen.getByText('设置本机管理员账号。创建完成后，其他人必须登录才能访问这个 AgentHub。'),
  ).toBeInTheDocument();
  expect(screen.getByText('此设备将保持登录 7 天。你可以随时从设置页退出。')).toBeInTheDocument();
  client.clear();
});

it('加载状态保留正在连接与认证读取语义', () => {
  vi.spyOn(authApi, 'get').mockImplementation(() => new Promise(() => undefined));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AccessGate>
        <IdentityProbe />
      </AccessGate>
    </QueryClientProvider>,
  );
  expect(screen.getByRole('main', { name: '正在连接 AgentHub' })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  expect(screen.getByRole('status')).toHaveTextContent('正在读取服务认证状态…');
  expect(screen.getByText('正在连接')).toBeInTheDocument();
  expect(screen.queryByText('工程控制平面')).not.toBeInTheDocument();
  client.clear();
});

it('44触点和密码留白只约束本页，不改变共享控件', () => {
  const css = readFileSync(new NodeURL('./AccessGate.module.css', import.meta.url), 'utf8');
  expect(css).toMatch(/\.form input\s*\{[^}]*min-height: 44px/s);
  expect(css).toMatch(/\.form > button\s*\{[^}]*min-height: 44px/s);
  expect(css).toMatch(/\.passwordControl input\s*\{[^}]*padding-right: 48px/s);
  expect(css).toMatch(/\.passwordControl > span > button\s*\{[^}]*width: 44px;[^}]*height: 44px/s);
  expect(css).toMatch(/\.card\s*\{[^}]*box-shadow: none/s);
  const sharedCss = readFileSync(
    new NodeURL('../../../../packages/ui/src/pinharness.css', import.meta.url),
    'utf8',
  );
  const accessCardRule = sharedCss.match(/^\.app-access-card\s*\{([^}]*)\}/m)?.[1];
  expect(accessCardRule).toBeDefined();
  expect(accessCardRule).toMatch(/(?:^|;)\s*box-shadow:\s*none\s*;/);

  expect(css).toMatch(/\.card > button\s*\{\s*min-height: 44px;\s*\}/s);
});

it('认证读取失败保留重试和错误说明，不显示登录表单', async () => {
  const get = vi.spyOn(authApi, 'get').mockRejectedValue(new Error('fixture unavailable'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AccessGate>
        <IdentityProbe />
      </AccessGate>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: '暂时无法连接' });
  expect(screen.getByRole('alert')).toHaveTextContent('无法读取服务认证状态。');
  expect(screen.queryByLabelText('用户名')).not.toBeInTheDocument();
  const retry = screen.getByRole('button', { name: '重试连接' });
  expect(retry.parentElement).toHaveClass('app-access-card');
  const before = get.mock.calls.length;
  fireEvent.click(retry);
  expect(get.mock.calls.length).toBe(before + 1);
  client.clear();
});
