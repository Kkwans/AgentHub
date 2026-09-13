// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/api-error';
import type { FileEntry } from '../../../lib/api';
import type { QueryState } from '../workspace-types';
import { FileInspector } from './FileInspector';

afterEach(cleanup);

function queryState<T>(overrides: Partial<QueryState<T>> = {}): QueryState<T> {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('FileInspector pane states', () => {
  it('keeps loading and empty states inside pane-sized state containers', () => {
    render(
      <FileInspector
        selected={undefined}
        onSelect={vi.fn()}
        files={queryState<FileEntry[]>({ isLoading: true })}
        content={queryState<{ content: string; path: string }>()}
      />,
    );

    expect(document.querySelectorAll('.file-inspector-state')).toHaveLength(1);
    expect(document.querySelector('.file-inspector--tree-state')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '正在读取文件树' })).toBeInTheDocument();
    expect(screen.queryByText('选择文件')).not.toBeInTheDocument();
  });

  it('文件树错误时不与旧选中文件叠加第二张编辑器错误卡', () => {
    render(
      <FileInspector
        selected="outside.md"
        onSelect={vi.fn()}
        files={queryState<FileEntry[]>({
          error: new ApiError('FILE_NOT_FOUND', '文件或目录不存在。', 404),
        })}
        content={queryState<{ content: string; path: string }>({
          error: new ApiError('PATH_TRAVERSAL', '路径不能越过当前 Project 根目录。', 400),
        })}
      />,
    );

    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(document.querySelector('.file-inspector--tree-state')).toBeInTheDocument();
    expect(document.querySelector('.editor-frame')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('暂时无法加载');
    expect(screen.getByRole('alert')).toHaveTextContent('文件或目录不存在。');
    expect(screen.getByRole('alert')).not.toHaveTextContent('文件路径不在当前 Project 内');
  });

  it('keeps content errors scoped to the editor pane', () => {
    render(
      <FileInspector
        selected="outside.md"
        onSelect={vi.fn()}
        files={queryState<FileEntry[]>({ data: [] })}
        content={queryState<{ content: string; path: string }>({
          error: new ApiError('PATH_ABSOLUTE_FORBIDDEN', '路径不能越过当前 Project 根目录。', 400),
        })}
      />,
    );

    expect(document.querySelector('.file-tree .file-inspector-state')).not.toBeInTheDocument();
    expect(document.querySelector('.editor-frame .file-inspector-state')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('文件路径不在当前 Project 内');
    expect(screen.getByRole('alert')).toHaveTextContent('路径不能越过当前 Project 根目录。');
  });
});
