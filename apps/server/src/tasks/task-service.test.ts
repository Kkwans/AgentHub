import { randomUUID } from 'node:crypto';

import {
  AgentRepository,
  createPgliteDatabase,
  ExecutionTargetRepository,
  GoalRepository,
  ProjectRepository,
  TaskRepository,
} from '@agenthub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
        return { id: randomUUID() };
      },
      startRun: async (sessionId, input) => {
        startedRuns.push({ sessionId, ...input });
        return { id: randomUUID() };
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

    const runId = randomUUID();
    await service.onRunCompleted(task.id, runId);
    expect(await service.getTask(task.id)).toMatchObject({
      status: 'WAITING_REVIEW',
      finalRunId: runId,
    });
    await service.reviewTask(task.id, { decision: 'APPROVE' });
    expect(await service.getTask(task.id)).toMatchObject({ status: 'DONE' });
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

    await service.onRunCompleted(task.id, rework.run!.id);
    expect(await service.getTask(task.id)).toMatchObject({
      status: 'WAITING_REVIEW',
      finalRunId: rework.run!.id,
    });
  });

  it('Run 失败时将 Task 标为阻塞，保留结果 Run', async () => {
    const task = await service.createTask({ projectId, title: '失败处理' });
    await service.transitionTask(task.id, 'READY');
    await service.startTask(task.id, { agentId });
    const runId = randomUUID();
    await service.onRunStopped(task.id, runId);
    expect(await service.getTask(task.id)).toMatchObject({ status: 'BLOCKED', finalRunId: runId });
  });
});
