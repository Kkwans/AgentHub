import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { FakeAgentAdapter } from '@agenthub/agent-core';
import {
  AgentRepository,
  ApprovalRepository,
  createPgliteDatabase,
  EventRepository,
  ExecutionTargetRepository,
  GoalRepository,
  MessageRepository,
  ProjectRepository,
  RunRepository,
  SessionRepository,
  TaskRepository,
  TaskStartAttemptRepository,
  WorktreeExecutionRepository,
} from '@agenthub/db';
import { AgentService } from '../agents/agent-service.js';
import { SessionService } from '../sessions/session-service.js';
import { TaskService } from './task-service.js';
import { WorktreeTaskService } from '../worktrees/worktree-task-service.js';
import { recoverRuntimeAfterRestart } from '../startup-recovery.js';

it('真实持久重开完整startup收敛预留/未知创建/已移交Run，不重放adapter', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agenthub-task-start-recovery-'));
  let database: Awaited<ReturnType<typeof createPgliteDatabase>> | undefined;
  try {
    const dataDir = join(temp, 'db');
    database = await createPgliteDatabase({ dataDir });
    const target = await new ExecutionTargetRepository(database.db).create({
      id: randomUUID(),
      name: '测试',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    const project = await new ProjectRepository(database.db).create({
      id: randomUUID(),
      targetId: target.id,
      name: '测试',
      rootPath: temp,
      realRootPath: temp,
      repoKind: 'NONE',
      status: 'ACTIVE',
    });
    const agent = await new AgentRepository(database.db).create({
      id: randomUUID(),
      targetId: target.id,
      name: '测试',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    const attempts = new TaskStartAttemptRepository(database.db),
      tasks = new TaskRepository(database.db);
    const cases = [];
    for (const phase of [
      'RESERVED',
      'CREATE_ATTEMPTED',
      'SESSION_READY',
      'RUN_ADMITTED',
    ] as const) {
      const task = await tasks.create({
        id: randomUUID(),
        projectId: project.id,
        title: phase,
        status: 'READY',
      });
      const id = randomUUID(),
        sessionId = randomUUID();
      await attempts.reserve({
        attemptId: id,
        kind: 'START',
        expectedOldSessionId: null,
        inputHash: 'fixture',
        session: {
          id: sessionId,
          projectId: project.id,
          taskId: task.id,
          agentId: agent.id,
          title: phase,
          cwd: temp,
        },
      });
      if (phase !== 'RESERVED') await attempts.markCreateAttempted(id);
      if (['SESSION_READY', 'RUN_ADMITTED'].includes(phase))
        await attempts.recordSessionReady(id, {
          externalSessionId: 'fixture',
          startedAt: new Date(),
        });
      if (phase === 'RUN_ADMITTED')
        await new RunRepository(database.db).create(
          {
            id: randomUUID(),
            sessionId,
            taskId: task.id,
            status: 'QUEUED',
            dispatchState: 'PREPARING',
          },
          { taskStartAttemptId: id },
        );
      cases.push({ id, taskId: task.id, sessionId, phase });
    }
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    const db = database.db,
      restoredAttempts = new TaskStartAttemptRepository(db),
      restoredTasks = new TaskRepository(db),
      runs = new RunRepository(db),
      projects = new ProjectRepository(db),
      agents = new AgentRepository(db),
      targets = new ExecutionTargetRepository(db);
    const adapter = new FakeAgentAdapter({ scenario: 'idle' });
    const create = vi.spyOn(adapter, 'createSession');
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
            throw new Error('startup must not launch');
          },
        },
        () => adapter,
      ),
      { publish: () => undefined },
      { readHead: async () => undefined },
      undefined,
      {},
      undefined,
      restoredAttempts,
    );
    const taskService = new TaskService(
      new GoalRepository(db),
      restoredTasks,
      projects,
      sessions,
      undefined,
      restoredAttempts,
    );
    const unexpected = async (): Promise<never> => {
      throw new Error('startup must not use Git');
    };
    const worktrees = new WorktreeTaskService(
      new WorktreeExecutionRepository(db),
      restoredTasks,
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
    const services = { sessions, tasks: taskService, worktrees, runs };
    await recoverRuntimeAfterRestart(services);
    for (const row of cases) {
      expect((await restoredAttempts.get(row.id))?.phase).toBe(
        row.phase === 'RESERVED'
          ? 'FAILED_KNOWN'
          : row.phase === 'RUN_ADMITTED'
            ? 'RUN_ADMITTED'
            : 'UNKNOWN',
      );
      expect((await restoredTasks.get(row.taskId))?.status).toBe(
        ['RESERVED', 'RUN_ADMITTED'].includes(row.phase) ? 'BLOCKED' : 'IN_PROGRESS',
      );
      expect(await runs.list(row.sessionId)).toHaveLength(row.phase === 'RUN_ADMITTED' ? 1 : 0);
    }
    const before = await Promise.all(cases.map((row) => restoredAttempts.get(row.id)));
    await recoverRuntimeAfterRestart(services);
    expect(await Promise.all(cases.map((row) => restoredAttempts.get(row.id)))).toEqual(before);
    expect(create).not.toHaveBeenCalled();
    await sessions.shutdown();
  } finally {
    await database?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
