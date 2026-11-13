import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPgliteDatabase } from './client.js';
import {
  AgentRepository,
  ExecutionTargetRepository,
  ProjectRepository,
  RunRepository,
  SessionRepository,
  TaskRepository,
  WorktreeExecutionRepository,
} from './repositories.js';
import { deriveWorktreeMergeOperationId } from './worktree-merge-operation.js';
import { gitCommitOperations, gitWriteClaims, worktreeExecutions } from './schema.js';

let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
let targetId: string;
let agentId: string;
beforeAll(async () => {
  database = await createPgliteDatabase({ dataDir: 'memory://' });
  targetId = (
    await new ExecutionTargetRepository(database.db).create({
      id: randomUUID(),
      name: 'test',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'x64',
      status: 'READY',
    })
  ).id;
  agentId = (
    await new AgentRepository(database.db).create({
      id: randomUUID(),
      targetId,
      name: 'test',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    })
  ).id;
});
afterAll(async () => database?.close());
async function fixture() {
  const projectId = randomUUID();
  await new ProjectRepository(database.db).create({
    id: projectId,
    targetId,
    name: 'test',
    rootPath: `/tmp/${projectId}`,
    realRootPath: `/tmp/${projectId}`,
    repoKind: 'GIT',
    status: 'ACTIVE',
  });
  const tasks = new TaskRepository(database.db);
  const task = await tasks.create({
    id: randomUUID(),
    projectId,
    title: 'review',
    status: 'IN_PROGRESS',
    assignedAgentId: agentId,
  });
  const session = await new SessionRepository(database.db).create({
    id: randomUUID(),
    projectId,
    agentId,
    taskId: task.id,
    title: 'review',
    cwd: `/tmp/${projectId}`,
    status: 'READY',
  });
  await tasks.update(task.id, { sessionId: session.id });
  const run = await new RunRepository(database.db).create({
    id: randomUUID(),
    sessionId: session.id,
    taskId: task.id,
    status: 'COMPLETED',
    dispatchState: 'ATTEMPTED',
  });
  await tasks.update(task.id, {
    sessionId: session.id,
    finalRunId: run.id,
    status: 'WAITING_REVIEW',
  });
  const repo = new WorktreeExecutionRepository(database.db);
  const execution = await repo.create({
    id: randomUUID(),
    taskId: task.id,
    projectId,
    agentId,
    sessionId: session.id,
    runId: run.id,
    status: 'REVIEW',
    baseBranch: 'main',
    baseSha: 'a'.repeat(40),
    taskBranch: `task-${task.id}`,
    worktreePath: `/tmp/${task.id}`,
    gitOwnerScope: 'local-trusted',
    gitCreateOperationId: randomUUID(),
  });
  const operationId = deriveWorktreeMergeOperationId(execution.id, run.id);
  const expected = { sessionId: session.id, runId: run.id, expectedOperationId: operationId };
  const snapshot = { sessionId: session.id, runId: run.id, generation: 0 };
  const ledger = async (
    phase: string,
    ownerScope = 'local-trusted',
    alternateProjectId = projectId,
  ) => {
    await database.db.insert(gitCommitOperations).values({
      ownerScope,
      operationId,
      projectId: alternateProjectId,
      requestHash: 'a'.repeat(64),
      payloadJson: { operationKind: 'WORKTREE_MERGE' },
      targetId,
      executionDeviceId: 'test',
      repositoryKey: `repo-${projectId}`,
      canonicalCommonDir: `/tmp/${projectId}/.git`,
      worktreeIdentity: `/tmp/${projectId}`,
      phase,
      dispatchToken: randomUUID(),
      workerId: 'test',
    });
  };
  return { repo, execution, operationId, expected, snapshot, ledger, projectId };
}

it('generation 0精确兼容旧键，后续代际稳定且不同', () => {
  const executionId = randomUUID(),
    runId = randomUUID();
  const hex = createHash('sha256')
    .update(JSON.stringify(['agenthub.worktree-merge.v1', executionId, runId]))
    .digest('hex');
  expect(deriveWorktreeMergeOperationId(executionId, runId)).toBe(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
  );
  expect(deriveWorktreeMergeOperationId(executionId, runId, 1)).not.toBe(
    deriveWorktreeMergeOperationId(executionId, runId),
  );
  expect(() => deriveWorktreeMergeOperationId(executionId, runId, -1)).toThrow();
});
it('首次领取也要求expected operation CAS，缺失/旧run/旧key不能进入MERGING', async () => {
  const f = await fixture();
  for (const expected of [
    { ...f.expected, expectedOperationId: randomUUID() },
    { ...f.expected, runId: randomUUID() },
  ])
    await expect(f.repo.claimReviewForMerge(f.execution.id, expected)).rejects.toMatchObject({
      code: 'WORKTREE_EXECUTION_CHANGED',
    });
  expect(await f.repo.get(f.execution.id)).toEqual(f.execution);
  expect(await f.repo.getMergeAdmission(f.execution.id, f.snapshot)).toMatchObject({
    mergeAllowed: true,
    retryEligible: false,
  });
  const claimed = await f.repo.claimReviewForMerge(f.execution.id, f.expected);
  expect(claimed.operationId).toBe(f.operationId);
  expect(claimed.execution.gitMergeGeneration).toBe(0);
  await expect(f.repo.claimReviewForMerge(f.execution.id, f.expected)).rejects.toMatchObject({
    code: 'WORKTREE_EXECUTION_CHANGED',
  });
});
it('两个重试CAS只有一个递增；旧普通请求和旧retry不能派发新代际，winner claim不变', async () => {
  const f = await fixture();
  await f.ledger('REJECTED_PREWRITE');
  const claim = {
    repositoryKey: `holder-${f.projectId}`,
    ownerScope: 'holder',
    operationId: randomUUID(),
    dispatchToken: randomUUID(),
    workerId: 'winner',
    phase: 'DISPATCHED',
  };
  const [loserRow] = await database.db
    .select()
    .from(gitCommitOperations)
    .where(eq(gitCommitOperations.operationId, f.operationId));
  await database.db
    .insert(gitCommitOperations)
    .values({ ...loserRow!, ...claim, projectId: f.projectId });
  await database.db.insert(gitWriteClaims).values(claim);
  const before = await database.db
    .select()
    .from(gitWriteClaims)
    .where(eq(gitWriteClaims.repositoryKey, claim.repositoryKey));
  expect(await f.repo.getMergeAdmission(f.execution.id, f.snapshot)).toMatchObject({
    retryEligible: true,
    mergeAllowed: true,
  });
  await expect(f.repo.claimReviewForMerge(f.execution.id, f.expected)).rejects.toMatchObject({
    code: 'WORKTREE_EXECUTION_CHANGED',
  });
  expect((await f.repo.get(f.execution.id))?.status).toBe('REVIEW');
  expect((await f.repo.get(f.execution.id))?.gitMergeGeneration).toBe(0);
  const input = { ...f.expected, retryOfOperationId: f.operationId };
  const results = await Promise.allSettled([
    f.repo.claimReviewForMerge(f.execution.id, input),
    f.repo.claimReviewForMerge(f.execution.id, input),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await f.repo.get(f.execution.id))?.gitMergeGeneration).toBe(1);
  // Simulates a known rejection returning the NEW generation to review.
  await f.repo.patch(f.execution.id, { status: 'REVIEW' });
  for (const old of [f.expected, input])
    await expect(f.repo.claimReviewForMerge(f.execution.id, old)).rejects.toMatchObject({
      code: 'WORKTREE_EXECUTION_CHANGED',
    });
  expect((await f.repo.get(f.execution.id))?.gitMergeGeneration).toBe(1);
  expect(await f.repo.getMergeAdmission(f.execution.id, f.snapshot)).toBeNull();
  expect(
    await database.db
      .select()
      .from(gitWriteClaims)
      .where(eq(gitWriteClaims.repositoryKey, claim.repositoryKey)),
  ).toEqual(before);
});
it.each([
  'MISSING',
  'RECEIVED',
  'DISPATCHED',
  'UNKNOWN',
  'COMMAND_SUCCEEDED',
  'WRONG_OWNER',
  'WRONG_PROJECT',
])('%s不允许轮换；错误标签不代替权威记录', async (kind) => {
  const f = await fixture();
  if (kind === 'WRONG_PROJECT') {
    const other = await fixture();
    await f.ledger('REJECTED_PREWRITE', 'local-trusted', other.projectId);
  } else if (kind !== 'MISSING')
    await f.ledger(
      kind === 'WRONG_OWNER' ? 'REJECTED_PREWRITE' : kind,
      kind === 'WRONG_OWNER' ? 'other' : 'local-trusted',
    );
  await f.repo.patch(f.execution.id, { errorCode: 'WORKTREE_GIT_PREWRITE_REJECTED' });
  await expect(
    f.repo.claimReviewForMerge(f.execution.id, {
      ...f.expected,
      retryOfOperationId: f.operationId,
    }),
  ).rejects.toMatchObject({ code: 'WORKTREE_EXECUTION_CHANGED' });
  expect((await f.repo.get(f.execution.id))?.gitMergeGeneration).toBe(0);
  expect((await f.repo.get(f.execution.id))?.status).toBe('REVIEW');
  expect(await f.repo.getMergeAdmission(f.execution.id, f.snapshot)).toMatchObject({
    retryEligible: false,
    mergeAllowed: false,
  });
});
it('数据库拒绝负代际，满值不能溢出轮换', async () => {
  const f = await fixture();
  await expect(
    database.db
      .update(worktreeExecutions)
      .set({ gitMergeGeneration: -1 })
      .where(eq(worktreeExecutions.id, f.execution.id)),
  ).rejects.toThrow();
  await f.repo.patch(f.execution.id, { gitMergeGeneration: 2147483647 });
  const key = deriveWorktreeMergeOperationId(f.execution.id, f.expected.runId, 2147483647);
  await expect(
    f.repo.claimReviewForMerge(f.execution.id, {
      ...f.expected,
      expectedOperationId: key,
      retryOfOperationId: key,
    }),
  ).rejects.toMatchObject({ code: 'WORKTREE_EXECUTION_CHANGED' });
});

it('领取事务已提交但回执丢失：代际保留且重放不再递增', async () => {
  const f = await fixture();
  await f.ledger('REJECTED_PREWRITE');
  const wrapped = new Proxy(database.db, {
    get(target, property) {
      if (property === 'transaction')
        return async (...args: Parameters<typeof target.transaction>) => {
          await target.transaction(...args);
          throw new Error('transaction response lost');
        };
      return Reflect.get(target, property);
    },
  });
  const uncertain = new WorktreeExecutionRepository(wrapped);
  const input = { ...f.expected, retryOfOperationId: f.operationId };
  await expect(uncertain.claimReviewForMerge(f.execution.id, input)).rejects.toThrow(
    'response lost',
  );
  expect(await f.repo.get(f.execution.id)).toMatchObject({
    status: 'MERGING',
    gitMergeGeneration: 1,
  });
  await expect(f.repo.claimReviewForMerge(f.execution.id, input)).rejects.toMatchObject({
    code: 'WORKTREE_EXECUTION_CHANGED',
  });
  expect((await f.repo.get(f.execution.id))?.gitMergeGeneration).toBe(1);
});

it('相同owner/key但其他操作类型的拒绝不是Worktree重试证据', async () => {
  const f = await fixture();
  await f.ledger('REJECTED_PREWRITE');
  await database.db
    .update(gitCommitOperations)
    .set({ payloadJson: { operationKind: 'COMMIT' } })
    .where(eq(gitCommitOperations.operationId, f.operationId));
  expect(await f.repo.getMergeAdmission(f.execution.id, f.snapshot)).toMatchObject({
    mergeAllowed: false,
    retryEligible: false,
  });
  await expect(
    f.repo.claimReviewForMerge(f.execution.id, {
      ...f.expected,
      retryOfOperationId: f.operationId,
    }),
  ).rejects.toMatchObject({ code: 'WORKTREE_EXECUTION_CHANGED' });
  expect((await f.repo.get(f.execution.id))?.gitMergeGeneration).toBe(0);
});

it('缺失ledger但已有失败记录时旧普通token不领取或清除错误', async () => {
  const f = await fixture();
  await f.repo.patch(f.execution.id, {
    errorCode: 'WORKTREE_GIT_OUTCOME_UNKNOWN',
    errorMessage: 'unconfirmed',
  });
  const before = await f.repo.get(f.execution.id);
  expect(await f.repo.getMergeAdmission(f.execution.id, f.snapshot)).toMatchObject({
    mergeAllowed: false,
    retryEligible: false,
  });
  await expect(f.repo.claimReviewForMerge(f.execution.id, f.expected)).rejects.toMatchObject({
    code: 'WORKTREE_EXECUTION_CHANGED',
  });
  expect(await f.repo.get(f.execution.id)).toEqual(before);
  expect((await f.repo.get(f.execution.id))?.gitMergeGeneration).toBe(0);
});
