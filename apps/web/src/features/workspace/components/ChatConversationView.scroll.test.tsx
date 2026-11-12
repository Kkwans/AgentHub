// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
