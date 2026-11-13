import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  AgentRepository,
  createPgliteDatabase,
  ExecutionTargetRepository,
  ProjectRepository,
  RunRepository,
  SessionRepository,
  TaskRepository,
  WorktreeExecutionRepository,
  TaskStartAttemptRepository,
  taskStartAttempts,
  agentRuns,
  type ReserveTaskStartInput,
} from './index.js';

let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
let projectId: string, agentId: string;
beforeAll(async () => {
  database = await createPgliteDatabase({ dataDir: 'memory://' });
  const target = await new ExecutionTargetRepository(database.db).create({
    id: randomUUID(),
    name: '预留测试',
    kind: 'LOCAL_HOST',
    hostname: 'test',
    os: 'linux',
    arch: 'arm64',
    status: 'READY',
  });
  const project = await new ProjectRepository(database.db).create({
    id: randomUUID(),
    targetId: target.id,
    name: '预留测试',
    rootPath: '/tmp/reservation-test',
    realRootPath: '/tmp/reservation-test',
    repoKind: 'NONE',
    status: 'ACTIVE',
  });
  const agent = await new AgentRepository(database.db).create({
    id: randomUUID(),
    targetId: target.id,
    name: '测试Agent',
    agentKind: 'CUSTOM_ACP',
    adapterKind: 'ACP_STDIO',
    executable: '/bin/false',
    status: 'READY',
  });
  projectId = project.id;
  agentId = agent.id;
});
afterAll(async () => database.close());
async function fixture(kind: 'START' | 'REWORK' = 'START') {
  const tasks = new TaskRepository(database.db),
    sessions = new SessionRepository(database.db),
    attempts = new TaskStartAttemptRepository(database.db);
  const task = await tasks.create({
    id: randomUUID(),
    projectId,
    title: '需要原子预留的任务',
    status: kind === 'START' ? 'READY' : 'WAITING_REVIEW',
    assignedAgentId: agentId,
  });
  const old =
    kind === 'REWORK'
      ? await sessions.create({
          id: randomUUID(),
          projectId,
          agentId,
          taskId: task.id,
          title: '原会话',
          cwd: '/tmp/reservation-test',
          status: 'READY',
        })
      : undefined;
  if (old) {
    await tasks.update(task.id, { sessionId: old.id });
    await new RunRepository(database.db).create({
      id: randomUUID(),
      sessionId: old.id,
      taskId: task.id,
      status: 'COMPLETED',
      dispatchState: 'ATTEMPTED',
    });
  }
  const input: ReserveTaskStartInput = {
    attemptId: randomUUID(),
    kind,
    expectedOldSessionId: old?.id ?? null,
    inputHash: 'test-input-hash',
    session: {
      id: randomUUID(),
      projectId,
      agentId,
      taskId: task.id,
      title: task.title,
      cwd: '/tmp/reservation-test',
    },
  };
  return { tasks, sessions, attempts, task, old, input };
}

it.each(['START', 'REWORK'] as const)(
  '%s两个Repository实例只能预留一个Session，不留下失败方行',
  async (kind) => {
    const f = await fixture(kind);
    const second = {
      ...f.input,
      attemptId: randomUUID(),
      session: { ...f.input.session, id: randomUUID() },
    };
    const results = await Promise.allSettled([
      f.attempts.reserve(f.input),
      new TaskStartAttemptRepository(database.db).reserve(second),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
    const winner = results.find((x) => x.status === 'fulfilled');
    if (winner?.status !== 'fulfilled') throw new Error('缺少赢家');
    expect(winner.value.task).toMatchObject({
      status: 'IN_PROGRESS',
      sessionId: winner.value.session.id,
    });
    expect(winner.value.session.status).toBe('CREATED');
    expect(winner.value.attempt.phase).toBe('RESERVED');
    expect(
      await database.db
        .select()
        .from(taskStartAttempts)
        .where(eq(taskStartAttempts.taskId, f.task.id)),
    ).toHaveLength(1);
    const loserId =
      winner.value.session.id === f.input.session.id ? second.session.id : f.input.session.id;
    expect(await f.sessions.get(loserId)).toBeUndefined();
  },
);

it.each(['CALL_FIRST', 'RELEASE_FIRST', 'CONCURRENT'] as const)(
  '调用前CAS与恢复释放%s仅一方获胜，重复不重放',
  async (order) => {
    const f = await fixture();
    await f.attempts.reserve(f.input);
    let call, release;
    if (order === 'CONCURRENT')
      [call, release] = await Promise.all([
        f.attempts.markCreateAttempted(f.input.attemptId),
        f.attempts.releaseUnattempted(f.input.attemptId),
      ]);
    else if (order === 'CALL_FIRST') {
      call = await f.attempts.markCreateAttempted(f.input.attemptId);
      release = await f.attempts.releaseUnattempted(f.input.attemptId);
    } else {
      release = await f.attempts.releaseUnattempted(f.input.attemptId);
      call = await f.attempts.markCreateAttempted(f.input.attemptId);
    }
    expect(Number(Boolean(call)) + Number(Boolean(release))).toBe(1);
    expect(await f.attempts.markCreateAttempted(f.input.attemptId)).toBeUndefined();
    expect(await f.attempts.releaseUnattempted(f.input.attemptId)).toBeUndefined();
    expect((await f.tasks.get(f.task.id))?.status).toBe(call ? 'IN_PROGRESS' : 'BLOCKED');
    expect((await f.sessions.get(f.input.session.id))?.status).toBe(call ? 'STARTING' : 'FAILED');
    expect((await f.attempts.get(f.input.attemptId))?.phase).toBe(
      call ? 'CREATE_ATTEMPTED' : 'FAILED_KNOWN',
    );
  },
);

it('预留第二笔插入失败必须回滚Session和Task绑定', async () => {
  const first = await fixture();
  await first.attempts.reserve(first.input);
  const second = await fixture();
  second.input.attemptId = first.input.attemptId;
  await expect(second.attempts.reserve(second.input)).rejects.toThrow();
  expect(await second.sessions.get(second.input.session.id)).toBeUndefined();
  expect(await second.tasks.get(second.task.id)).toMatchObject({
    status: 'READY',
    sessionId: null,
  });
});

it.each(['WORKTREE', 'STALE_SESSION', 'WRONG_PROJECT', 'RUN_UNKNOWN'] as const)(
  '%s准入拒绝且无新Session',
  async (mode) => {
    const f = await fixture(mode === 'RUN_UNKNOWN' ? 'REWORK' : 'START');
    if (mode === 'WORKTREE')
      await new WorktreeExecutionRepository(database.db).create({
        id: randomUUID(),
        taskId: f.task.id,
        projectId,
        agentId,
        status: 'CANCELED',
        baseBranch: 'main',
        baseSha: 'a'.repeat(40),
        taskBranch: `task-${f.task.id}`,
      });
    if (mode === 'STALE_SESSION') f.input.expectedOldSessionId = randomUUID();
    if (mode === 'WRONG_PROJECT') f.input.session.projectId = randomUUID();
    if (mode === 'RUN_UNKNOWN')
      await new RunRepository(database.db).create({
        id: randomUUID(),
        taskId: f.task.id,
        sessionId: f.old!.id,
        status: 'DISCONNECTED',
        dispatchState: 'ATTEMPTED',
      });
    await expect(f.attempts.reserve(f.input)).rejects.toThrow();
    expect(await f.sessions.get(f.input.session.id)).toBeUndefined();
    expect(await f.attempts.get(f.input.attemptId)).toBeUndefined();
  },
);

it.each(['TASK_CHANGED', 'SESSION_CHANGED', 'RUN_EXISTS', 'UNKNOWN'] as const)(
  '%s后不允许调用标记或未尝试释放覆盖',
  async (mode) => {
    const f = await fixture();
    await f.attempts.reserve(f.input);
    if (mode === 'TASK_CHANGED') await f.tasks.update(f.task.id, { sessionId: null });
    if (mode === 'SESSION_CHANGED') await f.sessions.transition(f.input.session.id, 'STARTING');
    if (mode === 'RUN_EXISTS')
      await database.db.insert(agentRuns).values({
        id: randomUUID(),
        taskId: f.task.id,
        sessionId: f.input.session.id,
        status: 'COMPLETED',
      });
    if (mode === 'UNKNOWN')
      await database.db
        .update(taskStartAttempts)
        .set({ phase: 'UNKNOWN' })
        .where(eq(taskStartAttempts.id, f.input.attemptId));
    const before = {
      task: await f.tasks.get(f.task.id),
      session: await f.sessions.get(f.input.session.id),
      attempt: await f.attempts.get(f.input.attemptId),
    };
    expect(await f.attempts.markCreateAttempted(f.input.attemptId)).toBeUndefined();
    expect(await f.attempts.releaseUnattempted(f.input.attemptId)).toBeUndefined();
    expect({
      task: await f.tasks.get(f.task.id),
      session: await f.sessions.get(f.input.session.id),
      attempt: await f.attempts.get(f.input.attemptId),
    }).toEqual(before);
  },
);

it('调用标记关联Session更新失败时整个CAS回滚，不能取得调用权', async () => {
  const f = await fixture();
  await f.attempts.reserve(f.input);
  const functionName = 'reject_attempt_' + randomUUID().replaceAll('-', '');
  await database.db.execute(
    sql.raw(
      `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${f.input.session.id}' THEN RAISE EXCEPTION 'injected session update failure'; END IF; RETURN NEW; END $$`,
    ),
  );
  await database.db.execute(
    sql.raw(
      `CREATE TRIGGER ${functionName} BEFORE UPDATE ON agent_sessions FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    ),
  );
  try {
    await expect(f.attempts.markCreateAttempted(f.input.attemptId)).rejects.toThrow();
    expect((await f.attempts.get(f.input.attemptId))?.phase).toBe('RESERVED');
    expect((await f.sessions.get(f.input.session.id))?.status).toBe('CREATED');
    expect((await f.tasks.get(f.task.id))?.status).toBe('IN_PROGRESS');
  } finally {
    await database.db.execute(sql.raw(`DROP TRIGGER ${functionName} ON agent_sessions`));
    await database.db.execute(sql.raw(`DROP FUNCTION ${functionName}()`));
  }
  expect(await f.attempts.releaseUnattempted(f.input.attemptId)).toBeDefined();
});

it.each(['RESERVED', 'CREATE_ATTEMPTED', 'SESSION_READY', 'UNKNOWN'] as const)(
  '%s未决预留不能通过历史错误状态重置绕过',
  async (phase) => {
    const f = await fixture();
    await f.attempts.reserve(f.input);
    await database.db
      .update(taskStartAttempts)
      .set({ phase })
      .where(eq(taskStartAttempts.id, f.input.attemptId));
    await f.tasks.update(f.task.id, { status: 'READY' });
    const next = {
      ...f.input,
      attemptId: randomUUID(),
      expectedOldSessionId: f.input.session.id,
      session: { ...f.input.session, id: randomUUID() },
    };
    await expect(f.attempts.reserve(next)).rejects.toMatchObject({ code: 'TASK_START_UNRESOLVED' });
    expect(await f.sessions.get(next.session.id)).toBeUndefined();
  },
);

it('确定未尝试释放后显式重置并新预留，不复用旧attempt', async () => {
  const f = await fixture();
  await f.attempts.reserve(f.input);
  await f.attempts.releaseUnattempted(f.input.attemptId);
  await f.tasks.transition(f.task.id, 'READY');
  const next = {
    ...f.input,
    attemptId: randomUUID(),
    expectedOldSessionId: f.input.session.id,
    session: { ...f.input.session, id: randomUUID() },
  };
  expect((await f.attempts.reserve(next)).attempt.phase).toBe('RESERVED');
  expect((await f.attempts.get(f.input.attemptId))?.phase).toBe('FAILED_KNOWN');
  expect(await f.attempts.markCreateAttempted(f.input.attemptId)).toBeUndefined();
});

it('READY阶段只允许内部精确attempt移交一次，Run和latest指针同事务', async () => {
  const f = await fixture();
  const runs = new RunRepository(database.db);
  await f.attempts.reserve(f.input);
  await f.attempts.markCreateAttempted(f.input.attemptId);
  expect(
    await f.attempts.recordSessionReady(f.input.attemptId, {
      externalSessionId: 'fixture-external',
      startedAt: new Date(),
    }),
  ).toMatchObject({ status: 'READY' });
  const input = {
    id: randomUUID(),
    sessionId: f.input.session.id,
    taskId: f.task.id,
    status: 'QUEUED',
    dispatchState: 'PREPARING' as const,
  };
  await expect(runs.create(input)).rejects.toMatchObject({ code: 'TASK_START_UNRESOLVED' });
  await expect(runs.create(input, { taskStartAttemptId: randomUUID() })).rejects.toMatchObject({
    code: 'TASK_START_UNRESOLVED',
  });
  expect(await runs.list(f.input.session.id)).toEqual([]);
  const admitted = await runs.create(input, { taskStartAttemptId: f.input.attemptId });
  expect(await f.attempts.get(f.input.attemptId)).toMatchObject({
    phase: 'RUN_ADMITTED',
    runId: admitted.id,
  });
  expect((await f.sessions.get(f.input.session.id))?.latestRunId).toBe(admitted.id);
  await expect(
    runs.create({ ...input, id: randomUUID() }, { taskStartAttemptId: f.input.attemptId }),
  ).rejects.toMatchObject({ code: 'TASK_START_UNRESOLVED' });
  expect(await f.attempts.markUnknown(f.input.attemptId, 'LATE_ERROR')).toBeUndefined();
  expect((await f.attempts.get(f.input.attemptId))?.phase).toBe('RUN_ADMITTED');
});

it.each(['RESERVED', 'CREATE_ATTEMPTED', 'SESSION_READY', 'RUN_ADMITTED'] as const)(
  '重启恢复%s不创建Session或Run，重复恢复幂等',
  async (phase) => {
    const f = await fixture();
    await f.attempts.reserve(f.input);
    if (phase !== 'RESERVED') await f.attempts.markCreateAttempted(f.input.attemptId);
    if (['SESSION_READY', 'RUN_ADMITTED'].includes(phase))
      await f.attempts.recordSessionReady(f.input.attemptId, {
        externalSessionId: 'fixture',
        startedAt: new Date(),
      });
    if (phase === 'RUN_ADMITTED')
      await new RunRepository(database.db).create(
        {
          id: randomUUID(),
          sessionId: f.input.session.id,
          taskId: f.task.id,
          status: 'QUEUED',
          dispatchState: 'PREPARING',
        },
        { taskStartAttemptId: f.input.attemptId },
      );
    await f.attempts.recoverAfterRestart();
    const expected =
      phase === 'RESERVED' ? 'FAILED_KNOWN' : phase === 'RUN_ADMITTED' ? 'RUN_ADMITTED' : 'UNKNOWN';
    expect((await f.attempts.get(f.input.attemptId))?.phase).toBe(expected);
    const before = {
      task: await f.tasks.get(f.task.id),
      session: await f.sessions.get(f.input.session.id),
      attempt: await f.attempts.get(f.input.attemptId),
    };
    await f.attempts.recoverAfterRestart();
    expect({
      task: await f.tasks.get(f.task.id),
      session: await f.sessions.get(f.input.session.id),
      attempt: await f.attempts.get(f.input.attemptId),
    }).toEqual(before);
    expect(await new RunRepository(database.db).list(f.input.session.id)).toHaveLength(
      phase === 'RUN_ADMITTED' ? 1 : 0,
    );
    if (expected === 'UNKNOWN')
      expect(
        await f.attempts.recordSessionReady(f.input.attemptId, {
          externalSessionId: 'late',
          startedAt: new Date(),
        }),
      ).toBeUndefined();
  },
);

it('旧或孤立普通Session不能派发，但当前会话继续对话不重启已审阅Task', async () => {
  const f = await fixture('REWORK');
  const runs = new RunRepository(database.db);
  const orphan = await f.sessions.create({ ...f.input.session, id: randomUUID(), status: 'READY' });
  await expect(
    runs.create({ id: randomUUID(), taskId: f.task.id, sessionId: orphan.id, status: 'RUNNING' }),
  ).rejects.toMatchObject({ code: 'TASK_RUN_OWNERSHIP_CHANGED' });
  const run = await runs.create({
    id: randomUUID(),
    taskId: f.task.id,
    sessionId: f.old!.id,
    status: 'COMPLETED',
    dispatchState: 'ATTEMPTED',
  });
  expect((await f.tasks.get(f.task.id))?.status).toBe('WAITING_REVIEW');
  expect((await f.sessions.get(f.old!.id))?.latestRunId).toBe(run.id);
  await expect(f.attempts.reserve(f.input)).rejects.toMatchObject({
    code: 'TASK_START_UNRESOLVED',
  });
});

it('未决预留不能通过手工状态或Worktree入队绕过', async () => {
  const f = await fixture();
  await f.attempts.reserve(f.input);
  await expect(
    f.tasks.transition(f.task.id, 'BLOCKED', {}, { guardManualRunState: true }),
  ).rejects.toMatchObject({ code: 'TASK_START_UNRESOLVED' });
  await f.tasks.update(f.task.id, { status: 'READY' });
  await expect(
    new WorktreeExecutionRepository(database.db).enqueue({
      id: randomUUID(),
      taskId: f.task.id,
      projectId,
      agentId,
      assignedAgentId: agentId,
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: `test-${f.task.id}`,
    }),
  ).rejects.toMatchObject({ code: 'TASK_START_UNRESOLVED' });
});

it('Run移交attempt写失败时Run插入和latest指针全部回滚', async () => {
  const f = await fixture();
  await f.attempts.reserve(f.input);
  await f.attempts.markCreateAttempted(f.input.attemptId);
  await f.attempts.recordSessionReady(f.input.attemptId, {
    externalSessionId: 'fixture',
    startedAt: new Date(),
  });
  const functionName = 'reject_handoff_' + randomUUID().replaceAll('-', '');
  await database.db.execute(
    sql.raw(
      `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${f.input.attemptId}' AND NEW.phase = 'RUN_ADMITTED' THEN RAISE EXCEPTION 'injected handoff failure'; END IF; RETURN NEW; END $$`,
    ),
  );
  await database.db.execute(
    sql.raw(
      `CREATE TRIGGER ${functionName} BEFORE UPDATE ON task_start_attempts FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    ),
  );
  const runs = new RunRepository(database.db);
  const input = {
    id: randomUUID(),
    sessionId: f.input.session.id,
    taskId: f.task.id,
    status: 'QUEUED',
    dispatchState: 'PREPARING' as const,
  };
  try {
    await expect(runs.create(input, { taskStartAttemptId: f.input.attemptId })).rejects.toThrow();
    expect(await runs.list(f.input.session.id)).toEqual([]);
    expect((await f.sessions.get(f.input.session.id))?.latestRunId).toBeNull();
    expect((await f.attempts.get(f.input.attemptId))?.phase).toBe('SESSION_READY');
  } finally {
    await database.db.execute(sql.raw(`DROP TRIGGER ${functionName} ON task_start_attempts`));
    await database.db.execute(sql.raw(`DROP FUNCTION ${functionName}()`));
  }
  expect(await runs.create(input, { taskStartAttemptId: f.input.attemptId })).toMatchObject({
    id: input.id,
  });
});

it('RESERVED先关闭仍可确定释放且保持CLOSED，绝不取得创建资格', async () => {
  const f = await fixture();
  await f.attempts.reserve(f.input);
  await f.sessions.transition(f.input.session.id, 'CLOSED');
  expect(await f.attempts.markCreateAttempted(f.input.attemptId)).toBeUndefined();
  expect(await f.attempts.releaseUnattempted(f.input.attemptId)).toMatchObject({
    phase: 'FAILED_KNOWN',
  });
  expect((await f.sessions.get(f.input.session.id))?.status).toBe('CLOSED');
  expect((await f.tasks.get(f.task.id))?.status).toBe('BLOCKED');
});
