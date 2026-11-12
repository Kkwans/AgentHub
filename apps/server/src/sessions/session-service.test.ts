import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  FakeAgentAdapter,
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
  TaskRepository,
  GoalRepository,
  SessionRepository,
  SessionContinuationRepository,
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
    );
    return {
      service,
      agentService,
      repositories: { sessions, runs, messages, events, approvals, continuations },
      projectId,
      agentId,
      published,
    };
  }

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
        await f.service.shutdown();
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
      await f.service.shutdown();
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
        await fixture.service.shutdown();
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
        const session = await fixture.service.create({
          projectId: fixture.projectId,
          agentId: fixture.agentId,
          taskId: task.id,
          title: '受控终态窗口',
          cwd: '/tmp',
        });
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
        const session = await fixture.service.create({
          projectId: fixture.projectId,
          agentId: fixture.agentId,
          taskId: task.id,
          title: '无HEAD会话',
          cwd: '/tmp',
        });
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
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      taskId: task.id,
      title: '准备窗口',
      cwd: '/tmp',
    });
    await tasks.update(task.id, { sessionId: session.id });
    return { ...fixture, adapter, tasks, taskService, task, session };
  }

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
      const lookup = f.repositories.runs.findActiveForSession.bind(f.repositories.runs);
      if (order === 'new-ready')
        vi.spyOn(f.repositories.runs, 'findActiveForSession').mockImplementationOnce(async (id) => {
          const snapshot = await lookup(id);
          oldWaiting = true;
          await new Promise<void>((resolve) => {
            releaseOld = resolve;
          });
          return snapshot;
        });
      const transition = f.repositories.sessions.transition.bind(f.repositories.sessions);
      vi.spyOn(f.repositories.sessions, 'transition').mockImplementation(
        async (id, to, patch, options) => {
          if (order !== 'new-ready' && to === 'DISCONNECTED' && !oldWaiting) {
            oldWaiting = true;
            await new Promise<void>((resolve) => {
              releaseOld = resolve;
            });
          }
          const result = await transition(id, to, patch, options);
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

  it('AH059合法cancel拒绝先断连，旧findActive返回后误断开恢复后的新Run Session', async () => {
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
    const lookup = f.repositories.runs.findActiveForSession.bind(f.repositories.runs);
    const barrier = vi
      .spyOn(f.repositories.runs, 'findActiveForSession')
      .mockImplementationOnce(async (id) => {
        const snapshot = await lookup(id);
        expect(snapshot?.id).toBe(first.id);
        entered = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return snapshot;
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

  it('AH059 taskLifecycle已持久DISCONNECTED时cancel拒绝不能打开提前resume窗口', async () => {
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
    const transition = f.repositories.runs.tryTransition.bind(f.repositories.runs);
    let rejectedCancelConverged = false;
    vi.spyOn(f.repositories.runs, 'tryTransition').mockImplementation(
      async (id, expected, to, patch) => {
        const result = await transition(id, expected, to, patch);
        if (patch?.errorCode === 'AGENT_RUN_CANCEL_FAILED') {
          expect(result.changed).toBe(false);
          rejectedCancelConverged = true;
        }
        return result;
      },
    );
    await f.adapter.handles[0]!.close();
    await waitFor(async () => entered);
    try {
      rejectCancel(new Error('controlled cancellation rejection'));
      await waitFor(async () => rejectedCancelConverged);
      expect((await f.repositories.runs.get(first.id))?.status).toBe('DISCONNECTED');
      expect((await f.repositories.sessions.get(f.session.id))?.status).toBe('RUNNING');
      await expect(f.service.resume(f.session.id)).rejects.toMatchObject({
        code: 'SESSION_NOT_DISCONNECTED',
      });
      expect(f.adapter.handles).toHaveLength(1);
      release();
      await waitFor(
        async () => (await f.repositories.sessions.get(f.session.id))?.status === 'DISCONNECTED',
      );
      expect((await f.service.resume(f.session.id)).status).toBe('READY');
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
      const continued = await f.service.continue(f.session.id);
      expect(continued.session.taskId).toBe(f.task.id);
      await expect(
        f.service.startRun(continued.session.id, { text: '新会话也不能继续执行' }),
      ).rejects.toMatchObject({ status: 409, code: 'TASK_CANCELED' });
      expect(await f.repositories.runs.list(continued.session.id)).toHaveLength(0);
      expect(await f.repositories.messages.list(continued.session.id)).toHaveLength(0);
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
    await fixture.service.shutdown();

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
        taskId: randomUUID(),
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
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      taskId,
      title: 'Approval 测试',
      cwd: '/tmp',
    });
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
