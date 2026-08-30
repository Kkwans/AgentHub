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
  SessionRepository,
  SessionContinuationRepository,
} from '@agenthub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentService } from '../agents/agent-service.js';
import type { AcpProcessLauncher } from '@agenthub/adapter-acp';
import {
  SessionService,
  type GitHeadProbe,
  type PromptContextResolver,
} from './session-service.js';

describe('Session/Run/Approval 持久化闭环', () => {
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
      repositories: { sessions, runs, messages, events, approvals, continuations },
      projectId,
      agentId,
      published,
    };
  }

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

  it('取消没有终态事件时按短 deadline 收敛，并记录超时原因', async () => {
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
      async () => (await fixture.repositories.runs.get(run.id))?.status === 'CANCELED',
      2_500,
    );
    expect(await fixture.repositories.runs.get(run.id)).toMatchObject({
      status: 'CANCELED',
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

  it('取消立即被 Agent 拒绝时只由 CAS 赢家标记 FAILED 并断开 Session', async () => {
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
    await waitFor(async () => (await fixture.repositories.runs.get(run.id))?.status === 'FAILED');
    expect(await fixture.repositories.runs.get(run.id)).toMatchObject({
      status: 'FAILED',
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
    return new ControlledHandle(input, this.scenario);
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
