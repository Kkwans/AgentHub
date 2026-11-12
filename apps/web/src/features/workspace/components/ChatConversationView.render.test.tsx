// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../../lib/api';
import type { ApprovalRecord, EventRecord } from '../../../lib/api';
import type { ComponentProps } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';

import { ChatConversationView } from './ChatConversationView';

vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'local_trusted',
  useAuthUser: () => null,
}));

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

beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => undefined));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.sessionStorage.clear();
});

it('renders the four ordered live tool rows and exposes tool/thought disclosures', async () => {
  const events: EventRecord[] = [
    {
      id: 'thought-1',
      sessionId: props.session.id,
      runId: 'run-1',
      seq: 1,
      type: 'agent.thought.delta',
      payloadJson: { messageId: 'thought', text: '先检查主舞台，' },
      createdAt: '2026-11-12T01:00:00Z',
    },
    {
      id: 'thought-2',
      sessionId: props.session.id,
      runId: 'run-1',
      seq: 2,
      type: 'agent.thought.delta',
      payloadJson: { messageId: 'thought', text: '再检查工具流水。' },
      createdAt: '2026-11-12T01:00:32Z',
    },
    ...[
      { tool: 'read_file', path: 'apps/web/src/features/workspace/WorkspacePage.tsx' },
      { tool: 'search', query: 'workspace panel composer inspector' },
      { tool: 'apply_patch', path: 'workspace.module.css' },
      { tool: 'run_tests', command: 'playwright test --project=desktop-1440' },
    ].map((payloadJson, index) => ({
      id: `tool-${index}`,
      sessionId: props.session.id,
      runId: 'run-1',
      seq: index + 3,
      type: 'tool.call.completed',
      payloadJson,
      createdAt: `2026-11-12T01:0${index + 1}:00Z`,
    })),
  ];
  const { container } = render(
    <MemoryRouter>
      <ChatConversationView {...props} events={{ ...props.events, data: events }} />
    </MemoryRouter>,
  );
  const rows = Array.from(container.querySelectorAll<HTMLElement>('.tool-event-row'));
  expect(rows.map((row) => row.dataset.eventId)).toEqual(['tool-0', 'tool-1', 'tool-2', 'tool-3']);
  expect(container.querySelector('.tool-execution-group')).toBeNull();
  for (const row of rows)
    expect(within(row).getByRole('button', { name: /工具调用完成/ })).toBeInTheDocument();
  const trigger = within(rows[0]!).getByRole('button', { name: /工具调用完成/ });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() => expect(within(rows[0]!).getByText('Agent 未返回可展开内容。')).toBeVisible());
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  const thought = container.querySelector('.thinking-event-row');
  expect(thought).not.toHaveAttribute('open');
  expect(screen.getByText('思考了 32 秒')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '展开思考过程' }));
  expect(thought).toHaveAttribute('open');
  expect(screen.getByText('先检查主舞台，再检查工具流水。')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '展开思考过程' }));
  expect(thought).not.toHaveAttribute('open');
});

it.each(['DELIVERED', 'UNKNOWN', 'DEAD', 'QUEUED'] as const)(
  'Approval反馈随权威%s变化，不由完成Run推断',
  async (state) => {
    const approval: ApprovalRecord = {
      id: 'approval-feedback',
      sessionId: props.session.id,
      runId: 'run-feedback',
      title: '权限决定',
      description: null,
      status: 'PENDING',
      optionsJson: [{ id: 'allow', label: '允许一次', kind: 'allow_once' }],
      selectedOptionId: null,
      deliveryId: null,
      deliveryState: null,
      deliveryAttemptCount: null,
      deliveryErrorCode: null,
      deliveryErrorMessage: null,
    };
    const saved: ApprovalRecord = {
      ...approval,
      status: 'APPROVED',
      selectedOptionId: 'allow',
      deliveryId: 'delivery-feedback',
      deliveryState: 'QUEUED',
      deliveryAttemptCount: 1,
    };
    const submit = vi.fn(async () => saved);
    const view = (data: ApprovalRecord[]) => (
      <MemoryRouter>
        <ChatConversationView
          {...props}
          latestRunStatus="COMPLETED"
          approvals={{ ...props.approvals, data }}
          onResolveApproval={submit}
        />
      </MemoryRouter>
    );
    const rendered = render(view([approval]));
    fireEvent.click(screen.getByRole('button', { name: '允许一次' }));
    await screen.findByText(/决定已.*保存/);
    rendered.rerender(view([{ ...saved, deliveryState: state }]));
    const expected =
      state === 'DELIVERED'
        ? '决定已保存，Agent 已确认接收。'
        : state === 'UNKNOWN'
          ? '决定已保存，但 Agent 是否收到仍无法确认。系统不会自动重发。'
          : state === 'DEAD'
            ? '决定已保存，但没有发送给 Agent。'
            : '决定已保存，正在等待投递；尚未确认 Agent 接收。';
    const feedback = await screen.findByText(expected, { exact: true });
    expect(feedback).toHaveAttribute(
      'role',
      state === 'UNKNOWN' || state === 'DEAD' ? 'alert' : 'status',
    );
    if (state !== 'DELIVERED') expect(feedback).not.toHaveClass('workspace-query-status');
    expect(submit).toHaveBeenCalledTimes(1);
  },
);

it('投递读取失败显示独立只读重试，不重新提交权限决定', async () => {
  const approval: ApprovalRecord = {
    id: 'approval-read',
    sessionId: props.session.id,
    runId: 'run-read',
    title: '权限决定',
    description: null,
    status: 'PENDING',
    optionsJson: [{ id: 'allow', label: '允许一次', kind: 'allow_once' }],
    selectedOptionId: null,
    deliveryId: null,
    deliveryState: null,
    deliveryAttemptCount: null,
    deliveryErrorCode: null,
    deliveryErrorMessage: null,
  };
  const saved: ApprovalRecord = {
    ...approval,
    status: 'APPROVED',
    selectedOptionId: 'allow',
    deliveryId: 'delivery-read',
    deliveryState: 'DISPATCHING',
    deliveryAttemptCount: 1,
  };
  const submit = vi.fn(async () => saved);
  vi.mocked(api.get)
    .mockRejectedValueOnce(new Error('read failed'))
    .mockResolvedValueOnce({ ...saved, deliveryState: 'DELIVERED' });
  render(
    <MemoryRouter>
      <ChatConversationView
        {...props}
        approvals={{ ...props.approvals, data: [approval] }}
        onResolveApproval={submit}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: '允许一次' }));
  const retry = await screen.findByRole('button', { name: '重新查询投递状态' });
  expect(screen.queryByRole('button', { name: '重试此选项' })).not.toBeInTheDocument();
  fireEvent.click(retry);
  await screen.findByText('决定已保存，Agent 已确认接收。', { exact: true });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledTimes(2);
});
