// @vitest-environment jsdom
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
