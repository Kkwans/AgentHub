// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { AccessGate, useAuthMode, useAuthUser, type AuthStatus } from './AccessGate';

function IdentityProbe() {
  const mode = useAuthMode();
  const user = useAuthUser();
  return <output data-testid="identity">{JSON.stringify({ mode, user })}</output>;
}

afterEach(cleanup);

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
