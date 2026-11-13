// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type TaskRecord, type WorktreeExecutionRecord } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';
import { TaskReviewActions } from './TaskReviewActions';
import { WorktreeReviewActions } from './WorktreeReviewActions';
import type { ReviewOperationProps, ReviewOperationSnapshot } from './review-operation';
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});
const task = {
  id: 'task-a',
  projectId: 'project-a',
  status: 'WAITING_REVIEW',
  assignedAgentId: 'agent-a',
  sessionId: 'session-a',
  finalRunId: 'run-a',
} as TaskRecord;
const execution = {
  id: 'execution-a',
  projectId: 'project-a',
  taskId: 'task-a',
  status: 'REVIEW',
  sessionId: 'session-a',
  runId: 'run-a',
  taskBranch: 'task/a',
  baseBranch: 'main',
  baseSha: 'base',
  worktreePath: '/tmp/tree',
} as WorktreeExecutionRecord;
const review = {
  worktreePath: '/tmp/tree',
  baseSha: 'base',
  headSha: 'head',
  taskBranch: 'task/a',
  clean: false,
  aheadBy: 0,
  entries: [],
  patch: '',
  diffStat: 'diff ready',
  truncated: false,
};
type Kind = 'task' | 'worktree';
function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}
function mount(kind: Kind, props: ReviewOperationProps = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const pending = vi.fn();
  const tree = (contract: ReviewOperationProps) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {kind === 'task' ? (
          <TaskReviewActions task={task} disabled={false} onPendingChange={pending} {...contract} />
        ) : (
          <WorktreeReviewActions
            execution={execution}
            disabled={false}
            onPendingChange={pending}
            {...contract}
          />
        )}
        <Location />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(tree(props));
  return {
    ...result,
    pending,
    update: (next: ReviewOperationProps) => result.rerender(tree(next)),
  };
}
async function prepare(kind: Kind) {
  if (kind === 'worktree') {
    fireEvent.click(screen.getByRole('button', { name: '读取隔离工作区审阅' }));
    await screen.findByText('diff ready');
  }
  fireEvent.change(
    screen.getByRole('textbox', { name: kind === 'task' ? '继续修改说明' : '隔离工作区修改说明' }),
    { target: { value: '请完善边界' } },
  );
}
const submitName = (kind: Kind) => (kind === 'task' ? '提交继续修改' : '提交隔离工作区返工');
const checkName = (kind: Kind) => (kind === 'task' ? '核对原任务' : '核对原隔离执行');
const success = (kind: Kind) =>
  kind === 'task'
    ? {
        task: { ...task, status: 'IN_PROGRESS', sessionId: 'session-b' },
        session: { id: 'session-b' },
        run: { id: 'run-b' },
      }
    : { ...execution, status: 'RUNNING', runId: 'run-b' };

it.each<Kind>(['task', 'worktree'])(
  '%s reports pending before post; captured epoch gate blocks late navigation without losing validated result',
  async (kind) => {
    vi.spyOn(api, 'get').mockResolvedValue(review);
    const snapshots: ReviewOperationSnapshot[] = [];
    const notify = (snapshot: ReviewOperationSnapshot) => snapshots.push(snapshot);
    let finish!: (value: unknown) => void;
    vi.spyOn(api, 'post').mockImplementation(() => {
      expect(snapshots.at(-1)?.phase).toBe('pending');
      return new Promise((resolve) => {
        finish = resolve;
      }) as never;
    });
    let epoch = 0;
    const capturedEpoch = epoch;
    const h = mount(kind, {
      onOperationChange: notify,
      canAutoNavigate: () => epoch === capturedEpoch,
    });
    await prepare(kind);
    expect(snapshots).toEqual([]); // Read-only review fetch does not acquire a write lock.
    fireEvent.click(screen.getByRole('button', { name: submitName(kind) }));
    epoch = 1; // Back to list.
    epoch = 2; // Return to detail; a new render's permissive predicate must not replace the captured one.
    h.update({ onOperationChange: notify, canAutoNavigate: () => true });
    await act(async () => finish(success(kind)));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    expect(screen.getByRole('link', { name: '打开已提交的工作区' })).toHaveAttribute(
      'href',
      kind === 'task' ? '/workspace/session-b' : '/workspace/session-a',
    );
    expect(snapshots.map((s) => s.phase)).toEqual(['pending', 'resolved']);
    expect(snapshots.at(-1)?.resultHref).toBe(
      kind === 'task' ? '/workspace/session-b' : '/workspace/session-a',
    );
    expect(new Set(snapshots.map((s) => s.operationId)).size).toBe(1);
    expect(snapshots[0]).toMatchObject({
      projectId: 'project-a',
      taskId: 'task-a',
      ...(kind === 'worktree' ? { executionId: 'execution-a' } : {}),
    });
    expect(h.pending).toHaveBeenLastCalledWith('project-a:task-a', false);
  },
);
it.each<Kind>(['task', 'worktree'])(
  '%s keeps unknown lock through checking and emits no false resolved',
  async (kind) => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(review);
    vi.spyOn(api, 'post').mockRejectedValue(new Error('network lost'));
    const notify = vi.fn();
    mount(kind, { onOperationChange: notify });
    await prepare(kind);
    fireEvent.click(screen.getByRole('button', { name: submitName(kind) }));
    await screen.findByText('network lost');
    let finish!: (value: unknown) => void;
    get.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
    );
    fireEvent.click(screen.getByRole('button', { name: checkName(kind) }));
    expect(notify.mock.calls.map(([s]) => s.phase)).toEqual(['pending', 'unknown', 'checking']);
    await act(async () => finish(kind === 'task' ? task : execution));
    expect(notify.mock.calls.map(([s]) => s.phase)).toEqual([
      'pending',
      'unknown',
      'checking',
      'unknown',
    ]);
    expect(new Set(notify.mock.calls.map(([s]) => s.operationId)).size).toBe(1);
    expect(screen.getByRole('button', { name: submitName(kind) })).toBeDisabled();
  },
);
it.each<Kind>(['task', 'worktree'])(
  '%s never offers a link for an invalid response',
  async (kind) => {
    vi.spyOn(api, 'get').mockResolvedValue(review);
    vi.spyOn(api, 'post').mockResolvedValue({
      ...success(kind),
      id: 'wrong-execution',
      task: { ...task, id: 'wrong-task' },
    });
    const notify = vi.fn();
    mount(kind, { onOperationChange: notify, canAutoNavigate: () => false });
    await prepare(kind);
    fireEvent.click(screen.getByRole('button', { name: submitName(kind) }));
    await waitFor(() =>
      expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'unknown' })),
    );
    expect(screen.queryByRole('link', { name: '打开已提交的工作区' })).not.toBeInTheDocument();
    expect(notify.mock.calls.every(([snapshot]) => snapshot.resultHref === undefined)).toBe(true);
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  },
);
it.each<Kind>(['task', 'worktree'])(
  '%s reports safe rejection as retryable with unique token on retry',
  async (kind) => {
    vi.spyOn(api, 'get').mockResolvedValue(review);
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError('VALIDATION_FAILED', 'invalid request', 400),
    );
    const notify = vi.fn();
    mount(kind, { onOperationChange: notify });
    await prepare(kind);
    fireEvent.click(screen.getByRole('button', { name: submitName(kind) }));
    await screen.findByText('invalid request');
    expect(notify.mock.calls.map(([s]) => s.phase)).toEqual(['pending', 'retryable']);
    if (kind === 'worktree') {
      fireEvent.click(screen.getByRole('button', { name: '读取隔离工作区审阅' }));
      await screen.findByText('diff ready');
    }
    fireEvent.click(screen.getByRole('button', { name: submitName(kind) }));
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(4));
    expect(notify.mock.calls[0]![0].operationId).not.toBe(notify.mock.calls[2]![0].operationId);
  },
);
it.each<Kind>(['task', 'worktree'])(
  '%s reports original outcome after unmount, not a cleanup unlock',
  async (kind) => {
    vi.spyOn(api, 'get').mockResolvedValue(review);
    let finish!: (value: unknown) => void;
    vi.spyOn(api, 'post').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
    );
    const notify = vi.fn();
    const h = mount(kind, { onOperationChange: notify });
    await prepare(kind);
    fireEvent.click(screen.getByRole('button', { name: submitName(kind) }));
    h.unmount();
    expect(notify.mock.calls.map(([s]) => s.phase)).toEqual(['pending']);
    await act(async () => finish(success(kind)));
    expect(notify.mock.calls.map(([s]) => s.phase)).toEqual(['pending', 'resolved']);
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        resultHref: kind === 'task' ? '/workspace/session-b' : '/workspace/session-a',
        projectId: 'project-a',
        taskId: 'task-a',
      }),
    );
  },
);

it.each<Kind>(['task', 'worktree'])(
  '%s hands verified result to an owner before refresh removes the review child',
  async (kind) => {
    vi.spyOn(api, 'get').mockResolvedValue(review);
    vi.spyOn(api, 'post').mockResolvedValue(success(kind));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const snapshots: ReviewOperationSnapshot[] = [];
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockImplementation(async () => {
      expect(snapshots.at(-1)).toMatchObject({
        phase: 'resolved',
        resultHref: kind === 'task' ? '/workspace/session-b' : '/workspace/session-a',
      });
      client.setQueryData(['owner-status'], 'IN_PROGRESS');
    });
    function Owner() {
      const [saved, setSaved] = useState<ReviewOperationSnapshot>();
      const status = useQuery({
        queryKey: ['owner-status'],
        queryFn: async () => 'WAITING_REVIEW',
        initialData: 'WAITING_REVIEW',
        enabled: false,
      });
      const onOperationChange = (snapshot: ReviewOperationSnapshot) => {
        snapshots.push(snapshot);
        if (snapshot.phase === 'resolved') setSaved(snapshot);
      };
      const props = {
        onOperationChange,
        canAutoNavigate: () => false,
        onPendingChange: vi.fn(),
        disabled: false,
      };
      return (
        <>
          {status.data === 'WAITING_REVIEW' ? (
            kind === 'task' ? (
              <TaskReviewActions task={task} {...props} />
            ) : (
              <WorktreeReviewActions execution={execution} {...props} />
            )
          ) : null}
          {saved?.resultHref ? <a href={saved.resultHref}>owner保留结果</a> : null}
        </>
      );
    }
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Owner />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await prepare(kind);
    fireEvent.click(screen.getByRole('button', { name: submitName(kind) }));
    const link = await screen.findByRole('link', { name: 'owner保留结果' });
    expect(link).toHaveAttribute(
      'href',
      kind === 'task' ? '/workspace/session-b' : '/workspace/session-a',
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: submitName(kind) })).not.toBeInTheDocument(),
    );
    expect(invalidate).toHaveBeenCalled();
  },
);
