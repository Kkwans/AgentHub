// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { editor } from 'monaco-editor';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { captured, prepare } = vi.hoisted(() => ({ captured: vi.fn(), prepare: vi.fn() }));
vi.mock('../../../lib/monaco', () => ({ prepareDiffLanguage: prepare }));
beforeEach(() => {
  prepare.mockReset().mockResolvedValue(undefined);
});
vi.mock('../../../components/SafeDiffEditor', () => ({
  SafeDiffEditor: (props: { options: editor.IDiffEditorConstructionOptions }) => {
    captured(props.options);
    return <div>已渲染差异编辑器</div>;
  },
}));
import { DiffViewer } from './DiffViewer';

afterEach(() => {
  cleanup();
  captured.mockClear();
});
const patch = '@@ -1 +1 @@\n-old\n+new';
it('names both real Monaco editors and keeps their identities across split and file changes', async () => {
  const view = render(<DiffViewer patch={patch} truncated={false} path="src/app.css" />);
  await screen.findByText('已渲染差异编辑器');
  expect(captured).toHaveBeenLastCalledWith(
    expect.objectContaining({
      readOnly: true,
      ariaLabel: '文件差异预览',
      originalAriaLabel: '更改前：src/app.css',
      modifiedAriaLabel: '更改后：src/app.css',
      renderSideBySide: false,
      useInlineViewWhenSpaceIsLimited: false,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '切换为分栏 Diff' }));
  expect(captured).toHaveBeenLastCalledWith(
    expect.objectContaining({
      originalAriaLabel: '更改前：src/app.css',
      modifiedAriaLabel: '更改后：src/app.css',
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '切换为统一 Diff' }));
  expect(captured).toHaveBeenLastCalledWith(
    expect.objectContaining({ renderSideBySide: false, useInlineViewWhenSpaceIsLimited: false }),
  );
  view.rerender(<DiffViewer patch={patch} truncated={false} path="README.md" />);
  await screen.findByText('已渲染差异编辑器');
  expect(captured).toHaveBeenLastCalledWith(
    expect.objectContaining({
      originalAriaLabel: '更改前：README.md',
      modifiedAriaLabel: '更改后：README.md',
    }),
  );
});
it('supplies meaningful names even when a path is unavailable', async () => {
  render(<DiffViewer patch={patch} truncated={false} />);
  await screen.findByText('已渲染差异编辑器');
  expect(captured).toHaveBeenLastCalledWith(
    expect.objectContaining({
      originalAriaLabel: '更改前：文件',
      modifiedAriaLabel: '更改后：文件',
    }),
  );
});

it('waits for the original grammar before mounting and ignores stale language completion', async () => {
  let finishCss!: () => void;
  let finishTs!: () => void;
  prepare.mockImplementation(
    (language: string) =>
      new Promise<void>((resolve) => {
        if (language === 'css') finishCss = resolve;
        else finishTs = resolve;
      }),
  );
  const view = render(<DiffViewer patch={patch} truncated={false} path="a.css" />);
  await waitFor(() => expect(prepare).toHaveBeenCalledWith('css'));
  expect(captured).not.toHaveBeenCalled();
  view.rerender(<DiffViewer patch={patch} truncated={false} path="a.tsx" />);
  await waitFor(() => expect(prepare).toHaveBeenCalledWith('typescript'));
  await act(async () => finishCss());
  expect(captured).not.toHaveBeenCalled();
  await act(async () => finishTs());
  await screen.findByText('已渲染差异编辑器');
  expect(captured).toHaveBeenCalled();
});

it('reports grammar failure instead of mounting an un-tokenized diff', async () => {
  prepare.mockRejectedValue(new Error('load failed'));
  render(<DiffViewer patch={patch} truncated={false} path="a.tsx" />);
  await screen.findByText('Diff 语法加载失败，请刷新后重试');
  expect(captured).not.toHaveBeenCalled();
});

it('clears an earlier grammar failure after switching away and successfully returning', async () => {
  prepare.mockRejectedValueOnce(new Error('temporary failure'));
  const view = render(<DiffViewer patch={patch} truncated={false} path="a.tsx" />);
  await screen.findByText('Diff 语法加载失败，请刷新后重试');
  view.rerender(<DiffViewer patch={patch} truncated={false} path="a.css" />);
  await screen.findByText('已渲染差异编辑器');
  view.rerender(<DiffViewer patch={patch} truncated={false} path="b.tsx" />);
  await screen.findByText('已渲染差异编辑器');
  expect(screen.queryByText('Diff 语法加载失败，请刷新后重试')).toBeNull();
});

it('keeps embedded staged/whitespace controls and explicit split choice across a file update', async () => {
  const { GitChangesTree } = await import('./GitChangesTree');
  const query = <T,>(data: T) => ({ data, error: null, isLoading: false, refetch: vi.fn() });
  const staged = vi.fn(),
    whitespace = vi.fn();
  const treeProps = {
    status: query({
      clean: false,
      branch: 'main',
      entries: [{ index: ' ', worktree: 'M', path: 'one.ts' }],
    }),
    diff: query({ patch, truncated: false, staged: false }),
    commits: query([]),
    branches: query([]),
    onCommit: vi.fn(),
    stagedDiff: false,
    onStagedDiffChange: staged,
    selectedPath: 'one.ts',
    onSelectPath: vi.fn(),
    whitespace: 'default' as const,
    onWhitespaceChange: whitespace,
  };
  const view = render(<GitChangesTree {...treeProps} />);
  await screen.findByText('已渲染差异编辑器');
  const group = screen.getByRole('group', { name: '文件 Diff 显示选项' });
  const stagedControl = screen.getByRole('checkbox', { name: 'staged' });
  expect(group.contains(stagedControl)).toBe(true);
  expect(group.contains(screen.getByRole('combobox', { name: 'Diff 空白处理' }))).toBe(true);
  fireEvent.click(stagedControl);
  expect(staged).toHaveBeenCalledWith(true);
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Diff 空白处理' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: '忽略全部' }));
  expect(whitespace).toHaveBeenCalledWith('ignore-all-space');
  fireEvent.click(screen.getByRole('button', { name: '切换为分栏 Diff' }));
  view.rerender(
    <GitChangesTree
      {...treeProps}
      selectedPath="two.ts"
      stagedDiff
      whitespace="ignore-all-space"
    />,
  );
  await waitFor(() =>
    expect(captured).toHaveBeenLastCalledWith(
      expect.objectContaining({
        renderSideBySide: true,
        modifiedAriaLabel: '更改后：two.ts',
        useInlineViewWhenSpaceIsLimited: false,
      }),
    ),
  );
  expect((screen.getByRole('checkbox', { name: 'staged' }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole('combobox', { name: 'Diff 空白处理' }).textContent).toContain('忽略全部');
  expect(screen.getAllByLabelText('two.ts', { selector: 'code' })).toHaveLength(1);
});

it.each(['empty', 'binary', 'loading', 'error'] as const)(
  'keeps scope controls available in %s feedback',
  async (state) => {
    if (state === 'loading') prepare.mockReturnValue(new Promise(() => {}));
    if (state === 'error') prepare.mockRejectedValue(new Error('grammar unavailable'));
    const content =
      state === 'empty' ? '' : state === 'binary' ? 'Binary files a/a and b/a differ' : patch;
    render(
      <DiffViewer
        patch={content}
        truncated={false}
        path="a.ts"
        toolbarControls={<button>保留的范围控制</button>}
      />,
    );
    await screen.findByRole('button', { name: '保留的范围控制' });
    if (state === 'error') await screen.findByText('Diff 语法加载失败，请刷新后重试');
    expect(screen.getAllByRole('button', { name: '保留的范围控制' })).toHaveLength(1);
    const control = screen.getByRole('button', { name: '保留的范围控制' });
    const body = control.closest('.git-diff-editor');
    expect(body).not.toBeNull();
    expect(body?.children.length).toBe(2);
  },
);

it.each(['loading', 'error'] as const)(
  'keeps parent %s feedback inside the second grid row',
  async (state) => {
    const { GitChangesTree } = await import('./GitChangesTree');
    const query = <T,>(data: T) => ({ data, error: null, isLoading: false, refetch: vi.fn() });
    const view = render(
      <GitChangesTree
        status={query({
          clean: false,
          branch: 'main',
          entries: [{ index: ' ', worktree: 'M', path: 'one.ts' }],
        })}
        diff={{
          ...query({ patch, truncated: false, staged: false }),
          isLoading: state === 'loading',
          error: state === 'error' ? new Error('读取失败') : null,
        }}
        commits={query([])}
        branches={query([])}
        onCommit={vi.fn()}
        stagedDiff={false}
        onStagedDiffChange={vi.fn()}
        selectedPath="one.ts"
        onSelectPath={vi.fn()}
        whitespace="default"
        onWhitespaceChange={vi.fn()}
      />,
    );
    const review = view.container.querySelector('.git-selected-diff')!;
    expect(review.children.length).toBe(2);
    expect(review.children[1]?.classList.contains('git-diff-editor')).toBe(true);
    expect(review.children[1]?.children.length).toBe(2);
    expect(review.contains(screen.getByRole('checkbox', { name: 'staged' }))).toBe(true);
  },
);
