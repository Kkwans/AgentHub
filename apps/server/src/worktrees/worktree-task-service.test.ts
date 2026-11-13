import { RunStartError } from '../sessions/run-start-error.js';
import { randomUUID } from 'node:crypto';

import {
  RunRepository,
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
    const merged = await service.merge(first.execution.id);
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
    const oldMerge = service.merge(queued.execution.id).then(
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
      const accepted = await service.merge(queued.execution.id);
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
        await expect(service.merge(first.id)).rejects.toMatchObject({
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
        await expect(service.merge(first.id)).rejects.toMatchObject({
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
      'WORKTREE_MERGE_CONFLICT',
      '任务分支与 base branch 存在冲突',
    );
    const service = createService(runtime);
    const queued = await service.queueTask(task.id, { agentId: fixture.agentId });
    await service.processQueue(fixture.projectId);
    const running = await waitForStatus(queued.execution.id, 'RUNNING');
    await complete(service, task.id, running.runId!);

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
