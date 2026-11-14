// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/api-error';
import type { FileEntry } from '../../../lib/api';
import type { QueryState } from '../workspace-types';
import { FileInspector } from './FileInspector';

// These tests cover loading/error layout only; real editor boot is covered by
// the browser content matrix. Do not leave Monaco's asynchronous module graph
// loading after jsdom teardown.
vi.mock('../../../lib/monaco', () => ({ prepareDiffLanguage: async () => undefined }));

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

it('loads only an opened directory, deduplicates pending requests, and retains loaded children', async () => {
  let resolve!: (entries: FileEntry[]) => void;
  const load = vi.fn(
    () =>
      new Promise<FileEntry[]>((done) => {
        resolve = done;
      }),
  );
  const select = vi.fn();
  render(
    <FileInspector
      selected={undefined}
      onSelect={select}
      files={queryState({ data: [{ name: 'src', path: 'src', type: 'DIRECTORY' }] })}
      content={queryState()}
      loadDirectory={load}
    />,
  );
  expect(load).not.toHaveBeenCalled();
  const directory = screen.getByRole('button', { name: 'src' });
  fireEvent.click(directory);
  expect(screen.getByRole('status', { name: '正在读取目录 src' })).toBeVisible();
  fireEvent.click(directory);
  fireEvent.click(directory);
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () =>
    resolve([
      { name: 'deep', path: 'src/deep', type: 'DIRECTORY' },
      { name: 'a.ts', path: 'src/a.ts', type: 'FILE' },
    ]),
  );
  expect(load).toHaveBeenCalledWith('src');
  expect(screen.getByRole('button', { name: 'deep' })).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'a.ts' }));
  expect(select).toHaveBeenCalledWith('src/a.ts');
  fireEvent.click(directory);
  fireEvent.click(directory);
  expect(load).toHaveBeenCalledTimes(1);
});

it('separates directory errors from empty results and retries in place', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('目录读取失败')).mockResolvedValue([]);
  render(
    <FileInspector
      selected={undefined}
      onSelect={vi.fn()}
      files={queryState({ data: [{ name: 'src', path: 'src', type: 'DIRECTORY' }] })}
      content={queryState()}
      loadDirectory={load}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'src' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('目录读取失败');
  expect(screen.queryByText('空目录')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试读取目录 src' }));
  expect(await screen.findByText('空目录')).toBeVisible();
  expect(load).toHaveBeenCalledTimes(2);
});

it('does not recurse into symlinks or blocked directories', () => {
  const load = vi.fn();
  const select = vi.fn();
  render(
    <FileInspector
      selected={undefined}
      onSelect={select}
      files={queryState({
        data: [
          { name: 'link', path: 'link', type: 'SYMLINK' },
          { name: 'blocked', path: 'blocked', type: 'DIRECTORY', blocked: true },
        ],
      })}
      content={queryState()}
      loadDirectory={load}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'link' }));
  expect(select).toHaveBeenCalledWith('link');
  expect(screen.getByRole('button', { name: 'blocked已阻止' })).toBeDisabled();
  expect(load).not.toHaveBeenCalled();
});

it('cannot insert a previous project response after its keyed tree is replaced', async () => {
  let finish!: (entries: FileEntry[]) => void;
  const oldLoad = vi.fn(
    () =>
      new Promise<FileEntry[]>((resolve) => {
        finish = resolve;
      }),
  );
  const props = {
    selected: undefined,
    onSelect: vi.fn(),
    files: queryState<FileEntry[]>({ data: [{ name: 'src', path: 'src', type: 'DIRECTORY' }] }),
    content: queryState<{ content: string; path: string }>(),
  };
  const view = render(<FileInspector key="project-a" {...props} loadDirectory={oldLoad} />);
  fireEvent.click(screen.getByRole('button', { name: 'src' }));
  view.rerender(
    <FileInspector key="project-b" {...props} loadDirectory={vi.fn().mockResolvedValue([])} />,
  );
  await act(async () =>
    finish([{ name: 'private-old.txt', path: 'src/private-old.txt', type: 'FILE' }]),
  );
  expect(screen.queryByRole('button', { name: 'private-old.txt' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'src' })).toHaveAttribute('aria-expanded', 'false');
});

it('keeps basename and exact keyboard-disclosed identity through loading/error and returns to the expanded tree', () => {
  const path = 'parent/中文 # &/report.ts';
  const props = {
    onSelect: vi.fn(),
    files: queryState<FileEntry[]>({
      data: [
        {
          name: 'parent',
          path: 'parent',
          type: 'DIRECTORY',
          children: [{ name: 'report.ts', path, type: 'FILE' }],
        },
      ],
    }),
    content: queryState<{ content: string; path: string }>({ isLoading: true }),
  };
  const view = render(<FileInspector {...props} selected={undefined} />);
  fireEvent.click(screen.getByRole('button', { name: 'report.ts' }));
  view.rerender(<FileInspector {...props} selected={path} />);
  const heading = screen.getByRole('heading', { name: 'report.ts' });
  expect(heading).toHaveFocus();
  expect(heading).toHaveAttribute('title', path);
  const disclosure = screen.getByRole('button', { name: '完整路径' });
  expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(disclosure);
  expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  expect(
    document.getElementById(disclosure.getAttribute('aria-controls')!)?.querySelector('code'),
  ).toHaveTextContent(path);
  fireEvent.click(screen.getByRole('button', { name: '目录' }));
  expect(screen.getByRole('button', { name: 'report.ts' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'parent' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: '阅读文件' }));
  expect(heading).toHaveFocus();
  view.rerender(
    <FileInspector
      {...props}
      selected="other/report.ts"
      content={queryState({ error: new Error('读取失败') })}
    />,
  );
  expect(screen.getByRole('heading', { name: 'report.ts' })).toHaveAttribute(
    'title',
    'other/report.ts',
  );
  expect(screen.getByRole('button', { name: '完整路径' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

it('keeps one explicit heading focus outline without the shared tabindex shadow', () => {
  const css = readFileSync(new NodeURL('../inspector.module.css', import.meta.url), 'utf8');
  const headingOnly = css.match(
    /:global\(\.workspace\) :global\(\.file-preview-header h3:focus\)\s*\{([^}]+)\}/,
  )?.[1];
  expect(headingOnly).toMatch(/box-shadow:\s*none/);
  const headingOutline = css.match(
    /:global\(\.file-preview-header h3:focus\),[^{}]+\{([^}]+)\}/,
  )?.[1];
  expect(headingOutline).toMatch(/outline:\s*2px solid var\(--ah-accent-primary\)/);
  expect(headingOutline).toMatch(/outline-offset:\s*-2px/);
});
