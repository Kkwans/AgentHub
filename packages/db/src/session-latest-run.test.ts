import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  AgentRepository,
  createPgliteDatabase,
  ExecutionTargetRepository,
  ProjectRepository,
  RunRepository,
  SessionRepository,
  TaskRepository,
  WorktreeExecutionRepository,
  deriveWorktreeMergeOperationId,
} from './index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('同 Session 最新 Run 的持久所有权', () => {
  let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
  let projectId: string;
  let agentId: string;
  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    const target = await new ExecutionTargetRepository(database.db).create({
      id: randomUUID(),
      name: '本地测试',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    projectId = randomUUID();
    agentId = randomUUID();
    await new ProjectRepository(database.db).create({
      id: projectId,
      name: '所有权测试',
      targetId: target.id,
      rootPath: '/tmp/task-ownership',
      realRootPath: '/tmp/task-ownership',
      repoKind: 'NONE',
      status: 'ACTIVE',
    });
    await new AgentRepository(database.db).create({
      id: agentId,
      targetId: target.id,
      name: '测试 Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
  });
  afterAll(async () => {
    await database.close();
  });

  async function fixture() {
    const tasks = new TaskRepository(database.db);
    const sessions = new SessionRepository(database.db);
    const runs = new RunRepository(database.db);
    const task = await tasks.create({
      id: randomUUID(),
      projectId,
      title: '同会话多轮',
      status: 'IN_PROGRESS',
      assignedAgentId: agentId,
    });
    const session = await sessions.create({
      id: randomUUID(),
      projectId,
      agentId,
      taskId: task.id,
      title: '会话',
      cwd: '/tmp/task-ownership',
      status: 'READY',
    });
    await tasks.update(task.id, { sessionId: session.id });
    return { tasks, sessions, runs, task, session };
  }

  it.each([
    'NO_RUN',
    'BUSY_NO_ROW',
    'NEW_COMPLETED',
    'OLD_QUEUED',
    'OLD_DISCONNECTED',
    'OLD_UNKNOWN',
    'OLD_FENCE',
    'KNOWN_OLD_COMPLETED',
  ] as const)('启动失败事务独立核对%s，不用忙碌错误掩盖Run证据', async (mode) => {
    const { tasks, runs, task, session } = await fixture();
    const executions = new WorktreeExecutionRepository(database.db);
    const old =
      mode.startsWith('OLD_') || mode === 'KNOWN_OLD_COMPLETED'
        ? await runs.create({
            id: randomUUID(),
            sessionId: session.id,
            taskId: task.id,
            status:
              mode === 'OLD_QUEUED'
                ? 'QUEUED'
                : mode === 'OLD_DISCONNECTED'
                  ? 'DISCONNECTED'
                  : mode === 'KNOWN_OLD_COMPLETED'
                    ? 'COMPLETED'
                    : 'FAILED',
            dispatchState: mode === 'OLD_UNKNOWN' ? 'LEGACY_UNKNOWN' : 'ATTEMPTED',
            errorCode:
              mode === 'OLD_UNKNOWN'
                ? 'SERVER_RESTARTED'
                : mode === 'OLD_FENCE'
                  ? 'RUN_PREPARATION_RECOVERY_REQUIRED'
                  : null,
          })
        : undefined;
    const execution = await executions.create({
      id: randomUUID(),
      taskId: task.id,
      projectId,
      agentId,
      sessionId: session.id,
      runId: old?.id ?? null,
      status: 'RUNNING',
      worktreePath: `/tmp/managed-${task.id}`,
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: `managed-${task.id}`,
    });
    try {
      const newer =
        mode === 'NEW_COMPLETED'
          ? await runs.create({
              id: randomUUID(),
              sessionId: session.id,
              taskId: task.id,
              status: 'COMPLETED',
            })
          : undefined;
      const blocked = mode === 'NO_RUN' || mode === 'KNOWN_OLD_COMPLETED';
      const result = await executions.failRunStart(
        execution.id,
        { sessionId: session.id, priorRunId: old?.id ?? null },
        {
          code: mode === 'BUSY_NO_ROW' ? 'SESSION_NOT_READY' : 'PROMPT_VARIABLES_MISSING',
          message: '准备未成功',
        },
      );
      expect(result.blocked).toBe(blocked);
      expect((await executions.get(execution.id))?.status).toBe(blocked ? 'BLOCKED' : 'RUNNING');
      expect((await tasks.get(task.id))?.status).toBe(blocked ? 'BLOCKED' : 'IN_PROGRESS');
      if (newer) expect((await executions.get(execution.id))?.runId).toBe(newer.id);
      // Failure-resolution first: admission after the committed terminal guard
      // must fail, just as admission-first cases above retain the owning Run.
      if (blocked)
        await expect(
          runs.create({
            id: randomUUID(),
            sessionId: session.id,
            taskId: task.id,
            status: 'RUNNING',
          }),
        ).rejects.toMatchObject({ code: 'WORKTREE_RUN_ADMISSION_REJECTED' });
    } finally {
      await executions.patch(execution.id, { status: 'CANCELED' });
    }
  });

  it.each([
    'QUEUED',
    'SETTING_UP',
    'AWAITING_INPUT',
    'REVIEW',
    'MERGING',
    'BLOCKED',
    'DONE',
    'CANCELED',
  ] as const)('Worktree %s 阶段拒绝直接会话Run且不改变latestRun', async (phase) => {
    const { tasks, sessions, runs, task, session } = await fixture();
    const first = await runs.create({
      id: randomUUID(),
      sessionId: session.id,
      taskId: task.id,
      status: 'COMPLETED',
    });
    await tasks.update(task.id, {
      status: ['QUEUED', 'SETTING_UP', 'AWAITING_INPUT'].includes(phase)
        ? 'IN_PROGRESS'
        : 'WAITING_REVIEW',
      finalRunId: first.id,
    });
    const executions = new WorktreeExecutionRepository(database.db);
    const execution = await executions.create({
      id: randomUUID(),
      taskId: task.id,
      projectId,
      agentId,
      sessionId: session.id,
      runId: first.id,
      status: phase === 'MERGING' ? 'REVIEW' : phase,
      worktreePath: `/tmp/managed-${task.id}`,
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: `managed-${task.id}`,
    });
    if (phase === 'MERGING')
      await executions.claimReviewForMerge(execution.id, {
        sessionId: session.id,
        runId: first.id,
        expectedOperationId: deriveWorktreeMergeOperationId(execution.id, first.id),
      });
    const beforeTask = await tasks.get(task.id);
    const beforeSession = await sessions.get(session.id);
    const beforeExecution = await executions.get(execution.id);
    try {
      await expect(
        runs.create({
          id: randomUUID(),
          sessionId: session.id,
          taskId: task.id,
          status: 'RUNNING',
        }),
      ).rejects.toMatchObject({ code: 'WORKTREE_RUN_ADMISSION_REJECTED' });
      expect(await runs.list(session.id)).toEqual([first]);
      expect(await sessions.get(session.id)).toEqual(beforeSession);
      expect(await tasks.get(task.id)).toEqual(beforeTask);
      expect(await executions.get(execution.id)).toEqual(beforeExecution);
    } finally {
      await executions.patch(execution.id, { status: 'CANCELED' });
    }
  });

  it('Worktree RUNNING 拒绝孤立Session，而原归属Session仍可启动', async () => {
    const { tasks, sessions, runs, task, session } = await fixture();
    const orphan = await sessions.create({
      id: randomUUID(),
      projectId,
      agentId,
      taskId: task.id,
      title: 'orphan',
      cwd: '/tmp/orphan',
      status: 'READY',
    });
    const executions = new WorktreeExecutionRepository(database.db);
    // A historical terminal record must not shadow the current managed owner.
    await executions.create({
      id: randomUUID(),
      taskId: task.id,
      projectId,
      agentId,
      status: 'CANCELED',
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: `history-${task.id}`,
    });
    const execution = await executions.create({
      id: randomUUID(),
      taskId: task.id,
      projectId,
      agentId,
      sessionId: session.id,
      status: 'RUNNING',
      worktreePath: `/tmp/managed-${task.id}`,
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: `managed-${task.id}`,
    });
    try {
      await expect(
        runs.create({ id: randomUUID(), sessionId: orphan.id, taskId: task.id, status: 'RUNNING' }),
      ).rejects.toMatchObject({ code: 'WORKTREE_RUN_ADMISSION_REJECTED' });
      expect((await sessions.get(orphan.id))?.latestRunId).toBeNull();
      expect(await runs.list(orphan.id)).toEqual([]);
      const results = await Promise.allSettled(
        [runs, new RunRepository(database.db)].map((repository) =>
          repository.create({
            id: randomUUID(),
            sessionId: session.id,
            taskId: task.id,
            status: 'RUNNING',
          }),
        ),
      );
      const winner = results.find((result) => result.status === 'fulfilled');
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: { code: 'WORKTREE_RUN_ADMISSION_REJECTED' },
      });
      if (!winner || winner.status !== 'fulfilled') throw new Error('Missing admission winner');
      const accepted = winner.value;
      expect((await sessions.get(session.id))?.latestRunId).toBe(accepted.id);
      expect((await tasks.get(task.id))?.sessionId).toBe(session.id);
      expect(await runs.list(session.id)).toEqual([accepted]);
    } finally {
      await executions.patch(execution.id, { status: 'CANCELED' });
    }
  });

  it.each(['MISSING', 'WRONG'] as const)(
    'Session的Task归属%s但仍绑定Worktree时拒绝Run',
    async (kind) => {
      const { tasks, sessions, runs, task, session } = await fixture();
      const executions = new WorktreeExecutionRepository(database.db);
      const execution = await executions.create({
        id: randomUUID(),
        taskId: task.id,
        projectId,
        agentId,
        sessionId: session.id,
        status: 'RUNNING',
        baseBranch: 'main',
        baseSha: 'a'.repeat(40),
        taskBranch: `lost-${task.id}`,
      });
      const otherTask =
        kind === 'WRONG'
          ? await tasks.create({
              id: randomUUID(),
              projectId,
              title: '错误归属',
              status: 'IN_PROGRESS',
              sessionId: session.id,
              assignedAgentId: agentId,
            })
          : undefined;
      // Explicit persisted-corruption fixture: no legitimate endpoint rebinds this owner.
      await sessions.transition(session.id, 'CLOSED', { taskId: otherTask?.id ?? null });
      const before = await sessions.get(session.id);
      try {
        await expect(
          runs.create({
            id: randomUUID(),
            sessionId: session.id,
            taskId: otherTask?.id,
            status: 'RUNNING',
          }),
        ).rejects.toMatchObject({ code: 'WORKTREE_RUN_ADMISSION_REJECTED' });
        expect(await runs.list(session.id)).toEqual([]);
        expect(await sessions.get(session.id)).toEqual(before);
      } finally {
        await executions.patch(execution.id, { status: 'CANCELED' });
      }
    },
  );

  it.each(['CANCELING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED', 'DISCONNECTED'] as const)(
    'AH061取消失败只收敛当前CANCELING，不重写%s权威状态',
    async (status) => {
      const { sessions, runs, task, session } = await fixture();
      const run = await runs.create({
        id: randomUUID(),
        sessionId: session.id,
        taskId: task.id,
        status,
      });
      const result = await runs.convergeCancellationFailure(
        session.id,
        run.id,
        'AGENT_RUN_CANCEL_FAILED',
        '取消未知',
      );
      expect(result.eligible).toBe(status === 'CANCELING');
      expect(result.changed).toBe(status === 'CANCELING');
      expect((await runs.get(run.id))?.status).toBe(
        status === 'CANCELING' ? 'DISCONNECTED' : status,
      );
      expect((await sessions.get(session.id))?.status).toBe(
        status === 'CANCELING' ? 'DISCONNECTED' : 'READY',
      );
    },
  );

  it.each(['NEW_RUN', 'CLOSED', 'WRONG_SESSION'] as const)(
    'AH061取消失败遇到%s不修改Run或Session',
    async (mode) => {
      const { sessions, runs, task, session } = await fixture();
      const run = await runs.create({
        id: randomUUID(),
        sessionId: session.id,
        taskId: task.id,
        status: 'CANCELING',
      });
      if (mode === 'NEW_RUN')
        await runs.create({
          id: randomUUID(),
          sessionId: session.id,
          taskId: task.id,
          status: 'RUNNING',
        });
      if (mode === 'CLOSED') await sessions.transition(session.id, 'CLOSED');
      const before = await sessions.get(session.id);
      const result = await runs.convergeCancellationFailure(
        mode === 'WRONG_SESSION' ? randomUUID() : session.id,
        run.id,
        'CANCEL_CONFIRMATION_TIMEOUT',
        '取消超时',
      );
      expect(result.eligible).toBe(false);
      expect((await runs.get(run.id))?.status).toBe('CANCELING');
      expect(await sessions.get(session.id)).toEqual(before);
    },
  );

  it.each(['OMITTED', 'OTHER'] as const)('Run不能通过%s任务归属绕过Session绑定', async (mode) => {
    const { runs, sessions, tasks, task, session } = await fixture();
    await tasks.transition(task.id, 'CANCELED');
    const other = await tasks.create({
      id: randomUUID(),
      projectId,
      title: '其他任务',
      status: 'READY',
    });
    await expect(
      runs.create({
        id: randomUUID(),
        sessionId: session.id,
        status: 'QUEUED',
        ...(mode === 'OTHER' ? { taskId: other.id } : {}),
      }),
    ).rejects.toMatchObject({ code: 'RUN_TASK_MISMATCH' });
    expect(await runs.list(session.id)).toHaveLength(0);
    expect((await sessions.get(session.id))?.latestRunId).toBeNull();
  });
  it.each(['COMPLETED', 'FAILED', 'CANCELED', 'DISCONNECTED'] as const)(
    'R2先提交：R1 %s不得覆盖当前任务，即使Run时间戳相同',
    async (status) => {
      const { tasks, sessions, runs, task, session } = await fixture();
      const startedAt = new Date('2026-11-12T00:00:00Z');
      const old = await runs.create({
        id: randomUUID(),
        sessionId: session.id,
        taskId: task.id,
        status,
        startedAt,
      });
      const latest = await runs.create({
        id: randomUUID(),
        sessionId: session.id,
        taskId: task.id,
        status: 'RUNNING',
        startedAt,
      });
      const before = await tasks.get(task.id);
      expect(
        await tasks.tryApplyRunOutcome(
          task.id,
          old.id,
          status === 'COMPLETED' ? 'COMPLETED' : 'STOPPED',
        ),
      ).toBe(false);
      expect(await tasks.get(task.id)).toEqual(before);
      expect((await sessions.get(session.id))?.latestRunId).toBe(latest.id);
      await runs.transition(latest.id, 'COMPLETED');
      expect(await tasks.tryApplyRunOutcome(task.id, latest.id, 'COMPLETED')).toBe(true);
      expect((await tasks.get(task.id))?.finalRunId).toBe(latest.id);
    },
  );
  it('R1先提交：R2不隐式重启已待审阅Task，也不能替换已确认结果', async () => {
    const { tasks, sessions, runs, task, session } = await fixture();
    const old = await runs.create({
      id: randomUUID(),
      sessionId: session.id,
      taskId: task.id,
      status: 'COMPLETED',
    });
    expect(await tasks.tryApplyRunOutcome(task.id, old.id, 'COMPLETED')).toBe(true);
    const before = await tasks.get(task.id);
    const latest = await runs.create({
      id: randomUUID(),
      sessionId: session.id,
      taskId: task.id,
      status: 'COMPLETED',
    });
    expect((await sessions.get(session.id))?.latestRunId).toBe(latest.id);
    expect(await tasks.get(task.id)).toEqual(before);
    expect(await tasks.tryApplyRunOutcome(task.id, latest.id, 'COMPLETED')).toBe(false);
    expect((await tasks.get(task.id))?.finalRunId).toBe(old.id);
  });
  it('Run插入失败整笔回滚，不改变最新所有权', async () => {
    const { runs, sessions, task, session } = await fixture();
    const old = await runs.create({
      id: randomUUID(),
      sessionId: session.id,
      taskId: task.id,
      status: 'RUNNING',
    });
    await expect(
      runs.create({ id: old.id, sessionId: session.id, taskId: task.id, status: 'QUEUED' }),
    ).rejects.toThrow();
    expect((await sessions.get(session.id))?.latestRunId).toBe(old.id);
    expect(await runs.list(session.id)).toHaveLength(1);
  });
  it('无Task独立会话也原子记录最新Run，不触碰其他Task', async () => {
    const { tasks, sessions, runs, task } = await fixture();
    const session = await sessions.create({
      id: randomUUID(),
      projectId,
      agentId,
      title: '独立会话',
      cwd: '/tmp/task-ownership',
      status: 'READY',
    });
    const before = await tasks.get(task.id);
    const run = await runs.create({ id: randomUUID(), sessionId: session.id, status: 'RUNNING' });
    expect((await sessions.get(session.id))?.latestRunId).toBe(run.id);
    expect(await tasks.get(task.id)).toEqual(before);
  });
  it('指针更新失败时已插入Run也回滚', async () => {
    const { runs, sessions, task, session } = await fixture();
    const old = await runs.create({
      id: randomUUID(),
      sessionId: session.id,
      taskId: task.id,
      status: 'COMPLETED',
    });
    await database.db
      .execute(sql`create function reject_latest_run() returns trigger language plpgsql
      as $$ begin raise exception 'test pointer failure'; end; $$`);
    await database.db.execute(sql`create trigger reject_latest_run before update of latest_run_id
      on agent_sessions for each row execute function reject_latest_run()`);
    const nextId = randomUUID();
    try {
      await expect(
        runs.create({ id: nextId, sessionId: session.id, taskId: task.id, status: 'QUEUED' }),
      ).rejects.toThrow();
      expect(await runs.get(nextId)).toBeUndefined();
      expect((await sessions.get(session.id))?.latestRunId).toBe(old.id);
    } finally {
      await database.db.execute(sql`drop trigger reject_latest_run on agent_sessions`);
      await database.db.execute(sql`drop function reject_latest_run()`);
    }
  });
  it.each(['RUN_FIRST', 'CALLBACK_FIRST'] as const)(
    '同时发起的PGlite事务按提交顺序线性化：%s',
    async (order) => {
      const { tasks, runs, sessions, task, session } = await fixture();
      const old = await runs.create({
        id: randomUUID(),
        sessionId: session.id,
        taskId: task.id,
        status: 'COMPLETED',
      });
      const input = { id: randomUUID(), sessionId: session.id, taskId: task.id, status: 'RUNNING' };
      const create = () => runs.create(input);
      const outcome = () => tasks.tryApplyRunOutcome(task.id, old.id, 'COMPLETED');
      const results =
        order === 'RUN_FIRST'
          ? await Promise.all([create(), outcome()])
          : await Promise.all([outcome(), create()]);
      const applied = order === 'RUN_FIRST' ? results[1] : results[0];
      expect(applied).toBe(order === 'CALLBACK_FIRST');
      expect((await sessions.get(session.id))?.latestRunId).toBe(input.id);
      expect((await tasks.get(task.id))?.status).toBe(
        order === 'CALLBACK_FIRST' ? 'WAITING_REVIEW' : 'IN_PROGRESS',
      );
    },
  );
});
