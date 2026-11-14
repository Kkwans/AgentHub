// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, authSession, type MessageRecord } from '../../lib/api';
import { useSessionMessages } from './useSessionMessages';
vi.mock('../../lib/api', async (original) => ({
  ...(await original<{ api: typeof api; authSession: typeof authSession }>()),
  api: { get: vi.fn() },
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.mocked(api.get).mockReset();
});
function setup(initial = 'A') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const cancel = vi.spyOn(client, 'cancelQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(({ id }) => useSessionMessages(id), { initialProps: { id: initial }, wrapper }),
    client,
    cancel,
    wrapper,
  };
}
it('passes actual query signal; switching sessions cancels only the owned exact query without revert', async () => {
  const pending = new Map<string, (value: MessageRecord[]) => void>();
  vi.mocked(api.get).mockImplementation(
    (url) => new Promise((resolve) => pending.set(url, resolve)) as never,
  );
  const f = setup();
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  const signalA = vi.mocked(api.get).mock.calls[0]![1]!.signal!;
  expect(signalA).toBeInstanceOf(AbortSignal);
  f.rerender({ id: 'B' });
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  expect(signalA.aborted).toBe(true);
  expect(f.cancel).toHaveBeenCalledWith(
    { queryKey: ['messages', 'A'], exact: true },
    { revert: false },
  );
  await act(async () =>
    pending.get('/sessions/A/messages?limit=100')!([
      {
        id: 'old',
        sequence: 1,
        runId: null,
        role: 'USER',
        kind: 'TEXT',
        text: 'old',
        createdAt: '2026-11-14T00:00:00Z',
      },
    ]),
  );
  expect(f.result.current.data).toEqual([]);
  expect(vi.mocked(api.get).mock.calls[1]![1]!.signal!.aborted).toBe(false);
});
it('authorization loss aborts the owned read and denies explicit pagination', async () => {
  vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
  const f = setup();
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(api.get).mock.calls[0]![1]!.signal!;
  act(() => authSession.notifyAuthorizationRequired());
  expect(signal.aborted).toBe(true);
  await act(async () => {
    await f.result.current.fetchPrevious();
  });
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(f.cancel).toHaveBeenCalledWith(
    { queryKey: ['messages', 'A'], exact: true },
    { revert: false },
  );
});
it('an observer that did not initiate the shared query does not explicitly cancel it', async () => {
  vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
  const f = setup();
  const second = renderHook(() => useSessionMessages('A'), { wrapper: f.wrapper });
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  f.cancel.mockClear();
  second.unmount();
  expect(f.cancel).not.toHaveBeenCalled();
  expect(vi.mocked(api.get).mock.calls[0]![1]!.signal!.aborted).toBe(false);
});
it('normal older pagination keeps existing messages and exposes failure without losing loaded history', async () => {
  const messages = Array.from({ length: 100 }, (_, i): MessageRecord => ({
    id: 'message-' + (i + 101),
    sequence: i + 101,
    role: 'USER',
    kind: 'TEXT',
    runId: null,
    text: 'saved',
    createdAt: '2026-11-14T00:00:00Z',
  }));
  vi.mocked(api.get)
    .mockResolvedValueOnce(messages)
    .mockRejectedValueOnce(new Error('older read failed'));
  const f = setup();
  await waitFor(() => expect(f.result.current.data).toHaveLength(100));
  await act(async () => {
    await f.result.current.fetchPrevious();
  });
  expect(f.result.current.data).toHaveLength(100);
  await waitFor(() => expect(f.result.current.error).not.toBeNull());
  expect(vi.mocked(api.get).mock.calls[1]![0]).toBe(
    '/sessions/A/messages?limit=100&beforeSequence=101',
  );
  expect(vi.mocked(api.get).mock.calls[1]![1]!.signal).toBeInstanceOf(AbortSignal);
  expect(f.cancel).not.toHaveBeenCalled();
});
it('A → B → A: an old request finally cannot remove the newer A cancellation owner', async () => {
  const pending: Array<(value: MessageRecord[]) => void> = [];
  vi.mocked(api.get).mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)) as never,
  );
  const f = setup();
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  f.rerender({ id: 'B' });
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  f.rerender({ id: 'A' });
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));
  const newerSignal = vi.mocked(api.get).mock.calls[2]![1]!.signal!;
  await act(async () => pending[0]!([]));
  expect(newerSignal.aborted).toBe(false);
  f.cancel.mockClear();
  act(() => authSession.notifyAuthorizationRequired());
  expect(f.cancel).toHaveBeenCalledTimes(1);
  expect(f.cancel).toHaveBeenCalledWith(
    { queryKey: ['messages', 'A'], exact: true },
    { revert: false },
  );
  expect(newerSignal.aborted).toBe(true);
  await act(async () => pending[2]!([]));
  expect(f.result.current.data).toEqual([]);
});
it('unmounting the initiating observer cancels the shared read; the remaining observer can explicitly retry', async () => {
  const pending: Array<(value: MessageRecord[]) => void> = [];
  vi.mocked(api.get).mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)) as never,
  );
  const f = setup();
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  const second = renderHook(() => useSessionMessages('A'), { wrapper: f.wrapper });
  expect(api.get).toHaveBeenCalledTimes(1);
  const originalSignal = vi.mocked(api.get).mock.calls[0]![1]!.signal!;
  f.cancel.mockClear();
  f.unmount();
  expect(originalSignal.aborted).toBe(true);
  expect(f.cancel).toHaveBeenCalledTimes(1);
  expect(f.cancel).toHaveBeenCalledWith(
    { queryKey: ['messages', 'A'], exact: true },
    { revert: false },
  );
  let retry: unknown;
  act(() => {
    retry = second.result.current.refetch();
  });
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  await act(async () => pending[0]!([]));
  expect(vi.mocked(api.get).mock.calls[1]![1]!.signal!.aborted).toBe(false);
  const saved: MessageRecord = {
    id: 'retry-message',
    sequence: 1,
    role: 'USER',
    kind: 'TEXT',
    runId: null,
    text: 'saved after retry',
    createdAt: '2026-11-14T00:00:00Z',
  };
  await act(async () => {
    pending[1]!([saved]);
    await retry;
  });
  await waitFor(() => expect(second.result.current.data).toEqual([saved]));
});

it('refetches the complete loaded cursor chain and retains the latest page after history prepend', async () => {
  const row = (sequence: number): MessageRecord => ({
    id: `m${sequence}`,
    sequence,
    runId: null,
    role: 'USER',
    kind: 'TEXT',
    text: `saved ${sequence}`,
    createdAt: '2026-11-14T00:00:00Z',
  });
  const page = (from: number) => Array.from({ length: 100 }, (_, index) => row(from + index));
  let latestFrom = 101;
  vi.mocked(api.get).mockImplementation(async (url) =>
    url.includes('beforeSequence=101') ? page(1) : page(latestFrom),
  );
  const f = setup();
  await waitFor(() => expect(f.result.current.data).toHaveLength(100));
  await act(async () => {
    await f.result.current.fetchPrevious();
  });
  await waitFor(() => expect(f.result.current.data).toHaveLength(200));
  vi.mocked(api.get).mockClear();
  await act(async () => {
    await f.result.current.refetch();
  });
  await waitFor(() => expect(f.result.current.data).toHaveLength(200));
  expect(vi.mocked(api.get).mock.calls.map(([url]) => url)).toEqual([
    '/sessions/A/messages?limit=100&beforeSequence=101',
    '/sessions/A/messages?limit=100',
  ]);
  latestFrom = 102;
  await act(async () => {
    await f.result.current.refetch();
  });
  await waitFor(() => expect(f.result.current.data).toHaveLength(201));
  expect(f.result.current.data?.map((message) => message.sequence)).toEqual(
    Array.from({ length: 201 }, (_, i) => i + 1),
  );
  await act(async () => {
    await f.result.current.refetch();
  });
  await waitFor(() => expect(f.result.current.data).toHaveLength(201));
  expect(new Set(f.result.current.data?.map((message) => message.id)).size).toBe(201);
  expect(vi.mocked(api.get).mock.calls.every(([url]) => !url.includes('beforeSequence=0'))).toBe(
    true,
  );
  // A different Session establishes its own tail, never merging A's retained rows.
  vi.mocked(api.get).mockResolvedValue(page(1001));
  f.rerender({ id: 'B' });
  await waitFor(() => expect(f.result.current.data?.[0]?.sequence).toBe(1001));
  expect(f.result.current.data).toHaveLength(100);
  expect(
    (f.client.getQueryData(['messages', 'A']) as { pages: MessageRecord[][] }).pages.flat(),
  ).toHaveLength(201);
});
