// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api, authSession, type AgentRecord } from '../../../lib/api';
import { AgentAvailability } from './AgentAvailability';
import {
  availabilityKey,
  readMarker,
  resetAvailabilityForTests,
} from '../lib/agent-availability-state';
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'local_trusted',
  useAuthUser: () => null,
}));
vi.mock('../../../lib/api', async (original) => ({
  ...(await original<{ api: typeof api; authSession: typeof authSession }>()),
  api: { get: vi.fn(), patch: vi.fn() },
}));
const agent = { id: 'a', targetId: 't', enabled: true, enabledRevision: 0 } as AgentRecord;
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  resetAvailabilityForTests();
  clients.splice(0).forEach((c) => c.clear());
  vi.restoreAllMocks();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.patch).mockReset();
});
function mount(value = agent) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const onObserved = vi.fn();
  const result = render(
    <QueryClientProvider client={client}>
      <AgentAvailability agent={value} onObserved={onObserved} />
    </QueryClientProvider>,
  );
  return { ...result, onObserved, client };
}
async function lose() {
  vi.mocked(api.patch).mockRejectedValue(new Error('lost'));
  fireEvent.click(screen.getByRole('button', { name: '禁用新工作' }));
  await screen.findByText('启停结果未知，请只读核对；不会自动重试。');
}
it('only exact committed response confirms; duplicate clicks submit once and invalidate eligibility', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(api.patch).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }) as never,
  );
  const f = mount();
  f.client.setQueryData(['agents'], [agent]);
  f.client.setQueryData(['agent-eligibility', 'p'], ['old']);
  const button = screen.getByRole('button', { name: '禁用新工作' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(api.patch).toHaveBeenCalledTimes(1);
  expect(api.patch).toHaveBeenCalledWith('/agents/a/availability', {
    enabled: false,
    expectedRevision: 0,
  });
  await act(async () => resolve({ ...agent, enabled: false, enabledRevision: 1 }));
  await screen.findByText('本次启停设置已保存。');
  expect(f.onObserved).toHaveBeenCalledWith({ ...agent, enabled: false, enabledRevision: 1 });
  expect(f.client.getQueryState(['agent-eligibility', 'p'])?.isInvalidated).toBe(true);
});
it('unknown survives remount; same revision GET does not unlock; higher revision is a new explicit intent', async () => {
  const first = mount();
  await lose();
  first.unmount();
  const second = mount();
  expect(screen.getByRole('button', { name: '禁用新工作' })).toBeDisabled();
  vi.mocked(api.get).mockResolvedValue([agent]);
  fireEvent.click(screen.getByRole('button', { name: '核对启停状态' }));
  await screen.findByText('已读取当前状态；这不证明原请求成功，未重新提交。');
  expect(screen.queryByRole('button', { name: /新操作/ })).not.toBeInTheDocument();
  vi.mocked(api.get).mockResolvedValue([{ ...agent, enabled: false, enabledRevision: 2 }]);
  fireEvent.click(screen.getByRole('button', { name: '核对启停状态' }));
  const next = await screen.findByRole('button', { name: '基于当前版本启用（新操作）' });
  expect(api.patch).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('本次启停设置已保存。')).not.toBeInTheDocument();
  vi.mocked(api.patch).mockResolvedValue({ ...agent, enabledRevision: 3 });
  fireEvent.click(next);
  await screen.findByText('本次启停设置已保存。');
  expect(api.patch).toHaveBeenLastCalledWith('/agents/a/availability', {
    enabled: true,
    expectedRevision: 2,
  });
  expect(second.onObserved).toHaveBeenCalled();
});
it.each([
  { ...agent, enabled: false, enabledRevision: 4 },
  { ...agent, id: 'other', enabled: false, enabledRevision: 1 },
  { ...agent, targetId: 'other', enabled: false, enabledRevision: 1 },
  { ...agent, enabled: true, enabledRevision: 1 },
])('mismatched PATCH response remains unknown %#', async (result) => {
  vi.mocked(api.patch).mockResolvedValue(result);
  const f = mount();
  fireEvent.click(screen.getByRole('button', { name: '禁用新工作' }));
  await screen.findByText('启停结果未知，请只读核对；不会自动重试。');
  expect(f.onObserved).not.toHaveBeenCalled();
});
it('failed storage means zero PATCH; absent revision and overflow are fail closed', async () => {
  const f = mount();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  fireEvent.click(screen.getByRole('button', { name: '禁用新工作' }));
  await screen.findByText('无法保存保护记录，本次未发送。');
  expect(api.patch).not.toHaveBeenCalled();
  f.unmount();
  const old = { ...agent };
  delete old.enabledRevision;
  const missing = mount(old);
  expect(screen.getByRole('button', { name: '启用新工作' })).toBeDisabled();
  missing.unmount();
  mount({ ...agent, enabledRevision: 2147483647 });
  expect(screen.getByRole('button', { name: '禁用新工作' })).toBeDisabled();
});
it('durable pending reloads unknown with only operation metadata', async () => {
  const key = availabilityKey('local-trusted', 'a', 't');
  localStorage.setItem(
    'agenthub.agent-availability.v1:' + key,
    JSON.stringify({ phase: 'pending', revision: 0, target: false }),
  );
  mount();
  expect(readMarker(key)?.phase).toBe('unknown');
  expect(screen.getByRole('button', { name: '禁用新工作' })).toBeDisabled();
  expect(api.patch).not.toHaveBeenCalled();
});
it('authorization loss suppresses late success and prevents more requests', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(api.patch).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }) as never,
  );
  const f = mount();
  fireEvent.click(screen.getByRole('button', { name: '禁用新工作' }));
  act(() => authSession.notifyAuthorizationRequired());
  await act(async () => resolve({ ...agent, enabled: false, enabledRevision: 1 }));
  expect(f.onObserved).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '核对启停状态' })).toBeDisabled();
});
it('leaving aborts GET and late result cannot update the prior Agent', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }) as never,
  );
  const f = mount();
  fireEvent.click(screen.getByRole('button', { name: '核对启停状态' }));
  const signal = vi.mocked(api.get).mock.calls[0]![1]!.signal!;
  f.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve([{ ...agent, enabled: false, enabledRevision: 2 }]));
  expect(f.onObserved).not.toHaveBeenCalled();
});
it('older reads cannot downgrade state; duplicate identities cannot be adopted', async () => {
  mount({ ...agent, enabledRevision: 3 });
  fireEvent.click(screen.getByText('版本与原操作详情'));
  for (const rows of [[agent], [agent, agent]]) {
    vi.mocked(api.get).mockResolvedValue(rows);
    fireEvent.click(screen.getByRole('button', { name: '核对启停状态' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '核对启停状态' })).toBeEnabled());
    expect(screen.getByText('当前设置：已启用 · 版本 3')).toBeVisible();
  }
});
it('cache publication failure does not erase authoritative commit evidence', async () => {
  vi.mocked(api.patch).mockResolvedValue({ ...agent, enabled: false, enabledRevision: 1 });
  const f = mount();
  vi.spyOn(f.client, 'cancelQueries').mockRejectedValue(new Error('cache failed'));
  fireEvent.click(screen.getByRole('button', { name: '禁用新工作' }));
  await screen.findByText('本次启停设置已保存，但页面状态未同步；请只读核对。');
  expect(readMarker(availabilityKey('local-trusted', 'a', 't'))).toEqual({
    phase: 'settled',
    revision: 1,
    target: false,
  });
});
it('higher external pending cannot be overwritten by a stale unknown new-intent button', async () => {
  mount();
  await lose();
  vi.mocked(api.get).mockResolvedValue([{ ...agent, enabled: false, enabledRevision: 2 }]);
  fireEvent.click(screen.getByRole('button', { name: '核对启停状态' }));
  const next = await screen.findByRole('button', { name: /新操作/ });
  const key = 'agenthub.agent-availability.v1:' + availabilityKey('local-trusted', 'a', 't');
  const external = JSON.stringify({ phase: 'pending', revision: 2, target: true });
  localStorage.setItem(key, external);
  fireEvent.click(next);
  expect(api.patch).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(key)).toBe(external);
});
it('read-only recovery never rewrites durable unknown evidence', async () => {
  mount();
  await lose();
  const before = { ...localStorage };
  vi.mocked(api.get).mockResolvedValue([{ ...agent, enabled: false, enabledRevision: 1 }]);
  fireEvent.click(screen.getByRole('button', { name: '核对启停状态' }));
  await screen.findByText('已读取当前状态；这不证明原请求成功，未重新提交。');
  expect({ ...localStorage }).toEqual(before);
  expect(api.patch).toHaveBeenCalledTimes(1);
});
it.each(['success', 'failure', 'unmount'])(
  'old PATCH %s cannot replace a higher revision pending marker',
  async (outcome) => {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    vi.mocked(api.patch).mockImplementation(
      () =>
        new Promise((r, j) => {
          resolve = r;
          reject = j;
        }) as never,
    );
    const f = mount();
    fireEvent.click(screen.getByRole('button', { name: '禁用新工作' }));
    const key = 'agenthub.agent-availability.v1:' + availabilityKey('local-trusted', 'a', 't');
    const external = JSON.stringify({ phase: 'pending', revision: 2, target: true });
    localStorage.setItem(key, external);
    await act(async () => {
      if (outcome === 'success') resolve({ ...agent, enabled: false, enabledRevision: 1 });
      else if (outcome === 'failure') reject(new Error('lost'));
    });
    expect(localStorage.getItem(key)).toBe(external);
    expect(f.onObserved).not.toHaveBeenCalled();
    if (outcome !== 'unmount')
      expect(screen.getByRole('button', { name: '核对启停状态' })).toBeEnabled();
    f.unmount();
    expect(localStorage.getItem(key)).toBe(external);
    mount();
    expect(screen.getByRole('button', { name: '核对启停状态' })).toBeEnabled();
    vi.mocked(api.get).mockResolvedValue([{ ...agent, enabled: false, enabledRevision: 2 }]);
    fireEvent.click(screen.getByRole('button', { name: '核对启停状态' }));
    await screen.findByText('已读取当前状态；这不证明原请求成功，未重新提交。');
    expect(screen.queryByRole('button', { name: /新操作/ })).not.toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(key)).toBe(external);
  },
);
it('external settled revision is not a new pending floor; authoritative GET permits an explicit new intent', async () => {
  mount();
  await lose();
  const key = 'agenthub.agent-availability.v1:' + availabilityKey('local-trusted', 'a', 't');
  localStorage.setItem(key, JSON.stringify({ phase: 'settled', revision: 1, target: false }));
  act(() => window.dispatchEvent(new StorageEvent('storage', { key })));
  vi.mocked(api.get).mockResolvedValue([{ ...agent, enabled: false, enabledRevision: 1 }]);
  fireEvent.click(screen.getByRole('button', { name: '核对启停状态' }));
  await screen.findByRole('button', { name: '基于当前版本启用（新操作）' });
  expect(api.patch).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('本次启停设置已保存。')).not.toBeInTheDocument();
});

it('discloses technical facts without unlocking an unknown attempt or hiding its safety warning', async () => {
  mount();
  await lose();
  expect(screen.getByRole('heading', { name: '原操作结果未知' })).toBeVisible();
  expect(screen.getByText('待核对', { exact: true })).toBeVisible();
  expect(screen.queryByText('当前设置：已启用', { exact: true })).not.toBeInTheDocument();
  expect(
    screen.getByText('当前状态不是原请求的成功证明。只有核对到更高版本，才能明确发起新操作。'),
  ).toBeVisible();
  const facts = screen.getByText('原操作：版本 0，请求禁用。结果未知。');
  expect(facts).not.toBeVisible();
  fireEvent.click(screen.getByText('版本与原操作详情'));
  expect(facts).toBeVisible();
  expect(screen.getByText('当前设置：已启用 · 版本 0')).toBeVisible();
  expect(screen.getByRole('button', { name: '禁用新工作' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '核对启停状态' })).toBeEnabled();
  fireEvent.click(screen.getByText('版本与原操作详情'));
  expect(facts).not.toBeVisible();
  expect(screen.getByRole('button', { name: '禁用新工作' })).toBeDisabled();
  expect(api.patch).toHaveBeenCalledTimes(1);
  expect(api.get).not.toHaveBeenCalled();
});
