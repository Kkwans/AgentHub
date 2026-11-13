import { randomUUID } from 'node:crypto';
import {
  createPgliteDatabase,
  ExecutionTargetRepository,
  ProjectRepository,
  GitCommitOperationRepository,
} from '@agenthub/db';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  GitWriteCoordinator,
  type GitWriteInput,
  type GitWriteResource,
} from './git-write-coordinator.js';

let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
let projectId: string;
let targetId: string;
beforeAll(async () => {
  database = await createPgliteDatabase({ dataDir: 'memory://' });
  targetId = (
    await new ExecutionTargetRepository(database.db).create({
      id: randomUUID(),
      name: 'coordinator',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    })
  ).id;
  projectId = (
    await new ProjectRepository(database.db).create({
      id: randomUUID(),
      targetId,
      name: 'coordinator',
      rootPath: '/tmp/coordinator',
      realRootPath: '/tmp/coordinator',
      repoKind: 'GIT',
      status: 'ACTIVE',
    })
  ).id;
});
afterAll(async () => database?.close());
function fixture() {
  const repository = new GitCommitOperationRepository(database.db);
  const resource: GitWriteResource = {
    projectId,
    targetId,
    executionDeviceId: 'host-test',
    repositoryKey: randomUUID(),
    canonicalCommonDir: '/tmp/coordinator/.git',
    worktreeIdentity: '/tmp/coordinator',
    head: 'a'.repeat(40),
  };
  const resolve = vi.fn(async () => ({ ...resource }));
  const input: GitWriteInput = {
    ownerScope: 'account:test',
    operationId: randomUUID(),
    projectId,
    protocolVersion: 1,
    payload: { operationKind: 'SELECTED_COMMIT', paths: ['a.txt'], message: 'test' },
    expectedHead: 'a'.repeat(40),
  };
  const write = vi.fn(async () => ({ commandExit: 0 as const, observedAfterHead: 'b'.repeat(40) }));
  const coordinator = new GitWriteCoordinator(repository, resolve);
  const get = () => repository.get(input.ownerScope, input.operationId, projectId);
  return { repository, resource, resolve, input, write, coordinator, get };
}
it('并发同键仅调用一次写入，已完成重放不依赖当前资源', async () => {
  const f = fixture();
  const results = await Promise.all([
    f.coordinator.execute(f.input, f.write),
    f.coordinator.execute(f.input, f.write),
  ]);
  expect(f.write).toHaveBeenCalledTimes(1);
  expect(results.filter((r) => !r.replayed)).toHaveLength(1);
  f.resolve.mockRejectedValue(new Error('device offline'));
  const replay = await f.coordinator.execute(f.input, f.write);
  expect(replay.operation.phase).toBe('COMMAND_SUCCEEDED');
  expect(replay.operation.resultEvidenceJson).toMatchObject({ headAttribution: 'OBSERVED_ONLY' });
  await expect(
    f.coordinator.execute({ ...f.input, expectedHead: 'c'.repeat(40) }, f.write),
  ).rejects.toMatchObject({ code: 'GIT_OPERATION_CONFLICT' });
  expect(f.write).toHaveBeenCalledTimes(1);
});
it('UNKNOWN跨新协调器持续阻塞新键写入', async () => {
  const f = fixture();
  const failedWrite = vi.fn(async () => {
    throw new Error('response lost after Git');
  });
  await expect(f.coordinator.execute(f.input, failedWrite)).rejects.toThrow('response lost');
  expect((await f.get())?.phase).toBe('UNKNOWN');
  const restarted = new GitWriteCoordinator(f.repository, f.resolve);
  expect((await restarted.execute(f.input, f.write)).replayed).toBe(true);
  await expect(
    restarted.execute({ ...f.input, operationId: randomUUID() }, f.write),
  ).rejects.toMatchObject({ code: 'GIT_REPOSITORY_CLAIMED' });
  expect(f.write).not.toHaveBeenCalled();
});
it.each([
  'head',
  'executionDeviceId',
  'canonicalCommonDir',
  'worktreeIdentity',
  'targetId',
] as const)('claim 后 %s 改变则拒绝且没有 Git 写入', async (key) => {
  const f = fixture();
  f.resolve
    .mockResolvedValueOnce({ ...f.resource })
    .mockResolvedValueOnce({ ...f.resource, [key]: 'changed' });
  await expect(f.coordinator.execute(f.input, f.write)).rejects.toBeInstanceOf(Error);
  expect((await f.get())?.phase).toBe('REJECTED_PREWRITE');
  expect(f.write).not.toHaveBeenCalled();
  f.resolve.mockResolvedValue({ ...f.resource });
  await f.coordinator.execute({ ...f.input, operationId: randomUUID() }, f.write);
  expect(f.write).toHaveBeenCalledTimes(1);
});
it('dispatch 已入库但响应丢失时不执行 callback，重放不重派', async () => {
  const f = fixture();
  const original = f.repository.markDispatched.bind(f.repository);
  vi.spyOn(f.repository, 'markDispatched').mockImplementation(async (identity) => {
    await original(identity);
    throw new Error('dispatch response lost');
  });
  await expect(f.coordinator.execute(f.input, f.write)).rejects.toThrow('dispatch response lost');
  expect((await f.get())?.phase).toBe('DISPATCHED');
  await f.coordinator.execute(f.input, f.write);
  expect(f.write).not.toHaveBeenCalled();
});
it('成功落库失败保持 DISPATCHED，不返回成功或释放 claim', async () => {
  const f = fixture();
  vi.spyOn(f.repository, 'recordCommandSucceeded').mockRejectedValue(new Error('DB unavailable'));
  await expect(f.coordinator.execute(f.input, f.write)).rejects.toThrow('DB unavailable');
  expect((await f.get())?.phase).toBe('DISPATCHED');
  await f.coordinator.execute(f.input, f.write);
  await expect(
    f.coordinator.execute({ ...f.input, operationId: randomUUID() }, f.write),
  ).rejects.toMatchObject({ code: 'GIT_REPOSITORY_CLAIMED' });
  expect(f.write).toHaveBeenCalledTimes(1);
});
it('成功已落库但响应丢失可恢复证据，不再次调用 Git', async () => {
  const f = fixture();
  const original = f.repository.recordCommandSucceeded.bind(f.repository);
  vi.spyOn(f.repository, 'recordCommandSucceeded').mockImplementation(
    async (identity, evidence) => {
      await original(identity, evidence);
      throw new Error('settlement response lost');
    },
  );
  await expect(f.coordinator.execute(f.input, f.write)).rejects.toThrow('settlement response lost');
  expect((await f.coordinator.execute(f.input, f.write)).operation.phase).toBe('COMMAND_SUCCEEDED');
  expect(f.write).toHaveBeenCalledTimes(1);
});
it('请求在首次 await 前冻结，对象键顺序不改变请求身份', async () => {
  const f = fixture();
  const pending = f.coordinator.execute(f.input, f.write);
  f.input.payload.message = 'new draft';
  await pending;
  expect(f.write.mock.calls[0]).toEqual([
    expect.anything(),
    { operationKind: 'SELECTED_COMMIT', paths: ['a.txt'], message: 'test' },
  ]);
  await f.coordinator.execute(
    {
      ...f.input,
      payload: {
        message: 'test',
        paths: ['a.txt'],
        operationKind: 'SELECTED_COMMIT',
      },
    },
    f.write,
  );
  expect(f.write).toHaveBeenCalledTimes(1);
});
it('非 JSON 或缺少 operationKind 的请求不创建操作', async () => {
  const f = fixture();
  for (const payload of [
    { value: undefined },
    { operationKind: 'x', value: NaN },
    { operationKind: '' },
  ]) {
    await expect(f.coordinator.execute({ ...f.input, payload }, f.write)).rejects.toMatchObject({
      code: 'GIT_OPERATION_INVALID',
    });
  }
  expect(await f.get()).toBeUndefined();
  expect(f.resolve).not.toHaveBeenCalled();
});
it('不同 operationId 同时争夺仓库，失败者没有写 callback', async () => {
  const f = fixture();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const write = vi.fn(async () => {
    started();
    await gate;
    return { commandExit: 0 as const, observedAfterHead: null };
  });
  const first = f.coordinator.execute(f.input, write);
  await began;
  try {
    await expect(
      f.coordinator.execute({ ...f.input, operationId: randomUUID() }, f.write),
    ).rejects.toMatchObject({ code: 'GIT_REPOSITORY_CLAIMED' });
    expect(f.write).not.toHaveBeenCalled();
  } finally {
    release();
    await first;
  }
  expect(write).toHaveBeenCalledTimes(1);
});
it('UNKNOWN 落库失败仍保留 DISPATCHED，不允许新键绕过', async () => {
  const f = fixture();
  vi.spyOn(f.repository, 'markUnknown').mockRejectedValue(new Error('DB unavailable'));
  await expect(
    f.coordinator.execute(f.input, async () => {
      throw new Error('Git failure');
    }),
  ).rejects.toThrow('DB unavailable');
  expect((await f.get())?.phase).toBe('DISPATCHED');
  await expect(
    f.coordinator.execute({ ...f.input, operationId: randomUUID() }, f.write),
  ).rejects.toMatchObject({ code: 'GIT_REPOSITORY_CLAIMED' });
  expect(f.write).not.toHaveBeenCalled();
});
it('CAS 未授予执行权，绝不调用 callback', async () => {
  const f = fixture();
  vi.spyOn(f.repository, 'markDispatched').mockResolvedValue(undefined);
  await expect(f.coordinator.execute(f.input, f.write)).rejects.toMatchObject({
    code: 'GIT_DISPATCH_NOT_GRANTED',
  });
  expect(f.write).not.toHaveBeenCalled();
  expect((await f.get())?.phase).toBe('RECEIVED');
});
it('UUID 大小写规范化后重放，非法 UUID 或 HEAD 在解析资源前拒绝', async () => {
  const f = fixture();
  await f.coordinator.execute(
    {
      ...f.input,
      operationId: f.input.operationId.toUpperCase(),
      projectId: f.input.projectId.toUpperCase(),
      expectedHead: 'A'.repeat(40),
    },
    f.write,
  );
  expect((await f.coordinator.execute(f.input, f.write)).replayed).toBe(true);
  expect(f.write).toHaveBeenCalledTimes(1);
  const other = fixture();
  for (const patch of [{ operationId: 'bad' }, { projectId: 'bad' }, { expectedHead: 'short' }]) {
    await expect(
      other.coordinator.execute({ ...other.input, ...patch }, other.write),
    ).rejects.toMatchObject({ code: 'GIT_OPERATION_INVALID' });
  }
  expect(other.resolve).not.toHaveBeenCalled();
  expect(other.write).not.toHaveBeenCalled();
});
it('非法 callback HEAD 证据不得标记成功或释放 claim', async () => {
  const f = fixture();
  await expect(
    f.coordinator.execute(f.input, async () => ({
      commandExit: 0,
      observedAfterHead: 'not-a-sha',
    })),
  ).rejects.toMatchObject({ code: 'GIT_EVIDENCE_INVALID' });
  expect((await f.get())?.phase).toBe('UNKNOWN');
});
