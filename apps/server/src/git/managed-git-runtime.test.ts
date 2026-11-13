import { randomUUID } from 'node:crypto';
import {
  createPgliteDatabase,
  ExecutionTargetRepository,
  ProjectRepository,
  GitCommitOperationRepository,
} from '@agenthub/db';
import { expect, it, vi } from 'vitest';
import { createManagedGitRuntime } from './managed-git-runtime.js';
import type { ManagedGitWriteContext, ManagedGitWriteKind } from './managed-git-writes.js';

async function fixture() {
  const database = await createPgliteDatabase({ dataDir: 'memory://' });
  const targets = new ExecutionTargetRepository(database.db);
  const projects = new ProjectRepository(database.db);
  const projectIds: string[] = [];
  for (let index = 0; index < 2; index++) {
    const target = await targets.create({
      id: randomUUID(),
      name: `target-${index}`,
      kind: 'LOCAL_HOST',
      hostname: `alias-${index}`,
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    projectIds.push(
      (
        await projects.create({
          id: randomUUID(),
          targetId: target.id,
          name: `project-${index}`,
          rootPath: `/mount-${index}/repo`,
          realRootPath: `/mount-${index}/repo`,
          repoKind: 'GIT',
          status: 'ACTIVE',
        })
      ).id,
    );
  }
  const dependencies = {
    createResourceResolver: () => async (projectId: string) => {
      const project = (await projects.get(projectId))!;
      return {
        projectId,
        targetId: project.targetId,
        executionDeviceId: `untrusted-probe:${projectId}`,
        repositoryKey: `path-key:${projectId}`,
        canonicalCommonDir: `${project.realRootPath}/.git`,
        worktreeIdentity: project.realRootPath,
        head: 'a'.repeat(40),
      };
    },
  };
  const input = { db: database.db, projects, targets };
  const build = () => createManagedGitRuntime(input, dependencies);
  const context = (kind: ManagedGitWriteKind, index = 0): ManagedGitWriteContext => ({
    kind,
    ownerScope: 'account:original',
    operationId: randomUUID(),
    projectId: projectIds[index]!,
    expectedHead: 'a'.repeat(40),
    payload: { message: 'test', paths: ['one.txt'] },
  });
  return { database, input, build, context, projects, targets, projectIds };
}
const kinds = ['COMMIT', 'WORKTREE_CREATE', 'WORKTREE_MERGE'] as const;
it.each(kinds)(
  '%s 未知写入跨 factory 重建、两实例、target 和 mount aliases 阻塞所有种类',
  async (kind) => {
    const f = await fixture();
    try {
      const [first, concurrent] = await Promise.all([f.build(), f.build()]);
      expect(first.domain).toEqual(concurrent.domain);
      const original = f.context(kind);
      await expect(
        first.writes.run(original, async () => {
          throw new Error('Git response lost');
        }),
      ).rejects.toMatchObject({
        code: kind === 'COMMIT' ? 'GIT_WRITE_OUTCOME_UNKNOWN' : 'WORKTREE_GIT_OUTCOME_UNKNOWN',
      });
      const restarted = await f.build();
      expect(restarted.domain).toEqual(first.domain);
      const a = await first.resolve(f.projectIds[0]!);
      const b = await restarted.resolve(f.projectIds[1]!);
      expect(a.canonicalCommonDir).not.toBe(b.canonicalCommonDir);
      expect(a.targetId).not.toBe(b.targetId);
      expect(a.repositoryKey).toBe(b.repositoryKey);
      expect(a.executionDeviceId).toBe(first.domain.executionDeviceId);
      const write = vi.fn(async () => 'should not run');
      for (const runtime of [concurrent, restarted])
        for (const nextKind of kinds) {
          await expect(runtime.writes.run(f.context(nextKind, 1), write)).rejects.toMatchObject({
            code:
              nextKind === 'COMMIT' ? 'GIT_WRITE_OUTCOME_UNKNOWN' : 'WORKTREE_GIT_OUTCOME_UNKNOWN',
          });
        }
      await expect(restarted.writes.run(original, write)).rejects.toBeInstanceOf(Error);
      expect(write).not.toHaveBeenCalled();
      expect(
        (
          await new GitCommitOperationRepository(f.database.db).get(
            original.ownerScope,
            original.operationId,
            original.projectId,
          )
        )?.phase,
      ).toBe('UNKNOWN');
    } finally {
      await f.database.close();
    }
  },
);
it('legacy owner 缺失不猜测归属，写 callback 零调用', async () => {
  const f = await fixture();
  try {
    const runtime = await f.build();
    const write = vi.fn(async () => 'should not run');
    for (const ownerScope of ['', null, undefined]) {
      await expect(
        runtime.writes.run(
          { ...f.context('WORKTREE_CREATE'), ownerScope: ownerScope as unknown as string },
          write,
        ),
      ).rejects.toMatchObject({ code: 'WORKTREE_GIT_PREWRITE_REJECTED' });
    }
    expect(write).not.toHaveBeenCalled();
  } finally {
    await f.database.close();
  }
});
it.each(['REMOTE_NODE', 'DOCKER_CONTAINER'])(
  '生产 resolver 拒绝 %s，不执行 Git callback',
  async (kind) => {
    const f = await fixture();
    try {
      const project = (await f.projects.get(f.projectIds[0]!))!;
      const runtime = await createManagedGitRuntime({
        ...f.input,
        targets: { get: async () => ({ id: project.targetId, kind }) },
      });
      const write = vi.fn(async () => 'should not run');
      await expect(runtime.resolve(project.id)).rejects.toMatchObject({
        code: 'GIT_LOCAL_TARGET_REQUIRED',
      });
      await expect(runtime.writes.run(f.context('COMMIT'), write)).rejects.toMatchObject({
        code: 'GIT_WRITE_OUTCOME_UNKNOWN',
      });
      expect(write).not.toHaveBeenCalled();
    } finally {
      await f.database.close();
    }
  },
);
