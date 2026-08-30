import { describe, expect, it } from 'vitest';

import { buildGitChangeTree } from './GitChangesTree';

describe('Git changes tree', () => {
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
