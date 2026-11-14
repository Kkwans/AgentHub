// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatConversationView } from './ChatConversationView';
import type { MessageRecord } from '../../../lib/api';
const row = (n: number): MessageRecord => ({
  id: 'm' + n,
  sequence: n,
  runId: null,
  role: 'USER',
  kind: 'TEXT',
  text: 'saved ' + n,
  createdAt: '2026-11-14T00:00:00Z',
});
const base: ComponentProps<typeof ChatConversationView> = {
  session: {
    id: 's',
    projectId: 'p',
    agentId: 'a',
    taskId: null,
    title: 'saved',
    cwd: '/tmp',
    branch: null,
    status: 'READY',
    model: null,
    mode: null,
    reasoningEffort: null,
    lastActiveAt: '2026-11-14T00:00:00Z',
  },
  messages: {
    data: [],
    error: null,
    isLoading: false,
    refetch: vi.fn(),
    hasPrevious: false,
    isFetchingPrevious: false,
    fetchPrevious: vi.fn(),
  },
  events: { data: [], error: null, isLoading: false, refetch: vi.fn() },
  approvals: { data: [], error: null, isLoading: false, refetch: vi.fn() },
  activeRun: undefined,
  continuation: undefined,
  continuePending: false,
  continueError: null,
  onContinue: vi.fn(),
  onResolveApproval: vi.fn(),
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture(count: number) {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++id, fn);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (n: number) => frames.delete(n));
  const p = {
    ...base,
    messages: { ...base.messages, data: Array.from({ length: count }, (_, i) => row(i + 1)) },
  };
  const f = render(<ChatConversationView {...p} />);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return {
      top: 10,
      bottom: 310,
      left: 0,
      right: 400,
      width: 400,
      height: 300,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    };
  });
  const flush = () =>
    act(() => {
      const calls = [...frames.values()];
      frames.clear();
      calls.forEach((fn) => fn(0));
    });
  return { ...f, p, flush };
}
it('moves the >500-turn render window and confirms only the real focused message node', () => {
  const f = fixture(505);
  expect(document.querySelector('[data-message-id="m1"]')).toBeNull();
  const complete = vi.fn();
  const controller = new AbortController();
  f.rerender(
    <ChatConversationView
      {...f.p}
      locationRequest={{
        target: { sessionId: 's', id: 'm1', sequence: 1 },
        signal: controller.signal,
        complete,
      }}
    />,
  );
  for (let i = 0; i < 8; i++) f.flush();
  const node = document.querySelector('[data-message-id="m1"]');
  expect(node).not.toBeNull();
  expect(node).toHaveFocus();
  expect(complete).toHaveBeenCalledWith();
});
it('cancelled location never focuses or reports success', () => {
  const f = fixture(1);
  const complete = vi.fn();
  const controller = new AbortController();
  f.rerender(
    <ChatConversationView
      {...f.p}
      locationRequest={{
        target: { sessionId: 's', id: 'm1', sequence: 1 },
        signal: controller.signal,
        complete,
      }}
    />,
  );
  controller.abort();
  f.flush();
  expect(complete).not.toHaveBeenCalled();
  expect(document.querySelector('[data-message-id="m1"]')).not.toHaveFocus();
});
it('new user scrolling cancels an outstanding locator rather than reclaiming scroll', () => {
  const f = fixture(1);
  const complete = vi.fn();
  const controller = new AbortController();
  f.rerender(
    <ChatConversationView
      {...f.p}
      locationRequest={{
        target: { sessionId: 's', id: 'm1', sequence: 1 },
        signal: controller.signal,
        complete,
      }}
    />,
  );
  fireEvent.wheel(screen.getByRole('log'), { deltaY: -100 });
  f.flush();
  expect(complete).toHaveBeenCalledWith(expect.any(Error));
  expect(document.querySelector('[data-message-id="m1"]')).not.toHaveFocus();
});
it('back to latest cancels the whole pending history location, not just its final render frame', () => {
  const f = fixture(1);
  const cancelHistoryNavigation = vi.fn();
  f.rerender(
    <ChatConversationView
      {...f.p}
      messages={{ ...f.p.messages, isNavigatingHistory: true, cancelHistoryNavigation }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '回到最新' }));
  expect(cancelHistoryNavigation).toHaveBeenCalledTimes(1);
});
it('a successfully consumed location does not replay after Session A→B→A', () => {
  const f = fixture(1);
  const complete = vi.fn();
  const controller = new AbortController();
  const request = {
    target: { sessionId: 's', id: 'm1', sequence: 1 },
    signal: controller.signal,
    complete,
  };
  f.rerender(<ChatConversationView {...f.p} locationRequest={request} />);
  for (let i = 0; i < 5; i++) f.flush();
  expect(complete).toHaveBeenCalledTimes(1);
  f.rerender(
    <ChatConversationView
      {...f.p}
      session={{ ...f.p.session, id: 'other' }}
      messages={{ ...f.p.messages, data: [row(2)] }}
      locationRequest={request}
    />,
  );
  f.flush();
  f.rerender(<ChatConversationView {...f.p} locationRequest={request} />);
  for (let i = 0; i < 5; i++) f.flush();
  expect(complete).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-message-id="m1"]')).not.toHaveFocus();
  expect((document.querySelector('[data-message-id="m1"]') as HTMLElement).style.outline).toBe('');
});
