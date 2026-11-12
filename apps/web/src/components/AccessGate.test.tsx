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
