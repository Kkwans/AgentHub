import { expect, it } from 'vitest';
import { projectFileRequestPath } from './projectFilePath';
it.each([
  ['/repo/project', '/repo/project/src/a.ts', 'src/a.ts'],
  ['/repo/project/', '/repo/project/a.ts', 'a.ts'],
  ['/repo/project', 'src/a.ts', 'src/a.ts'],
  ['/repo/project', './src/a.ts', 'src/a.ts'],
  ['C:\\work\\project', 'C:\\work\\project\\src\\a.ts', 'src/a.ts'],
  ['C:/work/project', 'C:/work/project/src/a.ts', 'src/a.ts'],
  ['/', '/src/a.ts', 'src/a.ts'],
])('project-scoped path %s %s', (root, path, expected) => {
  expect(projectFileRequestPath(root, path)).toBe(expected);
});
it.each([
  ['/repo/project', '/repo/project-other/a.ts'],
  ['/repo/project', '/outside/a.ts'],
  ['/repo/project', '/repo/project/../a.ts'],
  ['/repo/project', '/repo/project/%2e%2e/a.ts'],
  ['/repo/project', '/repo/project/%252e%252e/a.ts'],
  ['/repo/project', '/repo/project/%2foutside'],
  ['/repo/project', '/repo/project/%5c..%5ca.ts'],
  ['/repo/project', '../a.ts'],
  ['/repo/project', '%252foutside'],
  ['/repo/project', '%5coutside'],
  ['/repo/project', 'a\0.ts'],
  ['/repo/project', '/repo/project'],
  ['/repo/project', '%bad'],
  ['/repo/project', '.'],
  ['/repo/project', './'],
  ['/repo//project', '/repo//project/a.ts'],
  ['/repo/./project', '/repo/./project/a.ts'],
  ['/repo/../project', '/repo/../project/a.ts'],
  ['C:\\work\\project', 'C:\\work\\project-other\\a.ts'],
  ['C:/work/project', 'D:/work/project/a.ts'],
  ['C:/work/project', 'C:/work/project/../a.ts'],
])('rejects out-of-scope/unsafe identity without basename fallback %s %s', (root, path) => {
  expect(() => projectFileRequestPath(root, path)).toThrow(
    expect.objectContaining({ code: 'PROJECT_FILE_PATH_INVALID' }),
  );
});
