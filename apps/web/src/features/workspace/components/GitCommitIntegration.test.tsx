// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { QueryState } from '../workspace-types';
import { GitChangesTree } from './GitChangesTree';
import { GitCommitOperationProvider } from './GitCommitOperationProvider';

vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'local_trusted',
  useAuthUser: () => null,
}));
vi.mock('../../../lib/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('./DiffViewer', () => ({ DiffViewer: () => <div>Diff</div> }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  localStorage.clear();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
});
const deferred = () => {
  let resolve!: (result: unknown) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
};
const query = <T,>(data: T): QueryState<T> => ({
  data,
  error: null,
  isLoading: false,
  refetch: vi.fn(),
});
const receipt = { sha: 'a'.repeat(40) };
const projectA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const projectB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function mount(withProvider = true) {
  vi.mocked(api.get).mockImplementation(
    async (path) =>
      ({
        scope: 'local-trusted',
        projectId: path.split('/')[2],
        operationId: path.split('/').at(-1),
        protocolVersion: 1,
        requestHash: 'a'.repeat(64),
        phase: 'COMMAND_SUCCEEDED',
        commandExit: 0,
        observedAfterHead: receipt.sha,
        resultEvidence: { kind: 'COMMAND_EXIT_ZERO', headAttribution: 'OBSERVED_ONLY' },
      }) as never,
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  const fallback = vi.fn(async () => receipt);
  function Consumer() {
    const [open, setOpen] = useState(true);
    const [project, setProject] = useState(projectA);
    return (
      <>
        <button onClick={() => setOpen((value) => !value)}>{open ? '关闭面板' : '打开面板'}</button>
        <button onClick={() => setProject((value) => (value === projectA ? projectB : projectA))}>
          切换项目
        </button>
        <div aria-label="当前项目">{project}</div>
        {open && (
          <GitChangesTree
            key={project}
            projectId={project}
            projectName={project === projectA ? '项目a' : '项目b'}
            status={query({
              clean: false,
              branch: 'main',
              entries: [{ index: ' ', worktree: 'M', path: 'one.ts' }],
            })}
            diff={query({ patch: '', truncated: false, staged: false })}
            commits={query([])}
            branches={query([])}
            onCommit={fallback}
            stagedDiff={false}
            onStagedDiffChange={vi.fn()}
            whitespace="default"
            onWhitespaceChange={vi.fn()}
          />
        )}
      </>
    );
  }
  const child = <Consumer />;
  const view = render(
    <QueryClientProvider client={client}>
      {withProvider ? <GitCommitOperationProvider>{child}</GitCommitOperationProvider> : child}
    </QueryClientProvider>,
  );
  return { view, invalidate, fallback };
}
function fill(message: string) {
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 one.ts' }));
  fireEvent.change(screen.getByRole('textbox', { name: '提交说明' }), {
    target: { value: message },
  });
}
function submit() {
  fireEvent.click(screen.getByRole('button', { name: '提交所选文件 (1)' }));
}

it('关闭重开保留 pending，返回回执不重发且仅刷新原项目缓存', async () => {
  const pending = deferred();
  vi.mocked(api.post).mockReturnValue(pending.promise);
  const app = mount();
  fill('原说明');
  submit();
  expect(api.post).toHaveBeenCalledWith(`/projects/${projectA}/git/commit`, {
    protocolVersion: 1,
    operationId: expect.any(String),
    expectedHead: null,
    mode: 'SELECTED',
    paths: ['one.ts'],
    message: '原说明',
  });
  fireEvent.click(screen.getByRole('button', { name: '关闭面板' }));
  fireEvent.click(screen.getByRole('button', { name: '打开面板' }));
  expect(screen.getByRole('status')).toHaveTextContent('原 Project（项目a）正在提交');
  expect(screen.getByRole('button', { name: '正在提交…' })).toBeDisabled();
  await act(async () => pending.resolve(receipt));
  expect(screen.getByRole('status')).toHaveTextContent('提交完成：aaaaaaaaaaaa');
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(app.fallback).not.toHaveBeenCalled();
  expect(app.invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual([
    ['git-status', projectA],
    ['git-diff', projectA],
    ['git-commits', projectA],
    ['git-branches', projectA],
  ]);
});

it('关闭时丢失响应，重开保留原项目记录与 unknown 锁', async () => {
  const pending = deferred();
  vi.mocked(api.post).mockReturnValue(pending.promise);
  const app = mount();
  fill('原始说明');
  submit();
  fireEvent.click(screen.getByRole('button', { name: '关闭面板' }));
  await act(async () => pending.reject(new Error('断线')));
  vi.mocked(api.get).mockRejectedValue(new Error('404'));
  fireEvent.click(screen.getByRole('button', { name: '打开面板' }));
  expect(screen.getByRole('alert')).toHaveTextContent('提交结果未知');
  expect(screen.getByRole('alert')).toHaveTextContent('原始说明');
  expect(screen.getByRole('alert')).toHaveTextContent(`原 Project：项目a（${projectA}）`);
  fill('修改后的说明');
  fireEvent.submit(app.view.container.querySelector('form')!);
  expect(screen.getByRole('button', { name: '提交所选文件 (1)' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '重试提交' })).toBeDisabled();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(app.invalidate).not.toHaveBeenCalled();
});

it('项目 A→B→A 时 A 的晚到成功不清空 B 草稿且回到 A 可读回执', async () => {
  const pending = deferred();
  vi.mocked(api.post).mockReturnValue(pending.promise);
  mount();
  fill('项目A提交');
  submit();
  fireEvent.click(screen.getByRole('button', { name: '切换项目' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fill('项目B草稿');
  await act(async () => pending.resolve(receipt));
  expect(screen.getByRole('textbox', { name: '提交说明' })).toHaveValue('项目B草稿');
  expect(screen.getByRole('checkbox', { name: '选择 one.ts' })).toBeChecked();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '切换项目' }));
  expect(screen.getByRole('status')).toHaveTextContent('提交完成：aaaaaaaaaaaa');
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('成功仅清空未改动的原草稿', async () => {
  const pending = deferred();
  vi.mocked(api.post).mockReturnValue(pending.promise);
  mount();
  fill('原说明');
  submit();
  await act(async () => pending.resolve(receipt));
  expect(screen.getByRole('checkbox', { name: '选择 one.ts' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 one.ts' }));
  expect(screen.getByRole('textbox', { name: '提交说明' })).toHaveValue('');
});

it('同挂载 pending 时编辑的新草稿不会被旧成功回调清空', async () => {
  const pending = deferred();
  vi.mocked(api.post).mockReturnValue(pending.promise);
  mount();
  fill('原说明');
  submit();
  fireEvent.change(screen.getByRole('textbox', { name: '提交说明' }), {
    target: { value: '后来编辑的新说明' },
  });
  await act(async () => pending.resolve(receipt));
  expect(screen.getByRole('textbox', { name: '提交说明' })).toHaveValue('后来编辑的新说明');
  expect(screen.getByRole('checkbox', { name: '选择 one.ts' })).toBeChecked();
});

it('带 projectId 缺失 Provider 时 fail closed，不调用旧回调或 POST', async () => {
  const app = mount(false);
  fill('不能发送');
  fireEvent.submit(app.view.container.querySelector('form')!);
  expect(screen.getByRole('alert')).toHaveTextContent('Git 提交保护不可用');
  expect(screen.getByRole('button', { name: '提交所选文件 (1)' })).toBeDisabled();
  expect(api.post).not.toHaveBeenCalled();
  expect(app.fallback).not.toHaveBeenCalled();
});

it('缓存刷新失败仍显示有效成功，不伪装网络未知结果', async () => {
  vi.mocked(api.post).mockResolvedValue(receipt);
  const app = mount();
  app.invalidate.mockRejectedValue(new Error('缓存刷新失败'));
  fill('已成功提交');
  submit();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('提交完成'));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Git 状态刷新失败'));
  expect(screen.getByRole('alert')).not.toHaveTextContent('提交结果未知');
  expect(screen.queryByRole('button', { name: '重试提交' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '只读刷新' }));
  expect(api.post).toHaveBeenCalledTimes(1);
});
