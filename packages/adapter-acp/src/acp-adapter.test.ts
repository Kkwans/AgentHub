import { resolve } from 'node:path';

import type { AgentProfile, AgentSessionHandle, NormalizedAgentEvent } from '@agenthub/agent-core';
import { afterEach, describe, expect, it } from 'vitest';

import { AcpAdapter } from './acp-adapter.js';

const fixturePath = resolve(process.cwd(), 'tests/fixtures/acp/fake-agent.mjs');
const profile: AgentProfile = {
  id: 'acp-fixture',
  name: 'ACP Fixture',
  agentKind: 'CUSTOM_ACP',
  adapterKind: 'ACP_STDIO',
  targetKind: 'LOCAL_HOST',
  launchSpec: { kind: 'HOST_PROCESS', executable: process.execPath, args: [fixturePath] },
  config: {
    preflightCwd: process.cwd(),
    preflightSession: true,
    files: true,
    models: true,
    modes: true,
  },
};

const hangingCloseProfile: AgentProfile = {
  ...profile,
  id: 'acp-fixture-hanging-close',
  launchSpec: {
    kind: 'HOST_PROCESS',
    executable: process.execPath,
    args: [fixturePath, '--hang-close'],
  },
};

const openSessions: AgentSessionHandle[] = [];

afterEach(async () => {
  for (const session of openSessions.splice(0)) await session.close();
});

async function takeUntil(
  iterator: AsyncIterator<NormalizedAgentEvent>,
  type: NormalizedAgentEvent['type'],
): Promise<NormalizedAgentEvent[]> {
  const events: NormalizedAgentEvent[] = [];
  while (events.length < 30) {
    const next = await iterator.next();
    if (next.done) break;
    events.push(next.value);
    if (next.value.type === type) return events;
  }
  throw new Error(`未收到预期 ACP 事件：${type}`);
}

describe('ACP v1 adapter wire fixture', () => {
  it('完成 initialize 与 session smoke preflight', async () => {
    const adapter = new AcpAdapter();
    const report = await adapter.preflight(profile);
    const capabilities = await adapter.getCapabilities(profile);

    expect(report).toMatchObject({
      status: 'READY',
      detectedVersion: '1.0.0',
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'initialize', status: 'PASS' }),
        expect.objectContaining({ id: 'session', status: 'PASS' }),
      ]),
    });
    expect(capabilities.sessions).toEqual({ create: true, load: true, resume: true, close: true });
  });

  it('归一化 stream/tool/permission/file/usage 并完成 Run', async () => {
    const adapter = new AcpAdapter();
    const session = await adapter.createSession({
      sessionId: 'hub-session-1',
      projectId: 'project-1',
      profile,
      cwd: process.cwd(),
      mode: 'plan',
    });
    openSessions.push(session);
    const iterator = session.events()[Symbol.asyncIterator]();
    await session.sendTurn({ runId: 'run-1', text: '执行 Fixture' });

    const beforeApproval = await takeUntil(iterator, 'approval.requested');
    const approval = beforeApproval.at(-1);
    expect(approval?.payload.options).toEqual([
      { id: 'allow-once', label: '允许一次', kind: 'allow_once' },
      { id: 'reject-once', label: '拒绝', kind: 'reject_once' },
    ]);
    const approvalId = approval?.payload.approvalId;
    if (typeof approvalId !== 'string') throw new Error('Fixture 未返回 approvalId');
    await expect(
      session.resolveApproval(approvalId, { optionId: 'invented-option' }),
    ).rejects.toMatchObject({ code: 'APPROVAL_OPTION_INVALID' });
    await session.resolveApproval(approvalId, { optionId: 'allow-once' });

    const afterApproval = await takeUntil(iterator, 'run.completed');
    const all = [...beforeApproval, ...afterApproval];
    expect(all.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'session.created',
        'run.started',
        'agent.plan.updated',
        'tool.call.started',
        'approval.requested',
        'approval.resolved',
        'tool.call.completed',
        'file.changed',
        'assistant.message.delta',
        'assistant.message.completed',
        'usage.updated',
        'run.completed',
      ]),
    );
    expect(all.map((event) => event.seq)).toEqual(
      Array.from({ length: all.length }, (_, index) => index + 1),
    );
  });

  it('session/close 挂起时仍在短 grace 后关闭 connection、process 与 event queue', async () => {
    const adapter = new AcpAdapter({ sessionCloseGraceMs: 10 });
    const session = await adapter.createSession({
      sessionId: 'hub-session-hanging-close',
      projectId: 'project-1',
      profile: hangingCloseProfile,
      cwd: process.cwd(),
    });
    openSessions.push(session);

    const startedAt = Date.now();
    await Promise.all([session.close(), session.close(), session.close()]);

    expect(Date.now() - startedAt).toBeLessThan(500);
    const iterator = session.events()[Symbol.asyncIterator]();
    const drained: NormalizedAgentEvent[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      drained.push(next.value);
    }
    expect(drained.map((event) => event.type)).toContain('session.closed');
  });
});
