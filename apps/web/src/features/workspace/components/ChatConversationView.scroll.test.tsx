// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { authSession } from '../../../lib/api';
import { ChatConversationView } from './ChatConversationView';

const props: ComponentProps<typeof ChatConversationView> = {
  session: {
    id: 'session-scroll',
    projectId: 'project-1',
    agentId: 'agent-1',
    taskId: null,
    title: '滚动测试',
    cwd: '/project',
    branch: 'main',
    status: 'READY',
    model: null,
    mode: null,
    reasoningEffort: null,
    lastActiveAt: '2026-11-12T00:00:00Z',
  },
  messages: {
    data: [],
    isLoading: false,
    error: null,
    refetch: () => undefined,
    hasPrevious: false,
    isFetchingPrevious: false,
    fetchPrevious: async () => undefined,
  },
  events: { data: [], isLoading: false, error: null, refetch: () => undefined },
  approvals: { data: [], isLoading: false, error: null, refetch: () => undefined },
  activeRun: undefined,
  continuation: undefined,
  continuePending: false,
  continueError: null,
  onContinue: () => undefined,
  onResolveApproval: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setupLongScroll() {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  const view = render(<ChatConversationView {...props} />);
  const element = screen.getByRole('log');
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: 5000 },
    clientHeight: { configurable: true, value: 500 },
  });
  const scrollTo = vi.spyOn(element, 'scrollTo');
  const nextFrame = () =>
    act(() => {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(0);
    });
  nextFrame();
  nextFrame();
  expect(element.scrollTop).toBe(4800);
  expect(scrollTo).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  return { ...view, element, scrollTo, nextFrame, frames };
}

describe('streaming scroll frame ownership', () => {
  it('settles the long jump on the next frame while still following', () => {
    const { element, scrollTo, nextFrame } = setupLongScroll();
    nextFrame();
    expect(scrollTo).toHaveBeenCalledWith({ top: 5000, behavior: 'smooth' });
    expect(element.scrollTop).toBe(4500);
  });

  it('cancels the smooth tail when unmounted between frames', () => {
    const { unmount, scrollTo, nextFrame, frames } = setupLongScroll();
    unmount();
    expect(frames.size).toBe(0);
    nextFrame();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not reclaim scroll after the user takes over between frames', () => {
    const { element, scrollTo, nextFrame } = setupLongScroll();
    fireEvent.wheel(element, { deltaY: -120 });
    scrollTo.mockClear();
    nextFrame();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('cancels the old session tail when the session changes', () => {
    const { rerender, scrollTo, nextFrame } = setupLongScroll();
    rerender(
      <ChatConversationView {...props} session={{ ...props.session, id: 'session-next' }} />,
    );
    nextFrame();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('history anchor ownership', () => {
  function setupHistory() {
    const frames = new Map<number, FrameRequestCallback>();
    let frame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frame, callback);
      return frame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const pending: Array<() => void> = [];
    const load = vi.fn(() => new Promise<void>((resolve) => pending.push(resolve)));
    const renderProps = { ...props, hasPreviousMessages: true, onLoadPreviousMessages: load };
    const view = render(<ChatConversationView {...renderProps} hasPreviousMessages={false} />);
    const element = screen.getByRole('log');
    Object.defineProperties(element, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 500 },
    });
    const flush = () =>
      act(() => {
        const current = [...frames.values()];
        frames.clear();
        current.forEach((callback) => callback(0));
      });
    element.scrollTop = 200;
    fireEvent.wheel(element, { deltaY: -120 });
    frames.clear();
    view.rerender(<ChatConversationView {...renderProps} />);
    expect(load).not.toHaveBeenCalled();
    return { ...view, element, flush, pending, load, renderProps, frames };
  }
  it.each(['success', 'failure'])(
    'normal history %s preserves anchor and releases its guard',
    async (outcome) => {
      const f = setupHistory();
      if (outcome === 'failure') f.load.mockRejectedValueOnce(new Error('read failed'));
      const previousHeight = f.element.scrollHeight;
      const previousTop = f.element.scrollTop;
      fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
      if (outcome === 'success') await act(async () => f.pending[0]!());
      else await act(async () => {});
      Object.defineProperty(f.element, 'scrollHeight', {
        configurable: true,
        value: previousHeight + 1000,
      });
      f.flush();
      expect(f.element.scrollTop).toBe(previousTop + 1000);
      fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
      expect(f.load).toHaveBeenCalledTimes(2);
    },
  );
  it('authorization loss discards pending history anchor and denies another load', async () => {
    const f = setupHistory();
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
    act(() => authSession.notifyAuthorizationRequired());
    f.element.scrollTop = 85;
    await act(async () => f.pending[0]!());
    f.flush();
    expect(f.element.scrollTop).toBe(85);
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
    expect(f.load).toHaveBeenCalledTimes(1);
  });
  it('A→B→A cannot apply A old history anchor or block a new history request', async () => {
    const f = setupHistory();
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
    f.rerender(<ChatConversationView {...f.renderProps} session={{ ...props.session, id: 'B' }} />);
    f.rerender(<ChatConversationView {...f.renderProps} />);
    fireEvent.wheel(f.element, { deltaY: -120 });
    f.frames.clear();
    f.element.scrollTop = 40;
    Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 3000 });
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
    expect(f.load).toHaveBeenCalledTimes(2);
    await act(async () => f.pending[0]!());
    f.flush();
    expect(f.element.scrollTop).toBe(40);
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
    expect(f.load).toHaveBeenCalledTimes(2); // Old finally must not clear the newer request guard.
  });
  it('new user scroll intent invalidates an already queued history anchor frame', async () => {
    const f = setupHistory();
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
    await act(async () => f.pending[0]!());
    Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 3000 });
    fireEvent.wheel(f.element, { deltaY: -120 });
    f.element.scrollTop = 70;
    f.flush();
    expect(f.element.scrollTop).toBe(70);
  });
});

it('does not count prepended history as unread, only later persisted messages', () => {
  const message = (sequence: number) => ({
    id: `m${sequence}`,
    sessionId: props.session.id,
    runId: null,
    sequence,
    role: 'USER' as const,
    kind: 'TEXT' as const,
    text: `text ${sequence}`,
    createdAt: '2026-11-14T00:00:00Z',
  });
  const renderProps = (sequences: number[]) => ({
    ...props,
    messages: { ...props.messages, data: sequences.map(message) },
  });
  const view = render(<ChatConversationView {...renderProps([100, 101])} />);
  const log = screen.getByRole('log');
  fireEvent.wheel(log, { deltaY: -100 });
  view.rerender(<ChatConversationView {...renderProps([98, 99, 100, 101])} />);
  expect(screen.getByRole('button', { name: '回到最新' })).toHaveTextContent(/^回到最新$/);
  view.rerender(<ChatConversationView {...renderProps([98, 99, 100, 101, 102])} />);
  expect(screen.getByRole('button', { name: '回到最新' })).toHaveTextContent('1 条新消息');
  view.rerender(<ChatConversationView {...renderProps([97, 98, 99, 100, 101, 102])} />);
  expect(screen.getByRole('button', { name: '回到最新' })).toHaveTextContent('1 条新消息');
  expect(log.contains(screen.getByRole('button', { name: '回到最新' }))).toBe(false);
  // A mixed prepend + newly persisted reply increments exactly once.
  view.rerender(<ChatConversationView {...renderProps([96, 97, 98, 99, 100, 101, 102, 103])} />);
  expect(screen.getByRole('button', { name: '回到最新' })).toHaveTextContent('2 条新消息');
  view.rerender(<ChatConversationView {...renderProps([96, 97, 98, 99, 100, 101, 102, 103])} />);
  expect(screen.getByRole('button', { name: '回到最新' })).toHaveTextContent('2 条新消息');
  fireEvent.click(screen.getByRole('button', { name: '回到最新' }));
  fireEvent.wheel(log, { deltaY: -100 });
  expect(screen.getByRole('button', { name: '回到最新' })).toHaveTextContent(/^回到最新$/);
  view.rerender(
    <ChatConversationView {...renderProps([1, 2])} session={{ ...props.session, id: 'other' }} />,
  );
  fireEvent.wheel(log, { deltaY: -100 });
  expect(screen.getByRole('button', { name: '回到最新' })).toHaveTextContent(/^回到最新$/);
  view.rerender(
    <ChatConversationView
      {...renderProps([1, 2, 3])}
      session={{ ...props.session, id: 'other' }}
    />,
  );
  expect(screen.getByRole('button', { name: '回到最新' })).toHaveTextContent('1 条新消息');
});

it('explicit older pagination cancels an already queued follow-to-bottom frame before preserving its anchor', async () => {
  const f = setupLongScroll();
  let release!: () => void;
  const load = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  f.rerender(<ChatConversationView {...props} hasPreviousMessages onLoadPreviousMessages={load} />);
  f.element.scrollTop = 4000;
  fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
  expect(load).toHaveBeenCalledTimes(1);
  f.scrollTo.mockClear();
  f.nextFrame();
  expect(f.scrollTo).not.toHaveBeenCalled();
  Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 7000 });
  await act(async () => release());
  f.nextFrame();
  expect(f.element.scrollTop).toBe(6000);
  expect(screen.getByRole('button', { name: '回到最新' })).toBeInTheDocument();
});

it('preserves an owned anchor when the fetch promise settles before the prepended DOM commits', async () => {
  const f = setupLongScroll();
  const message = (sequence: number) => ({
    id: `delayed-${sequence}`,
    sessionId: props.session.id,
    runId: null,
    sequence,
    role: 'USER' as const,
    kind: 'TEXT' as const,
    text: `message ${sequence}`,
    createdAt: '2026-11-14T00:00:00Z',
  });
  let release!: () => void;
  const load = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const latest = [message(101), message(102)];
  const renderRows = (data: typeof latest) => (
    <ChatConversationView
      {...props}
      messages={{ ...props.messages, data }}
      hasPreviousMessages
      onLoadPreviousMessages={load}
    />
  );
  f.rerender(renderRows(latest));
  f.element.scrollTop = 4000;
  fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
  await act(async () => release());
  f.nextFrame(); // React Query's notification has not committed the new page yet.
  expect(f.element.scrollTop).toBe(4000);
  const prepended = [message(1), ...latest];
  Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 7000 });
  f.rerender(renderRows(prepended));
  f.nextFrame();
  expect(f.element.scrollTop).toBe(6000);
  Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 6832 });
  f.rerender(renderRows(prepended)); // virtual measurements converge after the data commit.
  f.nextFrame();
  expect(f.element.scrollTop).toBe(5832);
  Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 6804 });
  f.rerender(renderRows(prepended));
  f.nextFrame();
  expect(f.element.scrollTop).toBe(5804);
  fireEvent.wheel(f.element, { deltaY: -120 });
  f.element.scrollTop = 5300;
  Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 6780 });
  f.rerender(renderRows(prepended));
  f.nextFrame();
  expect(f.element.scrollTop).toBe(5300);
});

it.each(['stable', 'tail', 'authorization'] as const)(
  'ends committed history compensation on %s rather than reclaiming future scroll',
  async (end) => {
    const f = setupLongScroll();
    const message = (sequence: number) => ({
      id: `finish-${sequence}`,
      sessionId: props.session.id,
      runId: null,
      sequence,
      role: 'USER' as const,
      kind: 'TEXT' as const,
      text: `message ${sequence}`,
      createdAt: '2026-11-14T00:00:00Z',
    });
    let release!: () => void;
    const load = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const latest = [message(101), message(102)];
    const renderRows = (data: typeof latest) => (
      <ChatConversationView
        {...props}
        messages={{ ...props.messages, data }}
        hasPreviousMessages
        onLoadPreviousMessages={load}
      />
    );
    f.rerender(renderRows(latest));
    f.element.scrollTop = 4000;
    fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
    await act(async () => release());
    f.nextFrame();
    let data = [message(1), ...latest];
    Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 7000 });
    f.rerender(renderRows(data));
    expect(f.element.scrollTop).toBe(6000);
    if (end === 'stable') for (let index = 0; index < 4; index++) f.nextFrame();
    if (end === 'authorization') act(() => authSession.notifyAuthorizationRequired());
    if (end === 'tail') data = [...data, message(103)];
    f.element.scrollTop = 5500;
    Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 7400 });
    f.rerender(renderRows(data));
    f.nextFrame();
    expect(f.element.scrollTop).toBe(5500);
  },
);

it('does not resurrect abandoned prepend ownership when a tail update precedes late fetch completion', async () => {
  const f = setupLongScroll();
  const message = (sequence: number) => ({
    id: `late-${sequence}`,
    sessionId: props.session.id,
    runId: null,
    sequence,
    role: 'USER' as const,
    kind: 'TEXT' as const,
    text: `message ${sequence}`,
    createdAt: '2026-11-14T00:00:00Z',
  });
  let release!: () => void;
  const load = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const renderRows = (data: ReturnType<typeof message>[]) => (
    <ChatConversationView
      {...props}
      messages={{ ...props.messages, data }}
      hasPreviousMessages
      onLoadPreviousMessages={load}
    />
  );
  f.rerender(renderRows([message(101), message(102)]));
  f.element.scrollTop = 4000;
  fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
  const newer = [message(101), message(102), message(103)];
  Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 5200 });
  f.rerender(renderRows(newer));
  await act(async () => release());
  f.nextFrame();
  expect(f.element.scrollTop).toBe(4000);
  Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 7200 });
  f.rerender(renderRows([message(1), ...newer]));
  f.nextFrame();
  expect(f.element.scrollTop).toBe(4000);
});

it.each(['exhaust', 'wheel'] as const)(
  'local window reveal owns only its commit and respects %s',
  async (mode) => {
    const f = setupLongScroll();
    const data = Array.from({ length: 501 }, (_, index) => ({
      id: `window-${index + 101}`,
      sessionId: props.session.id,
      runId: null,
      sequence: index + 101,
      role: 'USER' as const,
      kind: 'TEXT' as const,
      text: `window ${index + 101}`,
      createdAt: '2026-11-14T00:00:00Z',
    }));
    let reject!: (reason: Error) => void;
    const load = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    f.rerender(
      <ChatConversationView
        {...props}
        messages={{ ...props.messages, data }}
        hasPreviousMessages
        onLoadPreviousMessages={load}
      />,
    );
    f.element.scrollTop = 4000;
    fireEvent.click(screen.getByRole('button', { name: /(?:加载|查看)更早消息/ }));
    expect(load).not.toHaveBeenCalled();
    if (mode === 'wheel') {
      fireEvent.wheel(f.element, { deltaY: -120 });
      f.element.scrollTop = 3900;
      Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 7000 });
      f.nextFrame();
      expect(f.element.scrollTop).toBe(3900);
      expect(load).not.toHaveBeenCalled();
      return;
    }
    Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 7000 });
    f.nextFrame();
    expect(f.element.scrollTop).toBe(6000);
    fireEvent.click(screen.getByRole('button', { name: /(?:加载|查看)更早消息/ }));
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('remote failed')));
    f.nextFrame();
    expect(f.element.scrollTop).toBe(6000);
    load.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: /(?:加载|查看)更早消息/ }));
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(2);
    const older = { ...data[0]!, id: 'older-1', sequence: 1, text: 'older 1' };
    Object.defineProperty(f.element, 'scrollHeight', { configurable: true, value: 8000 });
    f.rerender(
      <ChatConversationView
        {...props}
        messages={{ ...props.messages, data: [older, ...data] }}
        hasPreviousMessages
        onLoadPreviousMessages={load}
      />,
    );
    f.nextFrame();
    expect(f.element.scrollTop).toBe(7000);
  },
);
