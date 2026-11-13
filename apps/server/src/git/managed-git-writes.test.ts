import { randomUUID } from 'node:crypto';
import {
  createPgliteDatabase,
  ExecutionTargetRepository,
  ProjectRepository,
  GitCommitOperationRepository,
  gitWriteClaims,
} from '@agenthub/db';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { GitWriteCoordinator, GitWriteCoordinatorError } from './git-write-coordinator.js';
import {
  ManagedGitWrites,
  type ManagedGitWriteContext,
  type ManagedGitWriteKind,
} from './managed-git-writes.js';

let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
let projectId: string;
let aliasProjectId: string;
let targetId: string;
beforeAll(async () => {
  database = await createPgliteDatabase({ dataDir: 'memory://' });
  targetId = (
    await new ExecutionTargetRepository(database.db).create({
      id: randomUUID(),
      name: 'managed-write',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    })
  ).id;
  const projects = new ProjectRepository(database.db);
  const make = async (suffix: string) =>
    (
      await projects.create({
        id: randomUUID(),
        targetId,
        name: suffix,
        rootPath: `/tmp/${suffix}`,
        realRootPath: `/tmp/${suffix}`,
        repoKind: 'GIT',
        status: 'ACTIVE',
      })
    ).id;
  projectId = await make('managed-primary');
  aliasProjectId = await make('managed-alias');
});
afterAll(async () => database?.close());
function fixture(kind: ManagedGitWriteKind = 'COMMIT') {
  const repository = new GitCommitOperationRepository(database.db);
  const repositoryKey = randomUUID();
  const resolve = vi.fn(async (id: string) => ({
    projectId: id,
    targetId,
    executionDeviceId: 'host-test',
    repositoryKey,
    canonicalCommonDir: '/tmp/shared/.git',
    worktreeIdentity: '/tmp/shared',
    head: 'a'.repeat(40),
  }));
  const coordinator = new GitWriteCoordinator(repository, resolve);
  const writes = new ManagedGitWrites(coordinator);
  const input: ManagedGitWriteContext = {
    kind,
    ownerScope: 'account:original',
    operationId: randomUUID(),
    projectId,
    expectedHead: 'a'.repeat(40),
    payload: { paths: ['one.txt'], message: 'test' },
  };
  const get = () => repository.get(input.ownerScope, input.operationId, projectId);
  const claim = async () =>
    (await database.db.select().from(gitWriteClaims)).find(
      (row) => row.repositoryKey === repositoryKey,
    );
  return { repository, resolve, coordinator, writes, input, get, claim };
}
const kinds = ['COMMIT', 'WORKTREE_CREATE', 'WORKTREE_MERGE'] as const;
const unknownCode = (kind: ManagedGitWriteKind) =>
  kind === 'COMMIT' ? 'GIT_WRITE_OUTCOME_UNKNOWN' : 'WORKTREE_GIT_OUTCOME_UNKNOWN';
it.each(kinds)('%s 仅首次 durable success 返回临时值，成功重放不能再次执行', async (kind) => {
  const f = fixture(kind);
  const result = {
    worktreePath: '/tmp/example',
    secretResult: 'not-persisted',
    head: 'b'.repeat(40),
  };
  const write = vi.fn(async () => result);
  expect(await f.writes.run(f.input, write, (value) => value.head)).toBe(result);
  const saved = await f.get();
  expect(saved?.phase).toBe('COMMAND_SUCCEEDED');
  expect(saved?.observedAfterHead).toBe(result.head);
  expect(JSON.stringify(saved)).not.toContain('not-persisted');
  await expect(f.writes.run(f.input, write)).rejects.toMatchObject({ code: unknownCode(kind) });
  expect(write).toHaveBeenCalledTimes(1);
});
it.each(kinds)('%s 未知结果阻塞其他两种写入及不同 Project 别名', async (kind) => {
  const f = fixture(kind);
  const first = vi.fn(async () => {
    throw new Error('write response lost');
  });
  await expect(f.writes.run(f.input, first)).rejects.toMatchObject({ code: unknownCode(kind) });
  expect((await f.get())?.phase).toBe('UNKNOWN');
  const original = await f.get();
  const holderClaim = await f.claim();
  const retry = vi.fn(async () => 'unexpected');
  for (const nextKind of kinds) {
    const loser = {
      ...f.input,
      kind: nextKind,
      projectId: aliasProjectId,
      operationId: randomUUID(),
    };
    await expect(f.writes.run(loser, retry)).rejects.toMatchObject({
      code:
        nextKind === 'COMMIT' ? 'GIT_WRITE_PREWRITE_REJECTED' : 'WORKTREE_GIT_PREWRITE_REJECTED',
    });
    const saved = await f.repository.get(loser.ownerScope, loser.operationId, loser.projectId);
    expect(saved).toMatchObject({
      phase: 'REJECTED_PREWRITE',
      errorCode: 'GIT_REPOSITORY_CLAIMED',
      commandExit: null,
      dispatchedAt: null,
      settledAt: expect.any(Date),
    });
    expect(await f.get()).toEqual(original);
    expect(await f.claim()).toEqual(holderClaim);
  }
  expect(retry).not.toHaveBeenCalled();
  expect(first).toHaveBeenCalledTimes(1);
});
it('首次写入未完成时另一种操作同仓库没有执行权', async () => {
  const f = fixture();
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = f.writes.run(f.input, async () => {
    entered();
    await barrier;
    return 'first';
  });
  await ready;
  const other = vi.fn(async () => 'other');
  const loser = {
    ...f.input,
    kind: 'WORKTREE_MERGE' as const,
    projectId: aliasProjectId,
    operationId: randomUUID(),
  };
  const holder = await f.get();
  const holderClaim = await f.claim();
  expect(holder?.phase).toBe('DISPATCHED');
  try {
    await expect(f.writes.run(loser, other)).rejects.toMatchObject({
      code: 'WORKTREE_GIT_PREWRITE_REJECTED',
    });
    expect(
      await f.repository.get(loser.ownerScope, loser.operationId, loser.projectId),
    ).toMatchObject({
      phase: 'REJECTED_PREWRITE',
      errorCode: 'GIT_REPOSITORY_CLAIMED',
      commandExit: null,
      dispatchedAt: null,
      settledAt: expect.any(Date),
    });
    expect(await f.get()).toEqual(holder);
    expect(await f.claim()).toEqual(holderClaim);
    expect(other).not.toHaveBeenCalled();
  } finally {
    release();
    expect(await first).toBe('first');
  }
  expect((await f.get())?.phase).toBe('COMMAND_SUCCEEDED');
  expect(await f.claim()).toBeUndefined();
  // Releasing the holder never rearms the terminal losing operation.
  await expect(f.writes.run(loser, other)).rejects.toMatchObject({
    code: 'WORKTREE_GIT_PREWRITE_REJECTED',
  });
  expect(other).not.toHaveBeenCalled();
});
it('明确 HEAD 前置拒绝及其重放不是 UNKNOWN，仓库可由新请求获取', async () => {
  const f = fixture('WORKTREE_CREATE');
  const bad = { ...f.input, expectedHead: 'c'.repeat(40) };
  const write = vi.fn(async () => 'value');
  for (let i = 0; i < 2; i++)
    await expect(f.writes.run(bad, write)).rejects.toMatchObject({
      code: 'WORKTREE_GIT_PREWRITE_REJECTED',
    });
  expect((await f.get())?.phase).toBe('REJECTED_PREWRITE');
  expect(write).not.toHaveBeenCalled();
  expect(await f.writes.run({ ...f.input, operationId: randomUUID() }, write)).toBe('value');
});
it('callback 伪装前置错误不能把已派发操作释放为可重试', async () => {
  const f = fixture();
  await expect(
    f.writes.run(f.input, async () => {
      throw new GitWriteCoordinatorError('GIT_HEAD_CHANGED');
    }),
  ).rejects.toMatchObject({ code: 'GIT_WRITE_OUTCOME_UNKNOWN' });
  expect((await f.get())?.phase).toBe('UNKNOWN');
});
it('成功落库失败绝不返回临时结果，重放不执行', async () => {
  const f = fixture('WORKTREE_MERGE');
  vi.spyOn(f.repository, 'recordCommandSucceeded').mockRejectedValue(new Error('DB unavailable'));
  const write = vi.fn(async () => ({ value: 'not-confirmed' }));
  await expect(f.writes.run(f.input, write)).rejects.toMatchObject({
    code: 'WORKTREE_GIT_OUTCOME_UNKNOWN',
  });
  expect((await f.get())?.phase).toBe('DISPATCHED');
  await expect(f.writes.run(f.input, write)).rejects.toMatchObject({
    code: 'WORKTREE_GIT_OUTCOME_UNKNOWN',
  });
  expect(write).toHaveBeenCalledTimes(1);
});
it('DISPATCHED 响应丢失即使 callback 从未进入也按未知保守处理', async () => {
  const f = fixture();
  const original = f.repository.markDispatched.bind(f.repository);
  vi.spyOn(f.repository, 'markDispatched').mockImplementation(async (identity) => {
    await original(identity);
    throw new Error('response lost');
  });
  const write = vi.fn(async () => 'value');
  await expect(f.writes.run(f.input, write)).rejects.toMatchObject({
    code: 'GIT_WRITE_OUTCOME_UNKNOWN',
  });
  expect(write).not.toHaveBeenCalled();
  expect((await f.get())?.phase).toBe('DISPATCHED');
});
it('只向 callback 提供冻结请求，payload 不能覆盖操作种类', async () => {
  const f = fixture();
  f.input.payload.operationKind = 'WORKTREE_MERGE';
  const promise = f.writes.run(f.input, async (resource, payload) => {
    expect(resource.worktreeIdentity).toBe('/tmp/shared');
    expect(payload.operationKind).toBe('COMMIT');
    expect(payload.message).toBe('test');
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.paths)).toBe(true);
    return undefined;
  });
  f.input.payload.message = 'changed draft';
  expect(await promise).toBeUndefined();
  expect((await f.get())?.payloadJson.operationKind).toBe('COMMIT');
});
it('证据转换异常意味着写入可能已发生，不能返回原结果', async () => {
  const f = fixture('WORKTREE_CREATE');
  await expect(
    f.writes.run(
      f.input,
      async () => 'created',
      () => {
        throw new Error('read failed');
      },
    ),
  ).rejects.toMatchObject({ code: 'WORKTREE_GIT_OUTCOME_UNKNOWN' });
  expect((await f.get())?.phase).toBe('UNKNOWN');
});
