import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPgliteDatabase } from './client.js';
import { ExecutionTargetRepository, ProjectRepository } from './repositories.js';
import { gitCommitOperations, gitWriteClaims } from './schema.js';
import {
  GitCommitOperationRepository,
  type ReserveGitCommitInput,
} from './git-commit-operation-repository.js';

let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
let projectId: string;
let otherProjectId: string;
let targetId: string;
beforeAll(async () => {
  database = await createPgliteDatabase({ dataDir: 'memory://' });
  const target = await new ExecutionTargetRepository(database.db).create({
    id: randomUUID(),
    name: 'Git账本隔离测试',
    kind: 'LOCAL_HOST',
    hostname: 'test',
    os: 'linux',
    arch: 'arm64',
    status: 'READY',
  });
  targetId = target.id;
  const projects = new ProjectRepository(database.db);
  const makeProject = async (suffix: string) =>
    (
      await projects.create({
        id: randomUUID(),
        targetId,
        name: `账本${suffix}`,
        rootPath: `/tmp/ledger-${suffix}`,
        realRootPath: `/tmp/ledger-${suffix}`,
        repoKind: 'GIT',
        status: 'ACTIVE',
      })
    ).id;
  projectId = await makeProject('a');
  otherProjectId = await makeProject('b');
});
afterAll(async () => database?.close());

type ReserveInput = ReserveGitCommitInput;
function fixture(overrides: Partial<ReserveInput> = {}) {
  const repositoryKey = `device-test:${randomUUID()}`;
  const input: ReserveInput = {
    ownerScope: 'account:original',
    operationId: randomUUID(),
    projectId,
    protocolVersion: 1,
    requestHash: 'a'.repeat(64),
    payloadJson: { mode: 'SELECTED', paths: ['one.txt'], message: '原说明' },
    targetId,
    executionDeviceId: 'device-test',
    repositoryKey,
    canonicalCommonDir: `/tmp/${repositoryKey}/.git`,
    worktreeIdentity: `/tmp/${repositoryKey}`,
    expectedHead: null,
    dispatchToken: randomUUID(),
    workerId: 'worker-test',
    ...overrides,
  };
  return { repository: new GitCommitOperationRepository(database.db), input };
}
function identity(operation: { ownerScope: string; operationId: string; dispatchToken: string }) {
  return {
    ownerScope: operation.ownerScope,
    operationId: operation.operationId,
    dispatchToken: operation.dispatchToken,
  };
}
async function claim(repositoryKey: string) {
  const records = await database.db
    .select()
    .from(gitWriteClaims)
    .where(eq(gitWriteClaims.repositoryKey, repositoryKey));
  return records[0];
}

it('预留原子保存操作与资源claim，GET必须同时匹配owner和Project', async () => {
  const f = fixture();
  const saved = await f.repository.reserve(f.input);
  expect(saved.created).toBe(true);
  expect(saved.operation).toMatchObject({
    ownerScope: f.input.ownerScope,
    operationId: f.input.operationId,
    projectId,
    phase: 'RECEIVED',
    requestHash: f.input.requestHash,
    payloadJson: f.input.payloadJson,
  });
  expect(await claim(f.input.repositoryKey)).toMatchObject(identity(saved.operation));
  expect(await f.repository.get(f.input.ownerScope, f.input.operationId, projectId)).toEqual(
    saved.operation,
  );
  expect(await f.repository.get('account:other', f.input.operationId, projectId)).toBeUndefined();
  expect(
    await f.repository.get(f.input.ownerScope, f.input.operationId, otherProjectId),
  ).toBeUndefined();
});

it('同键同hash并发重放只有一个created，不重复claim', async () => {
  const f = fixture();
  const second = new GitCommitOperationRepository(database.db);
  const results = await Promise.all([f.repository.reserve(f.input), second.reserve(f.input)]);
  expect(results.filter((item) => item.created)).toHaveLength(1);
  expect(results[0]!.operation).toEqual(results[1]!.operation);
  expect(
    await database.db
      .select()
      .from(gitCommitOperations)
      .where(eq(gitCommitOperations.operationId, f.input.operationId)),
  ).toHaveLength(1);
  expect(await claim(f.input.repositoryKey)).toMatchObject(identity(results[0]!.operation));
});

it('同键不同hash冲突，不覆盖原payload与claim', async () => {
  const f = fixture();
  const original = await f.repository.reserve(f.input);
  await expect(
    f.repository.reserve({
      ...f.input,
      requestHash: 'b'.repeat(64),
      payloadJson: { message: '偷换内容' },
    }),
  ).rejects.toMatchObject({ code: 'GIT_OPERATION_CONFLICT' });
  expect(await f.repository.get(f.input.ownerScope, f.input.operationId, projectId)).toEqual(
    original.operation,
  );
  expect(await claim(f.input.repositoryKey)).toMatchObject(identity(original.operation));
});

it('不同操作与project别名竞争同一repository只有一个赢家且失败方不留操作', async () => {
  const f = fixture();
  const other = {
    ...f.input,
    operationId: randomUUID(),
    projectId: otherProjectId,
    ownerScope: 'account:other',
    dispatchToken: randomUUID(),
  };
  const results = await Promise.allSettled([
    f.repository.reserve(f.input),
    new GitCommitOperationRepository(database.db).reserve(other),
  ]);
  expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
  const winner = results.find((item) => item.status === 'fulfilled');
  if (winner?.status !== 'fulfilled') throw new Error('缺少赢家');
  const loser = winner.value.operation.operationId === f.input.operationId ? other : f.input;
  expect(
    await f.repository.get(loser.ownerScope, loser.operationId, loser.projectId),
  ).toBeUndefined();
  expect(await claim(f.input.repositoryKey)).toMatchObject(identity(winner.value.operation));
});

it('不同repository可以独立预留，不将scope当全局写锁', async () => {
  const f = fixture();
  const other = fixture();
  const results = await Promise.all([
    f.repository.reserve(f.input),
    other.repository.reserve(other.input),
  ]);
  expect(results.every((item) => item.created)).toBe(true);
});

it('DISPATCHED CAS并发仅一次成功，错误token和owner均不可派发', async () => {
  const f = fixture();
  const saved = await f.repository.reserve(f.input);
  const id = identity(saved.operation);
  expect(await f.repository.markDispatched({ ...id, dispatchToken: randomUUID() })).toBeUndefined();
  expect(await f.repository.markDispatched({ ...id, ownerScope: 'account:other' })).toBeUndefined();
  const results = await Promise.all([
    f.repository.markDispatched(id),
    new GitCommitOperationRepository(database.db).markDispatched(id),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(results.find(Boolean)).toMatchObject({ phase: 'DISPATCHED' });
  expect(await claim(f.input.repositoryKey)).toMatchObject({ ...id, phase: 'DISPATCHED' });
  expect(await f.repository.markDispatched(id)).toBeUndefined();
});

it('未派发不能直接报命令成功；DISPATCHED不能伪装为前置拒绝', async () => {
  const f = fixture();
  const saved = await f.repository.reserve(f.input);
  const id = identity(saved.operation);
  expect(
    await f.repository.recordCommandSucceeded(id, {
      observedAfterHead: 'b'.repeat(40),
      commandExit: 0,
    }),
  ).toBeUndefined();
  await f.repository.markDispatched(id);
  expect(await f.repository.rejectPrewrite(id, 'PREWRITE_REJECTED')).toBeUndefined();
  expect(await claim(f.input.repositoryKey)).toMatchObject({ phase: 'DISPATCHED' });
});

it('UNKNOWN持久禁写，不可终态覆盖/重复派发/新键绕过或错误token释放', async () => {
  const f = fixture();
  const saved = await f.repository.reserve(f.input);
  const id = identity(saved.operation);
  await f.repository.markDispatched(id);
  expect(await f.repository.markUnknown(id, 'PROCESS_OUTCOME_UNKNOWN')).toMatchObject({
    phase: 'UNKNOWN',
    errorCode: 'PROCESS_OUTCOME_UNKNOWN',
  });
  expect(
    await f.repository.recordCommandSucceeded(id, {
      observedAfterHead: 'c'.repeat(40),
      commandExit: 0,
    }),
  ).toBeUndefined();
  expect(await f.repository.rejectPrewrite(id, 'PREWRITE_REJECTED')).toBeUndefined();
  expect(await f.repository.markDispatched(id)).toBeUndefined();
  expect(
    await f.repository.markUnknown({ ...id, dispatchToken: randomUUID() }, 'CHANGED'),
  ).toBeUndefined();
  await expect(
    f.repository.reserve({ ...f.input, operationId: randomUUID(), dispatchToken: randomUUID() }),
  ).rejects.toMatchObject({ code: 'GIT_REPOSITORY_CLAIMED' });
  expect(await claim(f.input.repositoryKey)).toMatchObject({ ...id, phase: 'UNKNOWN' });
  expect((await f.repository.reserve(f.input)).operation).toMatchObject({
    phase: 'UNKNOWN',
    errorCode: 'PROCESS_OUTCOME_UNKNOWN',
  });
});

it('前置拒绝释放claim但保留原结果，重放不占新claim且旧token不碰新操作', async () => {
  const f = fixture();
  const saved = await f.repository.reserve(f.input);
  const old = identity(saved.operation);
  expect(await f.repository.rejectPrewrite(old, 'HEAD_MISMATCH')).toMatchObject({
    phase: 'REJECTED_PREWRITE',
  });
  expect(await claim(f.input.repositoryKey)).toBeUndefined();
  const nextInput = { ...f.input, operationId: randomUUID(), dispatchToken: randomUUID() };
  const next = await f.repository.reserve(nextInput);
  expect((await f.repository.reserve(f.input)).operation).toMatchObject({
    phase: 'REJECTED_PREWRITE',
  });
  expect(await f.repository.rejectPrewrite(old, 'AGAIN')).toBeUndefined();
  expect(await f.repository.markUnknown(old, 'OLD_ERROR')).toBeUndefined();
  expect(await claim(f.input.repositoryKey)).toMatchObject(identity(next.operation));
});

it('命令成功记录只称observedAfterHead，释放claim后可创建新操作且旧终态不可改写', async () => {
  const f = fixture();
  const saved = await f.repository.reserve(f.input);
  const old = identity(saved.operation);
  await f.repository.markDispatched(old);
  const result = await f.repository.recordCommandSucceeded(old, {
    observedAfterHead: 'd'.repeat(40),
    commandExit: 0,
  });
  expect(result).toMatchObject({
    phase: 'COMMAND_SUCCEEDED',
    observedAfterHead: 'd'.repeat(40),
    commandExit: 0,
  });
  expect(await claim(f.input.repositoryKey)).toBeUndefined();
  const next = await f.repository.reserve({
    ...f.input,
    operationId: randomUUID(),
    dispatchToken: randomUUID(),
  });
  expect(
    await f.repository.recordCommandSucceeded(old, {
      observedAfterHead: 'e'.repeat(40),
      commandExit: 0,
    }),
  ).toBeUndefined();
  expect(await f.repository.markUnknown(old, 'LATE_ERROR')).toBeUndefined();
  expect(await claim(f.input.repositoryKey)).toMatchObject(identity(next.operation));
  expect((await f.repository.reserve(f.input)).operation).toEqual(result);
});

it('命令成功允许缺失观测HEAD，不伪造精确commit SHA', async () => {
  const f = fixture();
  const saved = await f.repository.reserve(f.input);
  const id = identity(saved.operation);
  await f.repository.markDispatched(id);
  expect(
    await f.repository.recordCommandSucceeded(id, { observedAfterHead: null, commandExit: 0 }),
  ).toMatchObject({ phase: 'COMMAND_SUCCEEDED', observedAfterHead: null });
});

it('同操作键即使hash相同也不能换Project，原资源绑定不会被重放参数改写', async () => {
  const f = fixture();
  const saved = await f.repository.reserve(f.input);
  await expect(
    f.repository.reserve({ ...f.input, projectId: otherProjectId }),
  ).rejects.toMatchObject({ code: 'GIT_OPERATION_CONFLICT' });
  const replay = await f.repository.reserve({
    ...f.input,
    repositoryKey: 'different-resource',
    dispatchToken: randomUUID(),
    workerId: 'new-worker',
  });
  expect(replay.created).toBe(false);
  expect(replay.operation).toEqual(saved.operation);
  expect(await claim('different-resource')).toBeUndefined();
  expect(await claim(f.input.repositoryKey)).toMatchObject(identity(saved.operation));
});

it('缺少服务端归属身份在insert前拒绝，不留下操作或claim', async () => {
  const f = fixture({ executionDeviceId: '' });
  await expect(f.repository.reserve(f.input)).rejects.toMatchObject({
    code: 'GIT_OPERATION_INVALID',
  });
  expect(
    await f.repository.get(f.input.ownerScope, f.input.operationId, projectId),
  ).toBeUndefined();
  expect(await claim(f.input.repositoryKey)).toBeUndefined();
});

it('unknown与命令成功并发竞争只有一个终态获胜，claim与终态一致', async () => {
  const f = fixture();
  const saved = await f.repository.reserve(f.input);
  const id = identity(saved.operation);
  await f.repository.markDispatched(id);
  const results = await Promise.all([
    f.repository.markUnknown(id, 'PROCESS_LOST'),
    new GitCommitOperationRepository(database.db).recordCommandSucceeded(id, {
      observedAfterHead: 'f'.repeat(40),
      commandExit: 0,
    }),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const winner = results.find(Boolean)!;
  expect(await f.repository.get(f.input.ownerScope, f.input.operationId, projectId)).toEqual(
    winner,
  );
  if (winner.phase === 'UNKNOWN')
    expect(await claim(f.input.repositoryKey)).toMatchObject({ ...id, phase: 'UNKNOWN' });
  else {
    expect(winner.phase).toBe('COMMAND_SUCCEEDED');
    expect(await claim(f.input.repositoryKey)).toBeUndefined();
  }
});
