import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { runProcess } from '@agenthub/agent-core';
import { expect, it } from 'vitest';
import { WorktreeGitService } from './worktree-git-service.js';

async function git(root: string, args: string[]) {
  const result = await runProcess({
    executable: '/usr/bin/git',
    args: ['-C', root, ...args],
    timeoutMs: 10000,
    maxOutputBytes: 1024 * 1024,
  });
  if (result.exitCode !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), 'agenthub-worktree-unknown-'));
  const root = join(temp, 'repo');
  await mkdir(root);
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Test']);
  await git(root, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(root, 'file.txt'), 'initial\n');
  await git(root, ['add', 'file.txt']);
  await git(root, ['commit', '-m', 'initial']);
  const projectId = randomUUID(),
    executionId = randomUUID();
  const service = new WorktreeGitService(join(temp, 'managed'));
  const input = {
    projectRoot: root,
    projectId,
    executionId,
    taskBranch: service.taskBranch(randomUUID(), executionId),
    baseSha: await git(root, ['rev-parse', 'HEAD']),
  };
  return { temp, root, service, input };
}
it('worktree add hook失败后目录/分支可能已创建，不能称前置拒绝', async () => {
  const f = await fixture();
  try {
    const hook = join(f.root, '.git/hooks/post-checkout');
    await writeFile(hook, '#!/bin/sh\nexit 1\n');
    await chmod(hook, 0o755);
    await expect(f.service.create(f.input)).rejects.toMatchObject({
      code: 'WORKTREE_GIT_OUTCOME_UNKNOWN',
    });
    const path = join(f.temp, 'managed', f.input.projectId, f.input.executionId);
    expect(await readFile(join(path, 'file.txt'), 'utf8')).toBe('initial\n');
    expect(await git(f.root, ['rev-parse', f.input.taskBranch])).toBe(f.input.baseSha);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});
it('merge前commit hook失败已改index，错误保留未知分类而非安全重试', async () => {
  const f = await fixture();
  try {
    const path = await f.service.create(f.input);
    await writeFile(join(path, 'file.txt'), 'changed\n');
    const hook = join(f.root, '.git/hooks/pre-commit');
    await writeFile(hook, '#!/bin/sh\nprintf marker > hook-marker\nexit 1\n');
    await chmod(hook, 0o755);
    await expect(
      f.service.commitAndMerge({
        projectRoot: f.root,
        worktreePath: path,
        baseBranch: 'main',
        baseSha: f.input.baseSha,
        taskBranch: f.input.taskBranch,
        commitMessage: 'test',
      }),
    ).rejects.toMatchObject({ code: 'WORKTREE_GIT_OUTCOME_UNKNOWN' });
    expect(await git(path, ['diff', '--cached', '--name-only'])).toBe('file.txt');
    expect(await readFile(join(path, 'hook-marker'), 'utf8')).toBe('marker');
    expect(await git(f.root, ['rev-parse', 'HEAD'])).toBe(f.input.baseSha);
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});
