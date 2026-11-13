import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { runProcess } from '@agenthub/agent-core';
import {
  createPgliteDatabase,
  ExecutionTargetRepository,
  ProjectRepository,
  GitSnapshotRepository,
  GitCommitOperationRepository,
} from '@agenthub/db';
import { expect, it, vi } from 'vitest';
import { createManagedGitRuntime } from './managed-git-runtime.js';
import { GitService } from './git-service.js';
import { createGitRouter } from './git-routes.js';
const principal = { kind: 'local_trusted' as const, role: 'ADMIN' as const };
async function git(root: string, args: string[]) {
  const result = await runProcess({
    executable: '/usr/bin/git',
    args: ['-C', root, ...args],
    timeoutMs: 10000,
  });
  expect(result.exitCode, result.stderr).toBe(0);
  return result.stdout.trim();
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agenthub-managed-service-'));
  const database = await createPgliteDatabase({ dataDir: 'memory://' });
  await git(root, ['init']);
  await git(root, ['config', 'user.name', 'Test']);
  await git(root, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(root, 'one.txt'), 'initial');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'initial']);
  const targets = new ExecutionTargetRepository(database.db),
    projects = new ProjectRepository(database.db);
  const target = await targets.create({
    id: randomUUID(),
    name: 'test',
    kind: 'LOCAL_HOST',
    hostname: 'test',
    os: 'linux',
    arch: 'arm64',
    status: 'READY',
  });
  const project = await projects.create({
    id: randomUUID(),
    targetId: target.id,
    name: 'test',
    rootPath: root,
    realRootPath: root,
    repoKind: 'GIT',
    status: 'ACTIVE',
  });
  const build = async () =>
    new GitService(
      projects,
      new GitSnapshotRepository(database.db),
      targets,
      new GitCommitOperationRepository(database.db),
      await createManagedGitRuntime({ db: database.db, projects, targets }),
    );
  const input = {
    protocolVersion: 1 as const,
    operationId: randomUUID(),
    expectedHead: await git(root, ['rev-parse', 'HEAD']),
    message: 'managed',
    mode: 'SELECTED' as const,
    paths: ['one.txt'],
  };
  return {
    root,
    database,
    project,
    build,
    input,
    close: async () => {
      await database.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
it('真实提交完成后模拟客户端未使用回执，重建service重放不提交后来改动', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'one.txt'), 'first');
    const service = await f.build();
    const first = await service.commit(f.project.id, f.input, principal);
    await writeFile(join(f.root, 'one.txt'), 'later');
    const restarted = await f.build();
    await expect(restarted.commit(f.project.id, f.input, principal)).rejects.toMatchObject({
      code: 'GIT_WRITE_OUTCOME_UNKNOWN',
    });
    expect(await git(f.root, ['rev-parse', 'HEAD'])).toBe(first.sha);
    expect(await git(f.root, ['diff', '--', 'one.txt'])).toContain('+later');
    expect(
      await restarted.commitOperation(f.project.id, f.input.operationId, principal),
    ).toMatchObject({ phase: 'COMMAND_SUCCEEDED', scope: 'local-trusted' });
  } finally {
    await f.close();
  }
});
it('旧HEAD在暂存前拒绝，不改变索引；无认证/无持久key不派发', async () => {
  const f = await fixture();
  try {
    const service = await f.build();
    await writeFile(join(f.root, 'one.txt'), 'next');
    await expect(
      service.commit(f.project.id, { ...f.input, expectedHead: 'a'.repeat(40) }, principal),
    ).rejects.toMatchObject({ code: 'GIT_WRITE_PREWRITE_REJECTED' });
    expect(await git(f.root, ['diff', '--cached'])).toBe('');
    await expect(service.commit(f.project.id, f.input)).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    await expect(
      service.commit(f.project.id, { message: 'legacy', mode: 'STAGED' }, principal),
    ).rejects.toThrow();
  } finally {
    await f.close();
  }
});
it('HTTP旧无key/伪造owner请求均在service调用前拒绝', async () => {
  const commit = vi.fn();
  const app = express();
  app.use(express.json());
  app.use('/projects/:id/git', createGitRouter({ commit } as never));
  app.use(
    (
      _error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.sendStatus(400);
    },
  );
  for (const body of [
    { message: 'old', mode: 'STAGED' },
    {
      protocolVersion: 1,
      operationId: randomUUID(),
      expectedHead: null,
      message: 'new',
      mode: 'STAGED',
      ownerScope: 'forged',
    },
  ]) {
    expect(
      (await request(app).post(`/projects/${randomUUID()}/git/commit`).send(body)).status,
    ).toBe(400);
  }
  expect(commit).not.toHaveBeenCalled();
});
