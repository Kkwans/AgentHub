import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createPgliteDatabase,
  AgentRepository,
  ApprovalRepository,
  EventRepository,
  ExecutionTargetRepository,
  GoalRepository,
  SessionContinuationRepository,
  MessageRepository,
  ProjectRepository,
  RunRepository,
  SessionRepository,
  TaskRepository,
  WorktreeExecutionRepository,
  worktreeExecutions,
} from '@agenthub/db';
import { FakeAgentAdapter } from '@agenthub/agent-core';
import { AgentService } from './agents/agent-service.js';
import { SessionService } from './sessions/session-service.js';
import { TaskService } from './tasks/task-service.js';
import { WorktreeTaskService } from './worktrees/worktree-task-service.js';
import { recoverRuntimeAfterRestart } from './startup-recovery.js';

afterEach(() => vi.restoreAllMocks());
function services(database: Awaited<ReturnType<typeof createPgliteDatabase>>) {
  const db = database.db;
  const agents = new AgentRepository(db),
    targets = new ExecutionTargetRepository(db);
  const projects = new ProjectRepository(db),
    runs = new RunRepository(db),
    tasks = new TaskRepository(db);
  const sessions = new SessionService(
    new SessionRepository(db),
    runs,
    new MessageRepository(db),
    new EventRepository(db),
    new ApprovalRepository(db),
    projects,
    new AgentService(
      agents,
      targets,
      {
        launch: async () => {
          throw new Error('no real process');
        },
      },
      () => new FakeAgentAdapter({ scenario: 'idle' }),
    ),
    { publish: () => undefined },
    { readHead: async () => undefined },
    undefined,
    {},
    new SessionContinuationRepository(db),
  );
  const taskService = new TaskService(new GoalRepository(db), tasks, projects, sessions);
  const unexpected = async (): Promise<never> => {
    throw new Error('startup must not execute Git/runtime');
  };
  const worktrees = new WorktreeTaskService(
    new WorktreeExecutionRepository(db),
    tasks,
    projects,
    agents,
    targets,
    sessions,
    {
      inspectBase: unexpected,
      taskBranch: () => 'unused',
      create: unexpected,
      review: unexpected,
      commitAndMerge: unexpected,
    },
    { publish: () => undefined },
  );
  sessions.setTaskLifecycleObserver({
    onRunCompleted: async (taskId, runId) => {
      if (!(await worktrees.onRunCompleted(taskId, runId)))
        await taskService.onRunCompleted(taskId, runId);
    },
    onRunStopped: async (taskId, runId, reason) => {
      if (!(await worktrees.onRunStopped(taskId, runId, reason)))
        await taskService.onRunStopped(taskId, runId);
    },
  });
  return { sessions, worktrees, tasks: taskService, runs };
}
async function seed(
  database: Awaited<ReturnType<typeof createPgliteDatabase>>,
  dispatchState: 'PREPARING' | 'ATTEMPTED' | 'LEGACY_UNKNOWN',
  status: string,
  worktree = false,
) {
  const db = database.db;
  const target = await new ExecutionTargetRepository(db).create({
    id: randomUUID(),
    name: 'test',
    kind: 'LOCAL_HOST',
    hostname: 'test',
    os: 'linux',
    arch: 'arm64',
    status: 'READY',
  });
  const project = await new ProjectRepository(db).create({
    id: randomUUID(),
    name: '恢复项目',
    targetId: target.id,
    rootPath: '/tmp',
    realRootPath: '/tmp',
    repoKind: 'NONE',
    status: 'ACTIVE',
  });
  const agent = await new AgentRepository(db).create({
    id: randomUUID(),
    targetId: target.id,
    name: 'test',
    agentKind: 'CUSTOM_ACP',
    adapterKind: 'ACP_STDIO',
    executable: '/bin/false',
    status: 'READY',
  });
  const task = await new TaskRepository(db).create({
    id: randomUUID(),
    projectId: project.id,
    title: '保留正文',
    description: '不可自动重放😀',
    status: 'IN_PROGRESS',
    assignedAgentId: agent.id,
  });
  const session = await new SessionRepository(db).create({
    id: randomUUID(),
    projectId: project.id,
    agentId: agent.id,
    taskId: task.id,
    title: '原会话',
    cwd: '/tmp',
    status: 'RUNNING',
    externalSessionId: 'test-external',
  });
  await new TaskRepository(db).update(task.id, { sessionId: session.id });
  const run = await new RunRepository(db).create({
    id: randomUUID(),
    sessionId: session.id,
    taskId: task.id,
    status,
    dispatchState,
  });
  await new MessageRepository(db).append({
    sessionId: session.id,
    runId: run.id,
    role: 'USER',
    kind: 'TEXT',
    text: '不可自动重放😀',
    contentJson: {},
  });
  const executionId = randomUUID();
  if (worktree)
    await db.insert(worktreeExecutions).values({
      id: executionId,
      taskId: task.id,
      projectId: project.id,
      agentId: agent.id,
      status: 'RUNNING',
      sessionId: session.id,
      runId: run.id,
      baseBranch: 'main',
      baseSha: 'before',
      taskBranch: executionId,
    });
  return { task, session, run, project, executionId };
}
it.each([
  ['PREPARING', 'QUEUED', 'FAILED', 'BLOCKED'],
  ['PREPARING', 'RUNNING', 'FAILED', 'BLOCKED'],
  ['ATTEMPTED', 'RUNNING', 'DISCONNECTED', 'IN_PROGRESS'],
  ['LEGACY_UNKNOWN', 'QUEUED', 'DISCONNECTED', 'IN_PROGRESS'],
  ['ATTEMPTED', 'COMPLETED', 'COMPLETED', 'WAITING_REVIEW'],
] as const)(
  '真实关闭重开 %s/%s：恢复分类与Task幂等，绝不派发',
  async (phase, initial, final, taskStatus) => {
    const temp = await mkdtemp(join(tmpdir(), 'agenthub-dispatch-restart-'));
    let database = await createPgliteDatabase({ dataDir: join(temp, 'db') });
    try {
      const row = await seed(database, phase, initial);
      await database.close();
      database = await createPgliteDatabase({ dataDir: join(temp, 'db') });
      const runtime = services(database);
      const start = vi.spyOn(runtime.sessions, 'startRun');
      const reconnect = vi.spyOn(runtime.sessions, 'resume');
      await recoverRuntimeAfterRestart(runtime);
      const task = await new TaskRepository(database.db).get(row.task.id);
      expect(task).toMatchObject({ status: taskStatus, description: '不可自动重放😀' });
      expect((await runtime.runs.get(row.run.id))?.status).toBe(final);
      expect(Boolean(await runtime.runs.findBlockingForSession(row.session.id))).toBe(
        final === 'DISCONNECTED',
      );
      expect(await new MessageRepository(database.db).list(row.session.id)).toHaveLength(1);
      await recoverRuntimeAfterRestart(runtime);
      expect(await new TaskRepository(database.db).get(row.task.id)).toEqual(task);
      expect(start).not.toHaveBeenCalled();
      expect(reconnect).not.toHaveBeenCalled();
      if (final === 'DISCONNECTED') {
        await expect(
          runtime.sessions.startRun(row.session.id, { text: '不应派发' }),
        ).rejects.toMatchObject({ code: 'SESSION_RUN_UNRESOLVED' });
        await expect(runtime.sessions.cancelRun(row.session.id, row.run.id)).rejects.toMatchObject({
          code: 'RUN_DISPATCH_UNRESOLVED',
        });
        await runtime.sessions.close(row.session.id);
        await expect(runtime.sessions.continue(row.session.id)).rejects.toMatchObject({
          code: 'SESSION_RUN_UNRESOLVED',
        });
      }
    } finally {
      await database.close();
      await rm(temp, { recursive: true, force: true });
    }
  },
);

it.each(['PREPARING', 'ATTEMPTED'] as const)(
  'Worktree %s启动恢复不错误放行未知槽位',
  async (phase) => {
    const database = await createPgliteDatabase({ dataDir: 'memory://' });
    try {
      const row = await seed(database, phase, 'RUNNING', true);
      const runtime = services(database);
      const tasks = new TaskRepository(database.db),
        executions = new WorktreeExecutionRepository(database.db);
      const next = await tasks.create({
        id: randomUUID(),
        projectId: row.project.id,
        title: '下一项',
        status: 'READY',
      });
      await executions.enqueue({
        id: randomUUID(),
        taskId: next.id,
        projectId: row.project.id,
        agentId: row.session.agentId,
        assignedAgentId: row.session.agentId,
        baseBranch: 'main',
        baseSha: 'before',
        taskBranch: randomUUID(),
      });
      await recoverRuntimeAfterRestart(runtime);
      expect((await executions.get(row.executionId))?.status).toBe(
        phase === 'PREPARING' ? 'BLOCKED' : 'RUNNING',
      );
      expect((await tasks.get(row.task.id))?.status).toBe(
        phase === 'PREPARING' ? 'BLOCKED' : 'IN_PROGRESS',
      );
      if (phase === 'ATTEMPTED') {
        expect(await executions.claimNext(row.project.id)).toBeUndefined();
        expect((await executions.get(row.executionId))?.errorCode).toBe(
          'WORKTREE_RECOVERY_UNRESOLVED',
        );
        await recoverRuntimeAfterRestart(runtime);
        expect(await executions.claimNext(row.project.id)).toBeUndefined();
      } else expect(await executions.claimNext(row.project.id)).toBeDefined();
    } finally {
      await database.close();
    }
  },
);

it('恢复持久化失败阻止启动，下一次从已持久化终态继续修复', async () => {
  const database = await createPgliteDatabase({ dataDir: 'memory://' });
  try {
    const row = await seed(database, 'PREPARING', 'QUEUED');
    const runtime = services(database),
      listen = vi.fn();
    await database.db.execute(
      "create function reject_task_recovery() returns trigger language plpgsql as $$ begin raise exception 'recovery write denied'; end; $$",
    );
    await database.db.execute(
      'create trigger reject_task_recovery before update on tasks for each row execute function reject_task_recovery()',
    );
    await expect(
      (async () => {
        await recoverRuntimeAfterRestart(runtime);
        listen();
      })(),
    ).rejects.toThrow();
    expect(listen).not.toHaveBeenCalled();
    expect((await runtime.runs.get(row.run.id))?.status).toBe('FAILED');
    expect((await runtime.runs.findBlockingForSession(row.session.id))?.id).toBe(row.run.id);
    await database.db.execute('drop trigger reject_task_recovery on tasks');
    await database.db.execute('drop function reject_task_recovery()');
    await recoverRuntimeAfterRestart(runtime);
    expect((await new TaskRepository(database.db).get(row.task.id))?.status).toBe('BLOCKED');
    expect(await runtime.runs.findBlockingForSession(row.session.id)).toBeUndefined();
  } finally {
    await database.close();
  }
});

it.each([
  'CANCEL_CONFIRMATION_TIMEOUT',
  'AGENT_RUN_CANCEL_FAILED',
  'AGENT_RUN_START_FAILED',
  'SERVER_RESTARTED',
])('历史synthetic终态%s不被当作权威停止，也不通过迁移改写', async (code) => {
  const database = await createPgliteDatabase({ dataDir: 'memory://' });
  try {
    const row = await seed(
      database,
      'LEGACY_UNKNOWN',
      code === 'CANCEL_CONFIRMATION_TIMEOUT' ? 'CANCELED' : 'FAILED',
      true,
    );
    const runtime = services(database);
    await runtime.runs.patch(row.run.id, { errorCode: code });
    const before = await runtime.runs.get(row.run.id);
    await recoverRuntimeAfterRestart(runtime);
    expect(await runtime.runs.get(row.run.id)).toEqual(before);
    await expect(runtime.sessions.cancelRun(row.session.id, row.run.id)).rejects.toMatchObject({
      code: 'RUN_DISPATCH_UNRESOLVED',
    });
    expect((await runtime.runs.findBlockingForSession(row.session.id))?.id).toBe(row.run.id);
    expect((await new TaskRepository(database.db).get(row.task.id))?.status).toBe('IN_PROGRESS');
    expect((await new WorktreeExecutionRepository(database.db).get(row.executionId))?.status).toBe(
      'RUNNING',
    );
  } finally {
    await database.close();
  }
});

it('新ATTEMPTED真实终态即使保留旧诊断码也不被永久封锁', async () => {
  const database = await createPgliteDatabase({ dataDir: 'memory://' });
  try {
    const row = await seed(database, 'ATTEMPTED', 'CANCELED');
    const runtime = services(database);
    await runtime.runs.patch(row.run.id, { errorCode: 'CANCEL_CONFIRMATION_TIMEOUT' });
    await recoverRuntimeAfterRestart(runtime);
    expect(await runtime.runs.findBlockingForSession(row.session.id)).toBeUndefined();
    expect((await new TaskRepository(database.db).get(row.task.id))?.status).toBe('BLOCKED');
  } finally {
    await database.close();
  }
});

it('中断的合并不因上一Run已完成而恢复为可审核', async () => {
  const database = await createPgliteDatabase({ dataDir: 'memory://' });
  try {
    const row = await seed(database, 'ATTEMPTED', 'COMPLETED', true);
    await new TaskRepository(database.db).transition(row.task.id, 'WAITING_REVIEW');
    await new WorktreeExecutionRepository(database.db).patch(row.executionId, {
      status: 'MERGING',
    });
    const runtime = services(database);
    await recoverRuntimeAfterRestart(runtime);
    expect(await new WorktreeExecutionRepository(database.db).get(row.executionId)).toMatchObject({
      status: 'BLOCKED',
      errorCode: 'WORKTREE_MERGE_UNRESOLVED',
      errorMessage: expect.stringContaining('合并结果未确认'),
    });
    expect((await new TaskRepository(database.db).get(row.task.id))?.status).toBe('BLOCKED');
    await recoverRuntimeAfterRestart(runtime);
    expect((await new WorktreeExecutionRepository(database.db).get(row.executionId))?.status).toBe(
      'BLOCKED',
    );
  } finally {
    await database.close();
  }
});

it('在线断连保留Worktree槽位，过期Run回调不能释放当前执行', async () => {
  const database = await createPgliteDatabase({ dataDir: 'memory://' });
  try {
    const row = await seed(database, 'ATTEMPTED', 'DISCONNECTED', true);
    const runtime = services(database);
    const executions = new WorktreeExecutionRepository(database.db);
    expect(await runtime.worktrees.onRunStopped(row.task.id, row.run.id, 'DISCONNECTED')).toBe(
      true,
    );
    expect((await executions.get(row.executionId))?.status).toBe('RUNNING');
    expect((await new TaskRepository(database.db).get(row.task.id))?.status).toBe('IN_PROGRESS');
    const current = await runtime.runs.create({
      id: randomUUID(),
      taskId: row.task.id,
      sessionId: row.session.id,
      status: 'RUNNING',
      dispatchState: 'ATTEMPTED',
    });
    await runtime.runs.patch(row.run.id, { status: 'COMPLETED' });
    expect(await runtime.worktrees.onRunCompleted(row.task.id, row.run.id)).toBe(false);
    expect((await executions.get(row.executionId))?.status).toBe('RUNNING');
    await runtime.runs.patch(current.id, { status: 'COMPLETED' });
    expect(await runtime.worktrees.onRunCompleted(row.task.id, current.id)).toBe(true);
    expect((await executions.get(row.executionId))?.status).toBe('REVIEW');
  } finally {
    await database.close();
  }
});

it.each(['SETTING_UP', 'MERGING_AGENT', 'MERGING_SESSION'] as const)(
  '旧Execution归属错配%s只隔离，不覆盖当前Task',
  async (mode) => {
    const database = await createPgliteDatabase({ dataDir: 'memory://' });
    try {
      const row = await seed(database, 'ATTEMPTED', 'COMPLETED', true);
      const tasks = new TaskRepository(database.db);
      const executions = new WorktreeExecutionRepository(database.db);
      if (mode === 'SETTING_UP') {
        await executions.patch(row.executionId, {
          status: 'SETTING_UP',
          sessionId: null,
          runId: null,
        });
      } else {
        await tasks.transition(row.task.id, 'WAITING_REVIEW');
        await executions.patch(row.executionId, { status: 'MERGING' });
        if (mode === 'MERGING_AGENT') await tasks.update(row.task.id, { assignedAgentId: null });
        else await tasks.update(row.task.id, { sessionId: null });
      }
      const before = await tasks.get(row.task.id);
      await recoverRuntimeAfterRestart(services(database));
      expect(await tasks.get(row.task.id)).toEqual(before);
      expect(await executions.get(row.executionId)).toMatchObject({
        status: mode === 'SETTING_UP' ? 'SETTING_UP' : 'MERGING',
        errorCode: 'WORKTREE_RECOVERY_UNRESOLVED',
      });
    } finally {
      await database.close();
    }
  },
);
