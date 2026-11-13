// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
      onSelectPath={onSelectPath}
      whitespace="default"
      onWhitespaceChange={vi.fn()}
    />,
  );
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
