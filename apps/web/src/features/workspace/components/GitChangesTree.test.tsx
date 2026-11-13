import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildGitChangeTree } from './GitChangesTree';
import { flattenGitChangeTree } from './git-change-tree';

describe('Git changes tree', () => {
  it('compact review flattens validated files without dropping full-path identity', () => {
    const files = flattenGitChangeTree(
      buildGitChangeTree([
        { index: ' ', worktree: 'M', path: 'src/deep/one.ts' },
        { index: ' ', worktree: 'M', path: 'src/other/one.ts' },
        { index: ' ', worktree: 'M', path: '../secret' },
      ]),
    );
    expect(files.map((file) => file.path)).toEqual(['src/deep/one.ts', 'src/other/one.ts']);
    expect(files.every((file) => file.kind === 'file')).toBe(true);
  });
  it('groups repository-relative entries into directories before files', () => {
    const tree = buildGitChangeTree([
      { index: ' ', worktree: 'M', path: 'src/zeta.ts' },
      { index: 'M', worktree: ' ', path: 'src/lib/alpha.ts' },
      { index: '?', worktree: '?', path: 'README.md' },
      { index: ' ', worktree: 'M', path: 'src/lib/beta.ts' },
    ]);

    expect(tree.map((node) => `${node.kind}:${node.path}`)).toEqual([
      'directory:src',
      'file:README.md',
    ]);
    const src = tree[0];
    if (src?.kind !== 'directory') throw new Error('src directory missing');
    expect(src.fileCount).toBe(3);
    expect(src.children.map((node) => `${node.kind}:${node.path}`)).toEqual([
      'directory:src/lib',
      'file:src/zeta.ts',
    ]);
  });

  it('does not turn absolute or traversal paths into displayed tree entries', () => {
    const tree = buildGitChangeTree([
      { index: ' ', worktree: 'M', path: '/etc/passwd' },
      { index: ' ', worktree: 'M', path: 'src/../secret.txt' },
      { index: ' ', worktree: 'M', path: 'C:/Users/secret.txt' },
      { index: ' ', worktree: 'M', path: 'safe/file.ts' },
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ kind: 'directory', path: 'safe' });
  });
});

it('bounds only the focused file index without clipping the whole Inspector or changing default list height', () => {
  const css = readFileSync(new URL('../inspector.module.css', import.meta.url), 'utf8');
  const rule = css.match(
    /:global\(\.workspace\) :global\(\[data-right-focused='true'\] \.git-change-list\)\s*\{([^}]+)\}/,
  )![1]!;
  expect(rule).toContain('max-height: min(240px, 24dvh)');
  expect(rule).toContain('min-height: 0');
  expect(rule).toContain('overflow-y: auto');
  expect(rule).toContain('align-content: start');
  expect(rule).not.toContain('overflow: hidden');
  const normal = css.match(/:global\(\.workspace\) :global\(\.change-list\)\s*\{([^}]+)\}/)![1]!;
  expect(normal).not.toMatch(/(?:max-)?height|overflow/);
});
