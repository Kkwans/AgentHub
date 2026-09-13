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

    expect(document.querySelectorAll('.file-inspector-state')).toHaveLength(2);
    expect(document.querySelector('.file-tree .ah-loading-state')).toBeInTheDocument();
    expect(screen.getByText('选择文件')).toBeInTheDocument();
  });

  it('keeps content errors scoped to the editor pane', () => {
    render(
      <FileInspector
        selected="outside.md"
        onSelect={vi.fn()}
        files={queryState<FileEntry[]>({ data: [] })}
        content={queryState<{ content: string; path: string }>({
          error: new ApiError(
            'FILE_PATH_OUTSIDE_PROJECT',
            '路径不能越过当前 Project 根目录。',
            400,
          ),
        })}
      />,
    );

    expect(document.querySelector('.file-tree .file-inspector-state')).not.toBeInTheDocument();
    expect(document.querySelector('.editor-frame .file-inspector-state')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('路径不能越过当前 Project 根目录。');
  });
});
