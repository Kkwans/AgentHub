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

const transportWarningProfile: AgentProfile = {
  ...profile,
  id: 'acp-fixture-transport-warning',
  launchSpec: {
    kind: 'HOST_PROCESS',
    executable: process.execPath,
    args: [fixturePath, '--transport-warning'],
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
    expect(capabilities.configuration.modelOptions).toEqual([
      { id: 'fixture-model', label: 'Fixture Model' },
      { id: 'fixture-model-2', label: 'Fixture Model 2' },
    ]);
    expect(capabilities.configuration.modeOptions).toEqual([
      { id: 'read-only', label: 'Read-only', description: '只读模式' },
      { id: 'agent', label: 'Agent', description: '执行模式' },
      { id: 'default', label: 'Default' },
      { id: 'plan', label: 'Plan', description: '规划模式' },
    ]);
    expect(capabilities.configuration.reasoningEffortOptions).toEqual([
      { id: 'low', label: 'Low' },
      { id: 'high', label: 'High' },
    ]);
  });

  it('归一化 stream/tool/permission/file/usage 并完成 Run', async () => {
    const adapter = new AcpAdapter();
    const session = await adapter.createSession({
      sessionId: 'hub-session-1',
      projectId: 'project-1',
      profile,
      cwd: process.cwd(),
      model: 'fixture-model',
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

  it('读取并动态切换 Session model/mode/推理强度，拒绝无效选项', async () => {
    const adapter = new AcpAdapter();
    const session = await adapter.createSession({
      sessionId: 'hub-session-configuration',
      projectId: 'project-1',
      profile,
      cwd: process.cwd(),
      mode: 'plan',
    });
    openSessions.push(session);

    await expect(session.getConfiguration?.()).resolves.toMatchObject({
      supported: true,
      current: { model: 'fixture-model', mode: 'plan' },
    });
    await expect(session.setConfiguration?.({ mode: 'agent' })).resolves.toMatchObject({
      current: { mode: 'agent' },
    });
    await expect(session.setConfiguration?.({ model: 'fixture-model-2' })).resolves.toMatchObject({
      current: { model: 'fixture-model-2' },
    });
    await expect(session.setConfiguration?.({ reasoningEffort: 'high' })).resolves.toMatchObject({
      current: { reasoningEffort: 'high' },
    });
    await expect(
      session.setConfiguration?.({ reasoningEffort: 'missing-effort' }),
    ).rejects.toMatchObject({
      code: 'SESSION_REASONING_EFFORT_UNSUPPORTED',
    });
    await expect(session.setConfiguration?.({ mode: 'missing-mode' })).rejects.toMatchObject({
      code: 'SESSION_MODE_UNSUPPORTED',
    });
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

  it('把 Codex transport warning 归类为失败而不是误报 completed', async () => {
    const adapter = new AcpAdapter();
    const session = await adapter.createSession({
      sessionId: 'hub-session-transport-warning',
      projectId: 'project-1',
      profile: transportWarningProfile,
      cwd: process.cwd(),
    });
    openSessions.push(session);
    const iterator = session.events()[Symbol.asyncIterator]();
    await session.sendTurn({ runId: 'run-transport-warning', text: '测试网络失败' });

    const events = await takeUntil(iterator, 'run.failed');
    const failed = events.at(-1);
    expect(failed).toMatchObject({
      type: 'run.failed',
      payload: {
        code: 'AGENT_TRANSPORT_FAILED',
        message: expect.stringContaining('[已隐藏地址]'),
      },
    });
    expect(events.some((event) => event.type === 'run.completed')).toBe(false);
  });
});
