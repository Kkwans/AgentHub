import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runProcess } from '@agenthub/agent-core';
import { expect, it } from 'vitest';
import { GitService } from './git-service.js';

async function git(root: string, args: string[]) {
  const result = await runProcess({
    executable: '/usr/bin/git',
    args: ['--literal-pathspecs', '-C', root, ...args],
    timeoutMs: 10_000,
  });
  expect(result.exitCode, result.stderr).toBe(0);
  return result.stdout;
}
async function fixture(run: (root: string, service: GitService) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'agenthub-literal-paths-'));
  try {
    await git(root, ['init']);
    await git(root, ['config', 'user.name', 'AgentHub Test']);
    await git(root, ['config', 'user.email', 'test@example.invalid']);
    for (const name of ['*.txt', ':(glob)*.txt', 'other.txt'])
      await writeFile(join(root, name), 'before\n');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'baseline']);
    const project = { id: 'project', targetId: 'target', repoKind: 'GIT', realRootPath: root };
    const service = new GitService(
      { get: async () => project } as unknown as ConstructorParameters<typeof GitService>[0],
      {} as ConstructorParameters<typeof GitService>[1],
    );
    await run(root, service);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
it.each(['*.txt', ':(glob)*.txt'])(
  'SELECTED 只提交字面文件名 %s，不展开到其他文件',
  async (selected) => {
    await fixture(async (root, service) => {
      await writeFile(join(root, selected), 'selected change\n');
      await writeFile(join(root, 'other.txt'), 'unrelated change\n');
      await git(root, ['add', 'other.txt']);
      await service.commit('project', {
        message: 'literal selection',
        mode: 'SELECTED',
        paths: [selected],
      });
      expect(
        (await git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD']))
          .split('\0')
          .filter(Boolean),
      ).toEqual([selected]);
      expect(await git(root, ['show', 'HEAD:other.txt'])).toBe('before\n');
      expect(await git(root, ['diff', '--cached', '--name-only'])).toBe('other.txt\n');
      const diff = await service.diff('project', { path: selected });
      expect(diff.patch).not.toContain('unrelated change');
    });
  },
);
it.each([':(glob)**.txt', ':/*.txt'])(
  '不存在的 magic 路径 %s 不选择任何真实文件',
  async (selected) => {
    await fixture(async (root, service) => {
      await writeFile(join(root, 'other.txt'), 'unrelated change\n');
      const before = await git(root, ['rev-parse', 'HEAD']);
      await expect(
        service.commit('project', {
          message: 'must not commit',
          mode: 'SELECTED',
          paths: [selected],
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(await git(root, ['rev-parse', 'HEAD'])).toBe(before);
      expect(await git(root, ['diff', '--cached', '--name-only'])).toBe('');
    });
  },
);
