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
  mergeAdmission: {
    expectedRunId: 'run-a',
    expectedOperationId: 'operation-a',
    retryEligible: false,
    mergeAllowed: true,
  },
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
  expect(post).toHaveBeenCalledWith('/worktree-executions/execution-a/merge', {
    expectedRunId: 'run-a',
    expectedOperationId: 'operation-a',
  });
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
it('合并原子claim前明确拒绝不锁成未知，保留输入并要求重读及重新确认', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, truncated: false });
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValue(new ApiError('WORKTREE_EXECUTION_CHANGED', '原审阅执行已变化', 409));
  mount();
  await load();
  fireEvent.change(screen.getByRole('textbox', { name: '隔离工作区修改说明' }), {
    target: { value: '保留修改反馈' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: '合并提交说明' }), {
    target: { value: '保留提交说明' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '提交并合并隔离工作区' }));
  await screen.findByText('原审阅执行已变化');
  expect(screen.getByText(/未执行合并.*请重新读取.*确认/)).toBeVisible();
  expect(screen.queryByText(/可能已生成受管提交/)).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '隔离工作区修改说明' })).toHaveValue('保留修改反馈');
  expect(screen.getByRole('textbox', { name: '合并提交说明' })).toHaveValue('保留提交说明');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
  expect(screen.queryByText(review.diffStat)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '核对原隔离执行' })).not.toBeInTheDocument();
  expect(post).toHaveBeenCalledTimes(1);
  await load();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
  expect(post).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeEnabled();
});
it.each([400, 500])('同名错误码但HTTP %s不视作Git前明确拒绝', async (status) => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, truncated: false });
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValue(new ApiError('WORKTREE_EXECUTION_CHANGED', '无法确定合并结果', status));
  mount();
  await load();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '提交并合并隔离工作区' }));
  await screen.findByText('无法确定合并结果');
  expect(screen.getByRole('button', { name: '读取隔离工作区审阅' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '核对原隔离执行' })).toBeEnabled();
  expect(screen.queryByText(/未执行合并/)).not.toBeInTheDocument();
  expect(post).toHaveBeenCalledTimes(1);
});

it('前置拒绝必须按原 attempt 只读核实、重新读取和确认才显式重试', async () => {
  let rejected = false;
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (path.endsWith('/review'))
      return {
        ...review,
        truncated: false,
        mergeAdmission: { ...review.mergeAdmission, retryEligible: rejected },
      } as never;
    return execution as never;
  });
  const post = vi
    .spyOn(api, 'post')
    .mockImplementationOnce(async () => {
      rejected = true;
      throw new ApiError('WORKTREE_GIT_PREWRITE_REJECTED', '未写入', 409);
    })
    .mockResolvedValue({
      execution: { ...execution, status: 'DONE', mergeCommitSha: 'new-merge' },
      task: { id: 'task-a', projectId: 'project-a', status: 'DONE' },
    });
  mount();
  await load();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '提交并合并隔离工作区' }));
  await screen.findByRole('button', { name: '核对原隔离执行' });
  expect(screen.getByRole('button', { name: '读取隔离工作区审阅' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '核对原隔离执行' }));
  await screen.findByText(/原合并操作已确认未写入/);
  expect(post).toHaveBeenCalledTimes(1);
  await load();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '提交并合并隔离工作区' }));
  await screen.findByText(/new-merge/);
  expect(post).toHaveBeenLastCalledWith('/worktree-executions/execution-a/merge', {
    expectedRunId: 'run-a',
    expectedOperationId: 'operation-a',
    retryOfOperationId: 'operation-a',
  });
});

it.each(['missing', 'other-attempt', 'unknown'])('未知恢复的 %s 证据不能解锁', async (mode) => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({ ...review, truncated: false });
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('response lost'));
  mount();
  await load();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '提交并合并隔离工作区' }));
  await screen.findByRole('button', { name: '核对原隔离执行' });
  get.mockImplementation(async (path) => {
    if (!path.endsWith('/review')) return execution as never;
    if (mode === 'missing') throw new ApiError('NOT_FOUND', 'missing', 404);
    return {
      ...review,
      truncated: false,
      mergeAdmission: {
        ...review.mergeAdmission,
        retryEligible: mode !== 'unknown',
        expectedOperationId: mode === 'other-attempt' ? 'new-operation' : 'operation-a',
      },
    } as never;
  });
  fireEvent.click(screen.getByRole('button', { name: '核对原隔离执行' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '核对原隔离执行' })).not.toBeDisabled(),
  );
  expect(screen.getByRole('button', { name: '读取隔离工作区审阅' })).toBeDisabled();
  expect(post).toHaveBeenCalledTimes(1);
});

it('持久 attempt generation 变化使旧差异和确认失效', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, truncated: false });
  const app = mount({ ...execution, gitMergeGeneration: 0 });
  await load();
  fireEvent.click(screen.getByRole('checkbox'));
  app.update({ ...execution, gitMergeGeneration: 1 });
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
});

it('只读核对在途时 generation 变化，晚到安全拒绝也不能解锁', async () => {
  let resolve!: (value: unknown) => void;
  const late = new Promise((yes) => {
    resolve = yes;
  });
  const get = vi.spyOn(api, 'get').mockResolvedValue({ ...review, truncated: false });
  vi.spyOn(api, 'post').mockRejectedValue(new Error('lost'));
  const app = mount({ ...execution, gitMergeGeneration: 0 });
  await load();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '提交并合并隔离工作区' }));
  await screen.findByRole('button', { name: '核对原隔离执行' });
  get.mockImplementation(async (path) =>
    path.endsWith('/review') ? ((await late) as never) : (execution as never),
  );
  fireEvent.click(screen.getByRole('button', { name: '核对原隔离执行' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  app.update({ ...execution, gitMergeGeneration: 1 });
  await act(async () =>
    resolve({
      ...review,
      truncated: false,
      mergeAdmission: { ...review.mergeAdmission, retryEligible: true },
    }),
  );
  expect(screen.getByRole('button', { name: '读取隔离工作区审阅' })).toBeDisabled();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});

it('读取差异在途时 generation 变化，晚到旧差异不恢复合并权限', async () => {
  let resolve!: (value: unknown) => void;
  vi.spyOn(api, 'get').mockImplementation(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  const app = mount({ ...execution, gitMergeGeneration: 0 });
  fireEvent.click(screen.getByRole('button', { name: '读取隔离工作区审阅' }));
  app.update({ ...execution, gitMergeGeneration: 1 });
  await act(async () => resolve({ ...review, truncated: false }));
  expect(screen.queryByText('1 file changed')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
});
