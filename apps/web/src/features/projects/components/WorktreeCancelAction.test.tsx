// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, type WorktreeExecutionRecord } from '../../../lib/api';
import { WorktreeCancelAction, type WorktreeCancelState } from './WorktreeCancelAction';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const execution = {
  id: 'execution-a',
  projectId: 'project-a',
  taskId: 'task-a',
  status: 'RUNNING',
} as WorktreeExecutionRecord;
function mount(status = 'RUNNING') {
  function Harness() {
    const [state, setState] = useState<WorktreeCancelState>();
    return (
      <WorktreeCancelAction
        execution={{ ...execution, status } as WorktreeExecutionRecord}
        disabled={false}
        state={state}
        onStateChange={(_, value) => setState(value)}
      />
    );
  }
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );
}
it('运行中取消只表示请求已发出，不宣称停止且不重复', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue(execution);
  mount();
  fireEvent.click(screen.getByRole('button', { name: '取消隔离执行' }));
  await screen.findByText(/取消请求已发送/);
  expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeDisabled();
  expect(post).toHaveBeenCalledExactlyOnceWith('/worktree-executions/execution-a/cancel', {});
});
it('直接取消校验包裹的任务归属及终态', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    execution: { ...execution, status: 'CANCELED' },
    task: { id: execution.taskId, projectId: execution.projectId, status: 'CANCELED' },
  });
  mount('QUEUED');
  fireEvent.click(screen.getByRole('button', { name: '取消隔离执行' }));
  await screen.findByText(/隔离执行已取消/);
});
it.each(['SETTING_UP', 'MERGING', 'DONE', 'CANCELED'])('%s 不允许取消', (status) => {
  mount(status);
  expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeDisabled();
});
it.each([
  null,
  { ...execution, id: 'other' },
  { execution: { ...execution, status: 'CANCELED' }, task: { id: 'other' } },
])('非法响应只能核对，不能重放', async (result) => {
  const post = vi.spyOn(api, 'post').mockResolvedValue(result);
  const get = vi.spyOn(api, 'get').mockResolvedValue({ ...execution, status: 'CANCELED' });
  mount();
  fireEvent.click(screen.getByRole('button', { name: '取消隔离执行' }));
  await screen.findByText(/取消结果无法确认/);
  fireEvent.click(screen.getByRole('button', { name: '核对隔离取消状态' }));
  await screen.findByText(/隔离执行已取消/);
  expect(post).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledExactlyOnceWith('/worktree-executions/execution-a');
});
it('运行取消输给正常完成，核对REVIEW不声称取消且可释放审阅锁', async () => {
  vi.spyOn(api, 'post').mockResolvedValue(execution);
  vi.spyOn(api, 'get').mockResolvedValue({ ...execution, status: 'REVIEW' });
  mount();
  fireEvent.click(screen.getByRole('button', { name: '取消隔离执行' }));
  await screen.findByText(/取消请求已发送/);
  fireEvent.click(screen.getByRole('button', { name: '核对隔离取消状态' }));
  await screen.findByText(/原隔离执行已进入 REVIEW，不是取消成功/);
  expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeDisabled();
});
it('未知POST后GET REVIEW不能证明迟到取消已结束，不释放为resolved', async () => {
  vi.spyOn(api, 'post').mockRejectedValue(new Error('lost'));
  vi.spyOn(api, 'get').mockResolvedValue({ ...execution, status: 'REVIEW' });
  mount();
  fireEvent.click(screen.getByRole('button', { name: '取消隔离执行' }));
  await screen.findByText(/取消结果无法确认/);
  fireEvent.click(screen.getByRole('button', { name: '核对隔离取消状态' }));
  await screen.findByText(/尚未确认取消完成/);
  expect(screen.queryByText(/不是取消成功；可继续处理/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeDisabled();
});
it('明确拒绝只有只读核对后才允许显式重试', async () => {
  const { ApiError } = await import('../../../lib/api-error');
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValue(new ApiError('WORKTREE_EXECUTION_CHANGED', 'changed', 409));
  vi.spyOn(api, 'get').mockResolvedValue({ ...execution, status: 'BLOCKED' });
  mount();
  fireEvent.click(screen.getByRole('button', { name: '取消隔离执行' }));
  await screen.findByText(/取消请求未被接受/);
  expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '核对隔离取消状态' }));
  await screen.findByText(/可明确重新请求取消/);
  expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeEnabled();
  expect(post).toHaveBeenCalledTimes(1);
});
it('明确拒绝证据跨忙碌核对保留，后续可显式重试', async () => {
  const { ApiError } = await import('../../../lib/api-error');
  vi.spyOn(api, 'post').mockRejectedValue(
    new ApiError('WORKTREE_EXECUTION_CHANGED', 'changed', 409),
  );
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({ ...execution, status: 'SETTING_UP' })
    .mockResolvedValueOnce(execution);
  mount();
  fireEvent.click(screen.getByRole('button', { name: '取消隔离执行' }));
  await screen.findByText(/取消请求未被接受/);
  fireEvent.click(screen.getByRole('button', { name: '核对隔离取消状态' }));
  await screen.findByText(/状态已核对：SETTING_UP/);
  fireEvent.click(screen.getByRole('button', { name: '核对隔离取消状态' }));
  await screen.findByText(/可明确重新请求取消/);
  expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeEnabled();
});
it('已回执取消核对到BLOCKED允许明确后续取消，而非自动重放', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue(execution);
  vi.spyOn(api, 'get').mockResolvedValue({ ...execution, status: 'BLOCKED' });
  mount();
  fireEvent.click(screen.getByRole('button', { name: '取消隔离执行' }));
  await screen.findByText(/取消请求已发送/);
  fireEvent.click(screen.getByRole('button', { name: '核对隔离取消状态' }));
  await screen.findByText(/可明确再次取消这个已阻塞执行/);
  expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeEnabled();
  expect(post).toHaveBeenCalledTimes(1);
});
