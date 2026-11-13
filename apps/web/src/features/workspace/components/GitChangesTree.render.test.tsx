// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { QueryState } from '../workspace-types';
import { GitChangesTree } from './GitChangesTree';

afterEach(cleanup);
const query = <T,>(data: T): QueryState<T> => ({
  data,
  error: null,
  isLoading: false,
  refetch: vi.fn(),
});

it('默认平铺真实文件，目录切换保留勾选与完整路径预览', () => {
  const onSelectPath = vi.fn();
  render(
    <GitChangesTree
      status={query({
        clean: false,
        branch: 'main',
        entries: [
          { index: ' ', worktree: 'M', path: 'src/deep/one.ts' },
          { index: '?', worktree: '?', path: 'src/other/one.ts' },
        ],
      })}
      diff={query({ patch: '', truncated: false, staged: false })}
      commits={query([])}
      branches={query([])}
      onCommit={vi.fn()}
      stagedDiff={false}
      onStagedDiffChange={vi.fn()}
      selectedPath="src/deep/one.ts"
      onSelectPath={onSelectPath}
      whitespace="default"
      onWhitespaceChange={vi.fn()}
    />,
  );
  const selectedFile = screen.getByLabelText('src/deep/one.ts', { selector: 'code' });
  expect(selectedFile).toHaveTextContent(/^one.ts$/);
  expect(selectedFile).toHaveAttribute('title', 'src/deep/one.ts');
  const toggle = screen.getByRole('button', { name: '按目录显示变更' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getAllByRole('treeitem')).toHaveLength(2);
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 src/deep/one.ts' }));
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(2);
  expect(screen.getByRole('checkbox', { name: '选择 src/deep/one.ts' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '查看 src/deep/one.ts Diff' }));
  expect(onSelectPath).toHaveBeenLastCalledWith('src/deep/one.ts', 'diff');
  fireEvent.click(screen.getByRole('button', { name: '查看 src/other/one.ts 文件' }));
  expect(onSelectPath).toHaveBeenLastCalledWith('src/other/one.ts', 'files');
});

function reviewProps() {
  return {
    status: query({
      clean: false,
      branch: 'feature/review',
      headSha: 'abcdef1234567890',
      upstream: 'origin/feature/review',
      ahead: 2,
      behind: 1,
      entries: [{ index: ' ', worktree: 'M', path: 'src/one.ts' }],
    }),
    diff: query({ patch: '', truncated: false, staged: false }),
    commits: query([]),
    branches: query([]),
    onCommit: vi.fn(async () => ({ sha: 'new-commit-sha' })),
    stagedDiff: false,
    onStagedDiffChange: vi.fn(),
    selectedPath: 'src/one.ts',
    onSelectPath: vi.fn(),
    whitespace: 'default' as const,
    onWhitespaceChange: vi.fn(),
  };
}
it('合并changes工具栏并收紧零选择，只有hash与tracking渐进展开', () => {
  const props = reviewProps();
  const view = render(<GitChangesTree {...props} />);
  expect(view.container.querySelector('.git-selection-heading')).toBeNull();
  expect(view.container.querySelector('.git-commit-dock')).toBeNull();
  expect(view.container.querySelector('.git-review-toolbar')).toHaveTextContent('1 个变更');
  expect(view.container.querySelector('.git-review-toolbar')).toHaveTextContent('勾选文件后提交');
  expect(screen.getByText('feature/review')).toBeVisible();
  expect(screen.getByText('有未提交变更')).toBeVisible();
  expect(screen.getByText('ahead 2 · behind 1')).toBeVisible();
  expect(screen.getByText('abcdef1234567890')).not.toBeVisible();
  expect(screen.getByText('origin/feature/review')).not.toBeVisible();
  const summary = screen.getByText('Git 详情');
  summary.focus();
  expect(summary).toHaveFocus();
  fireEvent.click(summary);
  expect(screen.getByText('abcdef1234567890')).toBeVisible();
  expect(screen.getByText('origin/feature/review')).toBeVisible();
  expect(screen.queryByText('选中文件')).not.toBeInTheDocument();
  expect(screen.getByLabelText('src/one.ts', { selector: 'code' })).toHaveAttribute(
    'title',
    'src/one.ts',
  );
});
it('HEAD缺失与状态/Diff读取错误不会被metadata折叠隐藏', () => {
  const props = reviewProps();
  const view = render(
    <GitChangesTree
      {...props}
      status={{
        ...props.status,
        data: { ...props.status.data!, branch: '(detached)', headSha: '' },
      }}
      diff={{ ...props.diff, error: new Error('Diff读取失败') }}
    />,
  );
  expect(screen.getByText('(detached)')).toBeVisible();
  expect(screen.getByText('无 HEAD')).toBeVisible();
  expect(screen.getByRole('alert')).toBeVisible();
  view.rerender(
    <GitChangesTree {...props} status={{ ...props.status, error: new Error('Git状态读取失败') }} />,
  );
  expect(screen.getByRole('alert')).toBeVisible();
});
it('提交pending/错误保留说明，清空勾选或切视图不吞错误且禁空路径重试', async () => {
  const props = reviewProps();
  let reject!: (reason: Error) => void;
  props.onCommit.mockImplementation(
    () =>
      new Promise((_resolve, no) => {
        reject = no;
      }),
  );
  render(<GitChangesTree {...props} />);
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 src/one.ts' }));
  fireEvent.change(screen.getByRole('textbox', { name: '提交说明' }), {
    target: { value: '保留说明' },
  });
  fireEvent.click(screen.getByRole('button', { name: '提交所选文件 (1)' }));
  expect(screen.getByRole('textbox', { name: '提交说明' })).toHaveValue('保留说明');
  expect(screen.getByRole('button', { name: /正在提交/ })).toBeDisabled();
  await act(async () => {
    reject(new Error('提交未完成'));
  });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('提交未完成'));
  const retry = screen.getByRole('button', { name: '重试提交' });
  expect(retry).toBeEnabled();
  fireEvent.click(retry);
  expect(screen.queryByRole('button', { name: '重试提交' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /正在提交/ })).toBeDisabled();
  await act(async () => {
    reject(new Error('提交未完成'));
  });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('提交未完成'));
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 src/one.ts' }));
  expect(screen.getByRole('alert')).toHaveTextContent('提交未完成');
  expect(screen.getByRole('textbox', { name: '提交说明' })).toHaveValue('保留说明');
  expect(screen.getByRole('button', { name: '重试提交' })).toBeDisabled();
  fireEvent.click(screen.getByText('更多 Git'));
  fireEvent.click(screen.getByRole('menuitem', { name: '提交历史' }));
  expect(screen.getByRole('alert')).toHaveTextContent('提交未完成');
  expect(props.onCommit).toHaveBeenCalledTimes(2);
  expect(props.onCommit).toHaveBeenNthCalledWith(1, { paths: ['src/one.ts'], message: '保留说明' });
  expect(props.onCommit).toHaveBeenNthCalledWith(2, { paths: ['src/one.ts'], message: '保留说明' });
});
it('成功回执在清空选择后常显，合并工具栏全选仍可用', async () => {
  const props = reviewProps();
  render(<GitChangesTree {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /^全选$/ }));
  expect(screen.getByRole('checkbox', { name: '选择 src/one.ts' })).toBeChecked();
  fireEvent.change(screen.getByRole('textbox', { name: '提交说明' }), {
    target: { value: '完成修改' },
  });
  fireEvent.click(screen.getByRole('button', { name: '提交所选文件 (1)' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('提交完成：new-commit-s'),
  );
  expect(screen.getByRole('checkbox', { name: '选择 src/one.ts' })).not.toBeChecked();
  expect(screen.getByRole('status')).toBeVisible();
});

it('错误后清空说明不会保留可触发的重试入口', async () => {
  const props = reviewProps();
  props.onCommit.mockRejectedValue(new Error('未完成'));
  render(<GitChangesTree {...props} />);
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 src/one.ts' }));
  fireEvent.change(screen.getByRole('textbox', { name: '提交说明' }), {
    target: { value: '说明' },
  });
  fireEvent.click(screen.getByRole('button', { name: '提交所选文件 (1)' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '重试提交' })).toBeEnabled());
  fireEvent.change(screen.getByRole('textbox', { name: '提交说明' }), { target: { value: '' } });
  expect(screen.queryByRole('button', { name: '重试提交' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '提交所选文件 (1)' })).toBeDisabled();
  expect(props.onCommit).toHaveBeenCalledTimes(1);
});

it('失败后取消选择再编辑直到空说明仍保留表单，显式收起语义真实', async () => {
  const props = reviewProps();
  props.onCommit.mockRejectedValue(new Error('未完成'));
  render(<GitChangesTree {...props} />);
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 src/one.ts' }));
  fireEvent.change(screen.getByRole('textbox', { name: '提交说明' }), {
    target: { value: '旧说明' },
  });
  fireEvent.click(screen.getByRole('button', { name: '提交所选文件 (1)' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '重试提交' })).toBeEnabled());
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 src/one.ts' }));
  fireEvent.change(screen.getByRole('textbox', { name: '提交说明' }), { target: { value: '' } });
  expect(screen.getByRole('textbox', { name: '提交说明' })).toHaveValue('');
  fireEvent.change(screen.getByRole('textbox', { name: '提交说明' }), {
    target: { value: '修改后的说明' },
  });
  expect(screen.getByRole('textbox', { name: '提交说明' })).toHaveValue('修改后的说明');
  const collapse = screen.getByRole('button', { name: '收起' });
  expect(collapse).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(collapse);
  expect(screen.queryByRole('textbox', { name: '提交说明' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '填写提交说明' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  expect(props.onCommit).toHaveBeenCalledTimes(1);
});

it.each(['error', 'loading'] as const)('缓存clean后%s不再把旧badge当成当前干净事实', (phase) => {
  const props = reviewProps();
  render(
    <GitChangesTree
      {...props}
      status={{
        ...props.status,
        data: { ...props.status.data!, clean: true, entries: [] },
        error: phase === 'error' ? new Error('读取失败') : null,
        isLoading: phase === 'loading',
      }}
    />,
  );
  expect(screen.queryByText('工作区干净')).not.toBeInTheDocument();
  expect(screen.getByText(phase === 'error' ? '状态未确认' : '状态读取中')).toBeVisible();
  if (phase === 'error') expect(screen.getByRole('alert')).toBeVisible();
});
