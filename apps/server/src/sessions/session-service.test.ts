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
import { SessionService, type GitHeadProbe } from './session-service.js';

describe('Session/Run/Approval 持久化闭环', () => {
  let database: Awaited<ReturnType<typeof createPgliteDatabase>>;

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
  });

  afterAll(async () => {
    await database.close();
  });

  async function createFixture(scenario: 'complete' | 'approval' | 'idle') {
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

    const adapter = new FakeAgentAdapter({ scenario });
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
    const session = await fixture.service.create({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
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
