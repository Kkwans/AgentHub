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
  if (old) await tasks.update(task.id, { sessionId: old.id });
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
      await new RunRepository(database.db).create({
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
