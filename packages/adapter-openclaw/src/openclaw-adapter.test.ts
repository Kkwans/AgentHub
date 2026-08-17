import {
  NO_AGENT_CAPABILITIES,
  type AgentProfile,
  type AgentRuntimeAdapter,
  type CreateAgentSessionInput,
  type PreflightReport,
  type ProcessResult,
} from '@agenthub/agent-core';
import { describe, expect, it } from 'vitest';

import { OpenClawAdapter, type OpenClawExecLauncher } from './index.js';

const profile: AgentProfile = {
  id: 'openclaw-test',
  name: 'OpenClaw',
  agentKind: 'OPENCLAW',
  adapterKind: 'OPENCLAW_GATEWAY',
  targetKind: 'DOCKER_CONTAINER',
  launchSpec: {
    kind: 'DOCKER_EXEC',
    containerName: 'openclaw',
    expectedContainerId: 'a'.repeat(64),
    command: 'openclaw',
    args: ['acp'],
    startPolicy: 'MANUAL',
    workspaceMappings: [{ hostRoot: '/workspace', containerRoot: '/workspace' }],
  },
  config: { preflightCwd: '/workspace' },
};

describe('OpenClaw adapter', () => {
  it('ACP 已初始化但显式要求 exec 时切到已验证的单回合能力', async () => {
    const adapter = new OpenClawAdapter({
      primary: new ReadyPrimary(),
      exec: new SuccessfulExec(),
      preferExec: true,
    });

    const report = await adapter.preflight(profile);
    expect(report).toMatchObject({
      status: 'READY',
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'openclaw-exec-fallback',
          status: 'WARN',
          message: expect.stringContaining('ACP 版本未回传 Prompt 终态'),
        }),
      ]),
    });
    const session = await adapter.createSession({
      sessionId: 'session-forced-exec',
      projectId: 'project-1',
      profile,
      cwd: '/workspace',
    });
    expect(session.getConfiguration).toBeUndefined();
    await session.close();
  });

  it('ACP 失败且 agent exec 可用时降级为明确的单回合能力', async () => {
    const adapter = new OpenClawAdapter({
      primary: new BrokenPrimary(),
      exec: new SuccessfulExec(),
      now: () => new Date('2026-08-09T00:00:00.000Z'),
    });

    const report = await adapter.preflight(profile);
    const capabilities = await adapter.getCapabilities(profile);
    expect(report).toMatchObject({
      status: 'READY',
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'openclaw-exec-fallback', status: 'WARN' }),
      ]),
    });
    expect(capabilities.interaction).toEqual({
      streaming: false,
      approvals: false,
      questions: false,
      plan: false,
    });

    const session = await adapter.createSession({
      sessionId: 'session-1',
      projectId: 'project-1',
      profile,
      cwd: '/workspace',
    });
    expect(session.getConfiguration).toBeUndefined();
    expect(session.setConfiguration).toBeUndefined();
    const iterator = session.events()[Symbol.asyncIterator]();
    await session.sendTurn({ runId: 'run-1', text: '执行测试' });
    const types: string[] = [];
    while (!types.includes('run.completed')) {
      const event = await iterator.next();
      if (event.done) break;
      types.push(event.value.type);
    }
    expect(types).toEqual([
      'session.created',
      'run.started',
      'assistant.message.completed',
      'run.completed',
    ]);
    await session.close();
  });

  it('容器停止时不尝试 exec 回退', async () => {
    const exec = new CountingExec();
    const adapter = new OpenClawAdapter({ primary: new StoppedPrimary(), exec });
    const report = await adapter.preflight(profile);
    expect(report.status).toBe('STOPPED');
    expect(exec.probes).toBe(0);
  });
});

class BrokenPrimary implements AgentRuntimeAdapter {
  readonly kind = 'ACP_STDIO';
  async preflight(): Promise<PreflightReport> {
    return {
      status: 'BROKEN' as const,
      checkedAt: '2026-08-09T00:00:00.000Z',
      checks: [
        { id: 'initialize', label: 'ACP initialize', status: 'FAIL' as const, message: '失败' },
      ],
    };
  }
  async getCapabilities() {
    return NO_AGENT_CAPABILITIES;
  }
  createSession(_input: CreateAgentSessionInput): Promise<never> {
    throw new Error('不应调用 primary');
  }
}

class ReadyPrimary extends BrokenPrimary {
  override async preflight(): Promise<PreflightReport> {
    return {
      status: 'READY',
      checkedAt: '2026-08-09T00:00:00.000Z',
      checks: [
        { id: 'initialize', label: 'ACP initialize', status: 'PASS', message: '已启动' },
      ],
    };
  }
}

class StoppedPrimary extends BrokenPrimary {
  override async preflight(): Promise<PreflightReport> {
    return {
      status: 'STOPPED' as const,
      checkedAt: '2026-08-09T00:00:00.000Z',
      checks: [{ id: 'target', label: '容器', status: 'FAIL' as const, message: '已停止' }],
    };
  }
}

class SuccessfulExec implements OpenClawExecLauncher {
  async probe() {
    return { available: true, version: 'test', message: '回退可用' };
  }
  async launch() {
    const result: ProcessResult = {
      exitCode: 0,
      signal: null,
      stdout: 'OpenClaw 已完成',
      stderr: '',
      truncated: false,
      timedOut: false,
      canceled: false,
      durationMs: 1,
    };
    return { wait: async () => result, cancel: async () => ({ ...result, canceled: true }) };
  }
}

class CountingExec extends SuccessfulExec {
  probes = 0;
  override async probe() {
    this.probes += 1;
    return super.probe();
  }
}
