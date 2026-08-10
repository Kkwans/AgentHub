import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runProcess } from '@agenthub/agent-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WorktreeGitService } from './worktree-git-service.js';

describe('Worktree Git 安全边界与 merge gate', () => {
  let fixtureRoot: string;
  let projectRoot: string;
  let managedRoot: string;
  let service: WorktreeGitService;
  const projectId = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'agenthub-worktree-'));
    projectRoot = join(fixtureRoot, 'project');
    managedRoot = join(fixtureRoot, 'managed');
    await mkdir(projectRoot);
    await git(projectRoot, ['init', '-b', 'main']);
    await git(projectRoot, ['config', 'user.name', 'AgentHub Test']);
    await git(projectRoot, ['config', 'user.email', 'agenthub@example.invalid']);
    await writeFile(join(projectRoot, 'tracked.txt'), '初始\n');
    await git(projectRoot, ['add', '--', 'tracked.txt']);
    await git(projectRoot, ['commit', '-m', '初始提交']);
    service = new WorktreeGitService(managedRoot);
  });

  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('创建隔离 worktree 并提供真实 Review 数据', async () => {
    const executionId = '22222222-2222-4222-8222-222222222222';
    const base = await service.inspectBase(projectRoot);
    const taskBranch = service.taskBranch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', executionId);
    const worktreePath = await service.create({
      projectRoot,
      projectId,
      executionId,
      taskBranch,
      baseSha: base.sha,
    });
    await writeFile(join(worktreePath, 'tracked.txt'), '已修改\n');
    await writeFile(join(worktreePath, 'new.txt'), '新文件\n');

    const review = await service.review({
      projectRoot,
      worktreePath,
      baseSha: base.sha,
      taskBranch,
    });
    expect(review.clean).toBe(false);
    expect(review.patch).toContain('+已修改');
    expect(review.patch).toContain('+新文件');
    expect(review.entries.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['tracked.txt', 'new.txt']),
    );
  });

  it('显式批准后创建受管提交并执行 no-ff merge，保留 worktree', async () => {
    const executionId = '22222222-2222-4222-8222-222222222222';
    const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const base = await service.inspectBase(projectRoot);
    const taskBranch = service.taskBranch(taskId, executionId);
    const worktreePath = join(managedRoot, projectId, executionId);
    const result = await service.commitAndMerge({
      projectRoot,
      worktreePath,
      baseBranch: base.branch,
      baseSha: base.sha,
      taskBranch,
      commitMessage: 'feat(task): 保存隔离修改',
    });

    expect(result.merged).toBe(true);
    expect(result.managedCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(await readFile(join(projectRoot, 'tracked.txt'), 'utf8')).toBe('已修改\n');
    expect(await readFile(join(worktreePath, 'new.txt'), 'utf8')).toBe('新文件\n');
    expect(
      (await git(projectRoot, ['show', '-s', '--format=%P', 'HEAD'])).stdout.trim().split(' '),
    ).toHaveLength(2);
  });

  it('主工作区 dirty 时在提交和 merge 前拒绝变更', async () => {
    const executionId = '33333333-3333-4333-8333-333333333333';
    const taskId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const base = await service.inspectBase(projectRoot);
    const taskBranch = service.taskBranch(taskId, executionId);
    const worktreePath = await service.create({
      projectRoot,
      projectId,
      executionId,
      taskBranch,
      baseSha: base.sha,
    });
    await writeFile(join(worktreePath, 'second.txt'), '任务变更\n');
    await writeFile(join(projectRoot, 'dirty.txt'), '主工作区变更\n');

    await expect(
      service.commitAndMerge({
        projectRoot,
        worktreePath,
        baseBranch: base.branch,
        baseSha: base.sha,
        taskBranch,
        commitMessage: 'feat(task): 不应提交',
      }),
    ).rejects.toMatchObject({ code: 'PRIMARY_WORKTREE_DIRTY' });
    const branchCount = await git(worktreePath, ['rev-list', '--count', `${base.sha}..HEAD`]);
    expect(branchCount.stdout.trim()).toBe('0');
  });

  it('拒绝 symlink escape 与非法 branch', async () => {
    const outside = join(fixtureRoot, 'outside');
    await mkdir(outside);
    const escaped = join(managedRoot, 'escaped');
    await symlink(outside, escaped);
    await expect(
      service.review({
        projectRoot,
        worktreePath: escaped,
        baseSha: 'a'.repeat(40),
        taskBranch: 'agenthub/valid',
      }),
    ).rejects.toMatchObject({ code: 'WORKTREE_PATH_ESCAPE' });
    await expect(service.inspectBase(projectRoot, '../invalid')).rejects.toMatchObject({
      code: 'GIT_BRANCH_INVALID',
    });
  });
});

async function git(cwd: string, args: string[]) {
  const result = await runProcess({
    executable: '/usr/bin/git',
    args: ['-C', cwd, ...args],
    timeoutMs: 10_000,
    maxOutputBytes: 1024 * 1024,
  });
  if (result.exitCode !== 0) throw new Error(`Git fixture 失败：${result.stderr}`);
  return result;
}
