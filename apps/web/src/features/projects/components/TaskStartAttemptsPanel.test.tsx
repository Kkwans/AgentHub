// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api, authSession } from '../../../lib/api';
import { TaskStartAttemptsPanel } from './TaskStartAttemptsPanel';
import { parseTaskStartAttempts } from '../lib/task-start-attempts';
const row = {
  attemptId: 'attempt-1',
  taskId: 'task-1',
  sessionId: 'session-1',
  runId: null,
  kind: 'START',
  phase: 'UNKNOWN',
  errorCode: 'TASK_SESSION_CREATE_UNKNOWN',
  createdAt: '2026-11-14T03:47:00Z',
  updatedAt: '2026-11-14T03:47:01Z',
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (taskId = 'task-1', scope: string | null = 'admin-a') => (
    <QueryClientProvider client={client}>
      <TaskStartAttemptsPanel projectId="project-1" taskId={taskId} scope={scope} />
    </QueryClientProvider>
  );
  const result = render(view());
  return {
    ...result,
    change: (taskId: string, scope = 'admin-a') => result.rerender(view(taskId, scope)),
  };
}
function setup(data: unknown = [row]) {
  return vi
    .spyOn(api, 'get')
    .mockImplementation(
      async (path) =>
        (path.endsWith('/start-attempts')
          ? data
          : { id: 'task-1', projectId: 'project-1' }) as never,
    );
}
it('仅显式查询读取，未知记录不产生写入或解锁动作', async () => {
  const get = setup();
  const post = vi.spyOn(api, 'post');
  mount();
  expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '查询启动记录' }));
  expect(await screen.findByText(/首次启动 · 创建结果未知/)).toBeVisible();
  expect(get.mock.calls.map(([path]) => path)).toEqual([
    '/tasks/task-1',
    '/tasks/task-1/start-attempts',
  ]);
  expect(post).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(screen.getByText('查看操作标识与时间'));
  expect(screen.getByText('attempt-1')).toBeVisible();
});
it('空记录不会宣称未执行', async () => {
  setup([]);
  mount();
  fireEvent.click(screen.getByRole('button', { name: '查询启动记录' }));
  expect(await screen.findByText(/未查到启动记录；这不能证明/)).toBeVisible();
});
it('读取失败保持未确认且没有自动重试', async () => {
  const get = vi.spyOn(api, 'get').mockRejectedValue(new Error('404'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: '查询启动记录' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('查询失败不代表原操作未执行');
  expect(get).toHaveBeenCalledTimes(1);
});
it.each(['task', 'scope', 'revoke'] as const)('%s变化丢弃迟到响应', async (mode) => {
  let resolve!: (data: unknown) => void;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const get = vi
    .spyOn(api, 'get')
    .mockImplementation(
      async (path) =>
        (path.endsWith('/start-attempts')
          ? pending
          : { id: 'task-1', projectId: 'project-1' }) as never,
    );
  const ui = mount();
  fireEvent.click(screen.getByRole('button', { name: '查询启动记录' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('status')).toHaveTextContent('正在读取');
  if (mode === 'revoke') act(() => authSession.notifyAuthorizationRequired());
  else ui.change(mode === 'task' ? 'task-2' : 'task-1', mode === 'scope' ? 'admin-b' : 'admin-a');
  await act(async () => {
    resolve([row]);
    await pending;
  });
  expect(screen.queryByText(/首次启动 · 创建结果未知/)).not.toBeInTheDocument();
  if (mode === 'revoke') expect(screen.getByRole('button')).toBeDisabled();
});
it('任务项目身份不匹配时不读取尝试', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ id: 'task-1', projectId: 'other' });
  mount();
  fireEvent.click(screen.getByRole('button', { name: '查询启动记录' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('原任务身份无法确认');
  expect(get).toHaveBeenCalledTimes(1);
});
it('白名单丢弃额外正文，拒绝混合归属/未知阶段/重复记录', () => {
  expect(parseTaskStartAttempts([{ ...row, inputHash: 'secret' }], 'task-1')[0]).not.toHaveProperty(
    'inputHash',
  );
  expect(() => parseTaskStartAttempts([{ ...row, taskId: 'other' }], 'task-1')).toThrow();
  expect(() => parseTaskStartAttempts([{ ...row, phase: 'SAFE' }], 'task-1')).toThrow();
  expect(() => parseTaskStartAttempts([row, row], 'task-1')).toThrow();
});

it('查询处理中重复点击只发起一次读取', async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const get = vi
    .spyOn(api, 'get')
    .mockImplementation(async (path) => (path.endsWith('/start-attempts') ? [] : pending) as never);
  mount();
  const button = screen.getByRole('button', { name: '查询启动记录' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(button).toBeDisabled());
  expect(get).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ id: 'task-1', projectId: 'project-1' });
    await pending;
  });
  expect(await screen.findByText(/未查到启动记录；这不能证明/)).toBeVisible();
  expect(get).toHaveBeenCalledTimes(2);
});
it.each([{ kind: ['START'] }, { createdAt: 'not-a-date' }, { runId: '' }, { attemptId: ' ' }])(
  '拒绝非白名单类型 %j',
  (invalid) => {
    expect(() => parseTaskStartAttempts([{ ...row, ...invalid }], 'task-1')).toThrow();
  },
);
