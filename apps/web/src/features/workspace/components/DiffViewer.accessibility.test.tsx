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
