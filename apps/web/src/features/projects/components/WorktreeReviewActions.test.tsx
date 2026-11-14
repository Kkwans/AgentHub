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
    dispatchOperationId: 'operation-a',
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
  expect(screen.queryByText(/原合并操作已确认未写入/)).not.toBeInTheDocument();
  expect(screen.getByText(/旧操作已确认未写入；本次确认将创建新的合并尝试/)).toBeVisible();
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
  expect(screen.getByText(/请先核对原隔离执行和实际 Git 结果/)).toBeVisible();
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

it('显式retry再次前置拒绝时核对新实际key，而非复用旧拒绝证明', async () => {
  let attempt = 0;
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (!path.endsWith('/review')) return execution as never;
    return {
      ...review,
      truncated: false,
      mergeAdmission: {
        expectedRunId: 'run-a',
        expectedOperationId: attempt < 2 ? 'operation-a' : 'operation-b',
        dispatchOperationId:
          attempt === 0 ? 'operation-a' : attempt === 1 ? 'operation-b' : 'operation-c',
        retryEligible: attempt > 0,
        mergeAllowed: true,
      },
    } as never;
  });
  const post = vi.spyOn(api, 'post').mockImplementation(async () => {
    attempt += 1;
    throw new ApiError('WORKTREE_GIT_PREWRITE_REJECTED', '未写入', 409);
  });
  mount();
  for (let i = 0; i < 2; i += 1) {
    await load();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '提交并合并隔离工作区' }));
    await screen.findByRole('button', { name: '核对原隔离执行' });
    fireEvent.click(screen.getByRole('button', { name: '核对原隔离执行' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '读取隔离工作区审阅' })).toBeEnabled(),
    );
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  }
  expect(post).toHaveBeenCalledTimes(2);
  expect(post).toHaveBeenLastCalledWith('/worktree-executions/execution-a/merge', {
    expectedRunId: 'run-a',
    expectedOperationId: 'operation-a',
    retryOfOperationId: 'operation-a',
  });
});

it('合并主操作与结果先于返工输入，两个动作分区保持可发现', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, truncated: false });
  mount();
  await load();
  const mergeSection = screen.getByRole('region', { name: '确认合并' });
  const reworkSection = screen.getByRole('region', { name: '继续修改' });
  const merge = screen.getByRole('button', { name: '提交并合并隔离工作区' });
  const feedback = screen.getByRole('textbox', { name: '隔离工作区修改说明' });
  expect(mergeSection).toContainElement(merge);
  expect(reworkSection).toContainElement(feedback);
  expect(merge.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('heading', { name: '确认合并' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '继续修改' })).toBeVisible();
  expect(feedback).toBeVisible();
  expect(merge).toBeDisabled();
});

it('Git技术信息默认折叠且可聚焦展开读取完整SHA，不隐藏状态或发送请求', async () => {
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, baseSha: base, headSha: head });
  const post = vi.spyOn(api, 'post');
  mount({ ...execution, baseSha: base });
  await load();
  const summary = screen.getByText('Git 技术信息');
  const details = summary.closest('details')!;
  expect(details).not.toHaveAttribute('open');
  expect(screen.getByText(base)).not.toBeVisible();
  expect(screen.getByText(head)).not.toBeVisible();
  expect(screen.getByText(/领先提交：0/)).toBeVisible();
  expect(screen.getByText(/工作区包含未提交改动/)).toBeVisible();
  summary.focus();
  expect(summary).toHaveFocus();
  fireEvent.click(summary);
  expect(details).toHaveAttribute('open');
  expect(screen.getByText(base)).toBeVisible();
  expect(screen.getByText(head)).toBeVisible();
  expect(screen.getByText(base).textContent).toHaveLength(40);
  fireEvent.click(summary);
  expect(details).not.toHaveAttribute('open');
  expect(post).not.toHaveBeenCalled();
});

it('技术折叠不折叠截断警告、合并影响说明和确认条件', async () => {
  vi.spyOn(api, 'get').mockResolvedValue(review);
  mount();
  await load();
  expect(screen.getByText('Git 技术信息').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText(/差异已截断/)).toBeVisible();
  expect(screen.getByText(/不推送远端，不自动删除分支或工作区/)).toBeVisible();
  const confirm = screen.getByRole('checkbox', { name: '我已审阅改动，确认提交并合并到基础分支' });
  expect(confirm).toBeVisible();
  expect(confirm).toBeDisabled();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: '隔离工作区修改说明' })).toBeVisible();
});

it('返工失败反馈独立于合并分区，仍位于返工输入前且保留未知保护', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, truncated: false });
  vi.spyOn(api, 'post').mockRejectedValue(new Error('返工回执丢失，请核对'));
  mount();
  await load();
  const feedback = screen.getByRole('textbox', { name: '隔离工作区修改说明' });
  fireEvent.change(feedback, { target: { value: '请补充测试' } });
  fireEvent.click(screen.getByRole('button', { name: '提交隔离工作区返工' }));
  const error = await screen.findByText('返工回执丢失，请核对');
  expect(screen.getByRole('region', { name: '确认合并' })).not.toContainElement(error);
  expect(screen.getByRole('region', { name: '继续修改' })).not.toContainElement(error);
  expect(error.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText(/请先核对原隔离执行和实际 Git 结果/)).toBeVisible();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
});

it('文本差异默认展开，完整纯文本在技术信息和提交表单之前', async () => {
  const patch =
    'diff --git a/file b/file\n-旧行\n+<script>不是HTML</script>\n' + '保留长行'.repeat(200);
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, patch, truncated: false });
  const post = vi.spyOn(api, 'post');
  mount();
  await load();
  const content = screen.getByRole('region', { name: '隔离工作区差异' });
  expect(content).toBeVisible();
  expect(content.textContent).toBe(patch);
  expect(content.querySelector('script')).toBeNull();
  expect(content.closest('details')).toHaveAttribute('open');
  content.focus();
  expect(content).toHaveFocus();
  const tech = screen.getByText('Git 技术信息').closest('details')!;
  expect(tech).not.toHaveAttribute('open');
  expect(
    screen.getByText('src/example.ts').compareDocumentPosition(content) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(content.compareDocumentPosition(tech) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(
    tech.compareDocumentPosition(screen.getByRole('textbox', { name: '合并提交说明' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
});

it('收起再展开差异保留草稿和明确确认，不发送操作且不因输入重绘自动展开', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, truncated: false });
  const post = vi.spyOn(api, 'post');
  mount();
  await load();
  const summary = screen.getByText('查看隔离工作区差异');
  const commit = screen.getByRole('textbox', { name: '合并提交说明' });
  const feedback = screen.getByRole('textbox', { name: '隔离工作区修改说明' });
  fireEvent.change(commit, { target: { value: '审阅后的提交' } });
  fireEvent.change(feedback, { target: { value: '待修改建议' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(summary);
  expect(summary.closest('details')).not.toHaveAttribute('open');
  fireEvent.change(commit, { target: { value: '保留新的提交说明' } });
  expect(summary.closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText(review.patch)).not.toBeVisible();
  fireEvent.click(summary);
  expect(screen.getByRole('region', { name: '隔离工作区差异' })).toBeVisible();
  expect(commit).toHaveValue('保留新的提交说明');
  expect(feedback).toHaveValue('待修改建议');
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(post).not.toHaveBeenCalled();
});

it('空文本差异保留文件和截断警告，不宣称无改动或允许合并', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, patch: '' });
  mount();
  await load();
  expect(screen.getByText(/这不代表没有改动/)).toBeVisible();
  expect(screen.getByText('src/example.ts')).toBeVisible();
  fireEvent.click(screen.getByText('查看隔离工作区差异'));
  expect(screen.getByText(/差异已截断/)).toBeVisible();
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
});

it('大型patch保留完整纯文本，不创建逐行DOM或改变确认', async () => {
  const patch = '@@ -1 +1 @@\n' + '+x\n'.repeat(5000);
  vi.spyOn(api, 'get').mockResolvedValue({ ...review, patch, truncated: false });
  mount();
  await load();
  const region = screen.getByRole('region', { name: '隔离工作区差异' });
  expect(region.textContent).toBe(patch);
  expect(region.querySelectorAll('span')).toHaveLength(0);
  fireEvent.change(screen.getByRole('textbox', { name: '合并提交说明' }), {
    target: { value: '保留差异' },
  });
  expect(region.textContent).toBe(patch);
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});
