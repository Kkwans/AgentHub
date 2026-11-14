import { expect, it } from 'vitest';
import { toolSummaryFilePath } from './ToolUseEntry';

it('uses exact read/edit summary field priority without mutating raw data or guessing from other summaries', () => {
  const input = Object.freeze({
    target_file: '/a/one.ts',
    file_path: '/b/two.ts',
    path: '/c/three.ts',
  });
  expect(toolSummaryFilePath('read', input)).toBe('/a/one.ts');
  expect(toolSummaryFilePath('edit', input)).toBe('/b/two.ts');
  expect(toolSummaryFilePath('terminal', { command: 'cat /tmp/one.ts', ...input })).toBeNull();
  expect(toolSummaryFilePath('search', { query: 'a/b', ...input })).toBeNull();
  expect(toolSummaryFilePath('read', { target_directory: '/tmp/code' })).toBeNull();
  expect(toolSummaryFilePath('read', { glob_pattern: 'src/**/*.ts' })).toBeNull();
  expect(toolSummaryFilePath('read', { description: '/tmp/file.ts' })).toBeNull();
  expect(toolSummaryFilePath('read', { target_file: 42, file_path: '/b/two.ts' })).toBeNull();
  expect(input.file_path).toBe('/b/two.ts');
});
it.each(['/', 'C:\\', '/dir/', 'dir\\', '', '.', '..'])(
  'does not invent a filename from %s',
  (path) => {
    expect(toolSummaryFilePath('read', { file_path: path })).toBeNull();
  },
);
it.each(['C:\\project\\my file.ts', '/project/  file name.ts ', 'relative.ts'])(
  'preserves actual filename characters: %s',
  (path) => {
    expect(toolSummaryFilePath('edit', { file_path: path })).toBe(path);
  },
);
