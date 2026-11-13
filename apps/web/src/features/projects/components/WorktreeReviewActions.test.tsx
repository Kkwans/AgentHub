import { ApiError } from '../../../lib/api-error';
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, type WorktreeExecutionRecord } from '../../../lib/api';
import { WorktreeReviewActions } from './WorktreeReviewActions';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
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
  entries: [{ index: ' ', worktree: 'M', path: 'src/example.ts' }],
  patch: 'diff --git a/src/example.ts b/src/example.ts',
  diffStat: '1 file changed',
  truncated: true,
};
function mount(value = execution) {
  function Location() {
    return <output data-testid="location">{useLocation().pathname}</output>;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pending = vi.fn();
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WorktreeReviewActions
          key={value.id}
          execution={value}
          disabled={false}
          onPendingChange={pending}
        />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    ...result,
    pending,
    update: (next: WorktreeExecutionRecord) =>
      result.rerender(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <WorktreeReviewActions
              key={next.id}
              execution={next}
              disabled={false}
              onPendingChange={pending}
            />
            <Location />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
  };
}
async function load() {
  fireEvent.click(screen.getByRole('button', { name: '读取隔离工作区审阅' }));
  await screen.findByText('1 file changed');
}
it('先显式读取完整受管差异，明确确认后才合并', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, truncated: false });
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    execution: { ...execution, status: 'DONE', mergeCommitSha: 'merge-sha' },
    task: { id: 'task-a', projectId: 'project-a', status: 'DONE' },
  });
  mount();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
  await load();
  expect(screen.getByText('src/example.ts')).toBeVisible();
  expect(screen.getByText(/自动提交全部改动/)).toHaveTextContent('main');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '提交并合并隔离工作区' }));
  await screen.findByText(/merge-sha/);
  expect(post).toHaveBeenCalledWith('/worktree-executions/execution-a/merge', {});
});
it('返工复用原Session且提交修剪后的反馈，不使用普通Task审阅', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(review);
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ ...execution, status: 'RUNNING', runId: 'run-b' });
  mount();
  await load();
  fireEvent.change(screen.getByRole('textbox', { name: '隔离工作区修改说明' }), {
    target: { value: '  修复边界条件  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: '提交隔离工作区返工' }));
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent('/workspace/session-a'),
  );
  expect(post).toHaveBeenCalledWith('/worktree-executions/execution-a/rework', {
    feedback: '修复边界条件',
  });
});

it('截断审阅不允许合并但保留返工', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(review);
  const post = vi.spyOn(api, 'post');
  mount();
  await load();
  expect(screen.getByText(/差异已截断/)).toBeVisible();
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: '隔离工作区修改说明' }), {
    target: { value: '缩小改动' },
  });
  expect(screen.getByRole('button', { name: '提交隔离工作区返工' })).toBeEnabled();
  expect(post).not.toHaveBeenCalled();
});

it('待处理防重复提交，后台自身Run更新不吞返工跳转', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, truncated: false });
  let finish!: (value: unknown) => void;
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const h = mount();
  await load();
  fireEvent.change(screen.getByRole('textbox', { name: '隔离工作区修改说明' }), {
    target: { value: '完善边界' },
  });
  const button = screen.getByRole('button', { name: '提交隔离工作区返工' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('checkbox')).toBeDisabled();
  const next = { ...execution, status: 'RUNNING' as const, runId: 'run-new' };
  h.update(next);
  await act(async () => finish(next));
  expect(screen.getByTestId('location')).toHaveTextContent('/workspace/session-a');
  expect(h.pending).toHaveBeenLastCalledWith('project-a:task-a', false);
});
it('旧读取不成为新轮次的合并依据', async () => {
  let finish!: (value: unknown) => void;
  vi.spyOn(api, 'get').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const h = mount();
  fireEvent.click(screen.getByRole('button', { name: '读取隔离工作区审阅' }));
  h.update({ ...execution, runId: 'run-new' });
  await act(async () => finish({ ...review, truncated: false }));
  expect(screen.queryByText('1 file changed')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
});
it('换执行后旧返工回包不跳转或污染反馈', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, truncated: false });
  let finish!: (value: unknown) => void;
  vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const h = mount();
  await load();
  fireEvent.change(screen.getByRole('textbox', { name: '隔离工作区修改说明' }), {
    target: { value: '旧反馈' },
  });
  fireEvent.click(screen.getByRole('button', { name: '提交隔离工作区返工' }));
  h.update({ ...execution, id: 'execution-b', taskId: 'task-b' });
  fireEvent.change(screen.getByRole('textbox', { name: '隔离工作区修改说明' }), {
    target: { value: '新反馈' },
  });
  await act(async () => finish({ ...execution, status: 'RUNNING', runId: 'run-new' }));
  expect(screen.getByTestId('location')).toHaveTextContent('/');
  expect(screen.getByRole('textbox', { name: '隔离工作区修改说明' })).toHaveValue('新反馈');
});
it('网络失败保留反馈且不直接重放', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, truncated: false });
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('网络结果未知'));
  mount();
  await load();
  fireEvent.change(screen.getByRole('textbox', { name: '隔离工作区修改说明' }), {
    target: { value: '请保留' },
  });
  fireEvent.click(screen.getByRole('button', { name: '提交隔离工作区返工' }));
  await screen.findByText('网络结果未知');
  expect(screen.getByRole('textbox', { name: '隔离工作区修改说明' })).toHaveValue('请保留');
  expect(screen.getByRole('button', { name: '提交隔离工作区返工' })).toBeDisabled();
  expect(post).toHaveBeenCalledTimes(1);
});
it('明确合并拒绝清除预览和确认，重新读取后才可再确认', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, truncated: false });
  vi.spyOn(api, 'post').mockRejectedValue(
    new ApiError('PRIMARY_WORKTREE_DIRTY', '主工作区有改动', 409),
  );
  mount();
  await load();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '提交并合并隔离工作区' }));
  await screen.findByText('主工作区有改动');
  expect(screen.getByText(/可能已生成受管提交/)).toBeVisible();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
  await load();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});
it('拒绝不匹配或不完整的审阅数据', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, taskBranch: 'wrong' });
  mount();
  fireEvent.click(screen.getByRole('button', { name: '读取隔离工作区审阅' }));
  await screen.findByText(/审阅归属无法确认/);
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
});
