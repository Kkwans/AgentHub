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
  clients.splice(0).forEach((c) => c.clear());
  vi.restoreAllMocks();
  vi.mocked(api.get).mockReset();
  vi.useRealTimers();
});
const row = (sequence: number): MessageRecord => ({
  id: 'm' + sequence,
  sequence,
  role: 'USER',
  text: 'saved',
  kind: 'TEXT',
  runId: null,
  createdAt: '2026-11-14T00:00:00Z',
});
function setup(max = 1002) {
  vi.mocked(api.get).mockImplementation(async (url) => {
    const before =
      Number(new URL(url, 'https://fixture.test').searchParams.get('beforeSequence')) || max + 1;
    return Array.from({ length: Math.min(100, before - 1) }, (_, i) =>
      row(Math.max(1, before - 100) + i),
    ) as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(({ id }) => useSessionMessages(id), { initialProps: { id: 's' }, wrapper }),
    client,
    wrapper,
  };
}
it('five page budget stops and explicit continuation reaches old saved message before reveal', async () => {
  const f = setup();
  await waitFor(() => expect(f.result.current.data).toHaveLength(100));
  const reveal = vi.fn(async () => {});
  const progress = vi.fn();
  const controller = new AbortController();
  let outcome;
  await act(async () => {
    outcome = await f.result.current.locateMessage!(
      { sessionId: 's', id: 'm1', sequence: 1 },
      controller.signal,
      reveal,
      progress,
    );
  });
  expect(outcome).toBe('budget');
  expect(reveal).not.toHaveBeenCalled();
  expect(api.get).toHaveBeenCalledTimes(6);
  expect(progress).toHaveBeenLastCalledWith(5);
  await act(async () => {
    outcome = await f.result.current.locateMessage!(
      { sessionId: 's', id: 'm1', sequence: 1 },
      controller.signal,
      reveal,
      progress,
    );
  });
  expect(outcome).toBe('located');
  expect(reveal).toHaveBeenCalledTimes(1);
});
it('cancelled pending page cannot reveal and releases navigation for later explicit retry', async () => {
  const f = setup();
  await waitFor(() => expect(f.result.current.data).toHaveLength(100));
  vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
  const controller = new AbortController();
  const reveal = vi.fn(async () => {});
  let operation!: Promise<unknown>;
  act(() => {
    operation = f.result.current.locateMessage!(
      { sessionId: 's', id: 'm1', sequence: 1 },
      controller.signal,
      reveal,
      vi.fn(),
    ).catch(() => 'cancelled');
  });
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  await act(async () => {
    controller.abort();
    await operation;
  });
  expect(reveal).not.toHaveBeenCalled();
  expect(f.result.current.isNavigatingHistory).toBe(false);
});
it('ten second deadline aborts the pending owned read and returns explicit continuation budget', async () => {
  const f = setup();
  await waitFor(() => expect(f.result.current.data).toHaveLength(100));
  vi.useFakeTimers();
  vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
  const reveal = vi.fn(async () => {});
  let operation!: Promise<unknown>;
  act(() => {
    operation = f.result.current.locateMessage!(
      { sessionId: 's', id: 'm1', sequence: 1 },
      new AbortController().signal,
      reveal,
      vi.fn(),
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(await operation).toBe('budget');
  expect(reveal).not.toHaveBeenCalled();
  expect(vi.mocked(api.get).mock.calls[1]![1]!.signal!.aborted).toBe(true);
});
it('ABA session change aborts old location without invoking reveal', async () => {
  const f = setup();
  await waitFor(() => expect(f.result.current.data).toHaveLength(100));
  vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
  const reveal = vi.fn(async () => {});
  let operation!: Promise<unknown>;
  act(() => {
    operation = f.result.current.locateMessage!(
      { sessionId: 's', id: 'm1', sequence: 1 },
      new AbortController().signal,
      reveal,
      vi.fn(),
    ).catch(() => 'cancelled');
  });
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  f.rerender({ id: 'other' });
  f.rerender({ id: 's' });
  await act(async () => {
    await operation;
  });
  expect(reveal).not.toHaveBeenCalled();
});
it('authorization loss cancels locating and denies a new explicit locate', async () => {
  const f = setup();
  await waitFor(() => expect(f.result.current.data).toHaveLength(100));
  vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
  const reveal = vi.fn(async () => {});
  let operation!: Promise<unknown>;
  act(() => {
    operation = f.result.current.locateMessage!(
      { sessionId: 's', id: 'm1', sequence: 1 },
      new AbortController().signal,
      reveal,
      vi.fn(),
    ).catch(() => 'cancelled');
  });
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  await act(async () => {
    authSession.notifyAuthorizationRequired();
    await operation;
  });
  expect(reveal).not.toHaveBeenCalled();
  await expect(
    f.result.current.locateMessage!(
      { sessionId: 's', id: 'm1', sequence: 1 },
      new AbortController().signal,
      reveal,
      vi.fn(),
    ),
  ).rejects.toThrow('取消');
});
it('deadline releases a second observer locator without cancelling the first observer shared read', async () => {
  const first = setup();
  await waitFor(() => expect(first.result.current.data).toHaveLength(100));
  vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
  act(() => {
    void first.result.current.refetch();
  });
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  const sharedSignal = vi.mocked(api.get).mock.calls[1]![1]!.signal!;
  const second = renderHook(() => useSessionMessages('s'), { wrapper: first.wrapper });
  vi.useFakeTimers();
  const reveal = vi.fn(async () => {});
  let operation!: Promise<unknown>;
  act(() => {
    operation = second.result.current.locateMessage!(
      { sessionId: 's', id: 'm1', sequence: 1 },
      new AbortController().signal,
      reveal,
      vi.fn(),
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(await operation).toBe('budget');
  expect(second.result.current.isNavigatingHistory).toBe(false);
  expect(sharedSignal.aborted).toBe(false);
  expect(reveal).not.toHaveBeenCalled();
});
it('deadline also bounds an uncooperative reveal promise', async () => {
  const f = setup();
  await waitFor(() => expect(f.result.current.data).toHaveLength(100));
  vi.useFakeTimers();
  let operation!: Promise<unknown>;
  act(() => {
    operation = f.result.current.locateMessage!(
      { sessionId: 's', id: 'm1002', sequence: 1002 },
      new AbortController().signal,
      () => new Promise(() => {}),
      vi.fn(),
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(await operation).toBe('budget');
  expect(f.result.current.isNavigatingHistory).toBe(false);
});
it('explicit newer scroll intent cancels pending history and cannot reveal after completion', async () => {
  const f = setup();
  await waitFor(() => expect(f.result.current.data).toHaveLength(100));
  vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
  const reveal = vi.fn(async () => {});
  let operation!: Promise<unknown>;
  act(() => {
    operation = f.result.current.locateMessage!(
      { sessionId: 's', id: 'm1', sequence: 1 },
      new AbortController().signal,
      reveal,
      vi.fn(),
    ).catch(() => 'cancelled');
  });
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  await act(async () => {
    f.result.current.cancelHistoryNavigation!();
    await operation;
  });
  expect(reveal).not.toHaveBeenCalled();
  expect(f.result.current.isNavigatingHistory).toBe(false);
});
