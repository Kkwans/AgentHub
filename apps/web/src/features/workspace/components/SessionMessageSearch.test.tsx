// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, authSession } from '../../../lib/api';
import type { MessageQueryState } from '../workspace-types';
import { SessionMessageSearch } from './SessionMessageSearch';
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'local_trusted',
  useAuthUser: () => null,
}));
vi.mock('../../../lib/api', async (original) => ({
  ...(await original<{ api: typeof api; authSession: typeof authSession }>()),
  api: { post: vi.fn() },
}));
const hit = {
  id: 'm1',
  sessionId: 's',
  role: 'USER',
  sequence: 1,
  snippet: '<img src=x> **literal** %_',
  createdAt: '2026-11-14T00:00:00Z',
};
const response = {
  hits: [hit],
  upperSequence: 10,
  nextBeforeSequence: null,
  scannedCount: 10,
  exhausted: true,
};
let host: HTMLDivElement;
afterEach(() => {
  cleanup();
  host?.remove();
  vi.mocked(api.post).mockReset();
  vi.restoreAllMocks();
});
function setup() {
  host = document.createElement('div');
  document.body.append(host);
  const locateMessage = vi
    .fn<NonNullable<MessageQueryState['locateMessage']>>()
    .mockResolvedValue('located');
  const messages: MessageQueryState = {
    data: [],
    error: null,
    isLoading: false,
    refetch: vi.fn(),
    hasPrevious: true,
    isFetchingPrevious: false,
    fetchPrevious: vi.fn(),
    locateMessage,
  };
  const onLocate = vi.fn(async () => {});
  const f = render(
    <SessionMessageSearch sessionId="s" host={host} messages={messages} onLocate={onLocate} />,
  );
  fireEvent.click(screen.getByRole('button', { name: '搜索已保存文字' }));
  return { ...f, locateMessage, messages, onLocate };
}
function submit(text = 'needle') {
  fireEvent.change(screen.getByRole('textbox', { name: '搜索已保存文字' }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
}
it('renders literal snippets, sends query only in POST body and awaits actual locate promise', async () => {
  vi.mocked(api.post).mockResolvedValue(response);
  const f = setup();
  submit();
  await screen.findByText(hit.snippet);
  expect(host.querySelector('img')).toBeNull();
  expect(api.post).toHaveBeenCalledWith(
    '/sessions/s/messages/search',
    { query: 'needle' },
    { signal: expect.any(AbortSignal) },
  );
  let finish!: (value: 'located') => void;
  f.locateMessage.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: '定位消息 m1' }));
  expect(screen.queryByText('已定位到原消息。')).not.toBeInTheDocument();
  await act(async () => finish('located'));
  await screen.findByText('已定位到原消息。');
  expect(screen.queryByRole('textbox', { name: '搜索已保存文字' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '定位消息 m1' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '返回搜索结果' }));
  expect(screen.getByRole('textbox', { name: '搜索已保存文字' })).toHaveValue('needle');
  expect(screen.getByRole('textbox', { name: '搜索已保存文字' })).toHaveFocus();
  expect(screen.getByRole('button', { name: '定位消息 m1' })).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(f.locateMessage).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '关闭搜索' }));
  expect(screen.getByRole('button', { name: '搜索已保存文字' })).toHaveFocus();
});
it('zero hits with more history continues with fixed upper and strict cursor', async () => {
  vi.mocked(api.post)
    .mockResolvedValueOnce({
      ...response,
      hits: [],
      upperSequence: 105,
      nextBeforeSequence: 6,
      scannedCount: 100,
      exhausted: false,
    })
    .mockResolvedValueOnce({ ...response, upperSequence: 105, scannedCount: 5 });
  setup();
  submit();
  await screen.findByText('本段未找到匹配，仍有更早文字可搜索。');
  fireEvent.click(screen.getByRole('button', { name: '继续搜索' }));
  await screen.findByText(hit.snippet);
  expect(vi.mocked(api.post).mock.calls[1]?.[1]).toEqual({
    query: 'needle',
    upperSequence: 105,
    beforeSequence: 6,
  });
});
it('input ABA and close abort old query; late responses do not restore results', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }) as never,
  );
  setup();
  submit('A');
  const signal = vi.mocked(api.post).mock.calls[0]![2]!.signal!;
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'B' } });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A' } });
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(response));
  expect(screen.queryByRole('button', { name: '定位消息 m1' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭搜索' }));
  expect(screen.queryByRole('region', { name: '当前会话文字搜索' })).not.toBeInTheDocument();
});
it('budget is honest and only explicit continuation invokes another locate', async () => {
  vi.mocked(api.post).mockResolvedValue(response);
  const f = setup();
  f.locateMessage.mockResolvedValueOnce('budget').mockResolvedValueOnce('located');
  submit();
  fireEvent.click(await screen.findByRole('button', { name: '定位消息 m1' }));
  await screen.findByRole('button', { name: '继续加载历史' });
  expect(f.locateMessage).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('已定位到原消息。')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '继续加载历史' }));
  await screen.findByText('已定位到原消息。');
  expect(f.locateMessage).toHaveBeenCalledTimes(2);
});
it('authorization loss aborts pending search and prevents replay', async () => {
  vi.mocked(api.post).mockReturnValue(new Promise(() => {}));
  setup();
  submit();
  const signal = vi.mocked(api.post).mock.calls[0]![2]!.signal!;
  act(() => authSession.notifyAuthorizationRequired());
  expect(signal.aborted).toBe(true);
  await waitFor(() => expect(screen.getByRole('button', { name: '搜索' })).toBeDisabled());
  expect(api.post).toHaveBeenCalledTimes(1);
});
