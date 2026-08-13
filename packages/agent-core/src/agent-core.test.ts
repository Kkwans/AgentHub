import { describe, expect, it } from 'vitest';

import type { AgentProfile, AgentSessionHandle } from './contracts.js';
import { FakeAgentAdapter } from './fake-adapter.js';
import type { NormalizedAgentEvent } from './events.js';
import {
  InvalidStateTransitionError,
  transitionRun,
  transitionSession,
  transitionTask,
  transitionWorktreeExecution,
} from './state-machine.js';

const profile: AgentProfile = {
  id: 'agent-fixture',
  name: 'Fixture Agent',
  agentKind: 'CUSTOM_ACP',
  adapterKind: 'FIXTURE',
  targetKind: 'LOCAL_HOST',
  launchSpec: { kind: 'HOST_PROCESS', executable: '/bin/false', args: [] },
  config: {},
};

const fixedNow = () => new Date('2026-08-09T12:00:00.000Z');

async function createSession(adapter: FakeAgentAdapter): Promise<AgentSessionHandle> {
  return adapter.createSession({
    sessionId: 'session-fixture',
    projectId: 'project-fixture',
    profile,
    cwd: '/volume2/Project/fixture',
  });
}

async function takeEvents(
  handle: AgentSessionHandle,
  count: number,
): Promise<NormalizedAgentEvent[]> {
  const iterator = handle.events()[Symbol.asyncIterator]();
  const events: NormalizedAgentEvent[] = [];
  while (events.length < count) {
    const next = await iterator.next();
    if (next.done) break;
    events.push(next.value);
  }
  return events;
}

describe('Agent 状态机', () => {
  it('允许合法 Session 与 Run 转换', () => {
    expect(transitionSession('CREATED', 'STARTING')).toBe('STARTING');
    expect(transitionSession('WAITING_APPROVAL', 'RUNNING')).toBe('RUNNING');
    expect(transitionRun('RUNNING', 'COMPLETED')).toBe('COMPLETED');
    expect(transitionRun('CANCELING', 'CANCELED')).toBe('CANCELED');
    expect(transitionRun('CANCELING', 'COMPLETED')).toBe('COMPLETED');
    expect(transitionRun('CANCELING', 'FAILED')).toBe('FAILED');
    expect(transitionRun('CANCELING', 'DISCONNECTED')).toBe('DISCONNECTED');
  });

  it('阻止终态回到运行态', () => {
    expect(() => transitionSession('CLOSED', 'READY')).toThrow(InvalidStateTransitionError);
    expect(() => transitionRun('COMPLETED', 'RUNNING')).toThrow(InvalidStateTransitionError);
    expect(() => transitionTask('DONE', 'IN_PROGRESS')).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION', entity: 'TASK' }),
    );
  });

  it('Task 必须经过待审阅才能完成', () => {
    expect(() => transitionTask('IN_PROGRESS', 'DONE')).toThrow(InvalidStateTransitionError);
    expect(transitionTask('IN_PROGRESS', 'WAITING_REVIEW')).toBe('WAITING_REVIEW');
    expect(transitionTask('WAITING_REVIEW', 'DONE')).toBe('DONE');
  });

  it('Worktree Execution 必须经过 Review 与 Merge gate', () => {
    expect(transitionWorktreeExecution('QUEUED', 'SETTING_UP')).toBe('SETTING_UP');
    expect(transitionWorktreeExecution('SETTING_UP', 'RUNNING')).toBe('RUNNING');
    expect(transitionWorktreeExecution('RUNNING', 'AWAITING_INPUT')).toBe('AWAITING_INPUT');
    expect(transitionWorktreeExecution('AWAITING_INPUT', 'RUNNING')).toBe('RUNNING');
    expect(transitionWorktreeExecution('RUNNING', 'REVIEW')).toBe('REVIEW');
    expect(() => transitionWorktreeExecution('REVIEW', 'DONE')).toThrowError(
      InvalidStateTransitionError,
    );
    expect(transitionWorktreeExecution('REVIEW', 'MERGING')).toBe('MERGING');
    expect(transitionWorktreeExecution('MERGING', 'DONE')).toBe('DONE');
  });
});

describe('deterministic fake adapter', () => {
  it('返回供应商无关的 capability 与 preflight', async () => {
    const adapter = new FakeAgentAdapter({ now: fixedNow });
    const capabilities = await adapter.getCapabilities(profile);
    const preflight = await adapter.preflight(profile);

    expect(capabilities.sessions.create).toBe(true);
    expect(capabilities.interaction.approvals).toBe(true);
    expect(JSON.stringify(capabilities)).not.toMatch(/ACP|OpenClaw|Docker/i);
    expect(preflight).toMatchObject({
      status: 'READY',
      checkedAt: '2026-08-09T12:00:00.000Z',
      detectedVersion: 'fixture-1.0.0',
    });
  });

  it('创建、stream 并完成 Run，事件 seq 严格递增', async () => {
    const adapter = new FakeAgentAdapter({ scenario: 'complete', now: fixedNow });
    const session = await createSession(adapter);
    const run = await session.sendTurn({ runId: 'run-complete', text: '执行测试' });
    const events = await takeEvents(session, 6);

    expect(run).toEqual({ runId: 'run-complete', externalRunId: 'fake-run-run-complete' });
    expect(events.map((event) => event.type)).toEqual([
      'session.created',
      'run.started',
      'assistant.message.delta',
      'assistant.message.completed',
      'usage.updated',
      'run.completed',
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.every((event) => event.adapterKind === 'FAKE')).toBe(true);
  });

  it('只接受当前合法 Approval，并继续完成 Run', async () => {
    const adapter = new FakeAgentAdapter({ scenario: 'approval', now: fixedNow });
    const session = await createSession(adapter);
    await session.sendTurn({ runId: 'run-approval', text: '需要权限' });
    const beforeDecision = await takeEvents(session, 4);
    const requested = beforeDecision.at(-1);
    expect(requested?.type).toBe('approval.requested');

    await session.resolveApproval('fake-approval-run-approval', { optionId: 'allow' });
    await expect(
      session.resolveApproval('fake-approval-run-approval', { optionId: 'allow' }),
    ).rejects.toMatchObject({ code: 'APPROVAL_NOT_PENDING' });
    const afterDecision = await takeEvents(session, 4);
    expect(afterDecision.map((event) => event.type)).toEqual([
      'approval.resolved',
      'assistant.message.completed',
      'usage.updated',
      'run.completed',
    ]);
  });

  it('取消 idle Run 且不会伪造完成事件', async () => {
    const adapter = new FakeAgentAdapter({ scenario: 'idle', now: fixedNow });
    const session = await createSession(adapter);
    await session.sendTurn({ runId: 'run-idle', text: '等待取消' });
    await session.cancel('run-idle');
    const events = await takeEvents(session, 4);

    expect(events.at(-1)?.type).toBe('run.cancelled');
    expect(events.some((event) => event.type === 'run.completed')).toBe(false);
    await expect(session.cancel('run-idle')).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' });
  });

  it.each([
    ['fail', 'run.failed'],
    ['disconnect', 'adapter.disconnected'],
  ] as const)('覆盖 %s 场景', async (scenario, terminalEvent) => {
    const adapter = new FakeAgentAdapter({ scenario, now: fixedNow });
    const session = await createSession(adapter);
    await session.sendTurn({ runId: `run-${scenario}`, text: '测试异常路径' });
    const events = await takeEvents(session, 4);

    expect(events.at(-1)?.type).toBe(terminalEvent);
  });
});
