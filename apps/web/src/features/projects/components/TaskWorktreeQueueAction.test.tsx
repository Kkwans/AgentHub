import { ApiError } from '../../../lib/api-error';
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api, type TaskRecord } from '../../../lib/api';
import { TaskWorktreeQueueAction } from './TaskWorktreeQueueAction';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const task = {
  id: 'task-a',
  projectId: 'project-a',
  status: 'BACKLOG',
  sessionId: null,
} as TaskRecord;
const queued = {
  execution: {
    id: 'execution-a',
    taskId: task.id,
    projectId: task.projectId,
    agentId: 'agent-a',
    status: 'QUEUED',
  },
  task: { ...task, status: 'IN_PROGRESS', assignedAgentId: 'agent-a' },
};
function mount(overrides = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    task,
    agentId: 'agent-a',
    eligible: true,
    disabled: false,
    uncertain: false,
    inFlight: false,
    accepted: false,
    onAccepted: vi.fn(),
    onPendingChange: vi.fn(),
    onUncertainChange: vi.fn(),
    ...overrides,
  };
  const view = (p = props) => (
    <QueryClientProvider client={client}>
      <TaskWorktreeQueueAction {...p} />
    </QueryClientProvider>
  );
  return {
    ...render(view()),
    props,
    change: (extra: Record<string, unknown>) => view({ ...props, ...extra }),
  };
}
it('BACKLOG合法READY后才queue，保留任务变量由后端读取', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({ ...task, status: 'READY' })
    .mockResolvedValueOnce(queued);
  mount();
  fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
  await screen.findByText(/隔离执行队列已接收/);
  expect(post.mock.calls).toEqual([
    [`/tasks/${task.id}/transition`, { status: 'READY' }],
    [`/tasks/${task.id}/worktree/queue`, { agentId: 'agent-a' }],
  ]);
});
it('READY直接queue，不使用普通start', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue(queued);
  mount({ task: { ...task, status: 'READY' } });
  fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
  await screen.findByText(/隔离执行队列已接收/);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith('/tasks/task-a/worktree/queue', { agentId: 'agent-a' });
});
it.each([
  { eligible: false },
  { disabled: true },
  { agentId: '' },
  { task: { ...task, status: 'DONE' } },
  { task: { ...task, sessionId: 'prior' } },
])('不满足准入时禁止queue %j', async (overrides) => {
  const post = vi.spyOn(api, 'post');
  mount(overrides);
  expect(screen.getByRole('button', { name: '加入隔离执行队列' })).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
});
it.each([{ eligible: false }, { disabled: true }, { agentId: 'agent-b' }])(
  'READY等待期间准入变化不继续queue %j',
  async (extra) => {
    let finish!: (value: unknown) => void;
    const post = vi.spyOn(api, 'post').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
    );
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
    h.rerender(h.change(extra));
    await act(async () => finish({ ...task, status: 'READY' }));
    expect(post).toHaveBeenCalledTimes(1);
  },
);
it('READY响应失败不调用queue', async () => {
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('断开'));
  const h = mount();
  fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
  await screen.findByText('断开');
  expect(post).toHaveBeenCalledTimes(1);
  expect(h.props.onUncertainChange).toHaveBeenCalledWith('project-a:task-a', true);
});
it('入队未知结果不重放且只查询原任务和原执行', async () => {
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('响应丢失'));
  vi.spyOn(api, 'get').mockImplementation(
    (path) => Promise.resolve(path.startsWith('/tasks/') ? task : []) as never,
  );
  const h = mount({ task: { ...task, status: 'READY' } });
  fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
  await screen.findByText('响应丢失');
  expect(h.props.onUncertainChange).toHaveBeenCalledWith('project-a:task-a', true);
  fireEvent.click(screen.getByRole('button', { name: '核对原隔离队列' }));
  await screen.findByText(/尚未找到隔离执行/);
  expect(post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '加入隔离执行队列' })).toBeDisabled();
  expect(api.get).toHaveBeenCalledWith('/worktree-executions?taskId=task-a');
});
it('查询确认既有执行后不重复入队', async () => {
  vi.spyOn(api, 'get').mockImplementation(
    (path) =>
      Promise.resolve(
        path.startsWith('/tasks/') ? task : [{ ...queued.execution, status: 'RUNNING' }],
      ) as never,
  );
  const post = vi.spyOn(api, 'post');
  const h = mount({ uncertain: true });
  fireEvent.click(screen.getByRole('button', { name: '核对原隔离队列' }));
  await screen.findByText(/原任务已有隔离执行/);
  expect(h.props.onUncertainChange).toHaveBeenCalledWith('project-a:task-a', false);
  expect(post).not.toHaveBeenCalled();
});
it('重复点击只创建一次队列；自身状态刷新不丢接收结果', async () => {
  let finish!: (value: unknown) => void;
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const h = mount({ task: { ...task, status: 'READY' } });
  const button = screen.getByRole('button', { name: '加入隔离执行队列' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  h.rerender(
    h.change({
      task: { ...task, status: 'IN_PROGRESS', assignedAgentId: 'agent-a' },
      eligible: false,
    }),
  );
  await act(async () => finish(queued));
  expect(await screen.findByText(/隔离执行队列已接收/)).toBeVisible();
  expect(h.props.onUncertainChange).toHaveBeenCalledWith('project-a:task-a', false);
});
it('卸载后READY响应不派发queue', async () => {
  let finish!: (value: unknown) => void;
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const h = mount();
  fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
  h.unmount();
  await act(async () => finish({ ...task, status: 'READY' }));
  expect(post).toHaveBeenCalledTimes(1);
});
it('错误归属的queue响应保守锁定，不能假报成功', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    ...queued,
    execution: { ...queued.execution, taskId: 'other' },
  });
  const h = mount({ task: { ...task, status: 'READY' } });
  fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
  await screen.findByText('入队响应无法确认，请核对原隔离执行。');
  expect(h.props.onUncertainChange).toHaveBeenCalledWith('project-a:task-a', true);
});
it('READY响应丢失但从未queue，查询确认READY后可明确重新入队', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValueOnce(new Error('就绪回包丢失'))
    .mockResolvedValueOnce(queued);
  vi.spyOn(api, 'get').mockImplementation(
    (path) =>
      Promise.resolve(path.startsWith('/tasks/') ? { ...task, status: 'READY' } : []) as never,
  );
  const h = mount();
  fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
  await screen.findByText('就绪回包丢失');
  fireEvent.click(screen.getByRole('button', { name: '核对原隔离队列' }));
  await screen.findByText(/此前未发送入队请求/);
  h.rerender(h.change({ task: { ...task, status: 'READY' } }));
  fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
  await screen.findByText(/隔离执行队列已接收/);
  expect(post).toHaveBeenCalledTimes(2);
});
it.each([
  { ...task, status: 'CANCELED' },
  { ...task, sessionId: 'new-session' },
])('READY期间任务准入失效不queue %j', async (changed) => {
  let finish!: (value: unknown) => void;
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const h = mount();
  fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
  h.rerender(h.change({ task: changed }));
  await act(async () => finish({ ...task, status: 'READY' }));
  expect(post).toHaveBeenCalledTimes(1);
});
it.each(['WORKTREE_QUEUE_CONFLICT', 'UNRECOGNIZED_ERROR'])(
  '非确定拒绝%s即使4xx也先核对不重放',
  async (code) => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(code, '需要核对', 409));
    const h = mount({ task: { ...task, status: 'READY' } });
    fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
    await screen.findByText('需要核对');
    expect(h.props.onUncertainChange).toHaveBeenCalledWith('project-a:task-a', true);
    expect(screen.getByRole('button', { name: '加入隔离执行队列' })).toBeDisabled();
  },
);
it('明确预准入拒绝不标未知且不自动重发', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValue(new ApiError('AGENT_NOT_READY', 'Agent尚未就绪', 409));
  const h = mount({ task: { ...task, status: 'READY' } });
  fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
  await screen.findByText('Agent尚未就绪');
  expect(h.props.onUncertainChange).not.toHaveBeenCalledWith('project-a:task-a', true);
  expect(post).toHaveBeenCalledTimes(1);
});
