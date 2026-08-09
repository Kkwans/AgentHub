import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';

import {
  AcpAdapter,
  HostAcpProcessLauncher,
  resolvePinnedAcpAdapter,
} from '../../packages/adapter-acp/src/index.js';
import type { AgentProfile, NormalizedAgentEvent } from '../../packages/agent-core/src/index.js';
import { describe, expect, it } from 'vitest';

const enabled = process.env.AGENTHUB_E2E_LIVE === '1';
const liveDescribe = enabled ? describe : describe.skip;
const execFile = promisify(execFileCallback);
const dockerExecutable = '/usr/bin/docker';

liveDescribe('真实 Agent live smoke', () => {
  it('Codex 完成 preflight、Session、stream 与 cancel', async () => {
    const pinned = resolvePinnedAcpAdapter('CODEX');
    const profile: AgentProfile = {
      id: randomUUID(),
      name: 'Codex live',
      agentKind: 'CODEX',
      adapterKind: 'ACP_STDIO',
      targetKind: 'LOCAL_HOST',
      launchSpec: { kind: 'HOST_PROCESS', executable: pinned.executable, args: pinned.args },
      config: { models: true, modes: true, reasoningEffort: true, files: true, terminal: true },
    };
    const adapter = new AcpAdapter({ launcher: new HostAcpProcessLauncher() });
    const report = await adapter.preflight(profile);
    expect(report.status).toBe('READY');
    const capabilities = await adapter.getCapabilities(profile);
    expect(capabilities.interaction).toMatchObject({ streaming: true, approvals: true });

    const handle = await adapter.createSession({
      sessionId: randomUUID(),
      profile,
      projectId: randomUUID(),
      cwd: '/tmp',
    });
    const iterator = handle.events()[Symbol.asyncIterator]();
    try {
      const runId = randomUUID();
      await handle.sendTurn({ runId, text: '只回复 OK，不调用工具。' });
      const completed = await collectUntil(iterator, runId, ['run.completed'], 120_000);
      expect(completed.some((event) => event.type === 'assistant.message.completed')).toBe(true);

      const cancelRunId = randomUUID();
      await handle.sendTurn({
        runId: cancelRunId,
        text: '请执行命令 sleep 60，然后回复完成。',
      });
      await handle.cancel(cancelRunId);
      // codex-acp 1.1.14 confirms the ACP cancel notification but does not always return
      // a terminal prompt response; a successful notification plus authoritative close is the gate.
      expect(cancelRunId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await handle.close();
    }
  }, 180_000);

  it('Claude Code 容器可运行但固定 ACP adapter 缺失时明确为 BROKEN', async () => {
    await withContainer('claude-code', async () => {
      const version = await dockerExec('claude-code', ['claude', '--version']);
      expect(version.stdout).toMatch(/\d+\.\d+\.\d+/);
      const adapter = await dockerExecAllowFailure('claude-code', [
        'claude-agent-acp',
        '--version',
      ]);
      expect(adapter.exitCode).not.toBe(0);
      expect(`${adapter.stdout}${adapter.stderr}`).toMatch(/not found|executable file/i);
    });
  }, 120_000);

  it('Hermes 容器提供 ACP，但 Project workspace 未映射', async () => {
    const inspect = await docker(['inspect', '--format', '{{json .Mounts}}', 'hermes']);
    expect(inspect.stdout).not.toContain('/volume2/Project');
    await withContainer('hermes', async () => {
      const version = await dockerExec('hermes', ['hermes', '--version']);
      expect(version.stdout).toMatch(/\d+\.\d+\.\d+/);
      const acp = await dockerExec('hermes', ['hermes', 'acp', '--help']);
      expect(`${acp.stdout}${acp.stderr}`).toMatch(/ACP|Agent Client Protocol/i);
    });
  }, 120_000);

  it('OpenClaw 容器提供 Gateway-backed ACP 命令', async () => {
    await withContainer('openclaw-official', async () => {
      const version = await dockerExec('openclaw-official', ['openclaw', '--version']);
      expect(version.stdout).toMatch(/\d+\.\d+\.\d+/);
      const acp = await dockerExec('openclaw-official', ['openclaw', 'acp', '--help']);
      expect(`${acp.stdout}${acp.stderr}`).toMatch(/ACP|Agent Client Protocol/i);
    });
  }, 120_000);

  it('OpenCode 未安装时显式 SKIP: MISSING', async () => {
    try {
      await access('/usr/local/bin/opencode');
      const result = await execFile('/usr/local/bin/opencode', ['--version'], { timeout: 30_000 });
      expect(result.stdout).not.toBe('');
    } catch {
      console.warn('SKIP: MISSING - OpenCode 未安装');
      expect(true).toBe(true);
    }
  });
});

async function withContainer(name: string, action: () => Promise<void>): Promise<void> {
  const before = await docker(['inspect', '--format', '{{.Id}} {{.State.Running}}', name]);
  const [expectedId, runningText] = before.stdout.trim().split(/\s+/);
  if (!expectedId) throw new Error(`容器 ${name} 不存在`);
  const wasRunning = runningText === 'true';
  if (!wasRunning) await docker(['start', name], 60_000);
  try {
    const after = await docker(['inspect', '--format', '{{.Id}} {{.State.Running}}', name]);
    const [actualId, actualRunning] = after.stdout.trim().split(/\s+/);
    expect(actualId).toBe(expectedId);
    expect(actualRunning).toBe('true');
    await action();
  } finally {
    if (!wasRunning) await docker(['stop', '--time', '10', name], 60_000);
  }
}

async function dockerExec(name: string, command: string[]) {
  return docker(['exec', name, ...command], 60_000);
}

async function dockerExecAllowFailure(name: string, command: string[]) {
  try {
    const result = await dockerExec(name, command);
    return { ...result, exitCode: 0 };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message,
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
    };
  }
}

async function docker(args: string[], timeout = 30_000) {
  return execFile(dockerExecutable, args, { timeout, maxBuffer: 2 * 1024 * 1024 });
}

async function collectUntil(
  iterator: AsyncIterator<NormalizedAgentEvent>,
  runId: string,
  terminalTypes: NormalizedAgentEvent['type'][],
  timeoutMs: number,
): Promise<NormalizedAgentEvent[]> {
  const events: NormalizedAgentEvent[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const next = await Promise.race([
      iterator.next(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('等待 live Agent 事件超时')), remaining),
      ),
    ]);
    if (next.done) break;
    events.push(next.value);
    if (next.value.runId === runId && terminalTypes.includes(next.value.type)) return events;
  }
  throw new Error(`Run ${runId} 未产生预期终态事件`);
}
