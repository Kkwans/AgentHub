import { randomUUID } from 'node:crypto';

import {
  agentRuns,
  agentSessions,
  AgentRepository,
  createPgliteDatabase,
  ExecutionTargetRepository,
  ProjectRepository,
  TaskRepository,
  WorktreeExecutionRepository,
} from '@agenthub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '../errors.js';
import type { CreateSessionInput, StartRunInput } from '../sessions/session-service.js';
import type { WorktreeGitService } from './worktree-git-service.js';
import {
  WorktreeTaskService,
  type WorktreeEventPublisher,
  type WorktreeSessionController,
} from './worktree-task-service.js';

type GitController = Pick<
  WorktreeGitService,
  'inspectBase' | 'taskBranch' | 'create' | 'review' | 'commitAndMerge'
>;

describe('Worktree Task Runner 编排', () => {
  let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
  let targets: ExecutionTargetRepository<(typeof database)['db']>;
  let projects: ProjectRepository<(typeof database)['db']>;
  let agents: AgentRepository<(typeof database)['db']>;
  let tasks: TaskRepository<(typeof database)['db']>;
  let executions: WorktreeExecutionRepository<(typeof database)['db']>;

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    targets = new ExecutionTargetRepository(database.db);
    projects = new ProjectRepository(database.db);
    agents = new AgentRepository(database.db);
    tasks = new TaskRepository(database.db);
    executions = new WorktreeExecutionRepository(database.db);
  });

  afterAll(async () => database.close());

  it('同 Project FIFO 执行，Review 阻塞队列并支持 Rework 与显式 Merge', async () => {
    const fixture = await seedFixture('FIFO');
    const firstTask = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '第一项',
      description: '修改第一项',
      acceptanceCriteria: '进入人工审阅',
      status: 'READY',
    });
    const secondTask = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '第二项',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const service = createService(runtime);

    const first = await service.queueTask(firstTask.id, { agentId: fixture.agentId });
    const second = await service.queueTask(secondTask.id, { agentId: fixture.agentId });
    await service.processQueue(fixture.projectId);
    const firstRunning = await waitForStatus(first.execution.id, 'RUNNING');
    expect((await executions.get(second.execution.id))?.status).toBe('QUEUED');
    expect(runtime.sessions.created[0]).toMatchObject({
      taskId: firstTask.id,
      cwd: `/managed/${first.execution.id}`,
      branch: first.execution.taskBranch,
    });
    expect((await tasks.get(firstTask.id))?.sessionId).toBe(firstRunning.sessionId);

    await service.onRunWaitingForInput(firstTask.id, firstRunning.runId!);
    expect((await executions.get(first.execution.id))?.status).toBe('AWAITING_INPUT');
    await service.onRunResumed(firstTask.id, firstRunning.runId!);
    await service.onRunCompleted(firstTask.id, firstRunning.runId!);
    expect((await tasks.get(firstTask.id))?.status).toBe('WAITING_REVIEW');
    expect((await executions.get(second.execution.id))?.status).toBe('QUEUED');

    const reworked = await service.rework(first.execution.id, '请补充回归测试');
    expect(reworked.status).toBe('RUNNING');
    expect(runtime.sessions.started.at(-1)?.input.text).toBe('请补充回归测试');
    await service.onRunCompleted(firstTask.id, reworked.runId!);
    const merged = await service.merge(first.execution.id);
    expect(merged.execution.status).toBe('DONE');
    expect((await tasks.get(firstTask.id))?.status).toBe('DONE');

    await service.processQueue(fixture.projectId);
    expect((await executions.get(second.execution.id))?.status).toBe('RUNNING');
    expect(runtime.events.some((event) => event.type === 'worktree.execution.review_ready')).toBe(
      true,
    );
    await service.cancel(second.execution.id);
    await service.shutdown();
  });

  it('Merge preflight 失败时回到 Review，不提前完成 Task', async () => {
    const fixture = await seedFixture('MERGE-FAIL');
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '冲突任务',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    runtime.git.mergeError = new AppError(
      409,
      'WORKTREE_MERGE_CONFLICT',
      '任务分支与 base branch 存在冲突',
    );
    const service = createService(runtime);
    const queued = await service.queueTask(task.id, { agentId: fixture.agentId });
    await service.processQueue(fixture.projectId);
    const running = await waitForStatus(queued.execution.id, 'RUNNING');
    await service.onRunCompleted(task.id, running.runId!);

    await expect(service.merge(queued.execution.id)).rejects.toMatchObject({
      code: 'WORKTREE_MERGE_CONFLICT',
    });
    expect(await executions.get(queued.execution.id)).toMatchObject({
      status: 'REVIEW',
      errorCode: 'WORKTREE_MERGE_CONFLICT',
    });
    expect((await tasks.get(task.id))?.status).toBe('WAITING_REVIEW');
    await service.shutdown();
  });

  it('重启恢复阻断不安全状态并继续持久化队列', async () => {
    const fixture = await seedFixture('RECOVERY');
    const interruptedTask = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '被中断任务',
      status: 'READY',
    });
    const queuedTask = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '排队任务',
      status: 'READY',
    });
    const firstId = randomUUID();
    const secondId = randomUUID();
    await executions.enqueue({
      id: firstId,
      taskId: interruptedTask.id,
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      assignedAgentId: fixture.agentId,
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: `agenthub/task-${firstId.slice(0, 8)}`,
    });
    await executions.enqueue({
      id: secondId,
      taskId: queuedTask.id,
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      assignedAgentId: fixture.agentId,
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: `agenthub/task-${secondId.slice(0, 8)}`,
    });
    await executions.claimNext(fixture.projectId);

    const runtime = createRuntime(database);
    const service = createService(runtime);
    const recovery = await service.recoverAfterRestart();
    expect(recovery.blocked).toEqual([firstId]);
    expect(recovery.queuedProjects).toEqual([fixture.projectId]);
    expect((await executions.get(firstId))?.status).toBe('BLOCKED');
    expect((await tasks.get(interruptedTask.id))?.status).toBe('BLOCKED');

    service.resumeQueued(recovery.queuedProjects);
    await service.processQueue(fixture.projectId);
    expect((await executions.get(secondId))?.status).toBe('RUNNING');
    await service.shutdown();
  });

  async function seedFixture(label: string) {
    const targetId = randomUUID();
    const projectId = randomUUID();
    const agentId = randomUUID();
    await targets.create({
      id: targetId,
      name: `Target ${label}`,
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    await projects.create({
      id: projectId,
      name: `Project ${label}`,
      targetId,
      rootPath: `/project/${projectId}`,
      realRootPath: `/project/${projectId}`,
      repoKind: 'GIT',
      status: 'ACTIVE',
    });
    await agents.create({
      id: agentId,
      targetId,
      name: `Agent ${label}`,
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    return { targetId, projectId, agentId };
  }

  function createService(runtime: ReturnType<typeof createRuntime>) {
    return new WorktreeTaskService(
      executions,
      tasks,
      projects,
      agents,
      targets,
      runtime.sessions,
      runtime.git,
      runtime.publisher,
    );
  }

  async function waitForStatus(id: string, status: string) {
    let last: Awaited<ReturnType<typeof executions.get>>;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      last = await executions.get(id);
      if (last?.status === status) return last;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Execution ${id} 未进入 ${status}：${JSON.stringify(last)}`);
  }
});

function createRuntime(database: Awaited<ReturnType<typeof createPgliteDatabase>>) {
  const created: CreateSessionInput[] = [];
  const started: Array<{ sessionId: string; input: StartRunInput; runId: string }> = [];
  const sessions: WorktreeSessionController & {
    created: typeof created;
    started: typeof started;
  } = {
    created,
    started,
    create: async (input) => {
      created.push(input);
      const id = randomUUID();
      await database.db.insert(agentSessions).values({
        id,
        projectId: input.projectId,
        agentId: input.agentId,
        taskId: input.taskId,
        title: input.title,
        cwd: input.cwd,
        branch: input.branch,
        status: 'READY',
        model: input.model,
        mode: input.mode,
      });
      return { id };
    },
    createManagedWorktree: async (input) => {
      created.push(input);
      const id = randomUUID();
      await database.db.insert(agentSessions).values({
        id,
        projectId: input.projectId,
        agentId: input.agentId,
        taskId: input.taskId,
        title: input.title,
        cwd: input.cwd,
        branch: input.branch,
        status: 'READY',
        model: input.model,
        mode: input.mode,
      });
      return { id };
    },
    startRun: async (sessionId, input) => {
      const runId = randomUUID();
      await database.db.insert(agentRuns).values({ id: runId, sessionId, status: 'RUNNING' });
      started.push({ sessionId, input, runId });
      return { id: runId };
    },
    cancelRun: async () => undefined,
  };
  const git: GitController & { mergeError?: AppError } = {
    inspectBase: async (_projectRoot, branch) => ({
      branch: branch ?? 'main',
      sha: 'a'.repeat(40),
    }),
    taskBranch: (taskId, executionId) =>
      `agenthub/task-${taskId.slice(0, 8)}-${executionId.slice(0, 8)}`,
    create: async (input) => `/managed/${input.executionId}`,
    review: async (input) => ({
      worktreePath: input.worktreePath,
      baseSha: input.baseSha,
      headSha: 'b'.repeat(40),
      taskBranch: input.taskBranch,
      clean: false,
      aheadBy: 0,
      entries: [{ index: ' ', worktree: 'M', path: 'tracked.txt' }],
      patch: 'diff --git a/tracked.txt b/tracked.txt',
      diffStat: '1 file changed',
      truncated: false,
    }),
    commitAndMerge: async () => {
      if (git.mergeError) throw git.mergeError;
      return {
        mergeCommitSha: 'c'.repeat(40),
        managedCommitSha: 'b'.repeat(40),
        merged: true,
      };
    },
  };
  const events: Record<string, unknown>[] = [];
  const publisher: WorktreeEventPublisher & { events: typeof events } = {
    events,
    publish: (_topic, event) => events.push(event),
  };
  return { sessions, git, publisher, events };
}
