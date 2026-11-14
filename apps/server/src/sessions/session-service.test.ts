import { RemoteAgentAdapter } from '../remote-nodes/remote-agent-adapter.js';
import { RemoteNodeRpcError, type RemoteNodeGateway } from '../remote-nodes/remote-node-gateway.js';
import { AppError } from '../errors.js';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  FakeAgentAdapter,
  ResourceCleanupUnconfirmedError,
  type AgentRuntimeAdapter,
  type AgentSessionHandle,
  type AgentProfile,
  type AgentCapabilities,
  type CreateAgentSessionInput,
  type AgentRunRef,
  type AgentTurnInput,
  type ApprovalDecision,
  type NormalizedAgentEvent,
} from '@agenthub/agent-core';
import {
  AgentRepository,
  ApprovalRepository,
  createPgliteDatabase,
  EventRepository,
  ExecutionTargetRepository,
  MessageRepository,
  ProjectRepository,
  RunRepository,
  WorktreeExecutionRepository,
  TaskRepository,
  GoalRepository,
  SessionRepository,
  SessionContinuationRepository,
  TaskStartAttemptRepository,
} from '@agenthub/db';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TaskService } from '../tasks/task-service.js';
import { AgentService } from '../agents/agent-service.js';
import type { AcpProcessLauncher } from '@agenthub/adapter-acp';
import {
  SessionService,
  type GitHeadProbe,
  type PromptContextResolver,
} from './session-service.js';

describe('Session/Run/Approval 持久化闭环', () => {
  afterEach(() => vi.restoreAllMocks());
  let database: Awaited<ReturnType<typeof createPgliteDatabase>>;

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
  });

  afterAll(async () => {
    await database.close();
  });

  async function createFixture(
    scenario: 'complete' | 'approval' | 'idle',
    promptContext?: PromptContextResolver,
    adapterOptions: {
      includeExternalRunId?: boolean;
      usagePayload?: Record<string, unknown>;
    } = {},
    fixtureOptions: {
      projectRoot?: string;
      projectStatus?: 'ACTIVE' | 'ARCHIVED';
      agentStatus?: string;
      agentEnabled?: boolean;
      agentTargetId?: string;
      adapter?: AgentRuntimeAdapter;
      git?: GitHeadProbe;
      cancelConvergenceTimeoutMs?: number;
      approvalDeliveryTimeoutMs?: number;
    } = {},
  ) {
    const agents = new AgentRepository(database.db);
    const targets = new ExecutionTargetRepository(database.db);
    const projects = new ProjectRepository(database.db);
    const sessions = new SessionRepository(database.db);
    const runs = new RunRepository(database.db);
    const messages = new MessageRepository(database.db);
    const events = new EventRepository(database.db);
    const approvals = new ApprovalRepository(database.db);
    const continuations = new SessionContinuationRepository(database.db);
    const taskStartAttempts = new TaskStartAttemptRepository(database.db);
    const targetId = randomUUID();
    const projectId = randomUUID();
    const agentId = randomUUID();
    await targets.create({
      id: targetId,
      name: '测试宿主机',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    if (fixtureOptions.agentTargetId && fixtureOptions.agentTargetId !== targetId) {
      await targets.create({
        id: fixtureOptions.agentTargetId,
        name: '不匹配 Agent Target',
        kind: 'LOCAL_HOST',
        hostname: 'other-test',
        os: 'linux',
        arch: 'arm64',
        status: 'READY',
      });
    }
    const projectRoot = fixtureOptions.projectRoot ?? '/tmp';
    await projects.create({
      id: projectId,
      name: '测试 Project',
      targetId,
      rootPath: projectRoot,
      realRootPath: projectRoot,
      repoKind: 'NONE',
      status: fixtureOptions.projectStatus ?? 'ACTIVE',
    });
    await agents.create({
      id: agentId,
      targetId: fixtureOptions.agentTargetId ?? targetId,
      name: 'Fake Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: fixtureOptions.agentStatus ?? 'READY',
      ...(fixtureOptions.agentEnabled === undefined
        ? {}
        : { enabled: fixtureOptions.agentEnabled }),
    });

    const adapter = fixtureOptions.adapter ?? new FakeAgentAdapter({ scenario, ...adapterOptions });
    const agentService = new AgentService(agents, targets, new NeverLaunch(), () => adapter);
    const published: Array<{ topic: string; event: Record<string, unknown> }> = [];
    const git = fixtureOptions.git ?? new SequenceGitProbe(['before-sha', 'after-sha']);
    const service = new SessionService(
      sessions,
      runs,
      messages,
      events,
      approvals,
      projects,
      agentService,
      { publish: (topic, event) => published.push({ topic, event }) },
      git,
      promptContext,
      {
        ...(fixtureOptions.cancelConvergenceTimeoutMs === undefined
          ? {}
          : { cancelConvergenceTimeoutMs: fixtureOptions.cancelConvergenceTimeoutMs }),
        ...(fixtureOptions.approvalDeliveryTimeoutMs === undefined
          ? {}
          : { approvalDeliveryTimeoutMs: fixtureOptions.approvalDeliveryTimeoutMs }),
      },
      continuations,
      taskStartAttempts,
    );
    return {
      service,
      agentService,
      repositories: {
        sessions,
        runs,
        messages,
        events,
        approvals,
        continuations,
        taskStartAttempts,
      },
      projectId,
      agentId,
      published,
    };
  }

  async function taskAdmissionFixture(
    adapter = new ControlledAdapter('never'),
    git?: GitHeadProbe,
  ) {
    const f = await createFixture('idle', undefined, {}, { adapter, ...(git ? { git } : {}) });
    const tasks = new TaskRepository(database.db);
    const task = await tasks.create({
      id: randomUUID(),
      projectId: f.projectId,
      title: '持久启动',
      status: 'READY',
    });
    const input = {
      projectId: f.projectId,
      agentId: f.agentId,
      taskId: task.id,
      title: task.title,
      cwd: '/tmp',
    };
    const admission = {
      kind: 'START' as const,
      expectedOldSessionId: null,
      inputHash: 'fixture-hash',
    };
    return { ...f, tasks, task, input, admission, adapter };
  }

  it('任务公共create拒绝零runtime副作用，任务会话continuation也不得绕过返工', async () => {
    const f = await taskAdmissionFixture();
    try {
      await expect(f.service.create(f.input)).rejects.toMatchObject({
        code: 'TASK_SESSION_START_REQUIRED',
      });
      expect(f.adapter.handles).toHaveLength(0);
      expect(await f.repositories.sessions.list(f.projectId)).toHaveLength(0);
      const session = await f.service.createForTask(f.input, f.admission);
      await f.service.close(session.id);
      await expect(f.service.continue(session.id)).rejects.toMatchObject({
        code: 'TASK_SESSION_START_REQUIRED',
      });
      expect(f.adapter.handles).toHaveLength(1);
    } finally {
      await f.service.shutdown();
    }
  });

  it('持久任务创建并发只创建一个handle，公共Run不能抢先内部原子移交', async () => {
    const f = await taskAdmissionFixture();
    try {
      const results = await Promise.allSettled([
        f.service.createForTask(f.input, f.admission),
        f.service.createForTask(f.input, f.admission),
      ]);
      const winner = results.find((result) => result.status === 'fulfilled');
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      if (winner?.status !== 'fulfilled') throw new Error('缺少赢家');
      const session = winner.value;
      expect(f.adapter.handles).toHaveLength(1);
      expect((await f.repositories.taskStartAttempts.get(session.taskStartAttemptId))?.phase).toBe(
        'SESSION_READY',
      );
      await expect(f.service.startRun(session.id, { text: '直接抢先' })).rejects.toMatchObject({
        code: 'TASK_START_UNRESOLVED',
        status: 409,
      });
      expect(await f.repositories.messages.list(session.id)).toHaveLength(0);
      const run = await f.service.startTaskRun(
        session.id,
        { text: '首次专属指令' },
        session.taskStartAttemptId,
      );
      expect(await f.repositories.taskStartAttempts.get(session.taskStartAttemptId)).toMatchObject({
        phase: 'RUN_ADMITTED',
        runId: run.id,
      });
    } finally {
      await f.service.shutdown();
    }
  });

  it('任务adapter创建抛错持久UNKNOWN，不能把未取得handle猜成未调用', async () => {
    const f = await taskAdmissionFixture();
    const create = vi
      .spyOn(f.adapter, 'createSession')
      .mockRejectedValue(new Error('provider unknown'));
    try {
      await expect(f.service.createForTask(f.input, f.admission)).rejects.toMatchObject({
        code: 'TASK_SESSION_CREATE_UNKNOWN',
      });
      const rows = await f.repositories.taskStartAttempts.getForTask(f.task.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.phase).toBe('UNKNOWN');
      expect((await f.tasks.get(f.task.id))?.status).toBe('IN_PROGRESS');
      await expect(f.service.createForTask(f.input, f.admission)).rejects.toMatchObject({
        status: 409,
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect(
        await f.repositories.taskStartAttempts.releaseUnattempted(rows[0]!.id),
      ).toBeUndefined();
    } finally {
      await f.service.shutdown();
    }
  });

  it('恢复先释放RESERVED后原请求CAS失败不调用adapter', async () => {
    const f = await taskAdmissionFixture();
    const mark = f.repositories.taskStartAttempts.markCreateAttempted.bind(
      f.repositories.taskStartAttempts,
    );
    vi.spyOn(f.repositories.taskStartAttempts, 'markCreateAttempted').mockImplementationOnce(
      async (id) => {
        await f.repositories.taskStartAttempts.releaseUnattempted(id);
        return mark(id);
      },
    );
    try {
      await expect(f.service.createForTask(f.input, f.admission)).rejects.toMatchObject({
        code: 'TASK_START_NOT_ATTEMPTED',
      });
      expect(f.adapter.handles).toHaveLength(0);
      expect((await f.repositories.taskStartAttempts.getForTask(f.task.id))[0]?.phase).toBe(
        'FAILED_KNOWN',
      );
    } finally {
      await f.service.shutdown();
    }
  });

  it('创建响应晚于UNKNOWN恢复时关闭自己handle且不激活旧Session', async () => {
    const f = await taskAdmissionFixture();
    const ready = f.repositories.taskStartAttempts.recordSessionReady.bind(
      f.repositories.taskStartAttempts,
    );
    let close: ReturnType<typeof vi.spyOn> | undefined;
    vi.spyOn(f.repositories.taskStartAttempts, 'recordSessionReady').mockImplementationOnce(
      async (id, patch) => {
        close = vi.spyOn(f.adapter.handles[0]!, 'close');
        await f.repositories.taskStartAttempts.markUnknown(id, 'TASK_SESSION_CREATE_UNKNOWN');
        return ready(id, patch);
      },
    );
    try {
      await expect(f.service.createForTask(f.input, f.admission)).rejects.toMatchObject({
        code: 'TASK_SESSION_CREATE_UNKNOWN',
      });
      expect(close).toHaveBeenCalledTimes(1);
      const rows = await f.repositories.taskStartAttempts.getForTask(f.task.id);
      expect(rows[0]?.phase).toBe('UNKNOWN');
      expect((await f.service.getConfiguration(rows[0]!.sessionId)).supported).toBe(false);
    } finally {
      await f.service.shutdown();
    }
  });

  it('任务recordReady与activate之间close获准时不晚激活CLOSED会话', async () => {
    const f = await taskAdmissionFixture();
    const record = f.repositories.taskStartAttempts.recordSessionReady.bind(
      f.repositories.taskStartAttempts,
    );
    let reached!: (id: string) => void, release!: () => void;
    const entered = new Promise<string>((resolve) => {
      reached = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.repositories.taskStartAttempts, 'recordSessionReady').mockImplementationOnce(
      async (id, patch) => {
        const ready = await record(id, patch);
        reached(ready!.id);
        await barrier;
        return ready;
      },
    );
    const creation = f.service.createForTask(f.input, f.admission);
    const rejected = expect(creation).rejects.toMatchObject({
      code: 'TASK_SESSION_CREATE_UNKNOWN',
    });
    try {
      const sessionId = await entered;
      const closeHandle = vi.spyOn(f.adapter.handles[0]!, 'close');
      const closing = f.service.close(sessionId);
      release();
      await rejected;
      expect((await closing).status).toBe('CLOSED');
      expect((await f.repositories.sessions.get(sessionId))?.status).toBe('CLOSED');
      expect((await f.service.getConfiguration(sessionId)).supported).toBe(false);
      expect(closeHandle).toHaveBeenCalledTimes(1);
      expect((await f.repositories.taskStartAttempts.getForTask(f.task.id))[0]?.phase).toBe(
        'UNKNOWN',
      );
    } finally {
      release();
      await rejected;
      await f.service.shutdown();
    }
  });

  it('close写CLOSED失败也永久撤销未返回的任务创建token', async () => {
    const f = await taskAdmissionFixture();
    const create = f.adapter.createSession.bind(f.adapter);
    let reached!: (id: string) => void, release!: () => void;
    const entered = new Promise<string>((resolve) => {
      reached = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.adapter, 'createSession').mockImplementationOnce(async (input) => {
      const handle = await create(input);
      reached(input.sessionId);
      await barrier;
      return handle;
    });
    const transition = f.repositories.sessions.transition.bind(f.repositories.sessions);
    vi.spyOn(f.repositories.sessions, 'transition').mockImplementation(
      async (id, to, patch, options) => {
        if (to === 'CLOSED') throw new Error('injected close persistence failure');
        return transition(id, to, patch, options);
      },
    );
    const creation = f.service.createForTask(f.input, f.admission);
    const rejected = expect(creation).rejects.toMatchObject({
      code: 'TASK_SESSION_CREATE_UNKNOWN',
    });
    try {
      const sessionId = await entered;
      const closeHandle = vi.spyOn(f.adapter.handles[0]!, 'close');
      await expect(f.service.close(sessionId)).rejects.toThrow(
        'injected close persistence failure',
      );
      release();
      await rejected;
      expect((await f.service.getConfiguration(sessionId)).supported).toBe(false);
      expect(closeHandle).toHaveBeenCalledTimes(1);
      expect((await f.repositories.taskStartAttempts.getForTask(f.task.id))[0]?.phase).toBe(
        'UNKNOWN',
      );
    } finally {
      release();
      await rejected;
      await f.service.shutdown();
    }
  });

  it('reserve提交响应尚未返回时close失败仍撤销创建，零adapter调用', async () => {
    const f = await taskAdmissionFixture();
    const reserve = f.repositories.taskStartAttempts.reserve.bind(f.repositories.taskStartAttempts);
    let reached!: (id: string) => void, release!: () => void;
    const entered = new Promise<string>((resolve) => {
      reached = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.repositories.taskStartAttempts, 'reserve').mockImplementationOnce(async (input) => {
      const reserved = await reserve(input);
      reached(reserved.session.id);
      await barrier;
      return reserved;
    });
    const transition = f.repositories.sessions.transition.bind(f.repositories.sessions);
    vi.spyOn(f.repositories.sessions, 'transition').mockImplementation(
      async (id, to, patch, options) => {
        if (to === 'CLOSED') throw new Error('injected close persistence failure');
        return transition(id, to, patch, options);
      },
    );
    const creation = f.service.createForTask(f.input, f.admission);
    const rejected = expect(creation).rejects.toMatchObject({ code: 'TASK_START_NOT_ATTEMPTED' });
    try {
      const sessionId = await entered;
      await expect(f.service.close(sessionId)).rejects.toThrow(
        'injected close persistence failure',
      );
      release();
      await rejected;
      expect(f.adapter.handles).toHaveLength(0);
      expect((await f.repositories.taskStartAttempts.getForTask(f.task.id))[0]?.phase).toBe(
        'FAILED_KNOWN',
      );
    } finally {
      release();
      await rejected;
      await f.service.shutdown();
    }
  });

  it('reserve提交后响应抛错不猜回滚，可读取原尝试且安全释放未调用预留', async () => {
    const f = await taskAdmissionFixture();
    const reserve = f.repositories.taskStartAttempts.reserve.bind(f.repositories.taskStartAttempts);
    vi.spyOn(f.repositories.taskStartAttempts, 'reserve').mockImplementationOnce(async (input) => {
      await reserve(input);
      throw new Error('injected response lost after commit');
    });
    try {
      await expect(f.service.createForTask(f.input, f.admission)).rejects.toMatchObject({
        code: 'TASK_START_NOT_ATTEMPTED',
        details: { attemptId: expect.any(String), sessionId: expect.any(String) },
      });
      const attempts = await f.repositories.taskStartAttempts.getForTask(f.task.id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.phase).toBe('FAILED_KNOWN');
      expect((await f.tasks.get(f.task.id))?.status).toBe('BLOCKED');
      expect(f.adapter.handles).toHaveLength(0);
    } finally {
      await f.service.shutdown();
    }
  });

  it('shutdown在第一个慢close之前撤销全部activation，已准入第二Session不得迟到发送', async () => {
    const f = await taskAdmissionFixture();
    const input = { projectId: f.projectId, agentId: f.agentId, title: '关闭竞态', cwd: '/tmp' };
    await f.service.create(input);
    const second = await f.service.create(input);
    let entered!: () => void, release!: () => void, releaseClose!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closingBarrier = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const mark = f.repositories.runs.markDispatchAttempted.bind(f.repositories.runs);
    vi.spyOn(f.repositories.runs, 'markDispatchAttempted').mockImplementationOnce(
      async (...args) => {
        const result = await mark(...args);
        entered();
        await barrier;
        return result;
      },
    );
    const close = f.adapter.handles[0]!.close.bind(f.adapter.handles[0]!);
    vi.spyOn(f.adapter.handles[0]!, 'close').mockImplementationOnce(async () => {
      await closingBarrier;
      await close();
    });
    const send = vi.spyOn(f.adapter.handles[1]!, 'sendTurn');
    const run = f.service.startRun(second.id, { text: '不应派发' });
    const rejected = expect(run).rejects.toThrow();
    let stopping: Promise<void> | undefined;
    try {
      await reached;
      stopping = f.service.shutdown();
      release();
      await rejected;
      expect(send).not.toHaveBeenCalled();
    } finally {
      release();
      releaseClose();
      await rejected;
      await stopping;
      await f.service.shutdown();
    }
  });

  it.each(['create', 'resume'] as const)(
    'shutdown等待未返回%s，超时拒绝且不会重复调用后伪成功',
    async (kind) => {
      const adapter = Object.assign(new ControlledAdapter('never'), {
        resumeSession(this: ControlledAdapter, input: CreateAgentSessionInput) {
          return this.createSession(input);
        },
      });
      const f = await createFixture(
        'idle',
        undefined,
        {},
        { adapter, cancelConvergenceTimeoutMs: 1_000 },
      );
      const input = { projectId: f.projectId, agentId: f.agentId, title: '关闭排空', cwd: '/tmp' };
      const source = kind === 'resume' ? await f.service.create(input) : undefined;
      if (source) {
        await adapter.handles[0]!.close();
        await waitFor(
          async () => (await f.repositories.sessions.get(source.id))?.status === 'DISCONNECTED',
        );
      }
      let entered!: () => void, release!: () => void;
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let lateSessionId = '';
      const original = adapter.createSession.bind(adapter);
      vi.spyOn(adapter, 'createSession').mockImplementationOnce(async (value) => {
        lateSessionId = value.sessionId;
        const handle = await original(value);
        entered();
        await barrier;
        return handle;
      });
      const operation = source ? f.service.resume(source.id) : f.service.create(input);
      const rejected = expect(operation).rejects.toBeDefined();
      await reached;
      const late = adapter.handles.at(-1)!;
      const close = vi.spyOn(late, 'close');
      const releaseDatabase = vi.fn();
      const shutdown = f.service.shutdown();
      const releaseIfSafe = shutdown.then(releaseDatabase, () => undefined);
      await expect(shutdown).rejects.toMatchObject({ code: 'SESSION_SHUTDOWN_UNCONFIRMED' });
      expect(close).not.toHaveBeenCalled();
      expect(releaseDatabase).not.toHaveBeenCalled();
      release();
      await rejected;
      expect(close).toHaveBeenCalledTimes(1);
      expect((await f.service.getConfiguration(lateSessionId)).supported).toBe(false);
      await expect(f.service.shutdown()).rejects.toMatchObject({
        code: 'SESSION_SHUTDOWN_UNCONFIRMED',
      });
      await releaseIfSafe;
      expect(releaseDatabase).not.toHaveBeenCalled();
    },
  );

  it.each(['reject', 'timeout'] as const)(
    'shutdown活动handle关闭%s不能报告健康释放',
    async (kind) => {
      const adapter = new ControlledAdapter('never');
      const f = await createFixture(
        'idle',
        undefined,
        {},
        { adapter, cancelConvergenceTimeoutMs: 1_000 },
      );
      const session = await f.service.create({
        projectId: f.projectId,
        agentId: f.agentId,
        title: '关闭未知',
        cwd: '/tmp',
      });
      const original = adapter.handles[0]!.close.bind(adapter.handles[0]);
      const close = vi
        .spyOn(adapter.handles[0]!, 'close')
        .mockImplementation(() =>
          kind === 'reject'
            ? Promise.reject(new Error('close failed'))
            : new Promise(() => undefined),
        );
      await expect(f.service.shutdown()).rejects.toMatchObject({
        code: 'SESSION_SHUTDOWN_UNCONFIRMED',
      });
      expect((await f.service.get(session.id)).status).not.toBe('CLOSED');
      await expect(f.service.shutdown()).rejects.toMatchObject({
        code: 'SESSION_SHUTDOWN_UNCONFIRMED',
      });
      close.mockRestore();
      await original();
    },
  );

  it('事件流结束后 close 拒绝仍保留清理未知，shutdown 不能健康释放', async () => {
    const adapter = new ControlledAdapter('never');
    const f = await createFixture(
      'idle',
      undefined,
      {},
      { adapter, cancelConvergenceTimeoutMs: 1_000 },
    );
    const session = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '流结束清理未知',
      cwd: '/tmp',
    });
    const run = await f.service.startRun(session.id, { text: '等待流结束' });
    const handle = adapter.handles[0]!;
    const endStream = handle.close.bind(handle);
    const close = vi.spyOn(handle, 'close').mockRejectedValue(new Error('cleanup unconfirmed'));
    await endStream();
    await waitFor(async () => close.mock.calls.length > 0);
    await waitFor(async () => (await f.service.get(session.id)).status === 'DISCONNECTED');
    const release = vi.fn();
    await f.service.shutdown().then(release, () => undefined);
    expect(release).not.toHaveBeenCalled();
    await expect(f.service.shutdown()).rejects.toMatchObject({
      code: 'SESSION_SHUTDOWN_UNCONFIRMED',
    });
    expect((await f.repositories.runs.get(run.id))?.status).toBe('DISCONNECTED');
    expect(
      (await f.repositories.events.listAfter(session.id, 0, 100)).some(
        (event) => event.type === 'run.cancelled',
      ),
    ).toBe(false);
    close.mockRestore();
  });

  it('事件流已 detach 但 close 仍挂起时 shutdown 等待受跟踪清理', async () => {
    const adapter = new ControlledAdapter('never');
    const f = await createFixture(
      'idle',
      undefined,
      {},
      { adapter, cancelConvergenceTimeoutMs: 1000 },
    );
    const session = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '流结束竞态',
      cwd: '/tmp',
    });
    const handle = adapter.handles[0]!;
    const endStream = handle.close.bind(handle);
    let finish!: () => void;
    const barrier = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const close = vi.spyOn(handle, 'close').mockImplementation(() => barrier);
    await endStream();
    await waitFor(async () => close.mock.calls.length === 1);
    expect((await f.service.get(session.id)).status).toBe('DISCONNECTED');
    const released = vi.fn();
    const stopping = f.service.shutdown().then(released);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(released).not.toHaveBeenCalled();
    finish();
    await stopping;
    expect(released).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    close.mockRestore();
  });

  it('Remote handle close 失败后消费流结束与重复清理不能清掉未知账本', async () => {
    const failure = new RemoteNodeRpcError('REMOTE_NODE_RPC_TIMEOUT', 'fixture close timeout');
    const request = vi.fn(async (_node: string, command: string) => {
      if (command === 'session.create') return {};
      throw failure;
    });
    const unsubscribe = vi.fn();
    const remote = new RemoteAgentAdapter({
      request,
      subscribeSession: () => unsubscribe,
    } as unknown as RemoteNodeGateway);
    const adapter = new FakeAgentAdapter({ scenario: 'idle' });
    let handle!: AgentSessionHandle;
    vi.spyOn(adapter, 'createSession').mockImplementation(async (input) => {
      handle = await remote.createSession({
        ...input,
        profile: {
          ...input.profile,
          launchSpec: { kind: 'REMOTE_AGENT', nodeId: 'fixture-node', inventoryKey: 'fixture' },
        },
      });
      return handle;
    });
    const f = await createFixture('idle', undefined, {}, { adapter });
    const session = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: 'Remote close未知',
      cwd: '/tmp',
    });
    await expect(handle.close()).rejects.toBe(failure);
    await waitFor(async () => (await f.service.get(session.id)).status === 'DISCONNECTED');
    // Event-consumer cleanup calls close again. Its original failure must stick.
    const release = vi.fn();
    await f.service.shutdown().then(release, () => undefined);
    expect(release).not.toHaveBeenCalled();
    await expect(f.service.shutdown()).rejects.toMatchObject({
      code: 'SESSION_SHUTDOWN_UNCONFIRMED',
    });
    expect(request.mock.calls.filter((call) => call[1] === 'session.close')).toHaveLength(1);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('shutdown撤销普通创建，迟到handle只清理且不能激活或派发', async () => {
    const f = await taskAdmissionFixture();
    const input = { projectId: f.projectId, agentId: f.agentId, title: '普通创建', cwd: '/tmp' };
    const original = f.adapter.createSession.bind(f.adapter);
    let entered!: (id: string) => void, release!: () => void;
    const reached = new Promise<string>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.adapter, 'createSession').mockImplementationOnce(async (value) => {
      const handle = await original(value);
      entered(value.sessionId);
      await barrier;
      return handle;
    });
    const creating = f.service.create(input);
    const rejected = expect(creating).rejects.toMatchObject({
      code: 'AGENT_SESSION_CREATE_FAILED',
      details: { handleCleanup: 'HANDLE_CLOSE_RETURNED' },
    });
    try {
      const id = await reached;
      const close = vi.spyOn(f.adapter.handles[0]!, 'close');
      const send = vi.spyOn(f.adapter.handles[0]!, 'sendTurn');
      const stopping = f.service.shutdown();
      release();
      await rejected;
      await stopping;
      expect(close).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
      expect((await f.service.get(id)).status).toBe('FAILED');
      expect((await f.service.getConfiguration(id)).supported).toBe(false);
      await expect(f.service.startRun(id, { text: '迟到请求' })).rejects.toMatchObject({
        code: 'SESSION_SERVICE_STOPPING',
      });
      await f.service.close(id); // Explicit cleanup remains permitted.
    } finally {
      release();
      await rejected;
      await f.service.shutdown();
    }
  });

  it('shutdown后普通create、managed create、resume与startRun全部拒绝新准入', async () => {
    const f = await taskAdmissionFixture();
    const input = { projectId: f.projectId, agentId: f.agentId, title: '停止后创建', cwd: '/tmp' };
    await f.service.shutdown();
    for (const action of [
      () => f.service.create(input),
      () => f.service.createManagedWorktree(input, '/tmp'),
      () => f.service.resume(randomUUID()),
      () => f.service.startRun(randomUUID(), { text: '停止后派发' }),
    ])
      await expect(action()).rejects.toMatchObject({ code: 'SESSION_SERVICE_STOPPING' });
    expect(f.adapter.handles).toHaveLength(0);
    expect(await f.repositories.sessions.list(f.projectId)).toHaveLength(0);
  });

  it('普通create校验await期间shutdown，不能晚注册生命周期或调用adapter', async () => {
    const f = await taskAdmissionFixture();
    const original = f.agentService.resolveRuntime.bind(f.agentService);
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.agentService, 'resolveRuntime').mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      entered();
      await barrier;
      return result;
    });
    const creating = f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '迟到校验',
      cwd: '/tmp',
    });
    const rejected = expect(creating).rejects.toMatchObject({ code: 'SESSION_SERVICE_STOPPING' });
    try {
      await reached;
      const stopping = f.service.shutdown();
      release();
      await rejected;
      await stopping;
      expect(f.adapter.handles).toHaveLength(0);
      expect(await f.repositories.sessions.list(f.projectId)).toHaveLength(0);
    } finally {
      release();
      await rejected;
      await f.service.shutdown();
    }
  });

  it('shutdown撤销未返回的任务创建token，迟到handle只能清理不能激活', async () => {
    const f = await taskAdmissionFixture();
    const create = f.adapter.createSession.bind(f.adapter);
    let reached!: (id: string) => void, release!: () => void;
    const entered = new Promise<string>((resolve) => {
      reached = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.adapter, 'createSession').mockImplementationOnce(async (input) => {
      const handle = await create(input);
      reached(input.sessionId);
      await barrier;
      return handle;
    });
    const creation = f.service.createForTask(f.input, f.admission);
    const rejected = expect(creation).rejects.toMatchObject({
      code: 'TASK_SESSION_CREATE_UNKNOWN',
    });
    try {
      const sessionId = await entered;
      const closeHandle = vi.spyOn(f.adapter.handles[0]!, 'close');
      const stopping = f.service.shutdown();
      release();
      await rejected;
      await stopping;
      expect(closeHandle).toHaveBeenCalledTimes(1);
      expect((await f.service.getConfiguration(sessionId)).supported).toBe(false);
      expect((await f.repositories.taskStartAttempts.getForTask(f.task.id))[0]?.phase).toBe(
        'UNKNOWN',
      );
    } finally {
      release();
      await rejected;
      await f.service.shutdown();
    }
  });

  it('任务验证await期间shutdown后不重新注册token或预留Session', async () => {
    const f = await taskAdmissionFixture();
    const resolveRuntime = f.agentService.resolveRuntime.bind(f.agentService);
    let reached!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.agentService, 'resolveRuntime').mockImplementationOnce(async (...args) => {
      const runtime = await resolveRuntime(...args);
      reached();
      await barrier;
      return runtime;
    });
    const creation = f.service.createForTask(f.input, f.admission);
    const rejected = expect(creation).rejects.toMatchObject({ code: 'TASK_START_UNAVAILABLE' });
    try {
      await entered;
      const stopping = f.service.shutdown();
      release();
      await rejected;
      await stopping;
      expect(f.adapter.handles).toHaveLength(0);
      expect(await f.repositories.sessions.list(f.projectId)).toHaveLength(0);
      expect(await f.repositories.taskStartAttempts.getForTask(f.task.id)).toHaveLength(0);
      expect((await f.tasks.get(f.task.id))?.status).toBe('READY');
      await expect(f.service.createForTask(f.input, f.admission)).rejects.toMatchObject({
        code: 'TASK_START_UNAVAILABLE',
      });
      await expect(
        f.service.startTaskRun(randomUUID(), { text: '停止后请求' }, randomUUID()),
      ).rejects.toMatchObject({ code: 'TASK_START_UNAVAILABLE' });
    } finally {
      release();
      await rejected;
      await f.service.shutdown();
    }
  });

  it('内部启动传入其他Task尝试不得派发或污染另一任务阶段', async () => {
    const a = await taskAdmissionFixture(),
      b = await taskAdmissionFixture();
    try {
      const first = await a.service.createForTask(a.input, a.admission);
      const second = await b.service.createForTask(b.input, b.admission);
      await expect(
        a.service.startTaskRun(first.id, { text: '错误归属' }, second.taskStartAttemptId),
      ).rejects.toMatchObject({ code: 'TASK_START_UNRESOLVED' });
      expect((await a.repositories.taskStartAttempts.get(first.taskStartAttemptId))?.phase).toBe(
        'SESSION_READY',
      );
      expect((await b.repositories.taskStartAttempts.get(second.taskStartAttemptId))?.phase).toBe(
        'SESSION_READY',
      );
      expect(await a.repositories.runs.list(first.id)).toHaveLength(0);
      expect(await b.repositories.runs.list(second.id)).toHaveLength(0);
    } finally {
      await a.service.shutdown();
      await b.service.shutdown();
    }
  });

  it('重复内部startTaskRun忙碌拒绝不污染原请求的SESSION_READY移交', async () => {
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await taskAdmissionFixture(new ControlledAdapter('never'), {
      readHead: async () => {
        entered();
        await barrier;
        return undefined;
      },
    });
    try {
      const session = await f.service.createForTask(f.input, f.admission);
      const first = f.service.startTaskRun(
        session.id,
        { text: '首次' },
        session.taskStartAttemptId,
      );
      await reached;
      await expect(
        f.service.startTaskRun(session.id, { text: '重复' }, session.taskStartAttemptId),
      ).rejects.toMatchObject({ code: 'SESSION_NOT_READY' });
      expect((await f.repositories.taskStartAttempts.get(session.taskStartAttemptId))?.phase).toBe(
        'SESSION_READY',
      );
      release();
      const run = await first;
      expect((await f.repositories.taskStartAttempts.get(session.taskStartAttemptId))?.runId).toBe(
        run.id,
      );
    } finally {
      release();
      await f.service.shutdown();
    }
  });

  it('resume配置读取挂起后close，迟到配置不写CLOSED会话', async () => {
    let release!: () => void;
    let reading = false;
    const adapter = Object.assign(new ControlledAdapter('never'), {
      async resumeSession(
        this: ControlledAdapter,
        input: CreateAgentSessionInput,
      ): Promise<AgentSessionHandle> {
        const handle = await this.createSession(input);
        return Object.assign(handle, {
          async getConfiguration() {
            reading = true;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            return {
              supported: true,
              current: { model: 'late-model', mode: 'late-mode', reasoningEffort: null },
              options: { models: [], modes: [], reasoningEfforts: [] },
            };
          },
        });
      },
    });
    const f = await createFixture('idle', undefined, {}, { adapter });
    const source = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '配置归属',
      cwd: '/tmp',
    });
    await adapter.handles[0]!.close();
    await waitFor(
      async () => (await f.repositories.sessions.get(source.id))?.status === 'DISCONNECTED',
    );
    const pending = f.service.resume(source.id).catch((error: unknown) => error);
    await waitFor(async () => reading);
    const update = vi.spyOn(f.repositories.sessions, 'updateConfiguration');
    try {
      await f.service.close(source.id);
      release();
      expect(await pending).toMatchObject({ code: 'AGENT_SESSION_RESUME_FAILED' });
      expect(update).not.toHaveBeenCalled();
      expect(await f.repositories.sessions.get(source.id)).toMatchObject({
        status: 'CLOSED',
        model: source.model,
        mode: source.mode,
      });
      await expect(
        f.repositories.sessions.updateConfiguration(
          source.id,
          { model: 'wrong' },
          { expectedFrom: 'DISCONNECTED' },
        ),
      ).rejects.toBeDefined();
      expect((await f.repositories.sessions.get(source.id))?.model).toBe(source.model);
    } finally {
      release();
      await f.service.shutdown();
    }
  });

  it('resume允许捕获的旧activation在断连handler中自然detach', async () => {
    let releaseResume!: () => void;
    let releaseDisconnect!: () => void;
    let resumed = false;
    let disconnected = false;
    const adapter = Object.assign(new ControlledAdapter('never'), {
      async resumeSession(
        this: ControlledAdapter,
        input: CreateAgentSessionInput,
      ): Promise<AgentSessionHandle> {
        const handle = await this.createSession(input);
        resumed = true;
        await new Promise<void>((resolve) => {
          releaseResume = resolve;
        });
        return handle;
      },
    });
    const f = await createFixture('idle', undefined, {}, { adapter });
    const source = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '断连交错',
      cwd: '/tmp',
    });
    const original = f.repositories.sessions.transition.bind(f.repositories.sessions);
    const transition = vi
      .spyOn(f.repositories.sessions, 'transition')
      .mockImplementation(async (id, to, patch, options) => {
        const result = await original(id, to, patch, options);
        if (to === 'DISCONNECTED') {
          disconnected = true;
          await new Promise<void>((resolve) => {
            releaseDisconnect = resolve;
          });
        }
        return result;
      });
    await adapter.handles[0]!.close();
    await waitFor(async () => disconnected);
    const pending = f.service.resume(source.id);
    await waitFor(async () => resumed);
    const newClose = vi.spyOn(adapter.handles[1]!, 'close');
    try {
      releaseDisconnect();
      // Flush the real disconnect handler's post-persistence detach before returning the new handle.
      await new Promise((resolve) => setTimeout(resolve, 0));
      releaseResume();
      expect((await pending).status).toBe('READY');
      expect(newClose).not.toHaveBeenCalled();
    } finally {
      releaseDisconnect();
      releaseResume();
      transition.mockRestore();
      await f.service.shutdown();
    }
  });

  it('resume拒绝重用旧active对象且不关闭或改FAILED', async () => {
    const adapter = Object.assign(new ControlledAdapter('never'), {
      async resumeSession(this: ControlledAdapter): Promise<AgentSessionHandle> {
        return this.handles[0]!;
      },
    });
    const f = await createFixture('idle', undefined, {}, { adapter });
    const source = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '复用handle',
      cwd: '/tmp',
    });
    await f.repositories.sessions.transition(source.id, 'DISCONNECTED');
    const close = vi.spyOn(adapter.handles[0]!, 'close');
    try {
      await expect(f.service.resume(source.id)).rejects.toMatchObject({
        code: 'SESSION_RESUME_HANDLE_REUSED',
      });
      expect(close).not.toHaveBeenCalled();
      expect((await f.repositories.sessions.get(source.id))?.status).toBe('DISCONNECTED');
    } finally {
      await f.service.shutdown();
    }
  });

  it('resume迟到finally不释放正在关闭的新token', async () => {
    let releaseResume!: () => void;
    let releaseClose!: () => void;
    let entered = false;
    let closing = false;
    const adapter = Object.assign(new ControlledAdapter('never'), {
      async resumeSession(
        this: ControlledAdapter,
        input: CreateAgentSessionInput,
      ): Promise<AgentSessionHandle> {
        const handle = await this.createSession(input);
        entered = true;
        await new Promise<void>((resolve) => {
          releaseResume = resolve;
        });
        return handle;
      },
    });
    const f = await createFixture('idle', undefined, {}, { adapter });
    const source = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: 'token归属',
      cwd: '/tmp',
    });
    await adapter.handles[0]!.close();
    await waitFor(
      async () => (await f.repositories.sessions.get(source.id))?.status === 'DISCONNECTED',
    );
    const pending = f.service.resume(source.id).catch((error: unknown) => error);
    await waitFor(async () => entered);
    const original = f.repositories.sessions.transition.bind(f.repositories.sessions);
    const transition = vi
      .spyOn(f.repositories.sessions, 'transition')
      .mockImplementation(async (id, to, patch, options) => {
        if (to === 'CLOSED') {
          closing = true;
          await new Promise<void>((resolve) => {
            releaseClose = resolve;
          });
        }
        return original(id, to, patch, options);
      });
    const close = f.service.close(source.id);
    await waitFor(async () => closing);
    try {
      releaseResume();
      expect(await pending).toMatchObject({ code: 'AGENT_SESSION_RESUME_FAILED' });
      await expect(f.service.close(source.id)).rejects.toMatchObject({
        code: 'SESSION_LIFECYCLE_BUSY',
      });
      await expect(f.service.resume(source.id)).rejects.toMatchObject({
        code: 'SESSION_LIFECYCLE_BUSY',
      });
      expect((await f.repositories.sessions.get(source.id))?.status).toBe('DISCONNECTED');
      releaseClose();
      expect((await close).status).toBe('CLOSED');
    } finally {
      releaseResume();
      releaseClose();
      transition.mockRestore();
      await f.service.shutdown();
    }
  });

  it.each(['reject', 'timeout'] as const)(
    'resume新handle关闭%s明确未知且保留原错',
    async (kind) => {
      const adapter = Object.assign(new ControlledAdapter('never'), {
        resumeSession(
          this: ControlledAdapter,
          input: CreateAgentSessionInput,
        ): Promise<AgentSessionHandle> {
          return this.createSession(input);
        },
      });
      const f = await createFixture(
        'idle',
        undefined,
        {},
        { adapter, cancelConvergenceTimeoutMs: 1_000 },
      );
      const source = await f.service.create({
        projectId: f.projectId,
        agentId: f.agentId,
        title: '清理测试',
        cwd: '/tmp',
      });
      await adapter.handles[0]!.close();
      await waitFor(
        async () => (await f.repositories.sessions.get(source.id))?.status === 'DISCONNECTED',
      );
      const failure = new Error('READY failed');
      const original = f.repositories.sessions.transition.bind(f.repositories.sessions);
      const transition = vi
        .spyOn(f.repositories.sessions, 'transition')
        .mockImplementation(async (id, to, patch, options) => {
          if (to === 'READY') throw failure;
          return original(id, to, patch, options);
        });
      const close = vi
        .spyOn(ControlledHandle.prototype, 'close')
        .mockImplementation(() =>
          kind === 'reject'
            ? Promise.reject(new Error('close failed'))
            : new Promise(() => undefined),
        );
      try {
        await expect(f.service.resume(source.id)).rejects.toMatchObject({
          cause: failure,
          details: {
            handleCleanup: 'UNKNOWN',
            previousHandleCleanup: 'NOT_PRESENT',
            failureStateRecorded: true,
          },
        });
        expect(close).toHaveBeenCalledTimes(1);
      } finally {
        transition.mockRestore();
        close.mockRestore();
        await adapter.handles[1]?.close();
        await expect(f.service.shutdown()).rejects.toMatchObject({
          code: 'SESSION_SHUTDOWN_UNCONFIRMED',
        });
      }
    },
  );

  it('resume旧连接关闭未知不可激活新handle或声称旧连接已关闭', async () => {
    const adapter = Object.assign(new ControlledAdapter('never'), {
      resumeSession(
        this: ControlledAdapter,
        input: CreateAgentSessionInput,
      ): Promise<AgentSessionHandle> {
        return this.createSession(input);
      },
    });
    const f = await createFixture('idle', undefined, {}, { adapter });
    const source = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '旧连接清理',
      cwd: '/tmp',
    });
    // A disconnected durable row can briefly coexist with its old activation.
    await f.repositories.sessions.transition(source.id, 'DISCONNECTED');
    const failure = new Error('old close failed');
    const oldClose = vi.spyOn(adapter.handles[0]!, 'close').mockRejectedValue(failure);
    const events = vi.spyOn(ControlledHandle.prototype, 'events');
    const close = vi.spyOn(ControlledHandle.prototype, 'close');
    try {
      await expect(f.service.resume(source.id)).rejects.toMatchObject({
        cause: failure,
        details: { previousHandleCleanup: 'UNKNOWN', handleCleanup: 'HANDLE_CLOSE_RETURNED' },
      });
      expect(oldClose).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(events).not.toHaveBeenCalled();
    } finally {
      oldClose.mockRestore();
      await adapter.handles[0]!.close();
      await expect(f.service.shutdown()).rejects.toMatchObject({
        code: 'SESSION_SHUTDOWN_UNCONFIRMED',
      });
    }
  });

  it('resume状态CAS在行锁内拒绝覆盖已CLOSED状态', async () => {
    const f = await createFixture('idle');
    const source = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: 'CAS测试',
      cwd: '/tmp',
    });
    await f.service.close(source.id);
    for (const target of ['READY', 'FAILED'] as const) {
      await expect(
        f.repositories.sessions.transition(source.id, target, {}, { expectedFrom: 'DISCONNECTED' }),
      ).rejects.toMatchObject({ code: 'SESSION_CONCURRENT_UPDATE' });
      expect((await f.repositories.sessions.get(source.id))?.status).toBe('CLOSED');
    }
    await f.service.shutdown();
  });

  it.each([false, true])('resume拒绝重入且close可撤销挂起恢复=%s', async (cancel) => {
    let release!: () => void;
    let entered = false;
    const adapter = Object.assign(new ControlledAdapter('never'), {
      async resumeSession(
        this: ControlledAdapter,
        input: CreateAgentSessionInput,
      ): Promise<AgentSessionHandle> {
        const handle = await this.createSession(input);
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return handle;
      },
    });
    const fixture = await createFixture('idle', undefined, {}, { adapter });
    const source = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '恢复测试',
      cwd: '/tmp',
    });
    await adapter.handles[0]!.close();
    await waitFor(
      async () => (await fixture.repositories.sessions.get(source.id))?.status === 'DISCONNECTED',
    );
    const first = fixture.service.resume(source.id).catch((error: unknown) => error);
    await waitFor(async () => entered);
    const close = vi.spyOn(adapter.handles[1]!, 'close');
    try {
      await expect(fixture.service.resume(source.id)).rejects.toMatchObject({
        code: 'SESSION_LIFECYCLE_BUSY',
      });
      if (cancel) expect((await fixture.service.close(source.id)).status).toBe('CLOSED');
      release();
      const result = await first;
      expect(adapter.handles).toHaveLength(2);
      if (cancel) {
        expect(result).toMatchObject({
          code: 'AGENT_SESSION_RESUME_FAILED',
          details: { failureStateRecorded: false },
        });
        expect(close).toHaveBeenCalledTimes(1);
        expect((await fixture.repositories.sessions.get(source.id))?.status).toBe('CLOSED');
      } else {
        expect(result).toMatchObject({ status: 'READY' });
        expect(close).not.toHaveBeenCalled();
      }
    } finally {
      release();
      await fixture.service.shutdown();
    }
  });

  it.each([false, true])('resume READY失败且FAILED失败=%s仍清理保留原错', async (failFailed) => {
    const adapter = Object.assign(new ControlledAdapter('never'), {
      resumeSession(
        this: ControlledAdapter,
        input: CreateAgentSessionInput,
      ): Promise<AgentSessionHandle> {
        return this.createSession(input);
      },
    });
    const fixture = await createFixture('idle', undefined, {}, { adapter });
    const source = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '恢复审计',
      cwd: '/tmp',
    });
    await adapter.handles[0]!.close();
    await waitFor(
      async () => (await fixture.repositories.sessions.get(source.id))?.status === 'DISCONNECTED',
    );
    const readyFailure = new Error('resume READY write failed');
    const failedFailure = new Error('resume FAILED write failed');
    const original = fixture.repositories.sessions.transition.bind(fixture.repositories.sessions);
    const transition = vi
      .spyOn(fixture.repositories.sessions, 'transition')
      .mockImplementation(async (id, to, patch) => {
        if (to === 'READY') throw readyFailure;
        if (failFailed && to === 'FAILED') throw failedFailure;
        return original(id, to, patch);
      });
    const close = vi.spyOn(ControlledHandle.prototype, 'close');
    const events = vi.spyOn(ControlledHandle.prototype, 'events');
    try {
      const error = await fixture.service.resume(source.id).catch((failure: unknown) => failure);
      expect(adapter.handles).toHaveLength(2);
      expect(close).toHaveBeenCalledTimes(1);
      expect(events).not.toHaveBeenCalled();
      expect((await fixture.repositories.sessions.get(source.id))?.status).toBe(
        failFailed ? 'DISCONNECTED' : 'FAILED',
      );
      expect(error).toMatchObject({ code: 'AGENT_SESSION_RESUME_FAILED', cause: readyFailure });
      await fixture.service.shutdown();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      transition.mockRestore();
      await adapter.handles[1]?.close();
      await fixture.service.shutdown();
    }
  });

  it.each([false, true])(
    '创建资源回收：READY写失败且FAILED也失败=%s时先关闭owned handle',
    async (failFailed) => {
      const adapter = new ControlledAdapter('never');
      const fixture = await createFixture('idle', undefined, {}, { adapter });
      const readyFailure = new Error('injected READY persistence failure');
      const failedFailure = new Error('injected FAILED persistence failure');
      const original = fixture.repositories.sessions.transition.bind(fixture.repositories.sessions);
      const transition = vi
        .spyOn(fixture.repositories.sessions, 'transition')
        .mockImplementation(async (id, to, patch) => {
          if (to === 'READY') throw readyFailure;
          if (failFailed && to === 'FAILED') throw failedFailure;
          return original(id, to, patch);
        });
      const close = vi.spyOn(ControlledHandle.prototype, 'close');
      const events = vi.spyOn(ControlledHandle.prototype, 'events');
      try {
        const error = await fixture.service
          .create({
            projectId: fixture.projectId,
            agentId: fixture.agentId,
            title: '资源所有权审计',
            cwd: '/tmp',
          })
          .catch((failure: unknown) => failure);
        expect(adapter.handles).toHaveLength(1);
        expect(close).toHaveBeenCalledTimes(1);
        expect(events).not.toHaveBeenCalled();
        const rows = await fixture.repositories.sessions.list(fixture.projectId);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.status).toBe(failFailed ? 'STARTING' : 'FAILED');
        expect(error).toMatchObject({
          code: 'AGENT_SESSION_CREATE_FAILED',
          cause: readyFailure,
          details: { handleCleanup: 'HANDLE_CLOSE_RETURNED', failureStateRecorded: !failFailed },
        });
        await fixture.service.shutdown();
        expect(close).toHaveBeenCalledTimes(1);
      } finally {
        transition.mockRestore();
        close.mockRestore();
        events.mockRestore();
        // Idempotent test-owned final cleanup, after production call counts were asserted.
        await adapter.handles[0]?.close();
        await fixture.service.shutdown();
      }
    },
  );

  it.each(['REJECT', 'TIMEOUT'] as const)(
    '创建资源回收：close %s只报告未知且不遮蔽原错',
    async (mode) => {
      const adapter = new ControlledAdapter('never');
      const fixture = await createFixture('idle', undefined, {}, { adapter });
      const readyFailure = new Error('injected READY failure');
      const original = fixture.repositories.sessions.transition.bind(fixture.repositories.sessions);
      const transition = vi
        .spyOn(fixture.repositories.sessions, 'transition')
        .mockImplementation(async (id, to, patch) => {
          if (to === 'READY') throw readyFailure;
          return original(id, to, patch);
        });
      const close = vi.spyOn(ControlledHandle.prototype, 'close').mockImplementation(async () => {
        if (mode === 'REJECT') throw new Error('close diagnostic must not replace original error');
        await new Promise<void>(() => undefined);
      });
      try {
        const startedAt = Date.now();
        const error = await fixture.service
          .create({
            projectId: fixture.projectId,
            agentId: fixture.agentId,
            title: '资源回收未知',
            cwd: '/tmp',
          })
          .catch((failure: unknown) => failure);
        expect(Date.now() - startedAt).toBeLessThan(2_500);
        expect(error).toMatchObject({
          code: 'AGENT_SESSION_CREATE_FAILED',
          cause: readyFailure,
          message: expect.stringContaining('资源清理结果未知'),
          details: { handleCleanup: 'UNKNOWN', failureStateRecorded: true },
        });
        expect(close).toHaveBeenCalledTimes(1);
        expect((await fixture.repositories.sessions.list(fixture.projectId))[0]?.status).toBe(
          'FAILED',
        );
      } finally {
        transition.mockRestore();
        close.mockRestore();
        await adapter.handles[0]?.close();
        await expect(fixture.service.shutdown()).rejects.toMatchObject({
          code: 'SESSION_SHUTDOWN_UNCONFIRMED',
        });
      }
    },
  );

  it('创建资源回收：失败Session只关闭自己的handle，不提前关闭成功activation', async () => {
    const adapter = new ControlledAdapter('never');
    const fixture = await createFixture('idle', undefined, {}, { adapter });
    const close = vi.spyOn(ControlledHandle.prototype, 'close');
    const original = fixture.repositories.sessions.transition.bind(fixture.repositories.sessions);
    let rejectReady = false;
    const transition = vi
      .spyOn(fixture.repositories.sessions, 'transition')
      .mockImplementation(async (id, to, patch) => {
        if (rejectReady && to === 'READY') throw new Error('next READY failed');
        return original(id, to, patch);
      });
    try {
      const ready = await fixture.service.create({
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        title: '保留成功会话',
        cwd: '/tmp',
      });
      expect(ready.status).toBe('READY');
      expect(close).not.toHaveBeenCalled();
      rejectReady = true;
      await expect(
        fixture.service.create({
          projectId: fixture.projectId,
          agentId: fixture.agentId,
          title: '第二次创建失败',
          cwd: '/tmp',
        }),
      ).rejects.toMatchObject({ code: 'AGENT_SESSION_CREATE_FAILED' });
      expect(close).toHaveBeenCalledTimes(1);
      expect(close.mock.contexts[0]).toBe(adapter.handles[1]);
      expect((await fixture.repositories.sessions.get(ready.id))?.status).toBe('READY');
      await fixture.service.shutdown();
      expect(close).toHaveBeenCalledTimes(2);
      expect(close.mock.contexts[1]).toBe(adapter.handles[0]);
    } finally {
      transition.mockRestore();
      close.mockRestore();
      await fixture.service.shutdown();
    }
  });

  it('创建资源回收：adapter未返回handle时不虚构清理成功', async () => {
    const adapter = new ControlledAdapter('never');
    const fixture = await createFixture('idle', undefined, {}, { adapter });
    const failure = new Error('adapter creation failed');
    vi.spyOn(adapter, 'createSession').mockRejectedValueOnce(failure);
    const close = vi.spyOn(ControlledHandle.prototype, 'close');
    try {
      await expect(
        fixture.service.create({
          projectId: fixture.projectId,
          agentId: fixture.agentId,
          title: '未取得资源',
          cwd: '/tmp',
        }),
      ).rejects.toMatchObject({
        code: 'AGENT_SESSION_CREATE_FAILED',
        cause: failure,
        details: { handleCleanup: 'NOT_ACQUIRED', failureStateRecorded: true },
      });
      expect(close).not.toHaveBeenCalled();
    } finally {
      close.mockRestore();
      await fixture.service.shutdown();
    }
  });

  it('创建资源回收：防御性移交后异常不能关闭active或覆盖READY', async () => {
    const adapter = new ControlledAdapter('never');
    const fixture = await createFixture('idle', undefined, {}, { adapter });
    const failure = new Error('injected failure after activation transfer');
    // Deliberate private-boundary fault injection; normal activate currently does not throw after transfer.
    const activation = fixture.service as unknown as {
      activate(
        id: string,
        projectId: string,
        adapter: AgentRuntimeAdapter,
        handle: AgentSessionHandle,
      ): void;
    };
    const original = activation.activate.bind(fixture.service);
    const activate = vi.spyOn(activation, 'activate').mockImplementation((...args) => {
      original(...args);
      throw failure;
    });
    const close = vi.spyOn(ControlledHandle.prototype, 'close');
    try {
      await expect(
        fixture.service.create({
          projectId: fixture.projectId,
          agentId: fixture.agentId,
          title: '已移交active',
          cwd: '/tmp',
        }),
      ).rejects.toMatchObject({
        code: 'AGENT_SESSION_CREATE_FAILED',
        cause: failure,
        message: expect.stringContaining('已有会话仍受管理'),
        details: { handleCleanup: 'ACTIVE_OWNED', failureStateRecorded: false },
      });
      expect(close).not.toHaveBeenCalled();
      expect((await fixture.repositories.sessions.list(fixture.projectId))[0]?.status).toBe(
        'READY',
      );
      await fixture.service.shutdown();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      activate.mockRestore();
      close.mockRestore();
      await fixture.service.shutdown();
    }
  });

  it.each(['RUN_FIRST', 'CALLBACK_FIRST'] as const)(
    '真实事件READY与Task观察器之间的同会话下一轮：%s',
    async (order) => {
      const adapter = new ControlledAdapter('never');
      const fixture = await createFixture(
        'idle',
        undefined,
        {},
        {
          adapter,
          git: new SequenceGitProbe(['r1-before', 'r1-after', 'r2-before', 'r2-after']),
        },
      );
      const tasks = new TaskRepository(database.db);
      const taskService = new TaskService(
        new GoalRepository(database.db),
        tasks,
        new ProjectRepository(database.db),
        fixture.service,
      );
      const task = await tasks.create({
        id: randomUUID(),
        projectId: fixture.projectId,
        title: '同会话所有权',
        status: 'IN_PROGRESS',
        assignedAgentId: fixture.agentId,
      });
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let firstId: string | undefined;
      let entered = false;
      const outcomes = new Map<string, boolean>();
      fixture.service.setTaskLifecycleObserver({
        onRunCompleted: async (taskId, runId) => {
          if (runId === firstId) {
            entered = true;
            await barrier;
          }
          const applied = await taskService.onRunCompleted(taskId, runId);
          outcomes.set(runId, applied);
          return applied;
        },
      });
      try {
        const session = await fixture.service.createManagedWorktree(
          {
            projectId: fixture.projectId,
            agentId: fixture.agentId,
            taskId: task.id,
            title: '受控终态窗口',
            cwd: '/tmp',
          },
          '/tmp',
        );
        await tasks.update(task.id, { sessionId: session.id });
        const first = await fixture.service.startRun(session.id, { text: '第一轮' });
        firstId = first.id;
        adapter.handles[0]!.complete(first.id);
        await waitFor(async () => entered);
        // This is the actual public SessionService admission window, not a
        // manually patched READY state or direct repository callback simulation.
        expect((await fixture.repositories.sessions.get(session.id))?.status).toBe('READY');
        expect((await fixture.repositories.runs.get(first.id))?.status).toBe('COMPLETED');
        expect((await tasks.get(task.id))?.status).toBe('IN_PROGRESS');
        if (order === 'CALLBACK_FIRST') {
          release();
          await waitFor(async () => outcomes.has(first.id));
          expect(outcomes.get(first.id)).toBe(true);
        }
        const second = await fixture.service.startRun(session.id, { text: '第二轮' });
        expect((await fixture.repositories.runs.get(second.id))?.status).toBe('RUNNING');
        if (order === 'RUN_FIRST') {
          release();
          await waitFor(async () => outcomes.has(first.id));
          expect(outcomes.get(first.id)).toBe(false);
          expect((await tasks.get(task.id))?.status).toBe('IN_PROGRESS');
          expect((await tasks.get(task.id))?.finalRunId).toBeNull();
        } else {
          // Preserve existing direct Session turn semantics: no implicit Task restart.
          expect((await tasks.get(task.id))?.status).toBe('WAITING_REVIEW');
          expect((await tasks.get(task.id))?.finalRunId).toBe(first.id);
        }
        adapter.handles[0]!.complete(second.id);
        await waitFor(async () => outcomes.has(second.id));
        expect(outcomes.get(second.id)).toBe(order === 'RUN_FIRST');
        expect((await tasks.get(task.id))?.status).toBe('WAITING_REVIEW');
        expect((await tasks.get(task.id))?.finalRunId).toBe(
          order === 'RUN_FIRST' ? second.id : first.id,
        );
      } finally {
        release();
        await fixture.service.shutdown();
      }
    },
  );

  it.each(['ABSENT', 'ERROR'] as const)(
    'Git诊断读数%s：无HEAD正常收敛，真实异常不被吞掉',
    async (mode) => {
      let reads = 0;
      const adapter = new ControlledAdapter('never');
      const fixture = await createFixture(
        'idle',
        undefined,
        {},
        {
          adapter,
          git: {
            readHead: async () => {
              if (++reads > 1 && mode === 'ERROR') throw new Error('git probe failure');
              return undefined;
            },
          },
        },
      );
      const tasks = new TaskRepository(database.db);
      const taskService = new TaskService(
        new GoalRepository(database.db),
        tasks,
        new ProjectRepository(database.db),
        fixture.service,
      );
      fixture.service.setTaskLifecycleObserver(taskService);
      const task = await tasks.create({
        id: randomUUID(),
        projectId: fixture.projectId,
        title: '非Git任务',
        status: 'IN_PROGRESS',
        assignedAgentId: fixture.agentId,
      });
      try {
        const session = await fixture.service.createManagedWorktree(
          {
            projectId: fixture.projectId,
            agentId: fixture.agentId,
            taskId: task.id,
            title: '无HEAD会话',
            cwd: '/tmp',
          },
          '/tmp',
        );
        await tasks.update(task.id, { sessionId: session.id });
        const run = await fixture.service.startRun(session.id, { text: '正常完成' });
        adapter.handles[0]!.complete(run.id);
        if (mode === 'ABSENT') {
          await waitFor(
            async () => (await fixture.repositories.sessions.get(session.id))?.status !== 'RUNNING',
          );
          expect((await fixture.repositories.sessions.get(session.id))?.status).toBe('READY');
          await waitFor(async () => (await tasks.get(task.id))?.status === 'WAITING_REVIEW');
          expect((await tasks.get(task.id))?.finalRunId).toBe(run.id);
        } else {
          await waitFor(
            async () =>
              (await fixture.repositories.sessions.get(session.id))?.status === 'DISCONNECTED',
          );
          expect((await tasks.get(task.id))?.status).toBe('IN_PROGRESS');
          expect((await tasks.get(task.id))?.finalRunId).toBeNull();
        }
        expect(await fixture.repositories.runs.get(run.id)).toMatchObject({
          status: 'COMPLETED',
          gitBeforeSha: null,
          gitAfterSha: null,
        });
      } finally {
        await fixture.service.shutdown();
      }
    },
  );

  async function preparationFixture(scenario: ControlledScenario = 'never') {
    const adapter = new ControlledAdapter(scenario);
    const fixture = await createFixture(
      'idle',
      undefined,
      {},
      {
        adapter,
        cancelConvergenceTimeoutMs: 1_000,
        git: { readHead: async () => undefined },
      },
    );
    const tasks = new TaskRepository(database.db);
    const taskService = new TaskService(
      new GoalRepository(database.db),
      tasks,
      new ProjectRepository(database.db),
      fixture.service,
    );
    fixture.service.setTaskLifecycleObserver(taskService);
    const task = await tasks.create({
      id: randomUUID(),
      projectId: fixture.projectId,
      title: '准备窗口',
      status: 'IN_PROGRESS',
      assignedAgentId: fixture.agentId,
    });
    const session = await fixture.service.createManagedWorktree(
      {
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        taskId: task.id,
        title: '准备窗口',
        cwd: '/tmp',
      },
      '/tmp',
    );
    await tasks.update(task.id, { sessionId: session.id });
    return { ...fixture, adapter, tasks, taskService, task, session };
  }

  it('managed Run 准入拒绝映射409且不污染Session、消息或派发，专用阶段恢复后可执行', async () => {
    const f = await preparationFixture();
    const executions = new WorktreeExecutionRepository(database.db);
    const execution = await executions.create({
      id: randomUUID(),
      taskId: f.task.id,
      projectId: f.projectId,
      agentId: f.agentId,
      sessionId: f.session.id,
      status: 'REVIEW',
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: `guard-${f.task.id}`,
    });
    const send = vi.spyOn(f.adapter.handles[0]!, 'sendTurn');
    const beforeSession = await f.repositories.sessions.get(f.session.id);
    const beforeTask = await f.tasks.get(f.task.id);
    try {
      await expect(
        f.service.startRun(f.session.id, { text: '不应直接运行' }),
      ).rejects.toMatchObject({ status: 409, code: 'WORKTREE_RUN_ADMISSION_REJECTED' });
      expect(await f.repositories.runs.list(f.session.id)).toEqual([]);
      expect(await f.repositories.messages.list(f.session.id)).toEqual([]);
      expect(await f.repositories.sessions.get(f.session.id)).toEqual(beforeSession);
      expect(await f.tasks.get(f.task.id)).toEqual(beforeTask);
      expect(send).not.toHaveBeenCalled();
      // Prove rejection did not leave a preparation fence or lose the active handle.
      await executions.transition(execution.id, 'RUNNING');
      const run = await f.service.startRun(f.session.id, { text: '已进入专用运行阶段' });
      expect(run.id).toBeTruthy();
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      await f.service.shutdown();
    }
  });

  it.each(['reject', 'deadline'] as const)(
    'AH061 %s提交返回迟到时终态与新Run不能越过取消收敛',
    async (source) => {
      const f = await preparationFixture();
      let rejectCancel!: (error: Error) => void;
      vi.spyOn(f.adapter.handles[0]!, 'cancel').mockImplementation(
        () =>
          new Promise<void>((_r, reject) => {
            rejectCancel = reject;
          }),
      );
      const first = await f.service.startRun(f.session.id, { text: '取消旧Run' });
      let release!: () => void;
      let committed = false;
      const converge = f.repositories.runs.convergeCancellationFailure.bind(f.repositories.runs);
      const convergence = vi
        .spyOn(f.repositories.runs, 'convergeCancellationFailure')
        .mockImplementation(async (...args) => {
          const result = await converge(...args);
          committed = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return result;
        });
      const terminal = vi.spyOn(f.repositories.runs, 'tryTransition');
      const close = vi.spyOn(f.adapter.handles[0]!, 'close');
      await f.service.cancelRun(f.session.id, first.id);
      if (source === 'reject') rejectCancel(new Error('controlled failure'));
      await waitFor(async () => committed, 2500);
      try {
        f.adapter.handles[0]!.complete(first.id);
        await waitFor(async () =>
          (await f.repositories.events.listAfter(f.session.id, 0, 100)).some(
            (event) => event.type === 'run.completed',
          ),
        );
        expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('DISCONNECTED');
        expect(terminal.mock.calls.some((call) => call[2] === 'COMPLETED')).toBe(false);
        await expect(
          f.service.startRun(f.session.id, { text: '不允许新Run' }),
        ).rejects.toMatchObject({ code: 'SESSION_RUN_UNRESOLVED' });
        release();
        await waitFor(async () => close.mock.calls.length === 1);
        await waitFor(async () => convergence.mock.results[0]?.type === 'return');
        expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('DISCONNECTED');
        expect((await f.repositories.runs.get(first.id))?.status).toBe('DISCONNECTED');
        expect(await f.repositories.runs.list(f.session.id)).toHaveLength(1);
      } finally {
        release();
        await f.service.shutdown();
      }
    },
  );

  it.each(['reject', 'deadline'] as const)(
    'AH061 %s旧handle关闭迟到不得回写恢复后的READY',
    async (source) => {
      const f = await preparationFixture();
      Object.assign(f.adapter, {
        resumeSession: (input: CreateAgentSessionInput) => f.adapter.createSession(input),
      });
      let rejectCancel!: (error: Error) => void;
      vi.spyOn(f.adapter.handles[0]!, 'cancel').mockImplementation(
        () =>
          new Promise<void>((_r, reject) => {
            rejectCancel = reject;
          }),
      );
      let releaseClose!: () => void;
      let closing = false;
      const originalClose = f.adapter.handles[0]!.close.bind(f.adapter.handles[0]);
      vi.spyOn(f.adapter.handles[0]!, 'close').mockImplementationOnce(async () => {
        closing = true;
        await new Promise<void>((resolve) => {
          releaseClose = resolve;
        });
        await originalClose();
      });
      const stopped = vi.spyOn(f.taskService, 'onRunStopped');
      const first = await f.service.startRun(f.session.id, { text: '取消' });
      await f.service.cancelRun(f.session.id, first.id);
      if (source === 'reject') rejectCancel(new Error('controlled failure'));
      await waitFor(async () => closing, 2500);
      try {
        expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('DISCONNECTED');
        await f.service.resume(f.session.id);
        const closeWinner = vi.spyOn(f.adapter.handles[1]!, 'close');
        releaseClose();
        await waitFor(async () => stopped.mock.calls.length > 0);
        expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('READY');
        expect((await f.repositories.runs.get(first.id))?.status).toBe('DISCONNECTED');
        expect(closeWinner).not.toHaveBeenCalled();
      } finally {
        releaseClose();
        await f.service.shutdown();
      }
    },
  );

  it('AH061完成提交先获锁：取消拒绝等待后不能关闭当前handle或新Run', async () => {
    const f = await preparationFixture();
    let rejectCancel!: (error: Error) => void;
    vi.spyOn(f.adapter.handles[0]!, 'cancel').mockImplementation(
      () =>
        new Promise<void>((_r, reject) => {
          rejectCancel = reject;
        }),
    );
    const first = await f.service.startRun(f.session.id, { text: '先完成' });
    await f.service.cancelRun(f.session.id, first.id);
    let release!: () => void;
    let committed = false;
    const transition = f.repositories.runs.tryTransition.bind(f.repositories.runs);
    vi.spyOn(f.repositories.runs, 'tryTransition').mockImplementation(
      async (id, expected, to, patch) => {
        const result = await transition(id, expected, to, patch);
        if (id === first.id && to === 'COMPLETED') {
          committed = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return result;
      },
    );
    const convergence = vi.spyOn(f.repositories.runs, 'convergeCancellationFailure');
    const request = vi.spyOn(
      f.service as unknown as { requestAdapterCancellation: (...args: unknown[]) => Promise<void> },
      'requestAdapterCancellation',
    );
    const close = vi.spyOn(f.adapter.handles[0]!, 'close');
    try {
      f.adapter.handles[0]!.complete(first.id);
      await waitFor(async () => committed);
      rejectCancel(new Error('late failure'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(convergence).not.toHaveBeenCalled();
      release();
      await waitFor(
        async () => (await f.repositories.sessions.get(f.session.id))?.status === 'READY',
      );
      await waitFor(async () => convergence.mock.calls.length === 1);
      const second = await f.service.startRun(f.session.id, { text: '显式第二轮' });
      expect((await f.repositories.runs.get(second.id))?.status).toBe('RUNNING');
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('RUNNING');
      expect(close).not.toHaveBeenCalled();
    } finally {
      release?.();
      request.mockRestore();
      await f.service.shutdown();
    }
  });

  it('AH061只有供应商拒绝迟到且原Run已完成时不影响新Run', async () => {
    const f = await preparationFixture();
    let rejectCancel!: (error: Error) => void;
    vi.spyOn(f.adapter.handles[0]!, 'cancel').mockImplementation(
      () =>
        new Promise<void>((_r, reject) => {
          rejectCancel = reject;
        }),
    );
    const first = await f.service.startRun(f.session.id, { text: '第一轮' });
    const request = vi.spyOn(
      f.service as unknown as { requestAdapterCancellation: (...args: unknown[]) => Promise<void> },
      'requestAdapterCancellation',
    );
    await f.service.cancelRun(f.session.id, first.id);
    f.adapter.handles[0]!.complete(first.id);
    await waitFor(async () => (await f.tasks.get(f.task.id))?.status === 'WAITING_REVIEW');
    const second = await f.service.startRun(f.session.id, { text: '第二轮' });
    const close = vi.spyOn(f.adapter.handles[0]!, 'close');
    try {
      rejectCancel(new Error('late failure'));
      await request.mock.results[0]!.value;
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('RUNNING');
      expect((await f.repositories.runs.get(second.id))?.status).toBe('RUNNING');
      expect(close).not.toHaveBeenCalled();
    } finally {
      await f.service.shutdown();
    }
  });

  it('AH061旧取消拒绝不能清除恢复后同Run的新deadline', async () => {
    const f = await preparationFixture();
    Object.assign(f.adapter, {
      resumeSession: (input: CreateAgentSessionInput) => f.adapter.createSession(input),
    });
    let rejectCancel!: (error: Error) => void;
    vi.spyOn(f.adapter.handles[0]!, 'cancel').mockImplementation(
      () =>
        new Promise<void>((_r, reject) => {
          rejectCancel = reject;
        }),
    );
    const first = await f.service.startRun(f.session.id, { text: '同Run恢复' });
    const request = vi.spyOn(
      f.service as unknown as { requestAdapterCancellation: (...args: unknown[]) => Promise<void> },
      'requestAdapterCancellation',
    );
    await f.service.cancelRun(f.session.id, first.id);
    await f.adapter.handles[0]!.close();
    await waitFor(
      async () => (await f.repositories.sessions.get(f.session.id))?.status === 'DISCONNECTED',
    );
    await f.service.resume(f.session.id);
    vi.spyOn(f.adapter.handles[1]!, 'cancel').mockImplementation(
      () => new Promise<void>(() => undefined),
    );
    try {
      await f.service.cancelRun(f.session.id, first.id);
      rejectCancel(new Error('旧activation迟到拒绝'));
      await request.mock.results[0]!.value;
      expect((await f.repositories.runs.get(first.id))?.status).toBe('CANCELING');
      await waitFor(
        async () =>
          (await f.repositories.runs.get(first.id))?.errorCode === 'CANCEL_CONFIRMATION_TIMEOUT',
        2500,
      );
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('DISCONNECTED');
      await waitFor(async () =>
        f.published.some((entry) => {
          const payload = entry.event.payloadJson as Record<string, unknown> | undefined;
          return payload?.reason === 'CANCEL_CONFIRMATION_TIMEOUT';
        }),
      );
    } finally {
      await f.service.shutdown();
    }
  });

  it('AH061完成快照未收尾时保持原准入栅栏，下一轮不会提前派发', async () => {
    let release!: () => void;
    let entered = false;
    const adapter = new ControlledAdapter('never');
    const f = await createFixture(
      'idle',
      undefined,
      {},
      {
        adapter,
        git: {
          readHead: async () => undefined,
          capture: async (_run, _project, _cwd, type) => {
            if (type === 'AFTER') {
              entered = true;
              await new Promise<void>((resolve) => {
                release = resolve;
              });
            }
          },
        },
      },
    );
    const session = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '快照边界',
      cwd: '/tmp',
    });
    const first = await f.service.startRun(session.id, { text: '第一轮' });
    const send = vi.spyOn(adapter.handles[0]!, 'sendTurn');
    adapter.handles[0]!.complete(first.id);
    await waitFor(async () => entered);
    let next: Promise<unknown> | undefined;
    try {
      expect((await f.repositories.sessions.get(session.id))?.status).toBe('RUNNING');
      expect((await f.repositories.runs.get(first.id))?.status).toBe('COMPLETED');
      next = f.service.startRun(session.id, { text: '快照结束后才能执行' });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(send).not.toHaveBeenCalled();
      expect(await f.repositories.runs.list(session.id)).toHaveLength(1);
      release();
      await next;
      expect(send).toHaveBeenCalledTimes(1);
      expect((await f.repositories.sessions.get(session.id))?.status).toBe('RUNNING');
    } finally {
      release();
      await next?.catch(() => undefined);
      await f.service.shutdown();
    }
  });

  it('AH060消息准备挂起后close已detach，派发前重验不调用旧handle', async () => {
    const f = await preparationFixture();
    let releaseMessage!: () => void;
    let entered = false;
    const append = f.repositories.messages.append.bind(f.repositories.messages);
    vi.spyOn(f.repositories.messages, 'append').mockImplementationOnce(async (input) => {
      entered = true;
      await new Promise<void>((resolve) => {
        releaseMessage = resolve;
      });
      return append(input);
    });
    const send = vi.spyOn(f.adapter.handles[0]!, 'sendTurn');
    const originalClose = f.adapter.handles[0]!.close.bind(f.adapter.handles[0]);
    let releaseClose!: () => void;
    let closing = false;
    vi.spyOn(f.adapter.handles[0]!, 'close').mockImplementationOnce(async () => {
      closing = true;
      await new Promise<void>((resolve) => {
        releaseClose = resolve;
      });
      await originalClose();
    });
    const start = f.service
      .startRun(f.session.id, { text: '晚期准备' })
      .catch((error: unknown) => error);
    await waitFor(async () => entered);
    const closed = f.service.close(f.session.id);
    await waitFor(async () => closing);
    try {
      releaseMessage();
      expect(await start).toMatchObject({ code: 'RUN_PREPARATION_FAILED' });
      expect(send).not.toHaveBeenCalled();
      expect((await f.repositories.runs.list(f.session.id))[0]).toMatchObject({
        status: 'FAILED',
        dispatchState: 'PREPARING',
        errorCode: 'RUN_PREPARATION_FAILED',
      });
      releaseClose();
      expect((await closed).status).toBe('CLOSED');
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('CLOSED');
    } finally {
      releaseMessage();
      releaseClose();
      await f.service.shutdown();
    }
  });

  it('AH060无连接DEAD历史持久化且无active epoch引用最终回收', async () => {
    const f = await preparationFixture('approval-error');
    const send = vi.spyOn(f.adapter.handles[0]!, 'resolveApproval');
    const run = await f.service.startRun(f.session.id, { text: 'DEAD归属' });
    await waitFor(
      async () => (await f.repositories.runs.get(run.id))?.status === 'WAITING_APPROVAL',
    );
    const approval = (await f.repositories.approvals.listPending(f.session.id))[0]!;
    await f.adapter.handles[0]!.close();
    await waitFor(
      async () => (await f.repositories.sessions.get(f.session.id))?.status === 'DISCONNECTED',
    );
    const dispatch = vi.spyOn(
      f.service as unknown as { dispatchApprovalDecision: (id: string) => Promise<void> },
      'dispatchApprovalDecision',
    );
    try {
      await f.service.resolveApproval(approval.id, 'allow');
      await dispatch.mock.results[0]!.value;
      expect((await f.service.getApproval(approval.id)).deliveryState).toBe('DEAD');
      expect((await f.repositories.runs.get(run.id))?.status).toBe('DISCONNECTED');
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('DISCONNECTED');
      expect(
        (f.service as unknown as { approvalEpochs: Map<string, unknown> }).approvalEpochs.has(
          f.session.id,
        ),
      ).toBe(false);
      expect(send).not.toHaveBeenCalled();
    } finally {
      await f.service.shutdown();
    }
  });

  it('AH060 CANCELING仍由取消路径负责，旧投递UNKNOWN不关handle', async () => {
    const f = await approvalConvergenceFixture();
    const close = vi.spyOn(f.adapter.handles[0]!, 'close');
    try {
      await f.service.cancelRun(f.session.id, f.first.id);
      f.rejectDelivery(new Error('controlled rejection'));
      await f.deliveryDone;
      expect((await f.service.getApproval(f.approval.id)).deliveryState).toBe('UNKNOWN');
      expect((await f.repositories.runs.get(f.first.id))?.status).toBe('CANCELING');
      expect(close).not.toHaveBeenCalled();
    } finally {
      await f.service.shutdown();
    }
  });

  it.each(['close', 'resume'] as const)(
    'AH060准备补偿Task回调挂起期间%s接管，迟到不写新Session',
    async (action) => {
      const f = await preparationFixture();
      Object.assign(f.adapter, {
        resumeSession: (input: CreateAgentSessionInput) => f.adapter.createSession(input),
      });
      vi.spyOn(f.repositories.messages, 'append').mockRejectedValueOnce(
        new Error('preparation failed'),
      );
      let release!: () => void;
      let entered = false;
      const stopped = f.taskService.onRunStopped.bind(f.taskService);
      vi.spyOn(f.taskService, 'onRunStopped').mockImplementationOnce(async (task, run) => {
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return stopped(task, run);
      });
      const pending = f.service
        .startRun(f.session.id, { text: '准备补偿' })
        .catch((error: unknown) => error);
      await waitFor(async () => entered);
      try {
        if (action === 'close') await f.service.close(f.session.id);
        else {
          await f.adapter.handles[0]!.close();
          await waitFor(
            async () =>
              (await f.repositories.sessions.get(f.session.id))?.status === 'DISCONNECTED',
          );
          await f.service.resume(f.session.id);
        }
        const transition = vi.spyOn(f.repositories.sessions, 'transition');
        release();
        expect(await pending).toMatchObject({ code: 'RUN_PREPARATION_FAILED' });
        expect(transition).not.toHaveBeenCalled();
        expect((await f.repositories.sessions.get(f.session.id))?.status).toBe(
          action === 'close' ? 'CLOSED' : 'READY',
        );
        expect((await f.repositories.runs.list(f.session.id))[0]).toMatchObject({
          status: 'FAILED',
          dispatchState: 'PREPARING',
          errorCode: 'RUN_PREPARATION_FAILED',
        });
      } finally {
        release();
        await f.service.shutdown();
      }
    },
  );

  it('AH060 Run已插入时close撤销：不send、不留QUEUED、不复活CLOSED', async () => {
    const f = await preparationFixture();
    let release!: () => void;
    let inserted = false;
    const create = f.repositories.runs.create.bind(f.repositories.runs);
    vi.spyOn(f.repositories.runs, 'create').mockImplementationOnce(async (input) => {
      const result = await create(input);
      inserted = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return result;
    });
    const send = vi.spyOn(f.adapter.handles[0]!, 'sendTurn');
    const close = vi.spyOn(f.adapter.handles[0]!, 'close');
    const start = f.service
      .startRun(f.session.id, { text: '取消准入' })
      .catch((error: unknown) => error);
    await waitFor(async () => inserted);
    const closing = f.service.close(f.session.id);
    await waitFor(async () => close.mock.calls.length === 1);
    try {
      release();
      expect(await start).toMatchObject({ code: 'RUN_PREPARATION_FAILED' });
      expect((await closing).status).toBe('CLOSED');
      expect(send).not.toHaveBeenCalled();
      const runs = await f.repositories.runs.list(f.session.id);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        status: 'FAILED',
        dispatchState: 'PREPARING',
        errorCode: 'RUN_PREPARATION_FAILED',
      });
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('CLOSED');
      expect((await f.tasks.get(f.task.id))?.status).toBe('BLOCKED');
    } finally {
      release();
      await f.service.shutdown();
    }
  });

  it.each(['failure-first', 'admission-first'] as const)(
    'AH060失败收敛与新Run提交共享gate：%s',
    async (order) => {
      const f = await approvalConvergenceFixture();
      f.adapter.handles[0]!.complete(f.first.id);
      await waitFor(async () => (await f.tasks.get(f.task.id))?.status === 'WAITING_REVIEW');
      let release!: () => void;
      let waiting = false;
      const failure = f.repositories.runs.convergeApprovalFailure.bind(f.repositories.runs);
      const create = f.repositories.runs.create.bind(f.repositories.runs);
      const failed = vi
        .spyOn(f.repositories.runs, 'convergeApprovalFailure')
        .mockImplementation(async (...args) => {
          if (order === 'failure-first') {
            waiting = true;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return failure(...args);
        });
      const admission = vi
        .spyOn(f.repositories.runs, 'create')
        .mockImplementation(async (input) => {
          if (order === 'admission-first') {
            waiting = true;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return create(input);
        });
      const close = vi.spyOn(f.adapter.handles[0]!, 'close');
      let next: ReturnType<typeof f.service.startRun>;
      if (order === 'failure-first') {
        f.rejectDelivery(new Error('controlled rejection'));
        await waitFor(async () => waiting);
        next = f.service.startRun(f.session.id, { text: '新轮次' });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(admission).not.toHaveBeenCalled();
      } else {
        next = f.service.startRun(f.session.id, { text: '新轮次' });
        await waitFor(async () => waiting);
        f.rejectDelivery(new Error('controlled rejection'));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(failed).not.toHaveBeenCalled();
      }
      try {
        release();
        const run = await next;
        await f.deliveryDone;
        expect((await f.repositories.sessions.get(f.session.id))?.latestRunId).toBe(run.id);
        expect((await f.repositories.runs.get(f.first.id))?.status).toBe('COMPLETED');
        expect(close).not.toHaveBeenCalled();
        expect((await f.service.getApproval(f.approval.id)).deliveryState).toBe('UNKNOWN');
      } finally {
        release();
        await f.service.shutdown();
      }
    },
  );

  it('AH060拒绝close不撤销lease，正常UNKNOWN收敛后refs释放', async () => {
    const f = await approvalConvergenceFixture();
    const epochs = (f.service as unknown as { approvalEpochs: Map<string, { references: number }> })
      .approvalEpochs;
    const epoch = epochs.get(f.session.id);
    expect(epoch?.references).toBe(1);
    await expect(f.service.close(f.session.id)).rejects.toMatchObject({
      code: 'SESSION_HAS_ACTIVE_RUN',
    });
    expect(epochs.get(f.session.id)).toBe(epoch);
    try {
      f.rejectDelivery(new Error('controlled rejection'));
      await f.deliveryDone;
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('DISCONNECTED');
      expect((await f.repositories.runs.get(f.first.id))?.status).toBe('DISCONNECTED');
      expect((await f.service.getApproval(f.approval.id)).deliveryState).toBe('UNKNOWN');
      expect(epoch?.references).toBe(0);
      expect(epochs.has(f.session.id)).toBe(false);
    } finally {
      await f.service.shutdown();
    }
  });

  it('shutdown排空循环包含快照之后由原审批请求创建的异步投递子任务', async () => {
    const f = await preparationFixture('approval-error');
    const run = await f.service.startRun(f.session.id, { text: '嵌套排空' });
    await waitFor(
      async () => (await f.repositories.runs.get(run.id))?.status === 'WAITING_APPROVAL',
    );
    const approval = (await f.repositories.approvals.listPending(f.session.id))[0]!;
    let enteredParent!: () => void, releaseParent!: () => void;
    let enteredChild!: () => void, releaseChild!: () => void;
    const parentReached = new Promise<void>((resolve) => {
      enteredParent = resolve;
    });
    const parentBarrier = new Promise<void>((resolve) => {
      releaseParent = resolve;
    });
    const childReached = new Promise<void>((resolve) => {
      enteredChild = resolve;
    });
    const childBarrier = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });
    const record = f.repositories.approvals.recordDecisionExactlyOnce.bind(
      f.repositories.approvals,
    );
    vi.spyOn(f.repositories.approvals, 'recordDecisionExactlyOnce').mockImplementationOnce(
      async (...args) => {
        const result = await record(...args);
        enteredParent();
        await parentBarrier;
        return result;
      },
    );
    const claim = f.repositories.approvals.claimDelivery.bind(f.repositories.approvals);
    vi.spyOn(f.repositories.approvals, 'claimDelivery').mockImplementationOnce(async (...args) => {
      enteredChild();
      await childBarrier;
      return claim(...args);
    });
    const send = vi.spyOn(f.adapter.handles[0]!, 'resolveApproval');
    const resolving = f.service.resolveApproval(approval.id, 'allow');
    await parentReached;
    let stopped = false;
    const stopping = f.service.shutdown().then(() => {
      stopped = true;
    });
    releaseParent();
    await childReached;
    await resolving; // The original snapshot's parent is now complete.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    releaseChild();
    await stopping;
    expect(send).not.toHaveBeenCalled();
    expect((await f.service.getApproval(approval.id)).deliveryState).toBe('DEAD');
  });

  it('审批投递等待Task回调期间shutdown，最终准入核对阻止旧handle发送且排空后才完成', async () => {
    const f = await preparationFixture('approval-error');
    const run = await f.service.startRun(f.session.id, { text: '停止边界权限' });
    await waitFor(
      async () => (await f.repositories.runs.get(run.id))?.status === 'WAITING_APPROVAL',
    );
    const approval = (await f.repositories.approvals.listPending(f.session.id))[0]!;
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.service.setTaskLifecycleObserver({
      onRunCompleted: async () => undefined,
      onRunResumed: async () => {
        entered();
        await barrier;
      },
    });
    const send = vi.spyOn(f.adapter.handles[0]!, 'resolveApproval');
    await f.service.resolveApproval(approval.id, 'allow');
    await reached;
    let stopped = false;
    const stopping = f.service.shutdown().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stopped).toBe(false);
    expect(send).not.toHaveBeenCalled();
    release();
    await stopping;
    expect(send).not.toHaveBeenCalled();
    const saved = await f.service.getApproval(approval.id);
    expect(saved.deliveryState).toBe('DEAD');
    expect(saved.deliveryErrorCode).toBe('SESSION_ACTIVATION_CHANGED_BEFORE_DELIVERY');
    await expect(f.service.resolveApproval(approval.id, 'allow')).rejects.toMatchObject({
      code: 'SESSION_SERVICE_STOPPING',
    });
  });

  async function approvalConvergenceFixture() {
    const f = await preparationFixture('approval-error');
    Object.assign(f.adapter, {
      resumeSession: async (input: CreateAgentSessionInput) => {
        const handle = new ControlledHandle(input, 'never');
        f.adapter.handles.push(handle);
        return handle;
      },
    });
    let rejectDelivery!: (error: Error) => void;
    let delivering = false;
    vi.spyOn(f.adapter.handles[0]!, 'resolveApproval').mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDelivery = reject;
          delivering = true;
        }),
    );
    const first = await f.service.startRun(f.session.id, { text: '权限收敛审计' });
    await waitFor(
      async () => (await f.repositories.runs.get(first.id))?.status === 'WAITING_APPROVAL',
    );
    const approval = (await f.repositories.approvals.listPending(f.session.id))[0]!;
    const dispatch = vi.spyOn(
      f.service as unknown as { dispatchApprovalDecision: (id: string) => Promise<void> },
      'dispatchApprovalDecision',
    );
    await f.service.resolveApproval(approval.id, 'allow');
    await waitFor(async () => delivering);
    return {
      ...f,
      first,
      approval,
      rejectDelivery,
      deliveryDone: dispatch.mock.results[0]!.value as Promise<void>,
    };
  }

  it('AH060：同activation显式R2后旧投递失败不关闭R2 handle', async () => {
    const f = await approvalConvergenceFixture();
    const handle = f.adapter.handles[0]!;
    const close = vi.spyOn(handle, 'close');
    try {
      handle.complete(f.first.id);
      await waitFor(async () => (await f.tasks.get(f.task.id))?.status === 'WAITING_REVIEW');
      const second = await f.service.startRun(f.session.id, { text: '同连接显式新Run' });
      await waitFor(
        async () => (await f.repositories.runs.get(second.id))?.status === 'WAITING_APPROVAL',
      );
      expect(close).not.toHaveBeenCalled();
      f.rejectDelivery(new Error('old delivery rejected'));
      await f.deliveryDone;
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('WAITING_APPROVAL');
      expect(close).not.toHaveBeenCalled();
      expect((await f.repositories.runs.get(f.first.id))?.status).toBe('COMPLETED');
      expect((await f.repositories.runs.get(second.id))?.status).toBe('WAITING_APPROVAL');
      expect((await f.service.getApproval(f.approval.id)).deliveryState).toBe('UNKNOWN');
    } finally {
      f.rejectDelivery(new Error('cleanup'));
      await f.service.shutdown();
    }
  });

  it('AH060：恢复及新Run后旧投递拒绝不影响新Session', async () => {
    const f = await approvalConvergenceFixture();
    await f.adapter.handles[0]!.close();
    await waitFor(
      async () => (await f.repositories.sessions.get(f.session.id))?.status === 'DISCONNECTED',
    );
    try {
      await f.service.resume(f.session.id);
      const epochs = (f.service as unknown as { approvalEpochs: Map<string, unknown> })
        .approvalEpochs;
      const newEpoch = epochs.get(f.session.id);
      const newHandle = f.adapter.handles[1]!;
      const close = vi.spyOn(newHandle, 'close');
      newHandle.complete(f.first.id);
      await waitFor(async () => (await f.tasks.get(f.task.id))?.status === 'WAITING_REVIEW');
      const second = await f.service.startRun(f.session.id, { text: '显式新Run' });
      f.rejectDelivery(new Error('late delivery rejection'));
      await f.deliveryDone;
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('RUNNING');
      expect((await f.repositories.runs.get(f.first.id))?.status).toBe('COMPLETED');
      expect((await f.repositories.runs.get(second.id))?.status).toBe('RUNNING');
      expect((await f.tasks.get(f.task.id))?.status).toBe('WAITING_REVIEW');
      expect((await f.service.getApproval(f.approval.id)).deliveryState).toBe('UNKNOWN');
      expect(close).not.toHaveBeenCalled();
      expect(epochs.get(f.session.id)).toBe(newEpoch);
    } finally {
      f.rejectDelivery(new Error('cleanup'));
      await f.service.shutdown();
    }
  });

  it('AH060：旧handle关闭挂起期间可恢复，迟到清理不影响新Session', async () => {
    const f = await approvalConvergenceFixture();
    let releaseClose!: () => void;
    let closing = false;
    const originalClose = f.adapter.handles[0]!.close.bind(f.adapter.handles[0]);
    const closeOld = vi.spyOn(f.adapter.handles[0]!, 'close').mockImplementation(async () => {
      closing = true;
      await new Promise<void>((resolve) => {
        releaseClose = resolve;
      });
      await originalClose();
    });
    f.rejectDelivery(new Error('delivery rejection'));
    await waitFor(async () => closing);
    try {
      await waitFor(
        async () => (await f.repositories.sessions.get(f.session.id))?.status === 'DISCONNECTED',
      );
      await f.service.resume(f.session.id);
      const closeNew = vi.spyOn(f.adapter.handles[1]!, 'close');
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('READY');
      releaseClose();
      await f.deliveryDone;
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('READY');
      expect((await f.repositories.runs.get(f.first.id))?.status).toBe('DISCONNECTED');
      expect(closeOld).toHaveBeenCalledTimes(1);
      expect(closeNew).not.toHaveBeenCalled();
    } finally {
      releaseClose();
      closeOld.mockRestore();
      await originalClose();
      await f.service.shutdown();
    }
  });

  it('AH060：双权限合法DEAD收敛打开恢复窗口，旧Task回调不改新Session', async () => {
    const f = await approvalConvergenceFixture();
    f.adapter.handles[0]!.requestApproval('second-permission');
    await waitFor(
      async () => (await f.repositories.approvals.listPending(f.session.id)).length === 1,
    );
    const secondApproval = (await f.repositories.approvals.listPending(f.session.id))[0]!;
    let release!: () => void;
    let stopped = false;
    const originalStop = f.taskService.onRunStopped.bind(f.taskService);
    vi.spyOn(f.taskService, 'onRunStopped').mockImplementationOnce(async (task, run) => {
      stopped = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return originalStop(task, run);
    });
    f.rejectDelivery(new Error('first delivery rejected'));
    await waitFor(async () => stopped);
    try {
      expect((await f.repositories.runs.get(f.first.id))?.status).toBe('DISCONNECTED');
      // A second user decision has no active connection: its durable DEAD convergence is another real path.
      await f.service.resolveApproval(secondApproval.id, 'allow');
      await waitFor(
        async () => (await f.repositories.sessions.get(f.session.id))?.status === 'DISCONNECTED',
      );
      expect((await f.service.getApproval(secondApproval.id)).deliveryState).toBe('DEAD');
      await f.service.resume(f.session.id);
      const close = vi.spyOn(f.adapter.handles[1]!, 'close');
      const taskBefore = (await f.tasks.get(f.task.id))?.status;
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('READY');
      release();
      await f.deliveryDone;
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('READY');
      expect((await f.tasks.get(f.task.id))?.status).toBe(taskBefore);
      expect((await f.repositories.runs.get(f.first.id))?.status).toBe('DISCONNECTED');
      expect(await f.repositories.runs.list(f.session.id)).toHaveLength(1);
      expect(close).not.toHaveBeenCalled();
    } finally {
      release();
      await f.service.shutdown();
    }
  });

  it.each(['old-write', 'new-ready', 'close-queued'] as const)(
    'AH059真实提交barrier顺序%s保护activation交接',
    async (order) => {
      const f = await preparationFixture('approval-error');
      Object.assign(f.adapter, {
        resumeSession: (input: CreateAgentSessionInput) => f.adapter.createSession(input),
      });
      let rejectDelivery!: (error: Error) => void;
      let delivering = false;
      vi.spyOn(f.adapter.handles[0]!, 'resolveApproval').mockImplementation(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectDelivery = reject;
            delivering = true;
          }),
      );
      const run = await f.service.startRun(f.session.id, { text: '提交互斥' });
      await waitFor(
        async () => (await f.repositories.runs.get(run.id))?.status === 'WAITING_APPROVAL',
      );
      const approval = (await f.repositories.approvals.listPending(f.session.id))[0]!;
      await f.service.resolveApproval(approval.id, 'allow');
      await waitFor(async () => delivering);
      let releaseOld = () => undefined as void;
      let releaseReady = () => undefined as void;
      let oldWaiting = false;
      let readyWaiting = false;
      let resumed = false;
      let oldFinished = false;
      const consumer = f.service as unknown as {
        handleActivationDisconnected: (id: string, activation: string) => Promise<void>;
      };
      const handleDisconnect = consumer.handleActivationDisconnected.bind(f.service);
      if (order === 'new-ready')
        vi.spyOn(consumer, 'handleActivationDisconnected').mockImplementationOnce(
          async (...args) => {
            oldWaiting = true;
            await new Promise<void>((resolve) => {
              releaseOld = resolve;
            });
            return handleDisconnect(...args);
          },
        );
      const transition = f.repositories.sessions.transition.bind(f.repositories.sessions);
      vi.spyOn(f.repositories.sessions, 'transition').mockImplementation(
        async (id, to, patch, options) => {
          const result = await transition(id, to, patch, options);
          if (order !== 'new-ready' && to === 'DISCONNECTED' && !oldWaiting) {
            // The DB commit is visible while its completion is still pending in the short gate.
            // Approval convergence now shares this gate, so it cannot be a bypassing writer.
            oldWaiting = true;
            await new Promise<void>((resolve) => {
              releaseOld = resolve;
            });
          }
          if (order === 'new-ready' && to === 'READY') {
            readyWaiting = true;
            await new Promise<void>((resolve) => {
              releaseReady = resolve;
            });
          }
          return result;
        },
      );
      const disconnect = vi.spyOn(
        f.service as unknown as {
          handleActivationDisconnected: (id: string, activation: string) => Promise<void>;
        },
        'handleActivationDisconnected',
      );
      await f.adapter.handles[0]!.close();
      await waitFor(async () => oldWaiting);
      const oldDone = (disconnect.mock.results[0]!.value as Promise<void>).then(() => {
        oldFinished = true;
      });
      try {
        rejectDelivery(new Error('controlled rejection'));
        await waitFor(
          async () => (await f.repositories.sessions.get(f.session.id))?.status === 'DISCONNECTED',
        );
        const resume = f.service
          .resume(f.session.id)
          .then((value) => {
            resumed = true;
            return value;
          })
          .catch((error: unknown) => error);
        let closing: Promise<unknown> | undefined;
        await waitFor(async () => f.adapter.handles.length === 2);
        if (order !== 'new-ready') {
          await new Promise((resolve) => setTimeout(resolve, 20));
          expect(resumed).toBe(false);
          expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('DISCONNECTED');
          if (order === 'close-queued') closing = f.service.close(f.session.id);
          releaseOld();
        } else {
          await waitFor(async () => readyWaiting);
          releaseOld();
          await new Promise((resolve) => setTimeout(resolve, 20));
          expect(oldFinished).toBe(false);
          expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('READY');
          releaseReady();
        }
        if (order === 'close-queued') {
          expect(await resume).toMatchObject({
            code: 'AGENT_SESSION_RESUME_FAILED',
            cause: { code: 'SESSION_LIFECYCLE_SUPERSEDED' },
          });
          expect(await closing).toMatchObject({ status: 'CLOSED' });
        } else expect(await resume).toMatchObject({ status: 'READY' });
        await oldDone;
        expect((await f.repositories.sessions.get(f.session.id))?.status).toBe(
          order === 'close-queued' ? 'CLOSED' : 'READY',
        );
        expect((await f.repositories.runs.get(run.id))?.status).toBe('DISCONNECTED');
      } finally {
        releaseOld();
        releaseReady();
        await f.service.shutdown();
      }
    },
  );

  it('AH059提交失败不毒化队列，随后close仍可完成', async () => {
    const f = await preparationFixture();
    Object.assign(f.adapter, {
      resumeSession: (input: CreateAgentSessionInput) => f.adapter.createSession(input),
    });
    await f.adapter.handles[0]!.close();
    await waitFor(
      async () => (await f.repositories.sessions.get(f.session.id))?.status === 'DISCONNECTED',
    );
    const transition = f.repositories.sessions.transition.bind(f.repositories.sessions);
    vi.spyOn(f.repositories.sessions, 'transition').mockImplementation(
      async (id, to, patch, options) => {
        if (to === 'READY') throw new Error('controlled READY commit failure');
        return transition(id, to, patch, options);
      },
    );
    try {
      await expect(f.service.resume(f.session.id)).rejects.toMatchObject({
        code: 'AGENT_SESSION_RESUME_FAILED',
      });
      expect((await f.service.close(f.session.id)).status).toBe('CLOSED');
    } finally {
      await f.service.shutdown();
    }
  });

  it('AH059合法cancel拒绝先断连，旧断连消费者恢复后不影响新Run Session', async () => {
    const f = await preparationFixture();
    Object.assign(f.adapter, {
      resumeSession: (input: CreateAgentSessionInput) => f.adapter.createSession(input),
    });
    let rejectCancel!: (error: Error) => void;
    const cancel = vi.spyOn(f.adapter.handles[0]!, 'cancel').mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCancel = reject;
        }),
    );
    const first = await f.service.startRun(f.session.id, { text: '原始Run' });
    await f.service.cancelRun(f.session.id, first.id);
    let release!: () => void;
    let entered = false;
    const consumer = f.service as unknown as {
      handleActivationDisconnected: (id: string, activation: string) => Promise<void>;
    };
    const handleDisconnect = consumer.handleActivationDisconnected.bind(f.service);
    const barrier = vi
      .spyOn(consumer, 'handleActivationDisconnected')
      .mockImplementationOnce(async (...args) => {
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return handleDisconnect(...args);
      });
    const disconnect = vi.spyOn(
      f.service as unknown as {
        handleActivationDisconnected: (id: string, activation: string) => Promise<void>;
      },
      'handleActivationDisconnected',
    );
    await f.adapter.handles[0]!.close();
    await waitFor(async () => entered);
    try {
      rejectCancel(new Error('controlled cancellation rejection'));
      await waitFor(
        async () => (await f.repositories.sessions.get(f.session.id))?.status === 'DISCONNECTED',
      );
      expect((await f.repositories.runs.get(first.id))?.status).toBe('DISCONNECTED');
      await f.service.resume(f.session.id);
      const newHandle = f.adapter.handles[1]!;
      const newClose = vi.spyOn(newHandle, 'close');
      newHandle.complete(first.id); // Authoritative recovered-provider outcome, not a DB rewrite.
      await waitFor(async () => (await f.tasks.get(f.task.id))?.status === 'WAITING_REVIEW');
      const second = await f.service.startRun(f.session.id, { text: '用户显式新轮次' });
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('RUNNING');
      release();
      await disconnect.mock.results[0]!.value;
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('RUNNING');
      expect((await f.repositories.runs.get(first.id))?.status).toBe('COMPLETED');
      expect((await f.repositories.runs.get(second.id))?.status).toBe('RUNNING');
      expect((await f.tasks.get(f.task.id))?.status).toBe('WAITING_REVIEW');
      expect(newClose).not.toHaveBeenCalled();
    } finally {
      release();
      cancel.mockRestore();
      barrier.mockRestore();
      await f.service.shutdown();
    }
  });

  it('AH065当前连接配置失败不毒化队列且仅持久化请求字段', async () => {
    const adapter = new ControlledAdapter('never');
    const f = await createFixture('idle', undefined, {}, { adapter });
    const session = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '有效配置',
      cwd: '/tmp',
      mode: 'initial-mode',
    });
    const set = vi
      .fn()
      .mockRejectedValueOnce(new Error('controlled failure'))
      .mockResolvedValueOnce({
        supported: true,
        current: { model: 'selected-model', mode: 'unrequested-mode', reasoningEffort: null },
        options: { models: [], modes: [], reasoningEfforts: [] },
      });
    Object.assign(adapter.handles[0]!, { setConfiguration: set });
    try {
      const failed = f.service
        .updateConfiguration(session.id, { model: 'bad-model' })
        .catch((error: unknown) => error);
      const success = f.service.updateConfiguration(session.id, { model: 'selected-model' });
      expect(await failed).toMatchObject({ code: 'SESSION_CONFIGURATION_FAILED' });
      expect(await success).toMatchObject({ current: { model: 'selected-model' } });
      expect(set).toHaveBeenCalledTimes(2);
      expect(await f.repositories.sessions.get(session.id)).toMatchObject({
        model: 'selected-model',
        mode: 'initial-mode',
      });
      adapter.handles[0]!.configuration({ mode: 'event-mode' });
      await waitFor(
        async () => (await f.repositories.sessions.get(session.id))?.mode === 'event-mode',
      );
      expect((await f.repositories.sessions.get(session.id))?.model).toBe('selected-model');
    } finally {
      await f.service.shutdown();
    }
  });

  it('AH065旧配置事件写入挂起后恢复的新模型不能被覆盖', async () => {
    const adapter = Object.assign(new ControlledAdapter('reject'), {
      async resumeSession(this: ControlledAdapter, input: CreateAgentSessionInput) {
        const handle = await this.createSession(input);
        return Object.assign(handle, {
          async getConfiguration() {
            return {
              supported: true,
              current: { model: 'new-model', mode: 'new-mode', reasoningEffort: null },
              options: { models: [], modes: [], reasoningEfforts: [] },
            };
          },
        });
      },
    });
    const f = await createFixture('idle', undefined, {}, { adapter });
    const session = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '配置代际',
      cwd: '/tmp',
    });
    const run = await f.service.startRun(session.id, { text: '原连接' });
    let release = () => undefined as void;
    let entered = false;
    const configurationConsumer = f.service as unknown as {
      persistConfigurationPayload: (...args: unknown[]) => Promise<boolean>;
    };
    const apply = configurationConsumer.persistConfigurationPayload.bind(f.service);
    vi.spyOn(configurationConsumer, 'persistConfigurationPayload').mockImplementationOnce(
      async (...args) => {
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return apply(...args);
      },
    );
    const consumer = f.service as unknown as {
      persistEvent: (...args: unknown[]) => Promise<void>;
    };
    const event = vi.spyOn(consumer, 'persistEvent');
    try {
      adapter.handles[0]!.configuration({ model: 'old-model', mode: 'old-mode' });
      await waitFor(async () => entered);
      await f.service.cancelRun(session.id, run.id);
      await waitFor(
        async () => (await f.repositories.sessions.get(session.id))?.status === 'DISCONNECTED',
      );
      await f.service.resume(session.id);
      expect(await f.repositories.sessions.get(session.id)).toMatchObject({
        model: 'new-model',
        mode: 'new-mode',
      });
      release();
      await event.mock.results[0]!.value;
      expect(
        f.published.find(
          ({ topic, event }) =>
            topic === `session:${session.id}` && event.type === 'agent.configuration.updated',
        )?.event.payloadJson,
      ).toMatchObject({ ignored: true, ignoredReason: 'STALE_ACTIVATION' });
      expect(await f.repositories.sessions.get(session.id)).toMatchObject({
        model: 'new-model',
        mode: 'new-mode',
      });
    } finally {
      release();
      await f.service.shutdown();
    }
  });

  it('AH065当前配置持久化先赢时取消等待提交且恢复覆盖旧值', async () => {
    const adapter = Object.assign(new ControlledAdapter('reject'), {
      async resumeSession(this: ControlledAdapter, input: CreateAgentSessionInput) {
        const handle = await this.createSession(input);
        return Object.assign(handle, {
          async getConfiguration() {
            return {
              supported: true,
              current: { model: 'new-model', mode: 'new-mode', reasoningEffort: null },
              options: { models: [], modes: [], reasoningEfforts: [] },
            };
          },
        });
      },
    });
    const f = await createFixture('idle', undefined, {}, { adapter });
    const session = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '配置代际',
      cwd: '/tmp',
    });
    const run = await f.service.startRun(session.id, { text: '原连接' });
    let release = () => undefined as void;
    let entered = false;
    const update = f.repositories.sessions.updateConfiguration.bind(f.repositories.sessions);
    vi.spyOn(f.repositories.sessions, 'updateConfiguration').mockImplementation(
      async (id, patch, options) => {
        if (patch.model === 'old-model') {
          entered = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return update(id, patch, options);
      },
    );
    const consumer = f.service as unknown as {
      persistEvent: (...args: unknown[]) => Promise<void>;
    };
    const event = vi.spyOn(consumer, 'persistEvent');
    try {
      adapter.handles[0]!.configuration({ model: 'old-model', mode: 'old-mode' });
      await waitFor(async () => entered);
      const commits = f.service as unknown as {
        withActivationCommit: (id: string, action: () => Promise<unknown>) => Promise<unknown>;
      };
      const commit = commits.withActivationCommit.bind(f.service);
      let queued = false;
      vi.spyOn(commits, 'withActivationCommit').mockImplementation((id, action) => {
        queued = true;
        return commit(id, action);
      });
      let canceled = false;
      const cancellation = f.service.cancelRun(session.id, run.id).then((result) => {
        canceled = true;
        return result;
      });
      await waitFor(async () => queued);
      expect(canceled).toBe(false);
      release();
      await cancellation;
      await waitFor(
        async () => (await f.repositories.sessions.get(session.id))?.status === 'DISCONNECTED',
      );
      await f.service.resume(session.id);
      expect(await f.repositories.sessions.get(session.id)).toMatchObject({
        model: 'new-model',
        mode: 'new-mode',
      });
      release();
      await event.mock.results[0]!.value;
      expect(await f.repositories.sessions.get(session.id)).toMatchObject({
        model: 'new-model',
        mode: 'new-mode',
      });
    } finally {
      release();
      await f.service.shutdown();
    }
  });

  it('AH065旧配置请求与排队请求恢复后不得写入或调用旧handle', async () => {
    const adapter = Object.assign(new ControlledAdapter('reject'), {
      async resumeSession(this: ControlledAdapter, input: CreateAgentSessionInput) {
        const handle = await this.createSession(input);
        return Object.assign(handle, {
          async getConfiguration() {
            return {
              supported: true,
              current: { model: 'new-model', mode: 'new-mode', reasoningEffort: null },
              options: { models: [], modes: [], reasoningEfforts: [] },
            };
          },
        });
      },
    });
    const f = await createFixture('idle', undefined, {}, { adapter });
    const session = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '配置代际',
      cwd: '/tmp',
    });
    const run = await f.service.startRun(session.id, { text: '原连接' });
    let release = () => undefined as void;
    let entered = false;
    const set = vi.fn(async () => {
      if (!entered) {
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return {
        supported: true,
        current: { model: 'old-model', mode: 'old-mode', reasoningEffort: null },
        options: { models: [], modes: [], reasoningEfforts: [] },
      };
    });
    Object.assign(adapter.handles[0]!, { setConfiguration: set });
    let first: Promise<unknown> | undefined;
    let second: Promise<unknown> | undefined;
    try {
      first = f.service
        .updateConfiguration(session.id, { model: 'old-model' })
        .catch((error: unknown) => error);
      await waitFor(async () => entered);
      second = f.service
        .updateConfiguration(session.id, { mode: 'old-mode' })
        .catch((error: unknown) => error);
      await f.service.cancelRun(session.id, run.id);
      await waitFor(
        async () => (await f.repositories.sessions.get(session.id))?.status === 'DISCONNECTED',
      );
      await f.service.resume(session.id);
      expect(await f.repositories.sessions.get(session.id)).toMatchObject({
        model: 'new-model',
        mode: 'new-mode',
      });
      release();
      expect(await first).toMatchObject({ code: 'SESSION_LIFECYCLE_SUPERSEDED' });
      expect(await second).toMatchObject({ code: 'SESSION_LIFECYCLE_SUPERSEDED' });
      expect(set).toHaveBeenCalledTimes(1);
      expect(await f.repositories.sessions.get(session.id)).toMatchObject({
        model: 'new-model',
        mode: 'new-mode',
      });
    } finally {
      release();
      await Promise.allSettled([first, second]);
      await f.service.shutdown();
    }
  });

  it('AH065新activation配置请求不应被旧provider挂起阻塞', async () => {
    const adapter = Object.assign(new ControlledAdapter('reject'), {
      async resumeSession(this: ControlledAdapter, input: CreateAgentSessionInput) {
        const handle = await this.createSession(input);
        return Object.assign(handle, {
          async getConfiguration() {
            return {
              supported: true,
              current: { model: 'new-model', mode: 'new-mode', reasoningEffort: null },
              options: { models: [], modes: [], reasoningEfforts: [] },
            };
          },
        });
      },
    });
    const f = await createFixture('idle', undefined, {}, { adapter });
    const session = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '配置代际',
      cwd: '/tmp',
    });
    const run = await f.service.startRun(session.id, { text: '原连接' });
    let release = () => undefined as void;
    let entered = false;
    const set = vi.fn(async () => {
      if (!entered) {
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return {
        supported: true,
        current: { model: 'old-model', mode: 'old-mode', reasoningEffort: null },
        options: { models: [], modes: [], reasoningEfforts: [] },
      };
    });
    Object.assign(adapter.handles[0]!, { setConfiguration: set });
    let first: Promise<unknown> | undefined;
    let second: Promise<unknown> | undefined;
    try {
      first = f.service
        .updateConfiguration(session.id, { model: 'old-model' })
        .catch((error: unknown) => error);
      await waitFor(async () => entered);
      second = f.service
        .updateConfiguration(session.id, { mode: 'old-mode' })
        .catch((error: unknown) => error);
      await f.service.cancelRun(session.id, run.id);
      await waitFor(
        async () => (await f.repositories.sessions.get(session.id))?.status === 'DISCONNECTED',
      );
      await f.service.resume(session.id);
      expect(await f.repositories.sessions.get(session.id)).toMatchObject({
        model: 'new-model',
        mode: 'new-mode',
      });
      const newSet = vi.fn(async () => ({
        supported: true,
        current: { model: 'fresh-model', mode: 'new-mode', reasoningEffort: null },
        options: { models: [], modes: [], reasoningEfforts: [] },
      }));
      Object.assign(adapter.handles[1]!, { setConfiguration: newSet });
      const fresh = f.service
        .updateConfiguration(session.id, { model: 'fresh-model' })
        .catch((error: unknown) => error);
      await waitFor(async () => newSet.mock.calls.length === 1, 500);
      expect(await fresh).toMatchObject({ current: { model: 'fresh-model' } });
      release();
      await first;
      await second;
      expect(await f.repositories.sessions.get(session.id)).toMatchObject({ model: 'fresh-model' });
    } finally {
      release();
      await Promise.allSettled([first, second]);
      await f.service.shutdown();
    }
  });

  it.each(['cancel', 'resume'] as const)(
    'AH064权限读取后%s胜出不得发布旧权限或覆盖Session',
    async (action) => {
      const adapter = Object.assign(
        new ControlledAdapter(action === 'cancel' ? 'never' : 'reject'),
        {
          resumeSession(this: ControlledAdapter, input: CreateAgentSessionInput) {
            return this.createSession(input);
          },
        },
      );
      const f = await createFixture('idle', undefined, {}, { adapter });
      const session = await f.service.create({
        projectId: f.projectId,
        agentId: f.agentId,
        title: '权限竞争',
        cwd: '/tmp',
      });
      const run = await f.service.startRun(session.id, { text: '请求权限' });
      let entered = false;
      let release = () => undefined as void;
      const get = f.repositories.runs.get.bind(f.repositories.runs);
      vi.spyOn(f.repositories.runs, 'get').mockImplementation(async (id) => {
        const result = await get(id);
        if (!entered) {
          entered = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return result;
      });
      const consumer = f.service as unknown as {
        persistEvent: (...args: unknown[]) => Promise<void>;
      };
      const event = vi.spyOn(consumer, 'persistEvent');
      try {
        adapter.handles[0]!.requestApproval('permission-race');
        await waitFor(async () => entered);
        await f.service.cancelRun(session.id, run.id);
        if (action === 'resume') {
          await waitFor(
            async () => (await f.repositories.sessions.get(session.id))?.status === 'DISCONNECTED',
          );
          await f.service.resume(session.id);
        }
        release();
        await event.mock.results[0]!.value;
        expect((await f.repositories.sessions.get(session.id))?.status).toBe(
          action === 'cancel' ? 'RUNNING' : 'READY',
        );
        expect(await f.repositories.approvals.listPending(session.id)).toHaveLength(0);
        expect(
          f.published.filter(
            ({ topic, event }) =>
              topic === `session:${session.id}` && event.type === 'approval.requested',
          ),
        ).toHaveLength(1);
        expect(
          f.published.filter(
            ({ topic, event }) => topic === 'approvals' && event.type === 'approval.requested',
          ),
        ).toHaveLength(0);
      } finally {
        release();
        await f.service.shutdown();
      }
    },
  );

  it('AH064取消只撤销未决权限并保留已记录决定', async () => {
    const adapter = new ControlledAdapter('never');
    const f = await createFixture('idle', undefined, {}, { adapter });
    const session = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '权限历史',
      cwd: '/tmp',
    });
    const run = await f.service.startRun(session.id, { text: '权限历史' });
    vi.spyOn(adapter.handles[0]!, 'resolveApproval').mockResolvedValue();
    try {
      adapter.handles[0]!.requestApproval('decided');
      await waitFor(
        async () => (await f.repositories.approvals.listPending(session.id)).length === 1,
      );
      const first = (await f.repositories.approvals.listPending(session.id))[0]!;
      await f.service.resolveApproval(first.id, 'allow');
      await waitFor(async () => (await f.repositories.runs.get(run.id))?.status === 'RUNNING');
      adapter.handles[0]!.requestApproval('pending');
      await waitFor(
        async () => (await f.repositories.approvals.listPending(session.id)).length === 1,
      );
      const second = (await f.repositories.approvals.listPending(session.id))[0]!;
      await f.service.cancelRun(session.id, run.id);
      expect(await f.repositories.approvals.get(first.id)).toMatchObject({
        status: 'APPROVED',
        selectedOptionId: 'allow',
      });
      expect(await f.repositories.approvals.get(second.id)).toMatchObject({ status: 'CANCELED' });
    } finally {
      await f.service.shutdown();
    }
  });

  it('AH064权限提交先赢时cancel等待短提交并撤销两个PENDING', async () => {
    const adapter = new ControlledAdapter('never');
    const f = await createFixture('idle', undefined, {}, { adapter });
    const session = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '权限提交',
      cwd: '/tmp',
    });
    const run = await f.service.startRun(session.id, { text: '请求多权限' });
    let release = () => undefined as void;
    let entered = false;
    try {
      adapter.handles[0]!.requestApproval('first');
      await waitFor(
        async () => (await f.repositories.approvals.listPending(session.id)).length === 1,
      );
      const create = f.repositories.approvals.create.bind(f.repositories.approvals);
      vi.spyOn(f.repositories.approvals, 'create').mockImplementationOnce(async (input) => {
        const result = await create(input);
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return result;
      });
      adapter.handles[0]!.requestApproval('second');
      await waitFor(async () => entered);
      expect(await f.repositories.approvals.listPending(session.id)).toHaveLength(2);
      const commits = f.service as unknown as {
        withActivationCommit: (id: string, action: () => Promise<unknown>) => Promise<unknown>;
      };
      const commit = commits.withActivationCommit.bind(f.service);
      let cancellationQueued = false;
      vi.spyOn(commits, 'withActivationCommit').mockImplementation((id, action) => {
        cancellationQueued = true;
        return commit(id, action);
      });
      let canceled = false;
      const canceling = f.service.cancelRun(session.id, run.id).then((result) => {
        canceled = true;
        return result;
      });
      await waitFor(async () => cancellationQueued);
      expect(canceled).toBe(false);
      release();
      expect(await canceling).toMatchObject({ status: 'CANCELING' });
      expect(await f.repositories.approvals.listPending(session.id)).toHaveLength(0);
      expect(
        f.published.filter(
          ({ topic, event }) => topic === 'approvals' && event.type === 'approval.requested',
        ),
      ).toHaveLength(2);
    } finally {
      release();
      await f.service.shutdown();
    }
  });

  it('AH063断连读取空闲快照后显式新Run准入不能留下RUNNING孤儿', async () => {
    const adapter = new ControlledAdapter('never');
    const f = await createFixture('idle', undefined, {}, { adapter });
    const session = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: '断连准入交错',
      cwd: '/tmp',
    });
    let release = () => undefined as void;
    let entered = false;
    const lookup = f.repositories.runs.findActiveForSession.bind(f.repositories.runs);
    vi.spyOn(f.repositories.runs, 'findActiveForSession').mockImplementationOnce(async (id) => {
      const result = await lookup(id);
      expect(result).toBeUndefined();
      entered = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return result;
    });
    try {
      adapter.handles[0]!.disconnect();
      await waitFor(async () => entered);
      const commits = f.service as unknown as {
        withActivationCommit: (id: string, action: () => Promise<unknown>) => Promise<unknown>;
      };
      const commit = commits.withActivationCommit.bind(f.service);
      let admissionQueued = false;
      vi.spyOn(commits, 'withActivationCommit').mockImplementation((id, action) => {
        admissionQueued = true;
        return commit(id, action);
      });
      const starting = f.service.startRun(session.id, { text: '空闲窗口显式新工作' });
      const outcome = starting.catch((error: unknown) => error);
      await waitFor(async () => admissionQueued);
      release();
      expect(await outcome).toMatchObject({ code: expect.stringMatching(/^SESSION_/) });
      expect(await f.repositories.runs.list(session.id)).toHaveLength(0);
      expect((await f.repositories.sessions.get(session.id))?.status).toBe('DISCONNECTED');
    } finally {
      release();
      await f.service.shutdown();
    }
  });

  it.each(['historical', 'current', 'none'] as const)(
    'AH063同连接断连事件runId=%s应收敛当前Run且保留历史完成',
    async (reference) => {
      const adapter = new ControlledAdapter('never');
      const f = await createFixture('idle', undefined, {}, { adapter });
      const session = await f.service.create({
        projectId: f.projectId,
        agentId: f.agentId,
        title: '连接级断连',
        cwd: '/tmp',
      });
      try {
        const first = await f.service.startRun(session.id, { text: '第一轮' });
        adapter.handles[0]!.complete(first.id);
        await waitFor(
          async () => (await f.repositories.sessions.get(session.id))?.status === 'READY',
        );
        const second = await f.service.startRun(session.id, { text: '第二轮' });
        adapter.handles[0]!.disconnect(
          reference === 'historical' ? first.id : reference === 'current' ? second.id : undefined,
        );
        await waitFor(
          async () => (await f.repositories.sessions.get(session.id))?.status === 'DISCONNECTED',
        );
        expect((await f.repositories.runs.get(first.id))?.status).toBe('COMPLETED');
        expect((await f.repositories.runs.get(second.id))?.status).toBe('DISCONNECTED');
      } finally {
        await f.service.shutdown();
      }
    },
  );

  it.each([true, false])(
    'AH062当前连接显式断连事件携带runId=%s仍正常收敛',
    async (includeRunId) => {
      const f = await preparationFixture();
      const run = await f.service.startRun(f.session.id, { text: '当前连接断连' });
      try {
        f.adapter.handles[0]!.disconnect(includeRunId ? run.id : undefined);
        await waitFor(
          async () => (await f.repositories.sessions.get(f.session.id))?.status === 'DISCONNECTED',
        );
        expect(await f.repositories.runs.get(run.id)).toMatchObject({
          status: 'DISCONNECTED',
          errorCode: 'ADAPTER_DISCONNECTED',
        });
        await expect(
          f.service.startRun(f.session.id, { text: '不能继续使用断开的连接' }),
        ).rejects.toBeDefined();
      } finally {
        await f.service.shutdown();
      }
    },
  );

  it.each(['resume', 'close'] as const)(
    'AH062显式断连事件后长挂Task回调不阻塞%s且迟到不改赢家',
    async (action) => {
      const f = await preparationFixture('approval-error');
      Object.assign(f.adapter, {
        resumeSession: (input: CreateAgentSessionInput) => f.adapter.createSession(input),
      });
      let rejectDelivery!: (error: Error) => void;
      let delivering = false;
      vi.spyOn(f.adapter.handles[0]!, 'resolveApproval').mockImplementation(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectDelivery = reject;
            delivering = true;
          }),
      );
      const first = await f.service.startRun(f.session.id, { text: '权限Run' });
      await waitFor(
        async () => (await f.repositories.runs.get(first.id))?.status === 'WAITING_APPROVAL',
      );
      const approval = (await f.repositories.approvals.listPending(f.session.id))[0]!;
      await f.service.resolveApproval(approval.id, 'allow');
      await waitFor(async () => delivering);
      let release!: () => void;
      let entered = false;
      const stopped = f.taskService.onRunStopped.bind(f.taskService);
      vi.spyOn(f.taskService, 'onRunStopped').mockImplementationOnce(async (task, run) => {
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return stopped(task, run);
      });
      const disconnect = vi.spyOn(
        f.service as unknown as {
          persistEvent: (
            event: NormalizedAgentEvent,
            project: string,
            activation: string,
          ) => Promise<void>;
        },
        'persistEvent',
      );
      f.adapter.handles[0]!.disconnect(first.id);
      await waitFor(async () => entered);
      try {
        expect((await f.repositories.runs.get(first.id))?.status).toBe('DISCONNECTED');
        rejectDelivery(new Error('controlled delivery rejection'));
        await waitFor(
          async () => (await f.repositories.sessions.get(f.session.id))?.status === 'DISCONNECTED',
        );
        if (action === 'resume') await f.service.resume(f.session.id);
        else await f.service.close(f.session.id);
        const expected = action === 'resume' ? 'READY' : 'CLOSED';
        const close = action === 'resume' ? vi.spyOn(f.adapter.handles[1]!, 'close') : undefined;
        expect((await f.repositories.sessions.get(f.session.id))?.status).toBe(expected);
        release();
        await disconnect.mock.results[0]!.value;
        expect((await f.repositories.sessions.get(f.session.id))?.status).toBe(expected);
        expect((await f.repositories.runs.get(first.id))?.status).toBe('DISCONNECTED');
        expect((await f.tasks.get(f.task.id))?.status).toBe('IN_PROGRESS');
        if (close) expect(close).not.toHaveBeenCalled();
        expect(await f.repositories.runs.list(f.session.id)).toHaveLength(1);
      } finally {
        release();
        await f.service.shutdown();
      }
    },
  );

  it.each(['resume', 'close'] as const)(
    'AH059权限投递失败后长挂Task回调不阻塞%s且迟到不改赢家',
    async (action) => {
      const f = await preparationFixture('approval-error');
      Object.assign(f.adapter, {
        resumeSession: (input: CreateAgentSessionInput) => f.adapter.createSession(input),
      });
      let rejectDelivery!: (error: Error) => void;
      let delivering = false;
      vi.spyOn(f.adapter.handles[0]!, 'resolveApproval').mockImplementation(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectDelivery = reject;
            delivering = true;
          }),
      );
      const first = await f.service.startRun(f.session.id, { text: '权限Run' });
      await waitFor(
        async () => (await f.repositories.runs.get(first.id))?.status === 'WAITING_APPROVAL',
      );
      const approval = (await f.repositories.approvals.listPending(f.session.id))[0]!;
      await f.service.resolveApproval(approval.id, 'allow');
      await waitFor(async () => delivering);
      let release!: () => void;
      let entered = false;
      const stopped = f.taskService.onRunStopped.bind(f.taskService);
      vi.spyOn(f.taskService, 'onRunStopped').mockImplementationOnce(async (task, run) => {
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return stopped(task, run);
      });
      const disconnect = vi.spyOn(
        f.service as unknown as {
          handleActivationDisconnected: (id: string, activation: string) => Promise<void>;
        },
        'handleActivationDisconnected',
      );
      await f.adapter.handles[0]!.close();
      await waitFor(async () => entered);
      try {
        expect((await f.repositories.runs.get(first.id))?.status).toBe('DISCONNECTED');
        rejectDelivery(new Error('controlled delivery rejection'));
        await waitFor(
          async () => (await f.repositories.sessions.get(f.session.id))?.status === 'DISCONNECTED',
        );
        if (action === 'resume') await f.service.resume(f.session.id);
        else await f.service.close(f.session.id);
        const expected = action === 'resume' ? 'READY' : 'CLOSED';
        const close = action === 'resume' ? vi.spyOn(f.adapter.handles[1]!, 'close') : undefined;
        expect((await f.repositories.sessions.get(f.session.id))?.status).toBe(expected);
        release();
        await disconnect.mock.results[0]!.value;
        expect((await f.repositories.sessions.get(f.session.id))?.status).toBe(expected);
        expect((await f.repositories.runs.get(first.id))?.status).toBe('DISCONNECTED');
        expect((await f.tasks.get(f.task.id))?.status).toBe('IN_PROGRESS');
        if (close) expect(close).not.toHaveBeenCalled();
        expect(await f.repositories.runs.list(f.session.id)).toHaveLength(1);
      } finally {
        release();
        await f.service.shutdown();
      }
    },
  );

  it('AH059断连先提交后Task回调挂起不阻塞恢复，迟到cancel拒绝不污染新连接', async () => {
    const f = await preparationFixture();
    Object.assign(f.adapter, {
      resumeSession: (input: CreateAgentSessionInput) => f.adapter.createSession(input),
    });
    let rejectCancel!: (error: Error) => void;
    vi.spyOn(f.adapter.handles[0]!, 'cancel').mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCancel = reject;
        }),
    );
    const first = await f.service.startRun(f.session.id, { text: '原始Run' });
    await f.service.cancelRun(f.session.id, first.id);
    let release!: () => void;
    let entered = false;
    f.service.setTaskLifecycleObserver({
      onRunCompleted: (task, run) => f.taskService.onRunCompleted(task, run),
      onRunStopped: async (task, run) => {
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return f.taskService.onRunStopped(task, run);
      },
    });
    const convergence = vi.spyOn(f.repositories.runs, 'convergeCancellationFailure');
    await f.adapter.handles[0]!.close();
    await waitFor(async () => entered);
    try {
      expect((await f.repositories.runs.get(first.id))?.status).toBe('DISCONNECTED');
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('DISCONNECTED');
      expect((await f.service.resume(f.session.id)).status).toBe('READY');
      rejectCancel(new Error('controlled cancellation rejection'));
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(convergence).not.toHaveBeenCalled();
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('READY');
      expect(f.adapter.handles).toHaveLength(2);
    } finally {
      release();
      await f.service.shutdown();
    }
  });

  it('取消先于Run持久准入提交：读取旧READY也不派发或移动latestRun', async () => {
    const f = await preparationFixture();
    await f.tasks.transition(f.task.id, 'WAITING_REVIEW');
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const original = f.repositories.runs.create.bind(f.repositories.runs);
    const admission = vi.spyOn(f.repositories.runs, 'create').mockImplementation(async (input) => {
      entered();
      await gate;
      return original(input);
    });
    const send = vi.spyOn(ControlledHandle.prototype, 'sendTurn');
    try {
      const before = await f.repositories.sessions.get(f.session.id);
      const pending = f.service.startRun(f.session.id, { text: '旧页面发送' });
      const rejected = expect(pending).rejects.toMatchObject({
        status: 409,
        code: 'TASK_CANCELED',
      });
      await reached;
      await f.taskService.transitionTask(f.task.id, 'CANCELED');
      release();
      await rejected;
      expect((await f.tasks.get(f.task.id))?.status).toBe('CANCELED');
      expect(await f.repositories.runs.list(f.session.id)).toHaveLength(0);
      expect(await f.repositories.messages.list(f.session.id)).toHaveLength(0);
      expect((await f.repositories.sessions.get(f.session.id))?.latestRunId).toBe(
        before?.latestRunId,
      );
      expect(send).not.toHaveBeenCalled();
    } finally {
      release();
      admission.mockRestore();
      await f.service.shutdown();
    }
  });

  it('Run先持久准入：手动取消不能覆盖正在运行的旧Session turn', async () => {
    const f = await preparationFixture();
    try {
      await f.tasks.transition(f.task.id, 'WAITING_REVIEW');
      const run = await f.service.startRun(f.session.id, { text: '直接会话执行' });
      await expect(f.taskService.transitionTask(f.task.id, 'CANCELED')).rejects.toMatchObject({
        status: 409,
        code: 'TASK_RUN_CANCEL_REQUIRED',
      });
      expect((await f.tasks.get(f.task.id))?.status).toBe('WAITING_REVIEW');
      expect((await f.repositories.runs.get(run.id))?.status).toBe('RUNNING');
      expect((await f.repositories.sessions.get(f.session.id))?.latestRunId).toBe(run.id);
    } finally {
      await f.service.shutdown();
    }
  });

  it.each(['WAITING_REVIEW', 'DONE'] as const)(
    '直接Session turn保留%s任务状态，不隐式重启',
    async (status) => {
      const f = await preparationFixture();
      try {
        await f.tasks.transition(f.task.id, 'WAITING_REVIEW');
        if (status === 'DONE') await f.tasks.transition(f.task.id, 'DONE');
        const before = await f.tasks.get(f.task.id);
        const run = await f.service.startRun(f.session.id, { text: '保留上下文的后续问题' });
        expect(run.status).toBe('RUNNING');
        expect(await f.tasks.get(f.task.id)).toEqual(before);
      } finally {
        await f.service.shutdown();
      }
    },
  );

  it('已取消任务不能通过继承taskId的continuation绕过派发门禁', async () => {
    const f = await preparationFixture();
    const send = vi.spyOn(ControlledHandle.prototype, 'sendTurn');
    try {
      await f.tasks.transition(f.task.id, 'WAITING_REVIEW');
      await f.taskService.transitionTask(f.task.id, 'CANCELED');
      await f.service.close(f.session.id);
      const before = await f.repositories.sessions.list(f.projectId);
      await expect(f.service.continue(f.session.id)).rejects.toMatchObject({
        status: 409,
        code: 'TASK_SESSION_START_REQUIRED',
      });
      expect(await f.repositories.sessions.list(f.projectId)).toEqual(before);
      expect(await f.repositories.runs.list(f.session.id)).toHaveLength(0);
      expect(await f.repositories.messages.list(f.session.id)).toHaveLength(0);
      expect(send).not.toHaveBeenCalled();
      expect((await f.tasks.get(f.task.id))?.status).toBe('CANCELED');
    } finally {
      await f.service.shutdown();
    }
  });

  it.each(['MESSAGE', 'MESSAGE_LINK', 'STARTING', 'RUNNING', 'SESSION_RUNNING'] as const)(
    '准备失败%s不会派发、删除消息或遗留QUEUED Run',
    async (point) => {
      const f = await preparationFixture();
      const send = vi.spyOn(f.adapter.handles[0]!, 'sendTurn');
      if (point === 'MESSAGE')
        vi.spyOn(f.repositories.messages, 'append').mockRejectedValueOnce(
          new Error('body must not leak'),
        );
      if (point === 'MESSAGE_LINK')
        vi.spyOn(f.repositories.runs, 'patch').mockRejectedValueOnce(new Error('link'));
      if (point === 'STARTING' || point === 'RUNNING') {
        const original = f.repositories.runs.transition.bind(f.repositories.runs);
        let rejected = false;
        vi.spyOn(f.repositories.runs, 'transition').mockImplementation(
          async (id, status, patch) => {
            if (!rejected && status === point) {
              rejected = true;
              throw new Error('state');
            }
            return original(id, status, patch);
          },
        );
      }
      if (point === 'SESSION_RUNNING') {
        const original = f.repositories.sessions.transition.bind(f.repositories.sessions);
        vi.spyOn(f.repositories.sessions, 'transition').mockImplementation(
          async (id, status, patch) => {
            if (status === 'RUNNING') throw new Error('session');
            return original(id, status, patch);
          },
        );
      }
      try {
        await expect(
          f.service.startRun(f.session.id, { text: '私有正文不入error' }),
        ).rejects.toMatchObject({ code: 'RUN_PREPARATION_FAILED' });
        expect(send).not.toHaveBeenCalled();
        const runs = await f.repositories.runs.list(f.session.id);
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ status: 'FAILED', errorCode: 'RUN_PREPARATION_FAILED' });
        expect((await f.tasks.get(f.task.id))?.status).toBe('BLOCKED');
        expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('READY');
        expect(await f.repositories.messages.list(f.session.id)).toHaveLength(
          point === 'MESSAGE' ? 0 : 1,
        );
      } finally {
        await f.service.shutdown();
      }
    },
  );

  it.each(['TASK', 'SESSION'] as const)(
    '准备清理%s失败持久隔离，即使显式重连也不得派发下一Run',
    async (point) => {
      const f = await preparationFixture();
      let restoreSessionFailure: (() => void) | undefined;
      if (point === 'TASK') {
        vi.spyOn(f.repositories.messages, 'append').mockRejectedValueOnce(new Error('prepare'));
        vi.spyOn(f.tasks, 'tryApplyRunOutcome').mockRejectedValueOnce(new Error('cleanup'));
      } else {
        const original = f.repositories.sessions.transition.bind(f.repositories.sessions);
        const spy = vi
          .spyOn(f.repositories.sessions, 'transition')
          .mockImplementation(async (id, status, patch) => {
            if (status === 'READY') throw new Error('cleanup Session write');
            const result = await original(id, status, patch);
            if (status === 'RUNNING')
              throw new Error('preparation write committed but acknowledgement lost');
            return result;
          });
        restoreSessionFailure = () => spy.mockRestore();
      }
      const send = vi.spyOn(ControlledHandle.prototype, 'sendTurn');
      let restarted: SessionService | undefined;
      try {
        await expect(f.service.startRun(f.session.id, { text: '不能重发' })).rejects.toMatchObject({
          code: 'RUN_PREPARATION_RECOVERY_REQUIRED',
        });
        const [run] = await f.repositories.runs.list(f.session.id);
        expect(run).toMatchObject({
          status: 'FAILED',
          errorCode: 'RUN_PREPARATION_RECOVERY_REQUIRED',
        });
        await expect(f.service.startRun(f.session.id, { text: '再次提交' })).rejects.toMatchObject({
          code: 'SESSION_RUN_UNRESOLVED',
        });
        restoreSessionFailure?.();
        const r = f.repositories;
        restarted = new SessionService(
          r.sessions,
          r.runs,
          r.messages,
          r.events,
          r.approvals,
          new ProjectRepository(database.db),
          f.agentService,
          { publish: () => undefined },
          { readHead: async () => undefined },
        );
        Object.assign(f.adapter, {
          resumeSession: (input: CreateAgentSessionInput) => f.adapter.createSession(input),
        });
        await restarted.resume(f.session.id); // Explicit test action, never automatic recovery.
        await expect(
          restarted.startRun(f.session.id, { text: '新实例也不能重发' }),
        ).rejects.toMatchObject({ code: 'SESSION_RUN_UNRESOLVED' });
        expect(send).not.toHaveBeenCalled();
        expect(await r.runs.list(f.session.id)).toHaveLength(1);
      } finally {
        restoreSessionFailure?.();
        await restarted?.shutdown();
        await f.service.shutdown();
      }
    },
  );

  it('Session为READY仍拒绝持久QUEUED Run，不产生第二条Run', async () => {
    const f = await preparationFixture();
    try {
      await f.repositories.runs.create({
        id: randomUUID(),
        sessionId: f.session.id,
        taskId: f.task.id,
        status: 'QUEUED',
      });
      const send = vi.spyOn(f.adapter.handles[0]!, 'sendTurn');
      await expect(
        f.service.startRun(f.session.id, { text: '不能越过旧排队' }),
      ).rejects.toMatchObject({ code: 'SESSION_RUN_UNRESOLVED' });
      expect(send).not.toHaveBeenCalled();
      expect(await f.repositories.runs.list(f.session.id)).toHaveLength(1);
    } finally {
      await f.service.shutdown();
    }
  });

  it.each(['START', 'REWORK'] as const)(
    'Task%s已派发但externalRunId写失败保留权威结果，不自动重发或BLOCKED',
    async (mode) => {
      const adapter = new ControlledAdapter('never');
      const f = await createFixture(
        'idle',
        undefined,
        {},
        { adapter, git: { readHead: async () => undefined } },
      );
      const tasks = new TaskRepository(database.db);
      const taskService = new TaskService(
        new GoalRepository(database.db),
        tasks,
        new ProjectRepository(database.db),
        f.service,
      );
      f.service.setTaskLifecycleObserver(taskService);
      const task = await tasks.create({
        id: randomUUID(),
        projectId: f.projectId,
        title: '已派发未确认',
        status: mode === 'START' ? 'READY' : 'WAITING_REVIEW',
        assignedAgentId: f.agentId,
      });
      const send = vi
        .spyOn(ControlledHandle.prototype, 'sendTurn')
        .mockImplementation(async (input) => ({
          runId: input.runId,
          externalRunId: 'acknowledged',
        }));
      const original = f.repositories.runs.patch.bind(f.repositories.runs);
      vi.spyOn(f.repositories.runs, 'patch').mockImplementation(async (id, patch) => {
        if (patch.externalRunId) throw new Error('ack bookkeeping');
        return original(id, patch);
      });
      try {
        const result =
          mode === 'START'
            ? taskService.startTask(task.id, { agentId: f.agentId })
            : taskService.reviewTask(task.id, { decision: 'REWORK', feedback: '继续' });
        await expect(result).rejects.toMatchObject({ code: 'AGENT_RUN_DISPATCH_UNKNOWN' });
        const current = (await tasks.get(task.id))!;
        expect(current.status).toBe('IN_PROGRESS');
        const [run] = await f.repositories.runs.list(current.sessionId!);
        expect(run?.status).toBe('RUNNING');
        await expect(
          f.service.startRun(current.sessionId!, { text: '不能重复' }),
        ).rejects.toMatchObject({ code: 'SESSION_RUN_UNRESOLVED' });
        expect(send).toHaveBeenCalledTimes(1);
        adapter.handles[0]!.complete(run!.id);
        await waitFor(async () => (await tasks.get(task.id))?.status === 'WAITING_REVIEW');
        expect((await tasks.get(task.id))?.finalRunId).toBe(run!.id);
        expect(send).toHaveBeenCalledTimes(1);
      } finally {
        await f.service.shutdown();
      }
    },
  );

  it('有Task但缺少停止观察器时不谎称准备清理完成', async () => {
    const f = await preparationFixture();
    f.service.setTaskLifecycleObserver({ onRunCompleted: async () => undefined });
    vi.spyOn(f.repositories.messages, 'append').mockRejectedValueOnce(new Error('prepare'));
    try {
      await expect(f.service.startRun(f.session.id, { text: '缺少观察器' })).rejects.toMatchObject({
        code: 'RUN_PREPARATION_RECOVERY_REQUIRED',
      });
      expect((await f.tasks.get(f.task.id))?.status).toBe('IN_PROGRESS');
      expect((await f.repositories.runs.list(f.session.id))[0]?.errorCode).toBe(
        'RUN_PREPARATION_RECOVERY_REQUIRED',
      );
      await expect(f.service.startRun(f.session.id, { text: '不能重复' })).rejects.toMatchObject({
        code: 'SESSION_RUN_UNRESOLVED',
      });
    } finally {
      await f.service.shutdown();
    }
  });

  it.each(['START', 'REWORK'] as const)(
    'Task%s准备失败由停止观察器收敛后不重复BLOCKED转换',
    async (mode) => {
      const f = await preparationFixture();
      // Seed authoritative old completion; a no-Run legacy Session is now
      // intentionally unknown and must not be used to bypass startup recovery.
      await f.repositories.runs.create({
        id: randomUUID(),
        sessionId: f.session.id,
        taskId: f.task.id,
        status: 'COMPLETED',
        dispatchState: 'ATTEMPTED',
      });
      await f.tasks.update(f.task.id, { status: mode === 'START' ? 'READY' : 'WAITING_REVIEW' });
      vi.spyOn(f.repositories.messages, 'append').mockRejectedValueOnce(new Error('prepare'));
      try {
        const result =
          mode === 'START'
            ? f.taskService.startTask(f.task.id, { agentId: f.agentId })
            : f.taskService.reviewTask(f.task.id, { decision: 'REWORK', feedback: '继续' });
        await expect(result).rejects.toMatchObject({ code: 'RUN_PREPARATION_FAILED' });
        expect((await f.tasks.get(f.task.id))?.status).toBe('BLOCKED');
      } finally {
        await f.service.shutdown();
      }
    },
  );

  it('权威完成先于ack写失败时UNKNOWN不得覆盖已完成Task', async () => {
    const f = await preparationFixture();
    await f.repositories.runs.create({
      id: randomUUID(),
      sessionId: f.session.id,
      taskId: f.task.id,
      status: 'COMPLETED',
      dispatchState: 'ATTEMPTED',
    });
    await f.tasks.update(f.task.id, { status: 'READY' });
    const send = vi
      .spyOn(ControlledHandle.prototype, 'sendTurn')
      .mockImplementation(async (input) => ({ runId: input.runId, externalRunId: 'ack' }));
    const original = f.repositories.runs.patch.bind(f.repositories.runs);
    vi.spyOn(f.repositories.runs, 'patch').mockImplementation(async (id, patch) => {
      if (patch.externalRunId) {
        f.adapter.handles.at(-1)!.complete(id);
        await waitFor(async () => (await f.tasks.get(f.task.id))?.status === 'WAITING_REVIEW');
        throw new Error('ack save failed after completion');
      }
      return original(id, patch);
    });
    try {
      await expect(
        f.taskService.startTask(f.task.id, { agentId: f.agentId }),
      ).rejects.toMatchObject({ code: 'AGENT_RUN_DISPATCH_UNKNOWN' });
      expect((await f.tasks.get(f.task.id))?.status).toBe('WAITING_REVIEW');
      expect((await f.tasks.get(f.task.id))?.finalRunId).toBeTruthy();
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      await f.service.shutdown();
    }
  });

  it('首次清理CAS失败仍保留未派发证据，startup修复Task后解除持久fence', async () => {
    const f = await preparationFixture();
    vi.spyOn(f.repositories.messages, 'append').mockRejectedValueOnce(
      new Error('prepare private body'),
    );
    vi.spyOn(f.repositories.runs, 'tryTransition').mockImplementationOnce(async () => {
      vi.spyOn(f.repositories.sessions, 'get').mockRejectedValueOnce(new Error('private DB read'));
      throw new Error('terminal CAS unavailable');
    });
    try {
      await expect(f.service.startRun(f.session.id, { text: '不重放' })).rejects.toMatchObject({
        code: 'RUN_PREPARATION_RECOVERY_REQUIRED',
      });
      const [run] = await f.repositories.runs.list(f.session.id);
      expect(run?.status).toBe('QUEUED');
      expect((await f.repositories.runs.findBlockingForSession(f.session.id))?.id).toBe(run?.id);
      await expect(
        f.service.startRun(f.session.id, { text: '同实例不放行' }),
      ).rejects.toMatchObject({ code: 'SESSION_RUN_UNRESOLVED' });
      await f.service.recoverAfterRestart(); // Real startup path, not just a new service object.
      expect(await f.repositories.runs.get(run!.id)).toMatchObject({
        status: 'FAILED',
        errorCode: 'RUN_PREPARATION_RECOVERY_REQUIRED',
        dispatchState: 'PREPARING',
      });
      expect((await f.tasks.get(f.task.id))?.status).toBe('IN_PROGRESS');
      expect((await f.repositories.runs.findBlockingForSession(f.session.id))?.id).toBe(run?.id);
      await f.taskService.recoverAfterRestart();
      await f.repositories.runs.clearReconciledPreparationFences();
      expect((await f.tasks.get(f.task.id))?.status).toBe('BLOCKED');
      expect(await f.repositories.runs.findBlockingForSession(f.session.id)).toBeUndefined();
      expect(f.adapter.handles).toHaveLength(1);
    } finally {
      await f.service.shutdown();
    }
  });

  it.each([
    ['never', 'COMPLETED', false],
    ['never', 'CANCELED', false],
    ['reject', 'COMPLETED', false],
    ['reject', 'CANCELED', false],
    ['never', 'CANCELED', true],
    ['reject', 'CANCELED', true],
  ] as const)(
    '取消%s后未知隔离，显式重连收到%s才收敛，历史=%s',
    async (scenario, terminal, legacy) => {
      const f = await preparationFixture(scenario);
      const send = vi.spyOn(ControlledHandle.prototype, 'sendTurn');
      try {
        const run = await f.service.startRun(f.session.id, { text: '只派发一次' });
        expect((await f.repositories.runs.get(run.id))?.dispatchState).toBe('ATTEMPTED');
        await f.service.cancelRun(f.session.id, run.id);
        await waitFor(
          async () => (await f.repositories.runs.get(run.id))?.status === 'DISCONNECTED',
          2_500,
        );
        if (legacy) await f.repositories.runs.patch(run.id, { dispatchState: 'LEGACY_UNKNOWN' });
        expect((await f.tasks.get(f.task.id))?.status).toBe('IN_PROGRESS');
        await expect(f.service.cancelRun(f.session.id, run.id)).rejects.toMatchObject({
          code: 'RUN_DISPATCH_UNRESOLVED',
        });
        Object.assign(f.adapter, {
          resumeSession: (input: CreateAgentSessionInput) => f.adapter.createSession(input),
        });
        await f.service.resume(f.session.id);
        await expect(f.service.startRun(f.session.id, { text: '不应重发' })).rejects.toMatchObject({
          code: 'SESSION_RUN_UNRESOLVED',
        });
        f.adapter.handles[0]!.terminal(run.id, terminal);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect((await f.repositories.runs.get(run.id))?.status).toBe('DISCONNECTED');
        f.adapter.handles.at(-1)!.terminal(run.id, terminal);
        await waitFor(
          async () =>
            (await f.tasks.get(f.task.id))?.status ===
            (terminal === 'COMPLETED' ? 'WAITING_REVIEW' : 'BLOCKED'),
        );
        expect(await f.repositories.runs.findBlockingForSession(f.session.id)).toBeUndefined();
        expect((await f.repositories.runs.get(run.id))?.dispatchState).toBe('ATTEMPTED');
        expect(send).toHaveBeenCalledTimes(1);
      } finally {
        await f.service.shutdown();
      }
    },
  );

  it('派发意图CAS未确认时绝不调用Agent，保留未派发错误语义', async () => {
    const f = await preparationFixture();
    const send = vi.spyOn(ControlledHandle.prototype, 'sendTurn');
    const mark = vi
      .spyOn(f.repositories.runs, 'markDispatchAttempted')
      .mockRejectedValueOnce(new Error('intent write'));
    try {
      await expect(
        f.service.startRun(f.session.id, { text: '不能越过持久意图' }),
      ).rejects.toMatchObject({ code: 'RUN_PREPARATION_FAILED' });
      expect(send).not.toHaveBeenCalled();
      expect((await f.repositories.runs.list(f.session.id))[0]).toMatchObject({
        status: 'FAILED',
        dispatchState: 'PREPARING',
      });
    } finally {
      mark.mockRestore();
      await f.service.shutdown();
    }
  });

  it('创建 Session 前拒绝 archived Project、disabled/BROKEN Agent 与 target mismatch', async () => {
    const archived = await createFixture('idle', undefined, {}, { projectStatus: 'ARCHIVED' });
    await expect(
      archived.service.create({
        projectId: archived.projectId,
        agentId: archived.agentId,
        title: 'Archived Project',
        cwd: '/tmp',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_ACTIVE' });

    const disabled = await createFixture('idle', undefined, {}, { agentEnabled: false });
    await expect(
      disabled.service.create({
        projectId: disabled.projectId,
        agentId: disabled.agentId,
        title: 'Disabled Agent',
        cwd: '/tmp',
      }),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_READY' });

    const broken = await createFixture('idle', undefined, {}, { agentStatus: 'BROKEN' });
    await expect(
      broken.service.create({
        projectId: broken.projectId,
        agentId: broken.agentId,
        title: 'Broken Agent',
        cwd: '/tmp',
      }),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_READY' });

    const mismatchTargetId = randomUUID();
    const mismatch = await createFixture(
      'idle',
      undefined,
      {},
      { agentTargetId: mismatchTargetId },
    );
    await expect(
      mismatch.service.create({
        projectId: mismatch.projectId,
        agentId: mismatch.agentId,
        title: 'Target mismatch',
        cwd: '/tmp',
      }),
    ).rejects.toMatchObject({ code: 'AGENT_PROJECT_TARGET_MISMATCH' });
  });

  it('Session cwd 只允许 Project root 或真实存在的子目录，并阻止 traversal 与 symlink escape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-session-root-'));
    const child = join(root, 'packages');
    const outside = await mkdtemp(join(tmpdir(), 'agenthub-session-outside-'));
    const escaped = join(root, 'escaped');
    await mkdir(child);
    await symlink(outside, escaped);
    const fixture = await createFixture('idle', undefined, {}, { projectRoot: root });

    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '合法子目录',
      cwd: child,
    });
    expect(session.cwd).toBe(await realpath(child));

    await expect(
      fixture.service.create({
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        title: 'Traversal',
        cwd: join(root, '..', basename(outside)),
      }),
    ).rejects.toMatchObject({ code: 'SESSION_CWD_OUTSIDE_PROJECT' });
    await expect(
      fixture.service.create({
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        title: 'Symlink escape',
        cwd: escaped,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_CWD_OUTSIDE_PROJECT' });

    await fixture.service.shutdown();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('Worktree 使用内部受管入口，可在 Project root 外创建 Session，但 REST create 不能绕过边界', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'agenthub-session-project-'));
    const managedRoot = await mkdtemp(join(tmpdir(), 'agenthub-session-managed-'));
    const worktree = join(managedRoot, 'execution');
    await mkdir(worktree);
    const fixture = await createFixture('idle', undefined, {}, { projectRoot });

    await expect(
      fixture.service.create({
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        title: 'REST 越界',
        cwd: worktree,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_CWD_OUTSIDE_PROJECT' });
    const session = await fixture.service.createManagedWorktree(
      {
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        title: 'Worktree Session',
        cwd: worktree,
        taskId: randomUUID(),
      },
      managedRoot,
    );
    expect(session.cwd).toBe(await realpath(worktree));
    await fixture.service.shutdown();
    await rm(projectRoot, { recursive: true, force: true });
    await rm(managedRoot, { recursive: true, force: true });
  });

  it('同一 Session 的并发 Run 请求只持久化并发送一个 Run', async () => {
    let releaseGit!: () => void;
    let firstEntered!: () => void;
    let secondEntered!: () => void;
    const gitGate = new Promise<void>((resolve) => {
      releaseGit = resolve;
    });
    const firstProbe = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    const secondProbe = new Promise<void>((resolve) => {
      secondEntered = resolve;
    });
    let reads = 0;
    const fixture = await createFixture(
      'idle',
      undefined,
      {},
      {
        git: {
          readHead: async () => {
            reads += 1;
            if (reads === 1) firstEntered();
            if (reads === 2) secondEntered();
            await gitGate;
            return 'before-sha';
          },
        },
      },
    );
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '并发发送',
      cwd: '/tmp',
    });
    const first = fixture.service.startRun(session.id, { text: '第一个请求' });
    await firstProbe;
    const second = fixture.service.startRun(session.id, { text: '重复请求' });
    const secondResult = second.then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    );
    await Promise.race([secondProbe, secondResult]);
    releaseGit();
    try {
      await first;
      const rejected = await secondResult;
      const runs = await fixture.repositories.runs.list(session.id);
      expect(runs).toHaveLength(1);
      expect(rejected.error).toMatchObject({ code: 'SESSION_NOT_READY' });
      expect(runs[0]?.status).toBe('RUNNING');
      const messages = await fixture.repositories.messages.list(session.id);
      expect(messages.filter((message) => message.role === 'USER')).toHaveLength(1);
      expect(messages.find((message) => message.role === 'USER')?.text).toBe('第一个请求');
    } finally {
      await fixture.service.shutdown();
    }
  });

  it('Run 启动前失败释放准入，允许用户显式重试', async () => {
    let reads = 0;
    const fixture = await createFixture(
      'idle',
      undefined,
      {},
      {
        git: {
          readHead: async () => {
            if (++reads === 1) throw new Error('git probe unavailable');
            return 'before-sha';
          },
        },
      },
    );
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '显式重试',
      cwd: '/tmp',
    });
    try {
      await expect(fixture.service.startRun(session.id, { text: '第一次' })).rejects.toThrow(
        'git probe unavailable',
      );
      expect(await fixture.repositories.runs.list(session.id)).toHaveLength(0);
      const run = await fixture.service.startRun(session.id, { text: '明确重试' });
      expect(run.status).toBe('RUNNING');
      expect(await fixture.repositories.runs.list(session.id)).toHaveLength(1);
    } finally {
      await fixture.service.shutdown();
    }
  });

  it('不同 Session 的 Run 准入互不阻塞', async () => {
    let releaseGit!: () => void;
    let entered!: () => void;
    const gitGate = new Promise<void>((resolve) => {
      releaseGit = resolve;
    });
    const firstProbe = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let reads = 0;
    const fixture = await createFixture(
      'idle',
      undefined,
      {},
      {
        git: {
          readHead: async () => {
            if (++reads === 1) {
              entered();
              await gitGate;
            }
            return 'before-sha';
          },
        },
      },
    );
    const input = {
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '独立会话',
      cwd: '/tmp',
    };
    const firstSession = await fixture.service.create(input);
    const secondSession = await fixture.service.create(input);
    const first = fixture.service.startRun(firstSession.id, { text: '阻塞的请求' });
    await firstProbe;
    try {
      const second = await fixture.service.startRun(secondSession.id, { text: '独立请求' });
      expect(second.status).toBe('RUNNING');
    } finally {
      releaseGit();
      await first;
      await fixture.service.shutdown();
    }
  });

  it('Session 配置读取、动态切换与 Run 快照保持一致', async () => {
    const fixture = await createFixture('idle');
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '动态配置',
      cwd: '/tmp',
      mode: 'agent',
    });

    expect(await fixture.service.getConfiguration(session.id)).toMatchObject({
      supported: true,
      current: { model: 'fixture-model', mode: 'agent' },
    });
    const switched = await fixture.service.updateConfiguration(session.id, { mode: 'plan' });
    expect(switched.current.mode).toBe('plan');
    expect((await fixture.repositories.sessions.get(session.id))?.mode).toBe('plan');
    const modelSwitched = await fixture.service.updateConfiguration(session.id, {
      model: 'fixture-model-2',
    });
    expect(modelSwitched.current.model).toBe('fixture-model-2');

    await expect(
      fixture.service.updateConfiguration(session.id, { model: 'missing-model' }),
    ).rejects.toMatchObject({ code: 'SESSION_MODEL_UNSUPPORTED' });
    await expect(
      fixture.service.updateConfiguration(session.id, { model: 'fixture-model', mode: 'plan' }),
    ).rejects.toMatchObject({ code: 'SESSION_CONFIGURATION_FAILED' });

    const run = await fixture.service.startRun(session.id, { text: '验证配置快照' });
    expect(run.mode).toBe('plan');
    expect(run.model).toBe('fixture-model-2');
    const events = await fixture.repositories.events.listAfter(session.id, 0, 100);
    expect(events.some((event) => event.type === 'agent.configuration.updated')).toBe(true);
    await fixture.service.shutdown();
  });

  it('持久化 Approval 合法选项、exactly-once 决策、消息、事件与 Git 前后 SHA', async () => {
    const fixture = await createFixture('approval');
    const lifecycle: string[] = [];
    const taskId = randomUUID();
    const tasks = new TaskRepository(database.db);
    await tasks.create({
      id: taskId,
      projectId: fixture.projectId,
      title: 'Approval任务',
      status: 'IN_PROGRESS',
      assignedAgentId: fixture.agentId,
    });
    fixture.service.setTaskLifecycleObserver({
      onRunCompleted: async () => {
        lifecycle.push('completed');
      },
      onRunWaitingForInput: async () => {
        lifecycle.push('waiting');
      },
      onRunResumed: async () => {
        lifecycle.push('resumed');
      },
    });
    const session = await fixture.service.createManagedWorktree(
      {
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        taskId,
        title: 'Approval 测试',
        cwd: '/tmp',
      },
      '/tmp',
    );
    await tasks.update(taskId, { sessionId: session.id });
    const run = await fixture.service.startRun(session.id, { text: '执行需要权限的任务' });

    await waitFor(
      async () => (await fixture.repositories.runs.get(run.id))?.status === 'WAITING_APPROVAL',
    );
    const pending = await fixture.service.listApprovals(session.id);
    expect(pending).toHaveLength(1);
    await expect(fixture.service.resolveApproval(pending[0]!.id, 'invented')).rejects.toMatchObject(
      {
        code: 'APPROVAL_OPTION_INVALID',
      },
    );
    expect((await fixture.repositories.approvals.get(pending[0]!.id))?.status).toBe('PENDING');

    const first = await fixture.service.resolveApproval(pending[0]!.id, 'allow');
    const duplicate = await fixture.service.resolveApproval(pending[0]!.id, 'allow');
    expect(first.status).toBe('APPROVED');
    expect(duplicate.status).toBe('APPROVED');

    await waitFor(
      async () => (await fixture.repositories.runs.get(run.id))?.status === 'COMPLETED',
    );
    await waitFor(async () => {
      const delivery = await fixture.repositories.approvals.getWithDelivery(pending[0]!.id);
      return delivery?.deliveryState === 'DELIVERED';
    });
    const completed = await fixture.repositories.runs.get(run.id);
    const restoredSession = await fixture.repositories.sessions.get(session.id);
    const messages = await fixture.repositories.messages.list(session.id);
    const events = await fixture.repositories.events.listAfter(session.id, 0);
    expect(completed).toMatchObject({ gitBeforeSha: 'before-sha', gitAfterSha: 'after-sha' });
    expect(restoredSession?.status).toBe('READY');
    expect(messages.map((message) => message.role)).toEqual(['USER', 'ASSISTANT']);
    expect(events.map((event) => event.seq)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['approval.decision_recorded', 'approval.delivery_succeeded']),
    );
    expect(lifecycle).toEqual(['waiting', 'resumed', 'completed']);
    expect(fixture.published.some((message) => message.topic === 'approvals')).toBe(true);
    await fixture.service.shutdown();
  });

  it.each([
    ['approval-error', 'APPROVAL_DELIVERY_ACK_UNKNOWN'],
    ['approval-timeout', 'APPROVAL_DELIVERY_TIMEOUT'],
  ] as const)(
    'Approval %s 时保留用户决定、标记未知且不盲目重投',
    async (scenario, expectedErrorCode) => {
      const fixture = await createFixture(
        'idle',
        undefined,
        {},
        {
          adapter: new ControlledAdapter(scenario),
          approvalDeliveryTimeoutMs: 1_000,
        },
      );
      const session = await fixture.service.create({
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        title: `Approval 投递 ${scenario}`,
        cwd: '/tmp',
      });
      const run = await fixture.service.startRun(session.id, { text: '请求权限' });
      await waitFor(
        async () => (await fixture.repositories.runs.get(run.id))?.status === 'WAITING_APPROVAL',
      );
      const approval = (await fixture.service.listApprovals(session.id))[0]!;

      const recorded = await fixture.service.resolveApproval(approval.id, 'allow');
      expect(recorded).toMatchObject({ status: 'APPROVED', selectedOptionId: 'allow' });
      await waitFor(async () => {
        const current = await fixture.repositories.approvals.getWithDelivery(approval.id);
        return current?.deliveryState === 'UNKNOWN';
      }, 2_500);

      expect(await fixture.repositories.approvals.getWithDelivery(approval.id)).toMatchObject({
        status: 'APPROVED',
        selectedOptionId: 'allow',
        deliveryState: 'UNKNOWN',
        deliveryAttemptCount: 1,
        deliveryErrorCode: expectedErrorCode,
      });
      expect(await fixture.repositories.runs.get(run.id)).toMatchObject({
        status: 'DISCONNECTED',
        errorCode: expectedErrorCode,
      });
      expect(await fixture.repositories.sessions.get(session.id)).toMatchObject({
        status: 'DISCONNECTED',
      });

      const duplicate = await fixture.service.resolveApproval(approval.id, 'allow');
      expect(duplicate.deliveryAttemptCount).toBe(1);
      await expect(fixture.service.resolveApproval(approval.id, 'reject')).rejects.toMatchObject({
        code: 'APPROVAL_DECISION_CONFLICT',
      });
      const events = await fixture.repositories.events.listAfter(session.id, 0, 100);
      expect(events.filter((event) => event.type === 'approval.decision_recorded')).toHaveLength(1);
      expect(events.filter((event) => event.type === 'approval.delivery_unknown')).toHaveLength(1);
      await fixture.service.shutdown();
    },
  );

  it('Approval 投递前 Run 状态已变化时记录决定但不再调用 Agent', async () => {
    const fixture = await createFixture('approval');
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: 'Approval 与取消竞争',
      cwd: '/tmp',
    });
    const run = await fixture.service.startRun(session.id, { text: '请求权限后改变状态' });
    await waitFor(
      async () => (await fixture.repositories.runs.get(run.id))?.status === 'WAITING_APPROVAL',
    );
    const approval = (await fixture.service.listApprovals(session.id))[0]!;
    await fixture.repositories.runs.tryTransition(run.id, ['WAITING_APPROVAL'], 'CANCELING');

    await fixture.service.resolveApproval(approval.id, 'allow');
    await waitFor(async () => {
      const current = await fixture.repositories.approvals.getWithDelivery(approval.id);
      return current?.deliveryState === 'DEAD';
    });

    expect(await fixture.repositories.approvals.getWithDelivery(approval.id)).toMatchObject({
      status: 'APPROVED',
      deliveryState: 'DEAD',
      deliveryErrorCode: 'RUN_NOT_WAITING_FOR_APPROVAL',
    });
    expect((await fixture.repositories.runs.get(run.id))?.status).toBe('CANCELING');
    const events = await fixture.repositories.events.listAfter(session.id, 0, 100);
    expect(events.map((event) => event.type)).toContain('approval.delivery_aborted');
    await fixture.service.shutdown();
  });

  it('取消 idle Run 后持久化 CANCELED，并允许关闭 Session', async () => {
    const fixture = await createFixture('idle');
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '取消测试',
      cwd: '/tmp',
    });
    const run = await fixture.service.startRun(session.id, { text: '等待取消' });
    await fixture.service.cancelRun(session.id, run.id);
    await waitFor(async () => (await fixture.repositories.runs.get(run.id))?.status === 'CANCELED');
    expect((await fixture.repositories.sessions.get(session.id))?.status).toBe('READY');
    expect((await fixture.service.close(session.id)).status).toBe('CLOSED');
  });

  it('Run 终态 CAS 只允许一个写入者，并按 Run 原子取消 PENDING Approval', async () => {
    const fixture = await createFixture('approval');
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: 'CAS 测试',
      cwd: '/tmp',
    });
    const run = await fixture.service.startRun(session.id, { text: '测试并发取消' });
    await waitFor(
      async () => (await fixture.repositories.runs.get(run.id))?.status === 'WAITING_APPROVAL',
    );
    const first = await fixture.repositories.runs.tryTransition(
      run.id,
      ['WAITING_APPROVAL'],
      'CANCELING',
    );
    const loser = await fixture.repositories.runs.tryTransition(
      run.id,
      ['WAITING_APPROVAL'],
      'COMPLETED',
    );
    expect(first.changed).toBe(true);
    expect(loser.changed).toBe(false);
    expect(loser.run.status).toBe('CANCELING');

    const canceled = await fixture.repositories.approvals.cancelPendingForRun(run.id);
    expect(canceled).toHaveLength(1);
    expect(canceled[0]?.status).toBe('CANCELED');
    expect(await fixture.repositories.approvals.listPending(session.id)).toHaveLength(0);
    await fixture.service.shutdown();
  });

  it('取消没有终态事件时按短 deadline 保持未知隔离，并记录超时原因', async () => {
    const fixture = await createFixture(
      'idle',
      undefined,
      {},
      { adapter: new ControlledAdapter('never'), cancelConvergenceTimeoutMs: 1_000 },
    );
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '取消超时',
      cwd: '/tmp',
    });
    const run = await fixture.service.startRun(session.id, { text: '不会返回取消事件' });
    const requested = await fixture.service.cancelRun(session.id, run.id);
    expect(requested.status).toBe('CANCELING');
    await waitFor(
      async () => (await fixture.repositories.runs.get(run.id))?.status === 'DISCONNECTED',
      2_500,
    );
    expect(await fixture.repositories.runs.get(run.id)).toMatchObject({
      status: 'DISCONNECTED',
      errorCode: 'CANCEL_CONFIRMATION_TIMEOUT',
    });
    expect((await fixture.repositories.sessions.get(session.id))?.status).toBe('DISCONNECTED');
    await fixture.service.shutdown();
  });

  it('取消 CAS 获胜后迟到的 Approval 只保留审计事件，不留下 PENDING 请求', async () => {
    const fixture = await createFixture(
      'idle',
      undefined,
      {},
      { adapter: new ControlledAdapter('late-approval'), cancelConvergenceTimeoutMs: 1_000 },
    );
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '迟到 Approval',
      cwd: '/tmp',
    });
    const run = await fixture.service.startRun(session.id, { text: '先取消再请求权限' });

    await fixture.service.cancelRun(session.id, run.id);
    await waitFor(async () => {
      const events = await fixture.repositories.events.listAfter(session.id, 0, 100);
      return events.some((event) => event.type === 'approval.requested');
    });

    expect(await fixture.repositories.approvals.listPending(session.id)).toHaveLength(0);
    expect((await fixture.repositories.runs.get(run.id))?.status).toBe('CANCELING');
    await fixture.service.shutdown();
  });

  it('取消立即被 Agent 拒绝时只由 CAS 赢家保留未知DISCONNECTED 并断开 Session', async () => {
    const fixture = await createFixture(
      'idle',
      undefined,
      {},
      { adapter: new ControlledAdapter('reject'), cancelConvergenceTimeoutMs: 1_000 },
    );
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '取消拒绝',
      cwd: '/tmp',
    });
    const run = await fixture.service.startRun(session.id, { text: '立即拒绝' });
    await fixture.service.cancelRun(session.id, run.id);
    await waitFor(
      async () => (await fixture.repositories.runs.get(run.id))?.status === 'DISCONNECTED',
    );
    expect(await fixture.repositories.runs.get(run.id)).toMatchObject({
      status: 'DISCONNECTED',
      errorCode: 'AGENT_RUN_CANCEL_FAILED',
    });
    expect((await fixture.repositories.sessions.get(session.id))?.status).toBe('DISCONNECTED');
    await fixture.service.shutdown();
  });

  it.each([
    ['completed', 'COMPLETED', 'READY'],
    ['disconnected', 'DISCONNECTED', 'DISCONNECTED'],
  ] as const)(
    '取消与 %s 事件竞争时由终态 CAS 决定结果',
    async (scenario, expectedRun, expectedSession) => {
      const fixture = await createFixture(
        'idle',
        undefined,
        {},
        { adapter: new ControlledAdapter(scenario), cancelConvergenceTimeoutMs: 1_000 },
      );
      const session = await fixture.service.create({
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        title: `取消竞争 ${scenario}`,
        cwd: '/tmp',
      });
      const run = await fixture.service.startRun(session.id, { text: '竞争终态' });
      await fixture.service.cancelRun(session.id, run.id);
      await waitFor(
        async () => (await fixture.repositories.runs.get(run.id))?.status === expectedRun,
      );
      expect((await fixture.repositories.sessions.get(session.id))?.status).toBe(expectedSession);
      await fixture.service.shutdown();
    },
  );

  it('服务重启将活动状态置为 DISCONNECTED，并取消未决 Approval', async () => {
    const fixture = await createFixture('approval');
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '恢复测试',
      cwd: '/tmp',
    });
    const run = await fixture.service.startRun(session.id, { text: '等待重启' });
    await waitFor(
      async () => (await fixture.repositories.runs.get(run.id))?.status === 'WAITING_APPROVAL',
    );

    const recovery = await fixture.service.recoverAfterRestart();
    expect(recovery.sessions).toContain(session.id);
    expect(recovery.runs.disconnected).toContain(run.id);
    expect((await fixture.repositories.sessions.get(session.id))?.status).toBe('DISCONNECTED');
    expect((await fixture.repositories.runs.get(run.id))?.status).toBe('DISCONNECTED');
    expect(await fixture.repositories.approvals.listPending(session.id)).toHaveLength(0);
    await fixture.service.shutdown();
  });

  it('Git诊断快照读取失败不把正常Run改为失败', async () => {
    const capture = vi.fn(
      async (
        _run: string,
        _project: string,
        _cwd: string,
        _type: 'BEFORE' | 'AFTER' | 'REVIEW',
      ) => {
        throw new AppError(409, 'GIT_STATUS_FAILED', 'Git 状态读取失败');
      },
    );
    const fixture = await createFixture(
      'complete',
      undefined,
      {},
      { git: { readHead: async () => undefined, capture } },
    );
    try {
      const session = await fixture.service.create({
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        title: '诊断读取失败',
        cwd: '/tmp',
      });
      const run = await fixture.service.startRun(session.id, { text: '继续正常执行' });
      await waitFor(
        async () => (await fixture.repositories.sessions.get(session.id))?.status === 'READY',
      );
      expect(await fixture.repositories.runs.get(run.id)).toMatchObject({ status: 'COMPLETED' });
      expect(capture.mock.calls.map((call) => call[3])).toEqual(['BEFORE', 'AFTER']);
    } finally {
      await fixture.service.shutdown();
    }
  });

  it('ACP 未返回 externalRunId 且 usage 只有 context 数据时仍完成 Run', async () => {
    const fixture = await createFixture('complete', undefined, {
      includeExternalRunId: false,
      usagePayload: { used: 22_271, size: 258_400 },
    });
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: 'ACP 可选字段回归',
      cwd: '/tmp',
    });
    const started = await fixture.service.startRun(session.id, { text: '执行真实 ACP 行为' });

    expect(started.externalRunId).toBeNull();
    await waitFor(
      async () => (await fixture.repositories.runs.get(started.id))?.status === 'COMPLETED',
    );
    expect(await fixture.repositories.sessions.get(session.id)).toMatchObject({ status: 'READY' });
    expect(await fixture.repositories.messages.list(session.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'ASSISTANT', text: '测试响应' })]),
    );
    await fixture.service.shutdown();
  });

  it('前一个 Run 已终态但 Session 尚在收敛时等待 READY 再启动下一 Run', async () => {
    let releaseAfterSnapshot: () => void = () => undefined;
    let markAfterSnapshotStarted: () => void = () => undefined;
    const afterSnapshotStarted = new Promise<void>((resolve) => {
      markAfterSnapshotStarted = resolve;
    });
    const afterSnapshotRelease = new Promise<void>((resolve) => {
      releaseAfterSnapshot = resolve;
    });
    const heads = ['before-1', 'after-1', 'before-2', 'after-2'];
    const git: GitHeadProbe = {
      readHead: async () => heads.shift(),
      capture: async (_runId, _projectId, _cwd, type) => {
        if (type !== 'AFTER') return;
        markAfterSnapshotStarted();
        await afterSnapshotRelease;
      },
    };
    const fixture = await createFixture('complete', undefined, {}, { git });
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '连续 Run 收敛',
      cwd: '/tmp',
    });
    const first = await fixture.service.startRun(session.id, { text: '第一轮' });
    await afterSnapshotStarted;
    expect((await fixture.repositories.runs.get(first.id))?.status).toBe('COMPLETED');
    expect((await fixture.repositories.sessions.get(session.id))?.status).toBe('RUNNING');

    const secondRun = fixture.service.startRun(session.id, { text: '第二轮' });
    releaseAfterSnapshot();
    const second = await secondRun;
    await waitFor(
      async () => (await fixture.repositories.runs.get(second.id))?.status === 'COMPLETED',
    );
    expect((await fixture.repositories.sessions.get(session.id))?.status).toBe('READY');
    await fixture.service.shutdown();
  });

  it('Run 缺 PromptOS 必填变量时阻断，成功时保存 resolved provenance', async () => {
    const missingFixture = await createFixture('idle', {
      resolveForRun: async () => ({
        ready: false,
        finalContext: '',
        missingVariables: ['task.name'],
        items: [],
      }),
    });
    const missingSession = await missingFixture.service.create({
      projectId: missingFixture.projectId,
      agentId: missingFixture.agentId,
      title: '变量阻断',
      cwd: '/tmp',
    });
    await expect(
      missingFixture.service.startRun(missingSession.id, { text: '不应启动' }),
    ).rejects.toMatchObject({ code: 'PROMPT_VARIABLES_MISSING' });
    expect(await missingFixture.repositories.runs.list(missingSession.id)).toHaveLength(0);
    await missingFixture.service.shutdown();

    const resolvedFixture = await createFixture('idle', {
      resolveForRun: async () => ({
        ready: true,
        finalContext: '[PromptOS REVIEW]\n只修改必要代码',
        missingVariables: [],
        items: [
          {
            promptId: 'prompt-1',
            versionId: 'version-2',
            version: 2,
            label: 'production',
            contentHash: 'a'.repeat(64),
            bindingId: 'binding-1',
            slot: 'REVIEW',
            targetType: 'PROJECT',
            targetId: 'project-1',
          },
        ],
      }),
    });
    const resolvedSession = await resolvedFixture.service.create({
      projectId: resolvedFixture.projectId,
      agentId: resolvedFixture.agentId,
      title: 'Provenance 持久化',
      cwd: '/tmp',
    });
    const run = await resolvedFixture.service.startRun(resolvedSession.id, {
      text: '执行任务',
    });
    expect(run.metadataJson).toMatchObject({
      promptContext: {
        items: [
          {
            promptId: 'prompt-1',
            version: 2,
            label: 'production',
            contentHash: 'a'.repeat(64),
          },
        ],
      },
    });
    expect((run.metadataJson.promptContext as Record<string, unknown>).finalContextHash).toMatch(
      /^[a-f0-9]{64}$/,
    );
    await resolvedFixture.service.cancelRun(resolvedSession.id, run.id);
    await resolvedFixture.service.shutdown();
  });

  it.each(['ordinary', 'task'] as const)(
    'pre-handle %s未知清理不能记录NOT_ACQUIRED或健康shutdown',
    async (kind) => {
      const f = await taskAdmissionFixture();
      const create = vi
        .spyOn(f.adapter, 'createSession')
        .mockRejectedValue(
          new ResourceCleanupUnconfirmedError({ cause: new Error('private provider detail') }),
        );
      const operation =
        kind === 'task'
          ? f.service.createForTask(f.input, f.admission)
          : f.service.create({ ...f.input, taskId: undefined });
      await expect(operation).rejects.toMatchObject({ details: { handleCleanup: 'UNKNOWN' } });
      expect(create).toHaveBeenCalledTimes(1);
      await expect(f.service.create({ ...f.input, taskId: undefined })).rejects.toMatchObject({
        code: 'SESSION_SERVICE_STOPPING',
      });
      await expect(f.service.shutdown()).rejects.toMatchObject({
        code: 'SESSION_SHUTDOWN_UNCONFIRMED',
      });
      await expect(f.service.shutdown()).rejects.toMatchObject({
        code: 'SESSION_SHUTDOWN_UNCONFIRMED',
      });
      if (kind === 'task')
        expect((await f.repositories.taskStartAttempts.getForTask(f.task.id))[0]?.phase).toBe(
          'UNKNOWN',
        );
    },
  );

  it('普通创建失败但清理已确认不误设资源未知', async () => {
    const f = await taskAdmissionFixture();
    vi.spyOn(f.adapter, 'createSession').mockRejectedValue(new Error('confirmed failure'));
    await expect(f.service.create({ ...f.input, taskId: undefined })).rejects.toMatchObject({
      details: { handleCleanup: 'NOT_ACQUIRED' },
    });
    await expect(f.service.shutdown()).resolves.toBeUndefined();
  });

  it.each(['resumeSession', 'loadSession'] as const)(
    'pre-handle %s未知清理在业务包装前保留',
    async (method) => {
      const adapter = Object.assign(new ControlledAdapter('never'), {
        [method]: vi.fn().mockRejectedValue(new ResourceCleanupUnconfirmedError()),
      });
      const f = await createFixture('idle', undefined, {}, { adapter });
      const source = await f.service.create({
        projectId: f.projectId,
        agentId: f.agentId,
        title: 'restore',
        cwd: '/tmp',
      });
      await adapter.handles[0]!.close();
      await waitFor(async () => (await f.service.get(source.id)).status === 'DISCONNECTED');
      await expect(f.service.resume(source.id)).rejects.toMatchObject({
        details: { handleCleanup: 'UNKNOWN' },
      });
      await expect(f.service.shutdown()).rejects.toMatchObject({
        code: 'SESSION_SHUTDOWN_UNCONFIRMED',
      });
    },
  );

  async function summaryFixture() {
    const adapter = new ControlledAdapter('never');
    const f = await createFixture('idle', undefined, {}, { adapter });
    const source = await f.service.create({
      projectId: f.projectId,
      agentId: f.agentId,
      title: 'summary',
      cwd: '/tmp',
    });
    await f.service.close(source.id);
    const capabilities = await adapter.getCapabilities({} as AgentProfile);
    vi.spyOn(adapter, 'getCapabilities').mockResolvedValue({
      ...capabilities,
      configuration: {
        ...capabilities.configuration,
        modeOptions: [{ id: 'read-only', label: 'read only' }],
      },
    });
    const summary = () =>
      (
        f.service as unknown as {
          tryModelContinuationSummary(
            sourceSession: typeof source,
            snapshot: Record<string, unknown>,
          ): Promise<string | undefined>;
        }
      ).tryModelContinuationSummary(source, {});
    return { ...f, adapter, summary };
  }

  it('摘要capability探针未知失败即使fallback也阻止shutdown', async () => {
    const f = await summaryFixture();
    vi.mocked(f.adapter.getCapabilities).mockRejectedValue(new ResourceCleanupUnconfirmedError());
    await expect(f.summary()).resolves.toBeUndefined();
    await expect(f.service.shutdown()).rejects.toMatchObject({
      code: 'SESSION_SHUTDOWN_UNCONFIRMED',
    });
  });

  it.each(['capability', 'create'] as const)(
    '摘要%s超时后迟到未知仍被跟踪且不提前释放',
    async (phase) => {
      const f = await summaryFixture();
      let reject!: (error: Error) => void;
      let entered!: () => void;
      let directory: string | undefined;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = new Promise<never>((_, fail) => {
        reject = fail;
      });
      if (phase === 'capability')
        vi.mocked(f.adapter.getCapabilities).mockImplementation(() => {
          entered();
          return pending;
        });
      else
        vi.spyOn(f.adapter, 'createSession').mockImplementation((input) => {
          directory = input.cwd;
          entered();
          return pending;
        });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const summary = f.summary();
        await started;
        await vi.advanceTimersByTimeAsync(30_001);
        await expect(summary).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
      const released = vi.fn();
      const stopping = f.service.shutdown().then(released, (error) => error);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(released).not.toHaveBeenCalled();
      reject(new ResourceCleanupUnconfirmedError());
      await expect(stopping).resolves.toMatchObject({ code: 'SESSION_SHUTDOWN_UNCONFIRMED' });
      expect(released).not.toHaveBeenCalled();
      if (directory) {
        expect((await stat(directory)).isDirectory()).toBe(true);
        await rm(directory, { recursive: true, force: true }); // fixture has no actual resource
      }
    },
  );

  it('摘要已取得handle但close未知时保留本次目录', async () => {
    const f = await summaryFixture();
    let directory = '';
    const create = f.adapter.createSession.bind(f.adapter);
    const spy = vi.spyOn(f.adapter, 'createSession').mockImplementation(async (input) => {
      directory = input.cwd;
      const handle = await create(input);
      vi.spyOn(handle, 'sendTurn').mockRejectedValue(new Error('summary unavailable'));
      vi.spyOn(handle, 'close').mockRejectedValue(new Error('close unknown'));
      return handle;
    });
    await expect(f.summary()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
    expect((await stat(directory)).isDirectory()).toBe(true);
    await expect(f.service.shutdown()).rejects.toMatchObject({
      code: 'SESSION_SHUTDOWN_UNCONFIRMED',
    });
    await rm(directory, { recursive: true, force: true }); // in-memory fake handle only
  });

  it('仅 CLOSED Session 可以创建 continuation，并保留一次性、有界交接包', async () => {
    const fixture = await createFixture('idle');
    const source = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: '需要继续的 Session',
      cwd: '/tmp',
      branch: 'main',
      model: 'fixture-model-2',
      mode: 'plan',
      reasoningEffort: 'high',
    });

    await expect(fixture.service.continue(source.id)).rejects.toMatchObject({
      code: 'SESSION_CONTINUATION_SOURCE_NOT_CLOSED',
    });
    await fixture.service.close(source.id);
    const continued = await fixture.service.continue(source.id);

    expect(continued.session).toMatchObject({
      projectId: source.projectId,
      agentId: source.agentId,
      taskId: source.taskId,
      title: '继续：需要继续的 Session',
      cwd: source.cwd,
      branch: source.branch,
      model: source.model,
      mode: source.mode,
      reasoningEffort: source.reasoningEffort,
      continuedFromSessionId: source.id,
      status: 'READY',
    });
    expect((await fixture.repositories.sessions.get(source.id))?.status).toBe('CLOSED');
    expect(continued.continuation).toMatchObject({
      sourceSessionId: source.id,
      targetSessionId: continued.session.id,
      strategy: 'DETERMINISTIC',
      consumedAt: null,
    });
    expect(JSON.stringify(continued.continuation.inputSnapshotJson).length).toBeLessThanOrEqual(
      32 * 1024,
    );
    expect((await fixture.service.getContinuation(continued.session.id)).summaryText).toBe(
      continued.continuation.summaryText,
    );

    const firstRun = await fixture.service.startRun(continued.session.id, { text: '第一轮继续' });
    await fixture.service.cancelRun(continued.session.id, firstRun.id);
    await waitFor(
      async () => (await fixture.repositories.runs.get(firstRun.id))?.status === 'CANCELED',
    );
    const consumed = await fixture.repositories.continuations.getByTargetSessionId(
      continued.session.id,
    );
    expect(consumed?.consumedAt).not.toBeNull();

    const secondRun = await fixture.service.startRun(continued.session.id, { text: '第二轮继续' });
    await fixture.service.cancelRun(continued.session.id, secondRun.id);
    await waitFor(
      async () => (await fixture.repositories.runs.get(secondRun.id))?.status === 'CANCELED',
    );
    expect(
      (await fixture.repositories.continuations.getByTargetSessionId(continued.session.id))
        ?.consumedAt,
    ).toEqual(consumed?.consumedAt);
    await fixture.service.shutdown();
  });
});

type ControlledScenario =
  | 'never'
  | 'reject'
  | 'completed'
  | 'disconnected'
  | 'late-approval'
  | 'approval-error'
  | 'approval-timeout';

class ControlledAdapter implements AgentRuntimeAdapter {
  readonly kind = 'CONTROLLED';
  readonly handles: ControlledHandle[] = [];

  constructor(private readonly scenario: ControlledScenario) {}

  async preflight(_profile: AgentProfile) {
    return {
      status: 'READY' as const,
      checkedAt: new Date().toISOString(),
      checks: [],
    };
  }

  async getCapabilities(_profile: AgentProfile): Promise<AgentCapabilities> {
    return {
      sessions: { create: true, load: false, resume: false, close: true },
      prompts: { text: true, images: false, resources: false },
      interaction: { streaming: false, approvals: false, questions: false, plan: false },
      workspace: {
        files: false,
        terminal: false,
        additionalRoots: false,
        mcpStdio: false,
        mcpHttp: false,
      },
      configuration: { models: false, modes: false, reasoningEffort: false },
      telemetry: { tokenUsage: false, cost: false },
    };
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSessionHandle> {
    const handle = new ControlledHandle(input, this.scenario);
    this.handles.push(handle);
    return handle;
  }
}

class ControlledHandle implements AgentSessionHandle {
  readonly externalSessionId = `controlled-${randomUUID()}`;
  private readonly values: NormalizedAgentEvent[] = [];
  private readonly waiters: Array<(result: IteratorResult<NormalizedAgentEvent>) => void> = [];
  private closed = false;
  private runId: string | undefined;

  constructor(
    private readonly input: CreateAgentSessionInput,
    private readonly scenario: ControlledScenario,
  ) {}

  events(): AsyncIterable<NormalizedAgentEvent> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          const value = this.values.shift();
          if (value) return Promise.resolve({ value, done: false });
          if (this.closed) return Promise.resolve({ value: undefined, done: true });
          return new Promise<IteratorResult<NormalizedAgentEvent>>((resolve) =>
            this.waiters.push(resolve),
          );
        },
      }),
    };
  }

  async sendTurn(input: AgentTurnInput): Promise<AgentRunRef> {
    this.runId = input.runId;
    if (this.scenario === 'approval-error' || this.scenario === 'approval-timeout') {
      this.emit(
        'approval.requested',
        {
          approvalId: `controlled-${this.scenario}`,
          title: '允许执行受控操作吗？',
          options: [
            { id: 'allow', label: '允许一次', kind: 'allow_once' },
            { id: 'reject', label: '拒绝', kind: 'reject_once' },
          ],
        },
        this.runId,
      );
    }
    return { runId: input.runId };
  }

  async resolveApproval(_id: string, _decision: ApprovalDecision): Promise<void> {
    if (this.scenario === 'approval-timeout') return new Promise<void>(() => undefined);
    throw new Error('Controlled adapter 不支持 Approval');
  }

  async cancel(runId?: string): Promise<void> {
    if (runId && runId !== this.runId) throw new Error('Run 不匹配');
    if (this.scenario === 'never') return new Promise<void>(() => undefined);
    if (this.scenario === 'reject') throw new Error('Agent 拒绝取消');
    if (this.scenario === 'completed') this.emit('run.completed', {}, this.runId);
    if (this.scenario === 'disconnected') this.emit('adapter.disconnected', {}, this.runId);
    if (this.scenario === 'late-approval') {
      this.emit(
        'approval.requested',
        {
          approvalId: 'late-approval',
          title: '迟到的权限请求',
          options: [{ id: 'allow', label: '允许', kind: 'allow_once' }],
        },
        this.runId,
      );
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const resolve of this.waiters.splice(0)) resolve({ value: undefined, done: true });
  }

  requestApproval(id: string): void {
    this.emit(
      'approval.requested',
      {
        approvalId: id,
        title: '并发权限请求',
        options: [{ id: 'allow', label: '允许一次', kind: 'allow_once' }],
      },
      this.runId,
    );
  }

  configuration(current: Record<string, unknown>): void {
    this.emit('agent.configuration.updated', { current });
  }

  disconnect(runId?: string): void {
    this.emit('adapter.disconnected', {}, runId);
  }

  complete(runId: string): void {
    this.emit('run.completed', {}, runId);
  }

  terminal(runId: string, outcome: 'COMPLETED' | 'CANCELED') {
    this.emit(outcome === 'COMPLETED' ? 'run.completed' : 'run.cancelled', {}, runId);
  }

  private emit(
    type: NormalizedAgentEvent['type'],
    payload: Record<string, unknown>,
    runId?: string,
  ) {
    const event: NormalizedAgentEvent = {
      eventId: randomUUID(),
      sessionId: this.input.sessionId,
      ...(runId ? { runId } : {}),
      seq: 1,
      emittedAt: new Date().toISOString(),
      adapterKind: 'CONTROLLED',
      type,
      payload,
    };
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.values.push(event);
  }
}

class NeverLaunch implements AcpProcessLauncher {
  launch(): Promise<never> {
    throw new Error('不应启动真实进程');
  }
}

class SequenceGitProbe implements GitHeadProbe {
  constructor(private readonly values: string[]) {}
  async readHead(): Promise<string | undefined> {
    return this.values.shift();
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('等待持久化状态超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
