import { randomUUID } from 'node:crypto';

import { FakeAgentAdapter } from '@agenthub/agent-core';
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
  ) {
    const agents = new AgentRepository(database.db);
    const targets = new ExecutionTargetRepository(database.db);
    const projects = new ProjectRepository(database.db);
    const sessions = new SessionRepository(database.db);
    const runs = new RunRepository(database.db);
    const messages = new MessageRepository(database.db);
    const events = new EventRepository(database.db);
    const approvals = new ApprovalRepository(database.db);
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
    await projects.create({
      id: projectId,
      name: '测试 Project',
      targetId,
      rootPath: '/tmp',
      realRootPath: '/tmp',
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

    const adapter = new FakeAgentAdapter({ scenario, ...adapterOptions });
    const agentService = new AgentService(agents, targets, new NeverLaunch(), () => adapter);
    const published: Array<{ topic: string; event: Record<string, unknown> }> = [];
    const git = new SequenceGitProbe(['before-sha', 'after-sha']);
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
    );
    return {
      service,
      repositories: { sessions, runs, messages, events, approvals },
      projectId,
      agentId,
      published,
    };
  }

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
    expect(lifecycle).toEqual(['waiting', 'resumed', 'completed']);
    expect(fixture.published.some((message) => message.topic === 'approvals')).toBe(true);
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
});

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
