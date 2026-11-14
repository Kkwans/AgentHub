// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatConversationView } from './ChatConversationView';
import { ChatEntryRenderer } from './ChatEntryRenderer';
import { buildConversationTimeline } from './conversationModel';
import type { EventRecord, MessageRecord } from '../../../lib/api';

vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'local_trusted',
  useAuthUser: () => null,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const opening = '先核对状态与执行循环。';
const ending = '\n\n取消检查已准备好。';
const saved: MessageRecord = {
  id: 'saved',
  runId: 'r',
  role: 'ASSISTANT',
  kind: 'TEXT',
  text: opening + ending,
  sequence: 2,
  createdAt: '2026-11-14T13:00:04Z',
};
const events: EventRecord[] = [
  ['assistant.message.delta', { text: opening }],
  ['tool.call.completed', { toolCallId: 'call', name: '读取代码', status: 'completed' }],
  ['assistant.message.delta', { text: ending }],
  ['assistant.message.completed', { text: opening + ending }],
].map(([type, payload], index) => ({
  id: `e${index}`,
  sessionId: 's',
  runId: 'r',
  seq: index + 1,
  type: type as string,
  payloadJson: payload as Record<string, unknown>,
  createdAt: `2026-11-14T13:00:0${index + 1}Z`,
}));
const props: ComponentProps<typeof ChatConversationView> = {
  session: {
    id: 's',
    projectId: 'p',
    agentId: 'a',
    taskId: null,
    title: '测试',
    cwd: '/tmp',
    branch: null,
    status: 'READY',
    model: null,
    mode: null,
    reasoningEffort: null,
    lastActiveAt: '2026-11-14T13:00:04Z',
  },
  messages: {
    data: [saved],
    error: null,
    isLoading: false,
    refetch: vi.fn(),
    hasPrevious: false,
    isFetchingPrevious: false,
    fetchPrevious: vi.fn(),
  },
  events: { data: events, error: null, isLoading: false, refetch: vi.fn() },
  approvals: { data: [], error: null, isLoading: false, refetch: vi.fn() },
  activeRun: undefined,
  continuation: undefined,
  continuePending: false,
  continueError: null,
  onContinue: vi.fn(),
  onResolveApproval: vi.fn(),
};
it('renders each causal segment once, copies the full saved answer once, and focuses its unique persisted anchor', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++serial, fn);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const view = render(
    <MemoryRouter>
      <ChatConversationView {...props} />
    </MemoryRouter>,
  );
  await screen.findByText(opening);
  expect(screen.getAllByText(ending.trim())).toHaveLength(1);
  const anchors = view.container.querySelectorAll('[data-message-id="saved"]');
  expect(anchors).toHaveLength(1);
  expect(anchors[0]).toHaveTextContent(opening);
  expect(anchors[0]).not.toHaveTextContent(ending.trim());
  const copy = screen.getAllByRole('button', { name: '复制回复' });
  expect(copy).toHaveLength(1);
  fireEvent.click(copy[0]!);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(saved.text));
  const complete = vi.fn();
  const controller = new AbortController();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 10,
    top: 10,
    bottom: 310,
    left: 0,
    right: 400,
    width: 400,
    height: 300,
    toJSON: () => ({}),
  });
  view.rerender(
    <MemoryRouter>
      <ChatConversationView
        {...props}
        locationRequest={{
          target: { sessionId: 's', id: 'saved', sequence: 2 },
          signal: controller.signal,
          complete,
        }}
      />
    </MemoryRouter>,
  );
  for (let index = 0; index < 8; index++)
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((fn) => fn(0));
    });
  expect(anchors[0]).toHaveFocus();
  expect(complete).toHaveBeenCalledWith();
  expect(saved.text).toContain(ending); // original record used by search/export stays complete
});
it('does not render an empty copy button for synthetic continuation slices', async () => {
  const item = buildConversationTimeline([saved], events).at(-1)!;
  render(
    <MemoryRouter>
      <ChatEntryRenderer
        item={item}
        resolving={undefined}
        resolveError={undefined}
        resolveVariables={undefined}
        activeThoughtId={undefined}
        onResolve={() => undefined}
      />
    </MemoryRouter>,
  );
  await screen.findByText(ending.trim());
  expect(screen.queryByRole('button', { name: '复制回复' })).toBeNull();
});
