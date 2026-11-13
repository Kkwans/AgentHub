import { randomUUID } from 'node:crypto';

import {
  AgentRepository,
  createPgliteDatabase,
  ExecutionTargetRepository,
  GoalRepository,
  ProjectRepository,
  TaskRepository,
  SessionRepository,
  RunRepository,
  WorktreeExecutionRepository,
} from '@agenthub/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CreateSessionInput, StartRunInput } from '../sessions/session-service.js';
import { TaskService, type TaskSessionController } from './task-service.js';

describe('Goal 与 Task service', () => {
  let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
  let service: TaskService;
  let projectId: string;
  let agentId: string;
  const createdSessions: CreateSessionInput[] = [];
  const startedRuns: Array<StartRunInput & { sessionId: string }> = [];

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    const targets = new ExecutionTargetRepository(database.db);
    const projects = new ProjectRepository(database.db);
    const agents = new AgentRepository(database.db);
    const targetId = randomUUID();
    projectId = randomUUID();
    agentId = randomUUID();
    await targets.create({
      id: targetId,
      name: '本地测试',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    await projects.create({
      id: projectId,
      name: 'Task 测试',
      targetId,
      rootPath: '/tmp/agenthub-task',
      realRootPath: '/tmp/agenthub-task',
      repoKind: 'NONE',
      status: 'ACTIVE',
    });
    await agents.create({
      id: agentId,
      targetId,
      name: 'Fake Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    const fakeSessions: TaskSessionController = {
      create: async (input) => {
        createdSessions.push(input);
        return new SessionRepository(database.db).create({
          id: randomUUID(),
          projectId: input.projectId,
          agentId: input.agentId,
          taskId: input.taskId,
          title: input.title ?? '测试',
          cwd: input.cwd,
          status: 'READY',
        });
      },
      startRun: async (sessionId, input) => {
        startedRuns.push({ sessionId, ...input });
        const session = await new SessionRepository(database.db).get(sessionId);
        return new RunRepository(database.db).create({
          id: randomUUID(),
          sessionId,
          taskId: session!.taskId,
          status: 'RUNNING',
        });
      },
    };
    service = new TaskService(
      new GoalRepository(database.db),
      new TaskRepository(database.db),
      projects,
      fakeSessions,
    );
  });

  afterAll(async () => database.close());

  it.each([
    'QUEUED',
    'SETTING_UP',
    'RUNNING',
    'AWAITING_INPUT',
    'REVIEW',
    'MERGING',
    'DONE',
    'BLOCKED',
    'CANCELED',
  ])('Worktree %s 所有权阻止普通审批、返工、启动与手工状态修改', async (executionStatus) => {
    const taskRepository = new TaskRepository(database.db);
    const task = await taskRepository.create({
      id: randomUUID(),
      projectId,
      title: '隔离任务禁止普通入口',
      status: 'WAITING_REVIEW',
      assignedAgentId: agentId,
    });
    const executionRepository = new WorktreeExecutionRepository(database.db);
    const execution = await executionRepository.create({
      id: randomUUID(),
      taskId: task.id,
      projectId,
      agentId,
      status: executionStatus,
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: `managed-${task.id}`,
    });
    const beforeSessions = createdSessions.length;
    const beforeRuns = startedRuns.length;
    try {
      for (const action of [
        () => service.reviewTask(task.id, { decision: 'APPROVE' }),
        () => service.reviewTask(task.id, { decision: 'REWORK', feedback: '不能从根目录返工' }),
        () => service.transitionTask(task.id, 'DONE'),
        () => service.transitionTask(task.id, 'CANCELED'),
        () => service.startTask(task.id, { agentId }),
      ]) {
        await expect(action()).rejects.toMatchObject({
          status: 409,
          code: 'TASK_WORKTREE_MANAGED',
        });
        expect(await taskRepository.get(task.id)).toEqual(task);
        expect(await executionRepository.get(execution.id)).toEqual(execution);
        expect(createdSessions).toHaveLength(beforeSessions);
        expect(startedRuns).toHaveLength(beforeRuns);
      }
    } finally {
      // These parametrized records share a project, so release the active unique slot.
      await executionRepository.patch(execution.id, { status: 'CANCELED' });
    }
  });

  it('Worktree 入队赢得竞争后，普通手工变更的事务再次核对所有权', async () => {
    const repository = new TaskRepository(database.db);
    const controlled = new TaskService(
      new GoalRepository(database.db),
      repository,
      new ProjectRepository(database.db),
      {
        create: async () => {
          throw new Error('不应创建 Session');
        },
        startRun: async () => {
          throw new Error('不应创建 Run');
        },
      },
    );
    const task = await repository.create({
      id: randomUUID(),
      projectId,
      title: '旧状态竞争',
      status: 'READY',
    });
    const executionRepository = new WorktreeExecutionRepository(database.db);
    const transition = repository.transition.bind(repository);
    const paused = vi.spyOn(repository, 'transition').mockImplementationOnce(async (...args) => {
      await executionRepository.enqueue({
        id: randomUUID(),
        taskId: task.id,
        projectId,
        agentId,
        assignedAgentId: agentId,
        baseBranch: 'main',
        baseSha: 'a'.repeat(40),
        taskBranch: `race-${task.id}`,
      });
      return transition(...args);
    });
    try {
      await expect(controlled.transitionTask(task.id, 'CANCELED')).rejects.toMatchObject({
        status: 409,
        code: 'TASK_WORKTREE_MANAGED',
      });
      expect((await repository.get(task.id))?.status).toBe('IN_PROGRESS');
      expect((await executionRepository.list({ taskId: task.id }))[0]?.status).toBe('QUEUED');
    } finally {
      paused.mockRestore();
    }
  });

  it('AH041：手工任务仍需BACKLOG→READY→IN_PROGRESS，不放宽状态机或创建Session', async () => {
    const task = await service.createTask({ projectId, title: '手工任务' });
    const beforeSessions = createdSessions.length;
    const beforeRuns = startedRuns.length;
    await expect(service.transitionTask(task.id, 'IN_PROGRESS')).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
    expect((await service.getTask(task.id)).status).toBe('BACKLOG');
    await service.transitionTask(task.id, 'READY');
    expect((await service.transitionTask(task.id, 'IN_PROGRESS')).status).toBe('IN_PROGRESS');
    expect(createdSessions).toHaveLength(beforeSessions);
    expect(startedRuns).toHaveLength(beforeRuns);
  });

  it('AH039：进行中Task不能靠状态编辑假取消或绕过保护', async () => {
    for (const hasSession of [true]) {
      const task = await service.createTask({ projectId, title: '正在执行，不可假取消' });
      await service.transitionTask(task.id, 'READY');
      if (hasSession) await service.startTask(task.id, { agentId });
      else await service.transitionTask(task.id, 'IN_PROGRESS');
      const tasks = new TaskRepository(database.db);
      const before = await tasks.get(task.id);
      const runs = new RunRepository(database.db);
      const beforeRuns = before?.sessionId ? await runs.list(before.sessionId) : [];
      for (const to of ['CANCELED', 'BLOCKED', 'WAITING_REVIEW'] as const) {
        await expect(service.transitionTask(task.id, to)).rejects.toMatchObject({
          status: 409,
          code: 'TASK_RUN_CANCEL_REQUIRED',
        });
      }
      expect(await tasks.get(task.id)).toEqual(before);
      if (before?.sessionId) expect(await runs.list(before.sessionId)).toEqual(beforeRuns);
    }
  });

  it('AH039：行锁检查当前状态，已READY的旧快照不能放行随后执行中的取消', async () => {
    const task = await service.createTask({ projectId, title: '过期快照' });
    await service.transitionTask(task.id, 'READY');
    const tasks = new TaskRepository(database.db);
    const stale = await tasks.get(task.id);
    await service.startTask(task.id, { agentId });
    expect(stale?.status).toBe('READY');
    await expect(
      tasks.transition(task.id, 'CANCELED', {}, { guardManualRunState: true }),
    ).rejects.toMatchObject({ code: 'TASK_RUN_CANCEL_REQUIRED' });
    expect((await tasks.get(task.id))?.status).toBe('IN_PROGRESS');
  });

  it('AH039：未执行任务和确认没有Run的手工进行中任务仍可取消', async () => {
    for (const status of ['BACKLOG', 'READY', 'BLOCKED'] as const) {
      const task = await service.createTask({ projectId, title: `可取消 ${status}` });
      const tasks = new TaskRepository(database.db);
      if (status !== 'BACKLOG') await service.transitionTask(task.id, 'READY');
      if (status === 'BLOCKED') await tasks.transition(task.id, 'BLOCKED');
      expect((await service.transitionTask(task.id, 'CANCELED')).status).toBe('CANCELED');
    }
    const task = await service.createTask({ projectId, title: '权威终态' });
    const tasks = new TaskRepository(database.db);
    await tasks.transition(task.id, 'READY');
    await tasks.transition(task.id, 'IN_PROGRESS');
    expect((await service.transitionTask(task.id, 'CANCELED')).status).toBe('CANCELED');
  });

  it.each([
    ['DISCONNECTED', null],
    ['RUNNING', null],
    ['FAILED', 'RUN_PREPARATION_RECOVERY_REQUIRED'],
    ['FAILED', 'SERVER_RESTARTED'],
    ['CANCELED', 'CANCEL_CONFIRMATION_TIMEOUT'],
    ['FAILED', 'AGENT_RUN_CANCEL_FAILED'],
    ['FAILED', 'AGENT_RUN_START_FAILED'],
  ] as const)('AH039：BLOCKED旧状态不能越过未决Run %s/%s', async (status, errorCode) => {
    const task = await service.createTask({ projectId, title: '旧状态仍有未决运行' });
    await service.transitionTask(task.id, 'READY');
    const started = await service.startTask(task.id, { agentId });
    const tasks = new TaskRepository(database.db);
    await tasks.update(task.id, { status: 'BLOCKED' });
    await new RunRepository(database.db).patch(started.run.id, { status, errorCode });
    await expect(service.transitionTask(task.id, 'CANCELED')).rejects.toMatchObject({
      code: 'TASK_RUN_CANCEL_REQUIRED',
    });
    expect((await tasks.get(task.id))?.status).toBe('BLOCKED');
  });

  it.each(['COMPLETED', 'FAILED', 'CANCELED'] as const)(
    'AH039/AH015：真实终态 %s 不因保留旧取消诊断码而永久阻止任务操作',
    async (status) => {
      const task = await service.createTask({ projectId, title: '真实结果解除历史隔离' });
      await service.transitionTask(task.id, 'READY');
      const started = await service.startTask(task.id, { agentId });
      await new RunRepository(database.db).patch(started.run.id, {
        status,
        dispatchState: 'ATTEMPTED',
        errorCode: 'CANCEL_CONFIRMATION_TIMEOUT',
      });
      if (status === 'COMPLETED') await service.onRunCompleted(task.id, started.run.id);
      else await service.onRunStopped(task.id, started.run.id);
      expect((await service.getTask(task.id)).status).toBe(
        status === 'COMPLETED' ? 'WAITING_REVIEW' : 'BLOCKED',
      );
      expect((await service.transitionTask(task.id, 'CANCELED')).status).toBe('CANCELED');
    },
  );

  it('AH039：任务缺少Session关联仍须检查taskId归属的真实Run', async () => {
    const task = await service.createTask({ projectId, title: '关联缺失不等于无运行' });
    await service.transitionTask(task.id, 'READY');
    await service.startTask(task.id, { agentId });
    const tasks = new TaskRepository(database.db);
    await tasks.update(task.id, { sessionId: null });
    await expect(service.transitionTask(task.id, 'CANCELED')).rejects.toMatchObject({
      code: 'TASK_RUN_CANCEL_REQUIRED',
    });
    expect((await tasks.get(task.id))?.status).toBe('IN_PROGRESS');
  });

  it('创建 Goal/Task 并阻止非法状态跳转', async () => {
    const goal = await service.createGoal({ projectId, title: '交付 MVP' });
    expect(goal.status).toBe('DRAFT');
    await service.transitionGoal(goal.id, 'ACTIVE');
    await expect(service.transitionGoal(goal.id, 'ACTIVE')).rejects.toMatchObject({
      code: 'INVALID_GOAL_STATE_TRANSITION',
    });

    const task = await service.createTask({
      projectId,
      goalId: goal.id,
      title: '实现任务闭环',
      description: '连接 Task 与 Agent Run',
      acceptanceCriteria: 'Run 完成后进入待审阅',
    });
    expect(task.status).toBe('BACKLOG');
    await expect(service.transitionTask(task.id, 'DONE')).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });

  it('交给 Agent 后进入进行中，Run 完成后必须由用户审阅', async () => {
    const task = await service.createTask({
      projectId,
      title: '验证审阅门禁',
      description: '执行自动化验证',
      acceptanceCriteria: '用户确认后完成',
    });
    await service.transitionTask(task.id, 'READY');
    const started = await service.startTask(task.id, { agentId });
    expect(started.task).toMatchObject({ status: 'IN_PROGRESS', assignedAgentId: agentId });
    expect(createdSessions.at(-1)).toMatchObject({ taskId: task.id, projectId, agentId });
    expect(startedRuns.at(-1)?.text).toContain('用户确认后完成');
    expect(startedRuns.at(-1)?.text).toContain('验证审阅门禁');
    expect(startedRuns.at(-1)?.text).toContain('执行自动化验证');

    const runId = started.run.id;
    await new RunRepository(database.db).patch(runId, { status: 'COMPLETED' });
    await service.onRunCompleted(task.id, runId);
    expect(await service.getTask(task.id)).toMatchObject({
      status: 'WAITING_REVIEW',
      finalRunId: runId,
    });
    await service.reviewTask(task.id, { decision: 'APPROVE' });
    expect(await service.getTask(task.id)).toMatchObject({ status: 'DONE' });
  });

  it('没有补充说明时保留完整目标且不产生空白上下文段', async () => {
    const task = await service.createTask({ projectId, title: '只执行这个目标' });
    await service.transitionTask(task.id, 'READY');
    await service.startTask(task.id, { agentId });
    expect(startedRuns.at(-1)?.text).toBe('只执行这个目标');
  });

  it('多行目标、说明与验收标准按原顺序保留', async () => {
    const task = await service.createTask({
      projectId,
      title: '修复任务创建',
      description: '第一行上下文\n第二行上下文',
      acceptanceCriteria: '第一条验收\n第二条验收',
    });
    await service.transitionTask(task.id, 'READY');
    await service.startTask(task.id, { agentId });
    expect(startedRuns.at(-1)?.text).toBe(
      '修复任务创建\n\n任务说明：\n第一行上下文\n第二行上下文\n\n验收标准：\n第一条验收\n第二条验收',
    );
  });

  it('完整长任务说明在首次执行和返工中不被短标题替代', async () => {
    const description = `任务要求：\n${'完整要求'.repeat(100)}\n第二段\n\n补充上下文：\n原始约束`;
    const task = await service.createTask({
      projectId,
      title: '短标题',
      description,
      acceptanceCriteria: '保留验收',
    });
    await service.transitionTask(task.id, 'READY');
    const started = await service.startTask(task.id, { agentId });
    const expected = `短标题\n\n任务说明：\n${description}\n\n验收标准：\n保留验收`;
    expect(startedRuns.at(-1)?.text).toBe(expected);
    await new RunRepository(database.db).patch(started.run.id, { status: 'COMPLETED' });
    await service.onRunCompleted(task.id, started.run.id);
    await service.reviewTask(task.id, { decision: 'REWORK', feedback: '继续完善' });
    expect(startedRuns.at(-1)?.text).toContain(`原任务：\n${expected}`);
    expect((await service.getTask(task.id)).description).toBe(description);
  });

  it('同一待审阅任务并发返工不创建第二个无归属 Session', async () => {
    let release!: () => void;
    let entered!: () => void;
    let duplicateEntered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstEntry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const duplicateEntry = new Promise<void>((resolve) => {
      duplicateEntered = resolve;
    });
    let created = 0;
    const repository = new TaskRepository(database.db);
    const task = await repository.create({
      id: randomUUID(),
      projectId,
      title: '并发返工',
      status: 'WAITING_REVIEW',
      assignedAgentId: agentId,
    });
    const controlled = new TaskService(
      new GoalRepository(database.db),
      repository,
      new ProjectRepository(database.db),
      {
        create: async () => {
          created++;
          if (created === 1) entered();
          else duplicateEntered();
          await gate;
          return { id: randomUUID() };
        },
        startRun: async () => ({ id: randomUUID() }),
      },
    );
    const first = controlled.reviewTask(task.id, { decision: 'REWORK', feedback: '继续修复' });
    await firstEntry;
    const second = controlled
      .reviewTask(task.id, { decision: 'REWORK', feedback: '重复请求' })
      .then(
        () => undefined,
        (error) => error,
      );
    await Promise.race([duplicateEntry, second]);
    release();
    await first;
    const error = await second;
    expect(created).toBe(1);
    expect(error).toMatchObject({ status: 409 });
  });

  it('返工创建 Session 期间不能批准同一任务，避免已完成任务留下运行现场', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const repository = new TaskRepository(database.db);
    const task = await repository.create({
      id: randomUUID(),
      projectId,
      title: '返工与批准',
      status: 'WAITING_REVIEW',
      assignedAgentId: agentId,
    });
    const controlled = new TaskService(
      new GoalRepository(database.db),
      repository,
      new ProjectRepository(database.db),
      {
        create: async () => {
          entered();
          await gate;
          return { id: randomUUID() };
        },
        startRun: async () => ({ id: randomUUID() }),
      },
    );
    const rework = controlled
      .reviewTask(task.id, { decision: 'REWORK', feedback: '继续修复' })
      .then(
        (value) => value,
        (error) => error,
      );
    await entry;
    const approved = await controlled.reviewTask(task.id, { decision: 'APPROVE' }).then(
      (value) => value,
      (error) => error,
    );
    release();
    const result = await rework;
    expect(approved).toMatchObject({ status: 409 });
    expect(result).toHaveProperty('run.id');
    expect((await controlled.getTask(task.id)).status).toBe('IN_PROGRESS');
  });

  it.each(['start', 'rework'] as const)('%s 创建 Session 时拒绝手动状态交错', async (operation) => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const repository = new TaskRepository(database.db);
    const task = await repository.create({
      id: randomUUID(),
      projectId,
      title: '状态交错',
      status: operation === 'start' ? 'READY' : 'WAITING_REVIEW',
      assignedAgentId: agentId,
    });
    const controlled = new TaskService(
      new GoalRepository(database.db),
      repository,
      new ProjectRepository(database.db),
      {
        create: async () => {
          entered();
          await gate;
          return { id: randomUUID() };
        },
        startRun: async () => ({ id: randomUUID() }),
      },
    );
    const running = (
      operation === 'start'
        ? controlled.startTask(task.id, { agentId })
        : controlled.reviewTask(task.id, { decision: 'REWORK', feedback: '继续' })
    ).then(
      (value) => value,
      (error) => error,
    );
    await entry;
    const transition = await controlled.transitionTask(task.id, 'CANCELED').then(
      (value) => value,
      (error) => error,
    );
    release();
    const result = await running;
    expect(transition).toMatchObject({ code: 'TASK_OPERATION_IN_PROGRESS' });
    expect(result).toHaveProperty('run.id');
    expect((await controlled.getTask(task.id)).status).toBe('IN_PROGRESS');
  });

  it('返工创建失败释放 admission，后续独立审阅仍可执行', async () => {
    const repository = new TaskRepository(database.db);
    const task = await repository.create({
      id: randomUUID(),
      projectId,
      title: '失败释放',
      status: 'WAITING_REVIEW',
      assignedAgentId: agentId,
    });
    const controlled = new TaskService(
      new GoalRepository(database.db),
      repository,
      new ProjectRepository(database.db),
      {
        create: async () => {
          throw new Error('确定性创建失败');
        },
        startRun: async () => ({ id: randomUUID() }),
      },
    );
    await expect(
      controlled.reviewTask(task.id, { decision: 'REWORK', feedback: '继续' }),
    ).rejects.toThrow('确定性创建失败');
    expect((await controlled.reviewTask(task.id, { decision: 'APPROVE' })).task.status).toBe(
      'DONE',
    );
  });

  it('同一 Task 并发启动只创建一个 Session', async () => {
    let release!: () => void;
    let entered!: () => void;
    let duplicateEntered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstEntry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const duplicateEntry = new Promise<void>((resolve) => {
      duplicateEntered = resolve;
    });
    let created = 0;
    const controlled = new TaskService(
      new GoalRepository(database.db),
      new TaskRepository(database.db),
      new ProjectRepository(database.db),
      {
        create: async () => {
          created += 1;
          if (created === 1) entered();
          else duplicateEntered();
          await gate;
          return { id: randomUUID() };
        },
        startRun: async () => ({ id: randomUUID() }),
      },
    );
    const task = await controlled.createTask({ projectId, title: '并发启动' });
    await controlled.transitionTask(task.id, 'READY');
    const first = controlled.startTask(task.id, { agentId });
    await firstEntry;
    const second = controlled.startTask(task.id, { agentId }).then(
      () => undefined,
      (error: unknown) => error,
    );
    await Promise.race([duplicateEntry, second]);
    release();
    await first;
    expect(await second).toMatchObject({ code: 'TASK_NOT_READY' });
    expect(created).toBe(1);
  });

  it('Task 创建 Session 前失败后释放准入，显式重试不被永久锁定', async () => {
    let attempts = 0;
    const controlled = new TaskService(
      new GoalRepository(database.db),
      new TaskRepository(database.db),
      new ProjectRepository(database.db),
      {
        create: async () => {
          if (++attempts === 1) throw new Error('adapter temporarily unavailable');
          return { id: randomUUID() };
        },
        startRun: async () => ({ id: randomUUID() }),
      },
    );
    const task = await controlled.createTask({ projectId, title: '恢复启动' });
    await controlled.transitionTask(task.id, 'READY');
    await expect(controlled.startTask(task.id, { agentId })).rejects.toThrow(
      'adapter temporarily unavailable',
    );
    expect((await controlled.getTask(task.id)).status).toBe('READY');
    const recovered = await controlled.startTask(task.id, { agentId });
    expect(recovered.task.status).toBe('IN_PROGRESS');
    expect(attempts).toBe(2);
  });

  it('继续修改必须填写反馈，并创建新的 Session/Run 形成下一轮', async () => {
    const task = await service.createTask({
      projectId,
      title: '返工闭环',
      description: '完成可审阅实现',
      acceptanceCriteria: '补充边界测试后再次审阅',
    });
    await service.transitionTask(task.id, 'READY');
    const first = await service.startTask(task.id, { agentId });
    await new RunRepository(database.db).patch(first.run.id, { status: 'COMPLETED' });
    await service.onRunCompleted(task.id, first.run.id);

    await expect(
      service.reviewTask(task.id, { decision: 'REWORK', feedback: '   ' }),
    ).rejects.toMatchObject({ code: 'TASK_REWORK_FEEDBACK_REQUIRED' });
    const rework = await service.reviewTask(task.id, {
      decision: 'REWORK',
      feedback: '补充取消与 Approval 竞争测试',
    });

    expect(rework.session?.id).not.toBe(first.session.id);
    expect(rework.run?.id).toBeTruthy();
    expect(rework.task).toMatchObject({
      status: 'IN_PROGRESS',
      sessionId: rework.session?.id,
      finalRunId: null,
    });
    expect(startedRuns.at(-1)?.text).toContain('补充取消与 Approval 竞争测试');
    expect(startedRuns.at(-1)?.text).toContain('补充边界测试后再次审阅');
    expect(startedRuns.at(-1)?.text).toContain('返工闭环');
    expect(startedRuns.at(-1)?.text).toContain('完成可审阅实现');

    await new RunRepository(database.db).patch(rework.run!.id, { status: 'COMPLETED' });
    await service.onRunCompleted(task.id, rework.run!.id);
    expect(await service.getTask(task.id)).toMatchObject({
      status: 'WAITING_REVIEW',
      finalRunId: rework.run!.id,
    });
  });

  it('Run 失败时将 Task 标为阻塞，保留结果 Run', async () => {
    const task = await service.createTask({ projectId, title: '失败处理' });
    await service.transitionTask(task.id, 'READY');
    const started = await service.startTask(task.id, { agentId });
    const runId = started.run.id;
    await new RunRepository(database.db).patch(runId, { status: 'FAILED' });
    await service.onRunStopped(task.id, runId);
    expect(await service.getTask(task.id)).toMatchObject({ status: 'BLOCKED', finalRunId: runId });
  });
});
