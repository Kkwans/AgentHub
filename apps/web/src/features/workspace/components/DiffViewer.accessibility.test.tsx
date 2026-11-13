// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { editor } from 'monaco-editor';
import { afterEach, expect, it, vi } from 'vitest';

const { captured } = vi.hoisted(() => ({ captured: vi.fn() }));
vi.mock('../../../lib/monaco', () => ({}));
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
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '切换为分栏 Diff' }));
  expect(captured).toHaveBeenLastCalledWith(
    expect.objectContaining({
      originalAriaLabel: '更改前：src/app.css',
      modifiedAriaLabel: '更改后：src/app.css',
      renderSideBySide: true,
    }),
  );
  view.rerender(<DiffViewer patch={patch} truncated={false} path="README.md" />);
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
