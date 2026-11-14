import { RunStartError } from '../sessions/run-start-error.js';
import { randomUUID } from 'node:crypto';

import {
  RunRepository,
  deriveWorktreeMergeOperationId,
  SessionRepository,
  agentSessions,
  AgentRepository,
  createPgliteDatabase,
  ExecutionTargetRepository,
  ProjectRepository,
  TaskRepository,
  WorktreeExecutionRepository,
} from '@agenthub/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppError } from '../errors.js';
import { createManagedGitRuntime } from '../git/managed-git-runtime.js';
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
  const bootRuntimes: Awaited<ReturnType<typeof createManagedGitRuntime>>[] = [];

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    targets = new ExecutionTargetRepository(database.db);
    projects = new ProjectRepository(database.db);
    agents = new AgentRepository(database.db);
    tasks = new TaskRepository(database.db);
    executions = new WorktreeExecutionRepository(database.db);
    // These services share one application boot, before any task starts. Building
    // another runtime after the UNKNOWN cases below would correctly deny startup.
    for (let index = 0; index < 6; index++) {
      bootRuntimes.push(
        await createManagedGitRuntime(
          { db: database.db, projects, targets },
          {
            createResourceResolver: () => async (projectId) => {
              const project = (await projects.get(projectId))!;
              return {
                projectId,
                targetId: project.targetId,
                executionDeviceId: 'ignored',
                repositoryKey: 'ignored',
                canonicalCommonDir: '/canonical/.git',
                worktreeIdentity: '/canonical',
                head: 'c'.repeat(40),
              };
            },
          },
        ),
      );
    }
  });

  afterAll(async () => database.close());

  it.each(['project', 'claim'] as const)(
    '停服等待%s屏障中的合并并拒绝迟到Git调用',
    async (stage) => {
      const fixture = await seedFixture(`merge-stop-${stage}`);
      const task = await tasks.create({
        id: randomUUID(),
        projectId: fixture.projectId,
        title: '停止前合并',
        status: 'READY',
      });
      const runtime = createRuntime(database);
      const service = createService(runtime);
      const queued = await service.queueTask(task.id, { agentId: fixture.agentId });
      await service.processQueue(fixture.projectId);
      const running = await waitForStatus(queued.execution.id, 'RUNNING');
      await complete(service, task.id, running.runId!);
      let proceed!: () => void;
      let reached!: () => void;
      const barrier = new Promise<void>((resolve) => {
        proceed = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const git = vi.spyOn(runtime.git, 'commitAndMerge');
      const originalProject = projects.get.bind(projects);
      const originalClaim = executions.claimReviewForMerge.bind(executions);
      const pause =
        stage === 'project'
          ? vi.spyOn(projects, 'get').mockImplementationOnce(async (...args) => {
              const result = await originalProject(...args);
              reached();
              await barrier;
              return result;
            })
          : vi.spyOn(executions, 'claimReviewForMerge').mockImplementationOnce(async (...args) => {
              const result = await originalClaim(...args);
              reached();
              await barrier;
              return result;
            });
      const merging = mergeReviewed(service, queued.execution.id);
      const outcome = merging.catch((error: unknown) => error);
      await entered;
      let stopped = false;
      const shutdown = service.shutdown().then(() => {
        stopped = true;
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(stopped).toBe(false);
        proceed();
        expect(await outcome).toMatchObject({ code: 'WORKTREE_RUNNER_STOPPING' });
        await shutdown;
        expect(git).not.toHaveBeenCalled();
        expect((await executions.get(queued.execution.id))?.status).toBe('REVIEW');
        await expect(mergeReviewed(service, queued.execution.id)).rejects.toMatchObject({
          code: 'WORKTREE_RUNNER_STOPPING',
        });
      } finally {
        proceed();
        await outcome;
        await shutdown;
        pause.mockRestore();
        git.mockRestore();
      }
    },
  );

  it('已进入Git的合并未收敛时停服超时永久失败，不能提前释放归属', async () => {
    const fixture = await seedFixture('merge-stop-inflight');
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: 'Git待收敛',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const service = createService(runtime);
    const queued = await service.queueTask(task.id, { agentId: fixture.agentId });
    await service.processQueue(fixture.projectId);
    const running = await waitForStatus(queued.execution.id, 'RUNNING');
    await complete(service, task.id, running.runId!);
    let proceed!: () => void;
    let reached!: () => void;
    const barrier = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const original = runtime.git.commitAndMerge;
    const git = vi.spyOn(runtime.git, 'commitAndMerge').mockImplementationOnce(async (input) => {
      reached();
      await barrier;
      return original(input);
    });
    const merging = mergeReviewed(service, queued.execution.id);
    const outcome = merging.catch((error: unknown) => error);
    await entered;
    try {
      await expect(service.shutdown()).rejects.toMatchObject({
        code: 'WORKTREE_SHUTDOWN_UNCONFIRMED',
      });
      expect((await executions.get(queued.execution.id))?.status).toBe('MERGING');
      proceed();
      await outcome;
      expect((await executions.get(queued.execution.id))?.status).toBe('DONE');
      await expect(service.shutdown()).rejects.toMatchObject({
        code: 'WORKTREE_SHUTDOWN_UNCONFIRMED',
      });
      expect(git).toHaveBeenCalledTimes(1);
    } finally {
      proceed();
      await outcome;
      git.mockRestore();
    }
  });

  it.each(['account:original', 'token:original', 'local-trusted', undefined])(
    '队列持久保存服务端 Git owner %s，历史调用不猜测归属',
    async (ownerScope) => {
      const fixture = await seedFixture(`owner-${ownerScope}`);
      const task = await tasks.create({
        id: randomUUID(),
        projectId: fixture.projectId,
        title: '持久 owner',
        status: 'READY',
      });
      const runtime = createRuntime(database);
      const service = createService(runtime);
      vi.spyOn(service, 'processQueue').mockResolvedValue(undefined);
      const queued = await service.queueTask(task.id, { agentId: fixture.agentId }, ownerScope);
      const saved = await executions.get(queued.execution.id);
      expect(saved?.gitOwnerScope).toBe(ownerScope ?? null);
      if (ownerScope) {
        expect(saved?.gitCreateOperationId).toMatch(/^[0-9a-f-]{36}$/);
        expect(saved?.gitCreateOperationId).not.toBe(queued.execution.id);
        expect(queued.execution.gitCreateOperationId).toBe(saved?.gitCreateOperationId);
      } else expect(saved?.gitCreateOperationId).toBeNull();
      expect(saved?.configJson).not.toHaveProperty('gitOwnerScope');
      await service.shutdown();
      await executions.transitionWithTask(queued.execution.id, 'CANCELED', 'CANCELED');
    },
  );
  it('空 server-only owner 在读取任务或 Git 前被拒绝', async () => {
    const runtime = createRuntime(database);
    const service = createService(runtime);
    const lookup = vi.spyOn(tasks, 'get');
    try {
      await expect(
        service.queueTask(randomUUID(), { agentId: randomUUID() }, '  '),
      ).rejects.toMatchObject({ code: 'WORKTREE_GIT_OWNER_INVALID' });
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
      await service.shutdown();
    }
  });

  it('生产 runtime 让创建和合并共用持久协调器，使用 primary HEAD 和规范资源根', async () => {
    const fixture = await seedFixture('managed-writes');
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: 'managed',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const managed = bootRuntimes.shift()!;
    const run = vi.spyOn(managed.writes, 'run');
    const create = vi.spyOn(runtime.git, 'create');
    const merge = vi.spyOn(runtime.git, 'commitAndMerge');
    const service = createService(runtime, managed);
    const queued = await service.queueTask(task.id, { agentId: fixture.agentId }, 'local-trusted');
    await service.processQueue(fixture.projectId);
    const running = await waitForStatus(queued.execution.id, 'RUNNING');
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      kind: 'WORKTREE_CREATE',
      expectedHead: 'c'.repeat(40),
      operationId: queued.execution.gitCreateOperationId,
      payload: { baseSha: 'a'.repeat(40) },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: '/canonical' }));
    await complete(service, task.id, running.runId!);
    const result = await mergeReviewed(service, queued.execution.id);
    expect(result.execution.status).toBe('DONE');
    expect(run.mock.calls[1]?.[0]).toMatchObject({
      kind: 'WORKTREE_MERGE',
      ownerScope: 'local-trusted',
      expectedHead: 'c'.repeat(40),
    });
    expect(run.mock.calls[1]?.[0].operationId).not.toBe(queued.execution.gitCreateOperationId);
    expect(merge).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ projectRoot: '/canonical' }),
    );
    await service.shutdown();
  });

  it('权威前置拒绝经显式 retry CAS 新建持久 attempt，普通重放不能换键', async () => {
    const fixture = await seedFixture('managed-merge-safe-retry');
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: 'retry',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const managed = bootRuntimes.shift()!;
    const service = createService(runtime, managed);
    const queued = await service.queueTask(task.id, { agentId: fixture.agentId }, 'local-trusted');
    await service.processQueue(fixture.projectId);
    const running = await waitForStatus(queued.execution.id, 'RUNNING');
    await complete(service, task.id, running.runId!);
    const firstReview = await service.review(queued.execution.id);
    expect(firstReview.mergeAdmission).toMatchObject({
      expectedRunId: running.runId,
      retryEligible: false,
    });
    const operationId = firstReview.mergeAdmission!.expectedOperationId;
    const mergeGit = vi.spyOn(runtime.git, 'commitAndMerge');
    const resource = await managed.resolve(fixture.projectId);
    vi.spyOn(managed, 'resolve').mockResolvedValueOnce({ ...resource, head: 'd'.repeat(40) });
    const intent = { expectedRunId: running.runId!, expectedOperationId: operationId };
    await expect(service.merge(queued.execution.id, intent)).rejects.toMatchObject({
      code: 'WORKTREE_GIT_PREWRITE_REJECTED',
    });
    expect(mergeGit).not.toHaveBeenCalled();
    expect((await service.get(queued.execution.id)).gitMergeGeneration).toBe(0);
    const rejectedReview = await service.review(queued.execution.id);
    expect(rejectedReview.mergeAdmission).toMatchObject({
      expectedOperationId: operationId,
      retryEligible: true,
    });
    // Merely seeing REVIEW is not permission to mint a new identity.
    await expect(service.merge(queued.execution.id, intent)).rejects.toMatchObject({
      code: 'WORKTREE_EXECUTION_CHANGED',
    });
    expect(await service.get(queued.execution.id)).toMatchObject({
      status: 'REVIEW',
      gitMergeGeneration: 0,
    });
    expect(mergeGit).not.toHaveBeenCalled();
    const result = await service.merge(queued.execution.id, {
      ...intent,
      retryOfOperationId: operationId,
    });
    expect(result.execution.status).toBe('DONE');
    expect(result.execution.gitMergeGeneration).toBe(1);
    expect(mergeGit).toHaveBeenCalledTimes(1);
    await expect(
      service.merge(queued.execution.id, { ...intent, retryOfOperationId: operationId }),
    ).rejects.toMatchObject({ code: 'WORKTREE_EXECUTION_NOT_IN_REVIEW' });
    expect(mergeGit).toHaveBeenCalledTimes(1);
    await service.shutdown();
  });

  it('读取旧差异期间 run 变化不把新 attempt token 配给旧 review', async () => {
    const fixture = await seedFixture('merge-review-snapshot');
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: 'review snapshot',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const service = createService(runtime);
    const queued = await service.queueTask(task.id, { agentId: fixture.agentId }, 'local-trusted');
    await service.processQueue(fixture.projectId);
    const running = await waitForStatus(queued.execution.id, 'RUNNING');
    await complete(service, task.id, running.runId!);
    const before = await service.review(queued.execution.id);
    expect(before.mergeAdmission).toMatchObject({
      expectedRunId: running.runId,
      retryEligible: false,
    });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const original = runtime.git.review.bind(runtime.git);
    vi.spyOn(runtime.git, 'review').mockImplementationOnce(async (input) => {
      entered();
      await gate;
      return original(input);
    });
    const pending = service.review(queued.execution.id);
    await ready;
    const newer = await service.rework(queued.execution.id, 'new review generation');
    await complete(service, task.id, newer.runId!);
    release();
    expect((await pending).mergeAdmission).toBeNull();
    const current = await service.review(queued.execution.id);
    expect(current.mergeAdmission?.expectedRunId).toBe(newer.runId);
    expect(current.mergeAdmission?.expectedOperationId).not.toBe(
      before.mergeAdmission?.expectedOperationId,
    );
    await service.shutdown();
  });

  it('无账本前置拒绝不能重新领取；独立新执行 UNKNOWN 不回退 raw Git 或 REVIEW', async () => {
    const fixture = await seedFixture('managed-merge-replay');
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: 'replay',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const managed = bootRuntimes.shift()!;
    const service = createService(runtime, managed);
    const queued = await service.queueTask(task.id, { agentId: fixture.agentId }, 'local-trusted');
    await service.processQueue(fixture.projectId);
    const running = await waitForStatus(queued.execution.id, 'RUNNING');
    await complete(service, task.id, running.runId!);
    const merge = vi.spyOn(runtime.git, 'commitAndMerge');
    const run = vi
      .spyOn(managed.writes, 'run')
      .mockRejectedValue(new AppError(409, 'WORKTREE_GIT_PREWRITE_REJECTED', 'rejected'));
    await expect(mergeReviewed(service, queued.execution.id, 'first')).rejects.toMatchObject({
      code: 'WORKTREE_GIT_PREWRITE_REJECTED',
    });
    const rejected = await service.get(queued.execution.id);
    await expect(mergeReviewed(service, queued.execution.id, 'changed')).rejects.toMatchObject({
      code: 'WORKTREE_EXECUTION_CHANGED',
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(await service.get(queued.execution.id)).toEqual(rejected);
    expect(merge).not.toHaveBeenCalled();
    run.mockRestore();

    // UNKNOWN needs an independent clean execution, never a reset of the rejected
    // attempt's persisted evidence or relaxed admission guard.
    const freshFixture = await seedFixture('managed-merge-independent-unknown');
    const freshTask = await tasks.create({
      id: randomUUID(),
      projectId: freshFixture.projectId,
      title: 'independent unknown',
      status: 'READY',
    });
    const fresh = await service.queueTask(
      freshTask.id,
      { agentId: freshFixture.agentId },
      'local-trusted',
    );
    await service.processQueue(freshFixture.projectId);
    const freshRunning = await waitForStatus(fresh.execution.id, 'RUNNING');
    await complete(service, freshTask.id, freshRunning.runId!);
    const unknownRun = vi
      .spyOn(managed.writes, 'run')
      .mockRejectedValue(new AppError(409, 'WORKTREE_GIT_OUTCOME_UNKNOWN', 'unknown'));
    await expect(mergeReviewed(service, fresh.execution.id)).rejects.toMatchObject({
      code: 'WORKTREE_GIT_OUTCOME_UNKNOWN',
    });
    expect((await service.get(fresh.execution.id)).status).toBe('MERGING');
    expect(merge).not.toHaveBeenCalled();
    await expect(service.cancel(fresh.execution.id)).rejects.toMatchObject({
      code: 'WORKTREE_EXECUTION_BUSY',
    });
    await expect(mergeReviewed(service, fresh.execution.id)).rejects.toMatchObject({
      code: 'WORKTREE_EXECUTION_NOT_IN_REVIEW',
    });
    expect(unknownRun).toHaveBeenCalledTimes(1);
    await service.shutdown();
  });

  it('创建被协调器隔离后保留 SETTING_UP 槽位且绝不 raw fallback', async () => {
    const fixture = await seedFixture('managed-create-unknown');
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: 'unknown',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const managed = bootRuntimes.shift()!;
    vi.spyOn(managed.writes, 'run').mockRejectedValue(
      new AppError(409, 'WORKTREE_GIT_OUTCOME_UNKNOWN', 'unknown'),
    );
    const create = vi.spyOn(runtime.git, 'create');
    const service = createService(runtime, managed);
    const queued = await service.queueTask(task.id, { agentId: fixture.agentId }, 'local-trusted');
    await service.processQueue(fixture.projectId);
    const isolated = await service.get(queued.execution.id);
    expect(isolated.status).toBe('SETTING_UP');
    expect(isolated.errorCode).toBe('WORKTREE_GIT_OUTCOME_UNKNOWN');
    expect(create).not.toHaveBeenCalled();
    await expect(service.cancel(isolated.id)).rejects.toMatchObject({
      code: 'WORKTREE_EXECUTION_BUSY',
    });
    await service.shutdown();
  });

  it('启用 runtime 后历史 ownerless 队列不回退 raw Git', async () => {
    const fixture = await seedFixture('managed-ownerless');
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: 'legacy',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const managed = bootRuntimes.shift()!;
    const create = vi.spyOn(runtime.git, 'create');
    const resolve = vi.spyOn(managed, 'resolve');
    const service = createService(runtime, managed);
    const queued = await service.queueTask(task.id, { agentId: fixture.agentId });
    await service.processQueue(fixture.projectId);
    const blocked = await waitForStatus(queued.execution.id, 'BLOCKED');
    expect(blocked.errorCode).toBe('WORKTREE_GIT_OWNER_MISSING');
    expect(create).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    await service.shutdown();
  });

  it.each(['SETTING_UP', 'RUNNING', 'MERGING'] as const)(
    '取消旧快照时 %s 已抢先进入，不能释放隔离队列槽位',
    async (winner) => {
      const fixture = await seedFixture(`cancel-race-${winner}`);
      const task = await tasks.create({
        id: randomUUID(),
        projectId: fixture.projectId,
        title: '取消竞争',
        status: 'READY',
      });
      const runtime = createRuntime(database);
      const service = createService(runtime);
      const queued = await executions.enqueue({
        id: randomUUID(),
        taskId: task.id,
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        assignedAgentId: fixture.agentId,
        baseBranch: 'main',
        baseSha: 'a'.repeat(40),
        taskBranch: `race-${task.id}`,
      });
      if (winner !== 'SETTING_UP') {
        await service.processQueue(fixture.projectId);
        const running = (await executions.get(queued.execution.id))!;
        await complete(service, task.id, running.runId!);
      }
      const nextTask = await tasks.create({
        id: randomUUID(),
        projectId: fixture.projectId,
        title: '后续队列项',
        status: 'READY',
      });
      const next = await executions.enqueue({
        id: randomUUID(),
        taskId: nextTask.id,
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        assignedAgentId: fixture.agentId,
        baseBranch: 'main',
        baseSha: 'a'.repeat(40),
        taskBranch: `next-${nextTask.id}`,
        // Keep the intended head deterministic even at identical timestamp precision.
        queuedAt: new Date(Date.now() + 60_000),
      });
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const transition = executions.transitionWithTask.bind(executions);
      const paused = vi
        .spyOn(executions, 'transitionWithTask')
        .mockImplementationOnce(async (...args) => {
          enter();
          await barrier;
          return transition(...args);
        });
      const cancellation = service.cancel(queued.execution.id);
      // Attach the rejection assertion before releasing the barrier.
      const rejected = expect(cancellation).rejects.toMatchObject({
        code: 'WORKTREE_EXECUTION_CHANGED',
      });
      try {
        await entered;
        if (winner === 'SETTING_UP') await executions.claimNext(fixture.projectId);
        else if (winner === 'RUNNING')
          await transition(queued.execution.id, 'RUNNING', 'IN_PROGRESS');
        else await executions.transition(queued.execution.id, 'MERGING');
        const taskBefore = await tasks.get(task.id);
        release();
        await rejected;
        expect((await executions.get(queued.execution.id))?.status).toBe(winner);
        expect((await tasks.get(task.id))?.status).toBe(taskBefore?.status);
        expect(runtime.events.some((event) => event.type === 'worktree.execution.canceled')).toBe(
          false,
        );
        expect(await executions.claimNext(fixture.projectId)).toBeUndefined();
        expect((await executions.get(next.execution.id))?.status).toBe('QUEUED');
      } finally {
        release();
        paused.mockRestore();
        await service.shutdown();
        await transition(next.execution.id, 'CANCELED', 'CANCELED');
        // This suite shares one database; do not leak active race fixtures into recovery.
        const remaining = await executions.get(queued.execution.id);
        if (remaining && ['SETTING_UP', 'RUNNING', 'MERGING'].includes(remaining.status)) {
          await transition(queued.execution.id, 'BLOCKED', 'BLOCKED');
        }
      }
    },
  );

  it.each(
    (['start', 'rework'] as const).flatMap((mode) =>
      (
        [
          'RUNNING',
          'QUEUED',
          'DISCONNECTED',
          'FAILED_UNKNOWN',
          'COMPLETED',
          'CALLBACK',
          'CANCELED_CALLBACK',
        ] as const
      ).map((state) => ({ mode, state })),
    ),
  )('竞争Run抢先$mode/$state后原请求失败不得释放隔离槽位', async ({ mode, state }) => {
    const fixture = await seedFixture(`start-race-${mode}-${state}`);
    let nextId: string | undefined;
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '竞争启动',
      status: 'READY',
    });
    const nextTask = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '下一项',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const service = createService(runtime);
    const queued = await service.queueTask(task.id, { agentId: fixture.agentId });
    let proceed!: () => void;
    let reached!: (id: string) => void;
    const entered = new Promise<string>((resolve) => {
      reached = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const original = runtime.sessions.startRun;
    if (mode === 'rework') {
      await service.processQueue(fixture.projectId);
      const running = await waitForStatus(queued.execution.id, 'RUNNING');
      await complete(service, task.id, running.runId!);
    }
    const paused = vi
      .spyOn(runtime.sessions, 'startRun')
      .mockImplementationOnce(async (sessionId) => {
        reached(sessionId);
        await barrier;
        throw new AppError(409, 'SESSION_RUN_UNRESOLVED', '另一个Run已占槽');
      });
    const operation =
      mode === 'start'
        ? service.processQueue(fixture.projectId)
        : service.rework(queued.execution.id, '继续');
    const handled = operation.catch(() => undefined);
    try {
      const sessionId = await entered;
      const winner = await original(sessionId, { text: '竞争请求' });
      const runs = new RunRepository(database.db);
      if (state === 'CALLBACK') await complete(service, task.id, winner.id);
      else if (state === 'CANCELED_CALLBACK') await stop(service, task.id, winner.id, 'CANCELED');
      else if (state === 'FAILED_UNKNOWN')
        await runs.patch(winner.id, {
          status: 'FAILED',
          dispatchState: 'LEGACY_UNKNOWN',
          errorCode: 'SERVER_RESTARTED',
        });
      else await runs.patch(winner.id, { status: state });
      const next = await service.queueTask(nextTask.id, { agentId: fixture.agentId });
      nextId = next.execution.id;
      proceed();
      await handled;
      if (state === 'CANCELED_CALLBACK') {
        expect((await executions.get(queued.execution.id))?.status).toBe('CANCELED');
        if (mode === 'rework') await service.processQueue(fixture.projectId);
        const nextRunning = await waitForStatus(next.execution.id, 'RUNNING');
        await stop(service, nextTask.id, nextRunning.runId!, 'CANCELED');
        return;
      }
      expect((await executions.get(queued.execution.id))?.status).toBe(
        state === 'CALLBACK' ? 'REVIEW' : 'RUNNING',
      );
      expect((await tasks.get(task.id))?.status).toBe(
        state === 'CALLBACK' ? 'WAITING_REVIEW' : 'IN_PROGRESS',
      );
      expect(await executions.claimNext(fixture.projectId)).toBeUndefined();
      expect((await executions.get(next.execution.id))?.status).toBe('QUEUED');
      await runs.patch(winner.id, {
        status: 'COMPLETED',
        dispatchState: 'ATTEMPTED',
        errorCode: null,
      });
      await service.onRunCompleted(task.id, winner.id);
      expect((await executions.get(queued.execution.id))?.status).toBe('REVIEW');
    } finally {
      proceed();
      await handled;
      paused.mockRestore();
      await service.shutdown();
      for (const id of [nextId, queued.execution.id])
        if (id && !['CANCELED', 'DONE'].includes((await executions.get(id))!.status))
          await service.cancel(id);
    }
  });

  it('AH002隔离执行保存Task默认变量且显式值覆盖，返工沿用执行快照', async () => {
    const fixture = await seedFixture('Prompt variables');
    const defaults = { subject: 'saved', suffix: 'retained', flag: true, count: 7 };
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '保存模板稍后隔离执行',
      status: 'READY',
      promptVariablesJson: defaults,
    });
    const runtime = createRuntime(database);
    const service = createService(runtime);
    const queued = await service.queueTask(task.id, {
      agentId: fixture.agentId,
      promptVariables: { subject: 'override', flag: false, count: 0 },
    });
    await service.processQueue(fixture.projectId);
    const running = await waitForStatus(queued.execution.id, 'RUNNING');
    const expected = { subject: 'override', suffix: 'retained', flag: false, count: 0 };
    expect((await executions.get(queued.execution.id))?.configJson.promptVariables).toEqual(
      expected,
    );
    expect(runtime.sessions.started[0]?.input.promptVariables).toEqual(expected);
    await complete(service, task.id, running.runId!);
    const reworked = await service.rework(queued.execution.id, '保留同一隔离执行的模板上下文');
    expect(runtime.sessions.started[1]?.input.promptVariables).toEqual(expected);
    expect((await tasks.get(task.id))?.promptVariablesJson).toEqual(defaults);
    await stop(service, task.id, reworked.runId!, 'CANCELED');
    await service.shutdown();
  });

  it('AH002隔离返工不得丢掉已显式存入execution的变量', async () => {
    const fixture = await seedFixture('Explicit variables');
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '显式模板变量',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const service = createService(runtime);
    const variables = { subject: 'execution-context', empty: null };
    const queued = await service.queueTask(task.id, {
      agentId: fixture.agentId,
      promptVariables: variables,
    });
    await service.processQueue(fixture.projectId);
    const running = await waitForStatus(queued.execution.id, 'RUNNING');
    expect(runtime.sessions.started[0]?.input.promptVariables).toEqual(variables);
    await complete(service, task.id, running.runId!);
    const reworked = await service.rework(queued.execution.id, '继续修改');
    expect(runtime.sessions.started[1]?.input.promptVariables).toEqual(variables);
    await stop(service, task.id, reworked.runId!, 'CANCELED');
    await service.shutdown();
  });

  it.each(['snapshot', 'empty', 'legacy'] as const)(
    'AH002排队等待与服务重建保留%s执行输入，不吸收后来Task变量',
    async (mode) => {
      const fixture = await seedFixture('Queued snapshot');
      const blocker = await tasks.create({
        id: randomUUID(),
        projectId: fixture.projectId,
        title: '占用隔离槽位',
        status: 'READY',
      });
      const task = await tasks.create({
        id: randomUUID(),
        projectId: fixture.projectId,
        title: '排队模板',
        status: 'READY',
        promptVariablesJson: mode === 'snapshot' ? { subject: 'saved', nested: { value: 0 } } : {},
      });
      const firstRuntime = createRuntime(database);
      const firstService = createService(firstRuntime);
      const blocking = await firstService.queueTask(blocker.id, { agentId: fixture.agentId });
      await firstService.processQueue(fixture.projectId);
      const blockingRun = await waitForStatus(blocking.execution.id, 'RUNNING');
      const queued = await firstService.queueTask(task.id, { agentId: fixture.agentId });
      await firstService.processQueue(fixture.projectId);
      expect((await executions.get(queued.execution.id))?.status).toBe('QUEUED');
      if (mode === 'legacy') await executions.patch(queued.execution.id, { configJson: {} });
      else
        expect((await executions.get(queued.execution.id))?.configJson.promptVariables).toEqual(
          mode === 'snapshot' ? { subject: 'saved', nested: { value: 0 } } : {},
        );
      await tasks.update(task.id, {
        promptVariablesJson: { subject: 'later-default', extra: 'must-not-leak' },
      });
      await firstService.shutdown();
      await stop(firstService, blocker.id, blockingRun.runId!, 'CANCELED');
      const resumedRuntime = createRuntime(database);
      const resumedService = createService(resumedRuntime);
      await resumedService.processQueue(fixture.projectId);
      const running = await waitForStatus(queued.execution.id, 'RUNNING');
      const expected =
        mode === 'legacy'
          ? undefined
          : mode === 'snapshot'
            ? { subject: 'saved', nested: { value: 0 } }
            : {};
      expect(resumedRuntime.sessions.started[0]?.input.promptVariables).toEqual(expected);
      await complete(resumedService, task.id, running.runId!);
      const reworked = await resumedService.rework(queued.execution.id, '同一执行继续');
      expect(resumedRuntime.sessions.started[1]?.input.promptVariables).toEqual(expected);
      expect((await tasks.get(task.id))?.promptVariablesJson).toEqual({
        subject: 'later-default',
        extra: 'must-not-leak',
      });
      await stop(resumedService, task.id, reworked.runId!, 'CANCELED');
      await resumedService.shutdown();
    },
  );

  it.each([false, true])('派发未知不覆盖Worktree状态，权威完成先到=%s', async (completeFirst) => {
    const fixture = await seedFixture('Unknown dispatch');
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '未知派发',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const service = createService(runtime);
    const original = runtime.sessions.startRun;
    runtime.sessions.startRun = async (sessionId, input) => {
      const run = await original(sessionId, input);
      if (completeFirst) await complete(service, task.id, run.id);
      throw new RunStartError('DISPATCH_UNKNOWN', sessionId, run.id);
    };
    let executionId: string | undefined;
    try {
      const queued = await service.queueTask(task.id, { agentId: fixture.agentId });
      executionId = queued.execution.id;
      await service.processQueue(fixture.projectId);
      const execution = await executions.get(queued.execution.id);
      expect(execution?.status).toBe(completeFirst ? 'REVIEW' : 'RUNNING');
      expect((await tasks.get(task.id))?.status).toBe(
        completeFirst ? 'WAITING_REVIEW' : 'IN_PROGRESS',
      );
      expect(runtime.sessions.started).toHaveLength(1);
      if (!completeFirst) await complete(service, task.id, runtime.sessions.started[0]!.runId);
      expect((await executions.get(queued.execution.id))?.status).toBe('REVIEW');
      await expect(service.rework(queued.execution.id, '再次修改')).rejects.toMatchObject({
        code: 'AGENT_RUN_DISPATCH_UNKNOWN',
      });
      expect((await executions.get(queued.execution.id))?.status).toBe(
        completeFirst ? 'REVIEW' : 'RUNNING',
      );
      expect((await tasks.get(task.id))?.status).toBe(
        completeFirst ? 'WAITING_REVIEW' : 'IN_PROGRESS',
      );
      expect(runtime.sessions.started).toHaveLength(2);
    } finally {
      if (executionId) {
        const current = (await executions.get(executionId))!;
        if (['RUNNING', 'AWAITING_INPUT'].includes(current.status))
          await stop(service, task.id, current.runId!, 'CANCELED');
        else await service.cancel(executionId);
      }
      await service.shutdown();
    }
  });

  it.each([
    ['START', 'CANCELED'],
    ['REWORK', 'CANCELED'],
    ['START', 'COMPLETED'],
    ['REWORK', 'COMPLETED'],
  ] as const)('未知%s取消精确新Run，%s权威回调前不释放队列', async (mode, winner) => {
    const fixture = await seedFixture('取消未确认');
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '当前',
      status: 'READY',
    });
    const nextTask = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '下一项',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const service = createService(runtime);
    const runs = new RunRepository(database.db);
    const original = runtime.sessions.startRun;
    runtime.sessions.startRun = async (sessionId, input) => {
      const run = await original(sessionId, input);
      throw new RunStartError('DISPATCH_UNKNOWN', sessionId, run.id);
    };
    const cancel = vi
      .spyOn(runtime.sessions, 'cancelRun')
      .mockImplementation(async (_sessionId, runId) => {
        return runs.transition(runId, 'CANCELING');
      });
    const first = await service.queueTask(task.id, { agentId: fixture.agentId });
    const next = await service.queueTask(nextTask.id, { agentId: fixture.agentId });
    try {
      await service.processQueue(fixture.projectId);
      const initial = (await executions.get(first.execution.id))!;
      expect(initial.runId).toBe(runtime.sessions.started[0]!.runId);
      if (mode === 'REWORK') {
        await runs.transition(initial.runId!, 'COMPLETED');
        await complete(service, task.id, initial.runId!);
        await expect(service.rework(first.execution.id, '返工')).rejects.toMatchObject({
          code: 'AGENT_RUN_DISPATCH_UNKNOWN',
        });
      }
      const current = (await executions.get(first.execution.id))!;
      const actual = runtime.sessions.started.at(-1)!.runId;
      expect(current.runId).toBe(actual);
      if (mode === 'REWORK') {
        expect(actual).not.toBe(initial.runId);
        expect(
          await executions.bindCurrentRun(current.id, {
            sessionId: current.sessionId!,
            runId: initial.runId!,
          }),
        ).toBeUndefined();
      }
      await service.cancel(current.id);
      expect(cancel).toHaveBeenCalledWith(current.sessionId, actual);
      expect((await runs.get(actual))?.status).toBe('CANCELING');
      expect((await executions.get(current.id))?.status).toBe('RUNNING');
      expect((await tasks.get(task.id))?.status).toBe('IN_PROGRESS');
      expect((await executions.get(next.execution.id))?.status).toBe('QUEUED');
      await runs.transition(actual, winner);
      if (winner === 'COMPLETED') await complete(service, task.id, actual);
      else await stop(service, task.id, actual, 'CANCELED');
      expect((await executions.get(current.id))?.status).toBe(
        winner === 'COMPLETED' ? 'REVIEW' : 'CANCELED',
      );
      expect(
        await executions.bindCurrentRun(current.id, {
          sessionId: current.sessionId!,
          runId: actual,
        }),
      ).toBeUndefined();
      if (winner === 'COMPLETED')
        expect((await executions.get(next.execution.id))?.status).toBe('QUEUED');
    } finally {
      await service.shutdown();
      for (const id of [first.execution.id, next.execution.id]) {
        const current = (await executions.get(id))!;
        if (['RUNNING', 'AWAITING_INPUT'].includes(current.status))
          await stop(service, current.taskId, current.runId!, 'CANCELED');
        else if (!['DONE', 'CANCELED'].includes(current.status)) await service.cancel(id);
      }
      await service.shutdown();
      cancel.mockRestore();
    }
  });

  it.each(['START', 'REWORK'] as const)(
    '%s成功派发后的绑定写失败不会BLOCKED，cancel仍从durable最新Run定位',
    async (mode) => {
      const fixture = await seedFixture('绑定写失败');
      const task = await tasks.create({
        id: randomUUID(),
        projectId: fixture.projectId,
        title: '绑定失败',
        status: 'READY',
      });
      const runtime = createRuntime(database);
      const service = createService(runtime);
      const binding = vi.spyOn(executions, 'bindCurrentRun');
      if (mode === 'START') binding.mockRejectedValue(new Error('DB binding'));
      const queued = await service.queueTask(task.id, { agentId: fixture.agentId });
      try {
        await service.processQueue(fixture.projectId);
        if (mode === 'REWORK') {
          await complete(service, task.id, runtime.sessions.started.at(-1)!.runId);
          binding.mockRejectedValue(new Error('DB binding'));
          await expect(service.rework(queued.execution.id, '再次修改')).rejects.toMatchObject({
            code: 'AGENT_RUN_DISPATCH_UNKNOWN',
          });
        }
        expect((await executions.get(queued.execution.id))?.status).toBe('RUNNING');
        expect((await tasks.get(task.id))?.status).toBe('IN_PROGRESS');
        const runId = runtime.sessions.started.at(-1)!.runId;
        binding.mockRestore();
        const cancel = vi.spyOn(runtime.sessions, 'cancelRun');
        await service.cancel(queued.execution.id);
        expect(cancel).toHaveBeenCalledWith(runtime.sessions.started.at(-1)!.sessionId, runId);
        expect((await executions.get(queued.execution.id))?.status).toBe('RUNNING');
        await complete(service, task.id, runId);
        expect((await executions.get(queued.execution.id))?.status).toBe('REVIEW');
      } finally {
        binding.mockRestore();
        const current = (await executions.get(queued.execution.id))!;
        if (current.status === 'RUNNING')
          await stop(service, task.id, runtime.sessions.started.at(-1)!.runId, 'CANCELED');
        else await service.cancel(queued.execution.id);
        await service.shutdown();
      }
    },
  );

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
    await complete(service, firstTask.id, firstRunning.runId!);
    expect((await tasks.get(firstTask.id))?.status).toBe('WAITING_REVIEW');
    expect((await executions.get(second.execution.id))?.status).toBe('QUEUED');

    const reworked = await service.rework(first.execution.id, '请补充回归测试');
    expect(reworked.status).toBe('RUNNING');
    expect(runtime.sessions.started.at(-1)?.input.text).toBe('请补充回归测试');
    await complete(service, firstTask.id, reworked.runId!);
    const merged = await mergeReviewed(service, first.execution.id);
    expect(merged.execution.status).toBe('DONE');
    expect((await tasks.get(firstTask.id))?.status).toBe('DONE');

    await service.processQueue(fixture.projectId);
    expect((await executions.get(second.execution.id))?.status).toBe('RUNNING');
    expect(runtime.events.some((event) => event.type === 'worktree.execution.review_ready')).toBe(
      true,
    );
    await service.cancel(second.execution.id);
    const canceledRun = (await executions.get(second.execution.id))!.runId!;
    await stop(service, secondTask.id, canceledRun, 'CANCELED');
    await service.shutdown();
  });

  it('旧 merge 快照跨返工 Run 代际后不能合并未经本次请求审阅的新结果', async () => {
    const fixture = await seedFixture('MERGE-ABA');
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '合并代际竞争',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const service = createService(runtime);
    const queued = await service.queueTask(task.id, { agentId: fixture.agentId });
    await service.processQueue(fixture.projectId);
    const first = await waitForStatus(queued.execution.id, 'RUNNING');
    await complete(service, task.id, first.runId!);
    const mergeGit = vi.spyOn(runtime.git, 'commitAndMerge');
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const claim = executions.claimReviewForMerge.bind(executions);
    const paused = vi
      .spyOn(executions, 'claimReviewForMerge')
      .mockImplementationOnce(async (...args) => {
        enter();
        await barrier;
        return claim(...args);
      });
    const oldMerge = mergeReviewed(service, queued.execution.id).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    try {
      await entered;
      const second = await service.rework(queued.execution.id, '新一轮返工');
      expect(second.runId).not.toBe(first.runId);
      await complete(service, task.id, second.runId!);
      const reviewed = await executions.get(queued.execution.id);
      const reviewedTask = await tasks.get(task.id);
      release();
      const outcome = await oldMerge;
      expect(outcome).toMatchObject({ error: { status: 409, code: 'WORKTREE_EXECUTION_CHANGED' } });
      expect(mergeGit).not.toHaveBeenCalled();
      expect(await executions.get(queued.execution.id)).toEqual(reviewed);
      expect(await tasks.get(task.id)).toEqual(reviewedTask);
      // A fresh explicit merge can still accept the new generation.
      const accepted = await mergeReviewed(service, queued.execution.id);
      expect(accepted.execution.status).toBe('DONE');
      expect(accepted.execution.runId).toBe(second.runId);
      expect(accepted.task.finalRunId).toBe(second.runId);
      expect(mergeGit).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await oldMerge;
      paused.mockRestore();
      mergeGit.mockRestore();
      await service.shutdown();
    }
  });

  it.each(['RUNNING', 'COMPLETED'] as const)(
    'Execution 仍是旧 REVIEW，但 Session 已有新的 %s Run 时禁止合并',
    async (newStatus) => {
      const fixture = await seedFixture(`MERGE-NEW-RUN-${newStatus}`);
      const task = await tasks.create({
        id: randomUUID(),
        projectId: fixture.projectId,
        title: '新的会话轮次',
        status: 'READY',
      });
      const runtime = createRuntime(database);
      const service = createService(runtime);
      const queued = await service.queueTask(task.id, { agentId: fixture.agentId });
      await service.processQueue(fixture.projectId);
      const first = await waitForStatus(queued.execution.id, 'RUNNING');
      await complete(service, task.id, first.runId!);
      // Admission now rejects new turns during REVIEW. Create the new Run through
      // its legal managed RUNNING phase, then explicitly seed legacy inconsistent
      // ownership left by older versions. This is not an alternate product path
      // around the admission guard; merge must still reject such persisted data.
      await executions.transitionWithTask(
        first.id,
        'RUNNING',
        'IN_PROGRESS',
        { reviewReadyAt: null },
        { finalRunId: null },
      );
      const next = await runtime.sessions.startRun(first.sessionId!, { text: '新一轮合法准入' });
      if (newStatus === 'COMPLETED')
        await new RunRepository(database.db).tryTransition(next.id, ['RUNNING'], 'COMPLETED');
      await executions.transitionWithTask(
        first.id,
        'REVIEW',
        'WAITING_REVIEW',
        { runId: first.runId, reviewReadyAt: new Date() },
        { finalRunId: first.runId },
      );
      const before = await executions.get(first.id);
      const beforeTask = await tasks.get(task.id);
      const mergeGit = vi.spyOn(runtime.git, 'commitAndMerge');
      try {
        await expect(mergeReviewed(service, first.id)).rejects.toMatchObject({
          status: 409,
          code: 'WORKTREE_EXECUTION_CHANGED',
        });
        expect(mergeGit).not.toHaveBeenCalled();
        expect(await executions.get(first.id)).toEqual(before);
        expect(await tasks.get(task.id)).toEqual(beforeTask);
      } finally {
        mergeGit.mockRestore();
        await service.shutdown();
      }
    },
  );

  it.each(['task-final-run', 'session-task', 'run-not-completed'] as const)(
    '合并 claim 拒绝不一致的持久归属：%s',
    async (mismatch) => {
      const fixture = await seedFixture(`MERGE-OWNERSHIP-${mismatch}`);
      const task = await tasks.create({
        id: randomUUID(),
        projectId: fixture.projectId,
        title: '持久归属核对',
        status: 'READY',
      });
      const runtime = createRuntime(database);
      const service = createService(runtime);
      const queued = await service.queueTask(task.id, { agentId: fixture.agentId });
      await service.processQueue(fixture.projectId);
      const first = await waitForStatus(queued.execution.id, 'RUNNING');
      if (mismatch === 'run-not-completed') {
        // Simulate a stale REVIEW row; the actual durable Run is still RUNNING.
        await executions.transition(first.id, 'REVIEW');
        await tasks.transition(task.id, 'WAITING_REVIEW', { finalRunId: first.runId });
      } else {
        await complete(service, task.id, first.runId!);
        if (mismatch === 'task-final-run') await tasks.update(task.id, { finalRunId: null });
        else
          await new SessionRepository(database.db).transition(first.sessionId!, 'CLOSED', {
            taskId: null,
          });
      }
      const before = await executions.get(first.id);
      const beforeTask = await tasks.get(task.id);
      const mergeGit = vi.spyOn(runtime.git, 'commitAndMerge');
      try {
        await expect(mergeReviewed(service, first.id)).rejects.toMatchObject({
          status: 409,
          code: 'WORKTREE_EXECUTION_CHANGED',
        });
        expect(mergeGit).not.toHaveBeenCalled();
        expect(await executions.get(first.id)).toEqual(before);
        expect(await tasks.get(task.id)).toEqual(beforeTask);
      } finally {
        mergeGit.mockRestore();
        await service.shutdown();
      }
    },
  );

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
      'PRIMARY_WORKTREE_DIRTY',
      'Project 主工作区存在未提交变更',
    );
    const service = createService(runtime);
    const queued = await service.queueTask(task.id, { agentId: fixture.agentId });
    await service.processQueue(fixture.projectId);
    const running = await waitForStatus(queued.execution.id, 'RUNNING');
    await complete(service, task.id, running.runId!);

    await expect(mergeReviewed(service, queued.execution.id)).rejects.toMatchObject({
      code: 'PRIMARY_WORKTREE_DIRTY',
    });
    expect(await executions.get(queued.execution.id)).toMatchObject({
      status: 'REVIEW',
      errorCode: 'PRIMARY_WORKTREE_DIRTY',
    });
    expect((await tasks.get(task.id))?.status).toBe('WAITING_REVIEW');
    await service.shutdown();
  });

  it.each(['command-unknown', 'completion-db-failed', 'publish-failed'] as const)(
    '合并 %s 不恢复为可重试 REVIEW 或倒退 DONE',
    async (mode) => {
      const fixture = await seedFixture(`unknown-merge-${mode}`);
      const task = await tasks.create({
        id: randomUUID(),
        projectId: fixture.projectId,
        title: '未知合并',
        status: 'READY',
      });
      const next = await tasks.create({
        id: randomUUID(),
        projectId: fixture.projectId,
        title: '后续任务',
        status: 'READY',
      });
      const runtime = createRuntime(database);
      const service = createService(runtime);
      const queued = await service.queueTask(task.id, { agentId: fixture.agentId });
      await service.processQueue(fixture.projectId);
      const running = await waitForStatus(queued.execution.id, 'RUNNING');
      await complete(service, task.id, running.runId!);
      const second = await service.queueTask(next.id, { agentId: fixture.agentId });
      const git = vi.spyOn(runtime.git, 'commitAndMerge');
      let restore = () => {};
      if (mode === 'command-unknown')
        runtime.git.mergeError = new AppError(409, 'WORKTREE_GIT_OUTCOME_UNKNOWN', 'unknown');
      if (mode === 'completion-db-failed') {
        const spy = vi
          .spyOn(executions, 'transitionWithTask')
          .mockRejectedValueOnce(new Error('DB unavailable'));
        restore = () => spy.mockRestore();
      }
      if (mode === 'publish-failed') {
        const spy = vi.spyOn(runtime.publisher, 'publish').mockImplementationOnce(() => {
          throw new Error('publisher unavailable');
        });
        restore = () => spy.mockRestore();
      }
      try {
        await expect(mergeReviewed(service, queued.execution.id)).rejects.toMatchObject({
          code: 'WORKTREE_GIT_OUTCOME_UNKNOWN',
        });
        expect((await executions.get(queued.execution.id))?.status).toBe(
          mode === 'publish-failed' ? 'DONE' : 'MERGING',
        );
        await expect(mergeReviewed(service, queued.execution.id)).rejects.toMatchObject({
          code: 'WORKTREE_EXECUTION_NOT_IN_REVIEW',
        });
        await expect(service.rework(queued.execution.id, 'retry')).rejects.toMatchObject({
          code: 'WORKTREE_EXECUTION_NOT_IN_REVIEW',
        });
        await expect(service.cancel(queued.execution.id)).rejects.toMatchObject({
          code:
            mode === 'publish-failed'
              ? 'WORKTREE_EXECUTION_NOT_CANCELABLE'
              : 'WORKTREE_EXECUTION_BUSY',
        });
        expect(git).toHaveBeenCalledTimes(1);
        if (mode !== 'publish-failed') {
          await service.processQueue(fixture.projectId);
          expect((await executions.get(second.execution.id))?.status).toBe('QUEUED');
        }
      } finally {
        restore();
        git.mockRestore();
        await service.shutdown();
        if (mode !== 'publish-failed')
          await executions.transitionWithTask(queued.execution.id, 'BLOCKED', 'BLOCKED');
        await executions.transitionWithTask(second.execution.id, 'CANCELED', 'CANCELED');
      }
    },
  );
  it.each(['command-unknown', 'post-create-db-failed'] as const)(
    'Worktree 创建 %s 保留 SETTING_UP，禁止取消与启动后续任务',
    async (mode) => {
      const fixture = await seedFixture('unknown-create');
      const runtime = createRuntime(database);
      const service = createService(runtime);
      const git = vi.spyOn(runtime.git, 'create');
      if (mode === 'command-unknown')
        git.mockRejectedValue(new AppError(409, 'WORKTREE_GIT_OUTCOME_UNKNOWN', 'unknown'));
      const patch =
        mode === 'post-create-db-failed'
          ? vi
              .spyOn(executions, 'patch')
              .mockRejectedValueOnce(new Error('DB unavailable after Git'))
          : undefined;
      const queued = [];
      for (let i = 0; i < 2; i++) {
        const task = await tasks.create({
          id: randomUUID(),
          projectId: fixture.projectId,
          title: `create-${i}`,
          status: 'READY',
        });
        queued.push(await service.queueTask(task.id, { agentId: fixture.agentId }));
      }
      await service.processQueue(fixture.projectId);
      expect(await executions.get(queued[0]!.execution.id)).toMatchObject({
        status: 'SETTING_UP',
        errorCode: 'WORKTREE_GIT_OUTCOME_UNKNOWN',
      });
      expect((await executions.get(queued[1]!.execution.id))?.status).toBe('QUEUED');
      await expect(service.cancel(queued[0]!.execution.id)).rejects.toMatchObject({
        code: 'WORKTREE_EXECUTION_BUSY',
      });
      expect(git).toHaveBeenCalledTimes(1);
      await service.shutdown();
      git.mockRestore();
      patch?.mockRestore();
      await executions.transitionWithTask(queued[0]!.execution.id, 'BLOCKED', 'BLOCKED');
      await executions.transitionWithTask(queued[1]!.execution.id, 'CANCELED', 'CANCELED');
    },
  );

  it('重启恢复隔离未知 Git 创建状态，不自动释放后续队列', async () => {
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
    expect(recovery.blocked).not.toContain(firstId);
    expect(recovery.queuedProjects).toEqual([fixture.projectId]);
    expect(await executions.get(firstId)).toMatchObject({
      status: 'SETTING_UP',
      errorCode: 'WORKTREE_GIT_OUTCOME_UNKNOWN',
    });
    expect((await tasks.get(interruptedTask.id))?.status).toBe('IN_PROGRESS');

    service.resumeQueued(recovery.queuedProjects);
    await service.processQueue(fixture.projectId);
    expect((await executions.get(secondId))?.status).toBe('QUEUED');
    await service.recoverAfterRestart();
    expect((await executions.get(firstId))?.status).toBe('SETTING_UP');
    await service.shutdown();
  });

  it('停服发生于持久Git派发回调之前时禁止raw合并并保留UNKNOWN', async () => {
    const fixture = await seedFixture('merge-stop-managed-callback');
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '协调器回调屏障',
      status: 'READY',
    });
    const runtime = createRuntime(database);
    const managed = bootRuntimes.shift()!;
    const service = createService(runtime, managed);
    const queued = await service.queueTask(task.id, { agentId: fixture.agentId }, 'local-trusted');
    await service.processQueue(fixture.projectId);
    const running = await waitForStatus(queued.execution.id, 'RUNNING');
    await complete(service, task.id, running.runId!);
    let proceed!: () => void;
    let reached!: () => void;
    const barrier = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const originalRun = managed.writes.run.bind(managed.writes);
    const run = vi.spyOn(managed.writes, 'run').mockImplementationOnce((context, write, head) =>
      originalRun(
        context,
        async (resource, payload) => {
          reached();
          await barrier;
          return write(resource, payload);
        },
        head,
      ),
    );
    const git = vi.spyOn(runtime.git, 'commitAndMerge');
    const merging = mergeReviewed(service, queued.execution.id);
    const outcome = merging.catch((error: unknown) => error);
    await entered;
    const shutdown = service.shutdown();
    try {
      proceed();
      expect(await outcome).toMatchObject({ code: 'WORKTREE_GIT_OUTCOME_UNKNOWN' });
      await shutdown;
      expect(git).not.toHaveBeenCalled();
      expect((await executions.get(queued.execution.id))?.status).toBe('MERGING');
      expect((await executions.get(queued.execution.id))?.errorCode).toBe(
        'WORKTREE_GIT_OUTCOME_UNKNOWN',
      );
    } finally {
      proceed();
      await outcome;
      await shutdown;
      run.mockRestore();
      git.mockRestore();
    }
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

  function createService(
    runtime: ReturnType<typeof createRuntime>,
    managedGit?: Awaited<ReturnType<typeof createManagedGitRuntime>>,
  ) {
    return new WorktreeTaskService(
      executions,
      tasks,
      projects,
      agents,
      targets,
      runtime.sessions,
      runtime.git,
      runtime.publisher,
      managedGit,
    );
  }

  async function complete(service: WorktreeTaskService, taskId: string, runId: string) {
    const runs = new RunRepository(database.db);
    const run = await runs.get(runId);
    if (run?.status !== 'COMPLETED')
      await runs.tryTransition(
        runId,
        ['RUNNING', 'WAITING_APPROVAL', 'CANCELING', 'DISCONNECTED'],
        'COMPLETED',
      );
    return service.onRunCompleted(taskId, runId);
  }
  async function stop(
    service: WorktreeTaskService,
    taskId: string,
    runId: string,
    reason: 'CANCELED' | 'FAILED' | 'DISCONNECTED',
  ) {
    const runs = new RunRepository(database.db);
    const run = await runs.get(runId);
    if (run?.status !== reason)
      await runs.tryTransition(
        runId,
        reason === 'DISCONNECTED'
          ? ['RUNNING', 'WAITING_APPROVAL', 'CANCELING']
          : ['RUNNING', 'WAITING_APPROVAL', 'CANCELING', 'DISCONNECTED'],
        reason,
      );
    return service.onRunStopped(taskId, runId, reason);
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
      const session = await new SessionRepository(database.db).get(sessionId);
      await new RunRepository(database.db).create({
        id: runId,
        sessionId,
        taskId: session?.taskId,
        status: 'RUNNING',
      });
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

async function mergeReviewed(service: WorktreeTaskService, id: string, commitMessage?: string) {
  const snapshot = await service.get(id);
  return service.merge(id, {
    expectedRunId: snapshot.runId ?? randomUUID(),
    expectedOperationId: snapshot.runId
      ? deriveWorktreeMergeOperationId(snapshot.id, snapshot.runId, snapshot.gitMergeGeneration)
      : randomUUID(),
    ...(commitMessage ? { commitMessage } : {}),
  });
}
