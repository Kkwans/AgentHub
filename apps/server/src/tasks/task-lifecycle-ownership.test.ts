import { randomUUID } from 'node:crypto';
import {
  AgentRepository,
  createPgliteDatabase,
  ExecutionTargetRepository,
  GoalRepository,
  ProjectRepository,
  RunRepository,
  SessionRepository,
  TaskRepository,
} from '@agenthub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TaskService } from './task-service.js';

describe('Task 生命周期必须属于当前返工 Session', () => {
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

  it.each(['COMPLETED', 'FAILED', 'CANCELED', 'DISCONNECTED'] as const)(
    '旧 Session 的 %s 延迟通知不能结束新返工',
    async (outcome) => {
      const tasks = new TaskRepository(database.db);
      const sessions = new SessionRepository(database.db);
      const runs = new RunRepository(database.db);
      const task = await tasks.create({
        id: randomUUID(),
        projectId,
        title: '保留当前返工',
        status: 'WAITING_REVIEW',
        assignedAgentId: agentId,
      });
      const previousSession = await sessions.create({
        id: randomUUID(),
        projectId,
        agentId,
        taskId: task.id,
        title: '旧执行',
        cwd: '/tmp/task-ownership',
        status: 'READY',
      });
      const previousRun = await runs.create({
        id: randomUUID(),
        sessionId: previousSession.id,
        taskId: task.id,
        status: outcome,
      });
      await tasks.update(task.id, {
        sessionId: previousSession.id,
        finalRunId: previousRun.id,
      });
      const service = new TaskService(
        new GoalRepository(database.db),
        tasks,
        new ProjectRepository(database.db),
        {
          create: async (input) =>
            sessions.create({
              id: randomUUID(),
              projectId: input.projectId,
              agentId: input.agentId,
              taskId: input.taskId,
              title: input.title ?? '返工',
              cwd: input.cwd,
              status: 'READY',
            }),
          startRun: async (sessionId) =>
            runs.create({
              id: randomUUID(),
              sessionId,
              taskId: task.id,
              status: 'RUNNING',
            }),
        },
      );
      const rework = await service.reviewTask(task.id, {
        decision: 'REWORK',
        feedback: '继续修改',
      });
      expect(rework.session?.id).not.toBe(previousSession.id);
      if (outcome === 'COMPLETED') await service.onRunCompleted(task.id, previousRun.id);
      else await service.onRunStopped(task.id, previousRun.id);
      expect(await service.getTask(task.id)).toMatchObject({
        status: 'IN_PROGRESS',
        sessionId: rework.session?.id,
        finalRunId: null,
      });
      expect((await runs.get(rework.run!.id))?.status).toBe('RUNNING');
      // Nonterminal/missing/misbound events are harmless even for the current Session.
      expect(await service.onRunCompleted(task.id, randomUUID())).toBe(false);
      expect(await service.onRunCompleted(task.id, rework.run!.id)).toBe(false);
      expect(await service.onRunStopped(task.id, rework.run!.id)).toBe(false);
      await runs.patch(rework.run!.id, {
        taskId: randomUUID(),
        status: outcome,
      });
      expect(await service.onRunCompleted(task.id, rework.run!.id)).toBe(false);
      expect(await service.onRunStopped(task.id, rework.run!.id)).toBe(false);
      await runs.patch(rework.run!.id, { taskId: task.id });
      const apply = () =>
        outcome === 'COMPLETED'
          ? service.onRunCompleted(task.id, rework.run!.id)
          : service.onRunStopped(task.id, rework.run!.id);
      expect(await apply()).toBe(true);
      expect(await apply()).toBe(false);
      expect(await service.getTask(task.id)).toMatchObject({
        status: outcome === 'COMPLETED' ? 'WAITING_REVIEW' : 'BLOCKED',
        finalRunId: rework.run!.id,
      });
    },
  );
  it('Session 的任务或项目归属不匹配时，不修改 Task 或 Run', async () => {
    const tasks = new TaskRepository(database.db);
    const sessions = new SessionRepository(database.db);
    const runs = new RunRepository(database.db);
    const projects = new ProjectRepository(database.db);
    const currentProject = (await projects.get(projectId))!;
    const other = await projects.create({
      id: randomUUID(),
      targetId: currentProject.targetId,
      name: '其他项目',
      rootPath: '/tmp/ownership-other',
      realRootPath: '/tmp/ownership-other',
      status: 'ACTIVE',
      repoKind: 'NONE',
    });
    const service = new TaskService(new GoalRepository(database.db), tasks, projects, {
      create: async () => {
        throw new Error('不应创建 Session');
      },
      startRun: async () => {
        throw new Error('不应创建 Run');
      },
    });
    for (const mismatch of ['project', 'task'] as const) {
      const task = await tasks.create({
        id: randomUUID(),
        projectId,
        title: '归属校验',
        status: 'IN_PROGRESS',
        assignedAgentId: agentId,
      });
      const session = await sessions.create({
        id: randomUUID(),
        projectId: mismatch === 'project' ? other.id : projectId,
        agentId,
        taskId: mismatch === 'task' ? randomUUID() : task.id,
        title: '不匹配',
        cwd: '/tmp/task-ownership',
        status: 'READY',
      });
      const run = await runs.create({
        id: randomUUID(),
        sessionId: session.id,
        taskId: task.id,
        status: 'COMPLETED',
      });
      await tasks.update(task.id, { sessionId: session.id });
      const before = await tasks.get(task.id);
      const changed = await service.onRunCompleted(task.id, run.id);
      expect(await tasks.get(task.id)).toEqual(before);
      expect(changed).toBe(false);
      expect((await runs.get(run.id))?.status).toBe('COMPLETED');
    }
  });
  it('Session Agent 与 Task 当前分配不匹配时拒绝终态，且不修改任何记录', async () => {
    const tasks = new TaskRepository(database.db);
    const sessions = new SessionRepository(database.db);
    const runs = new RunRepository(database.db);
    const projects = new ProjectRepository(database.db);
    const otherAgent = await new AgentRepository(database.db).create({
      id: randomUUID(),
      targetId: (await projects.get(projectId))!.targetId,
      name: '其他 Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    const task = await tasks.create({
      id: randomUUID(),
      projectId,
      title: 'Agent 所有权不匹配',
      status: 'IN_PROGRESS',
      assignedAgentId: otherAgent.id,
    });
    const session = await sessions.create({
      id: randomUUID(),
      projectId,
      agentId,
      taskId: task.id,
      title: '原 Agent 会话',
      cwd: '/tmp/task-ownership',
      status: 'READY',
    });
    await tasks.update(task.id, { sessionId: session.id });
    for (const status of ['COMPLETED', 'FAILED'] as const) {
      const run = await runs.create({
        id: randomUUID(),
        sessionId: session.id,
        taskId: task.id,
        status,
      });
      const beforeTask = await tasks.get(task.id);
      const beforeSession = await sessions.get(session.id);
      const beforeRun = await runs.get(run.id);
      expect(
        await tasks.tryApplyRunOutcome(
          task.id,
          run.id,
          status === 'COMPLETED' ? 'COMPLETED' : 'STOPPED',
        ),
      ).toBe(false);
      expect(await tasks.get(task.id)).toEqual(beforeTask);
      expect(await sessions.get(session.id)).toEqual(beforeSession);
      expect(await runs.get(run.id)).toEqual(beforeRun);
    }
  });

  it.each(['COMPLETED', 'FAILED', 'CANCELED', 'DISCONNECTED'] as const)(
    '合法归属的 %s Run 不能用不匹配的回调改变 Task',
    async (status) => {
      const tasks = new TaskRepository(database.db);
      const sessions = new SessionRepository(database.db);
      const runs = new RunRepository(database.db);
      const task = await tasks.create({
        id: randomUUID(),
        projectId,
        title: '终态类型校验',
        status: 'IN_PROGRESS',
        assignedAgentId: agentId,
      });
      const session = await sessions.create({
        id: randomUUID(),
        projectId,
        agentId,
        taskId: task.id,
        title: '当前所有者',
        cwd: '/tmp/task-ownership',
        status: 'READY',
      });
      await tasks.update(task.id, { sessionId: session.id });
      const run = await runs.create({
        id: randomUUID(),
        sessionId: session.id,
        taskId: task.id,
        status,
      });
      const service = new TaskService(
        new GoalRepository(database.db),
        tasks,
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
      const beforeTask = await tasks.get(task.id);
      const beforeSession = await sessions.get(session.id);
      const beforeRun = await runs.get(run.id);
      const changed =
        status === 'COMPLETED'
          ? await service.onRunStopped(task.id, run.id)
          : await service.onRunCompleted(task.id, run.id);
      expect(changed).toBe(false);
      expect(await tasks.get(task.id)).toEqual(beforeTask);
      expect(await sessions.get(session.id)).toEqual(beforeSession);
      expect(await runs.get(run.id)).toEqual(beforeRun);
      // The rejection must not consume the event or poison a valid subsequent callback.
      expect(
        status === 'COMPLETED'
          ? await service.onRunCompleted(task.id, run.id)
          : await service.onRunStopped(task.id, run.id),
      ).toBe(true);
      expect(await tasks.get(task.id)).toMatchObject({
        status: status === 'COMPLETED' ? 'WAITING_REVIEW' : 'BLOCKED',
        finalRunId: run.id,
      });
    },
  );
});
