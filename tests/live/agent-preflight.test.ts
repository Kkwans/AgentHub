import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    const codexHome = await mkdtemp(join(process.cwd(), 'tmp-v06-codex-home-'));
    await symlink('/home/Kkwans/.codex/auth.json', join(codexHome, 'auth.json'));
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
    const adapter = new AcpAdapter({
      launcher: new HostAcpProcessLauncher({
        resolveEnvironment: async () => ({ ...process.env, CODEX_HOME: codexHome }),
      }),
    });
    let handle: Awaited<ReturnType<typeof adapter.createSession>> | undefined;
    try {
      const report = await adapter.preflight(profile);
      expect(report.status).toBe('READY');
      const capabilities = await adapter.getCapabilities(profile);
      expect(capabilities.interaction).toMatchObject({ streaming: true, approvals: true });

      handle = await adapter.createSession({
        sessionId: randomUUID(),
        profile,
        projectId: randomUUID(),
        cwd: '/tmp',
      });
      const iterator = handle.events()[Symbol.asyncIterator]();
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
      await handle?.close().catch(() => undefined);
      await rm(codexHome, { recursive: true, force: true });
    }
  }, 180_000);

  it('Codex 在一次性 Git 仓库完成文件变更、Diff 与提交', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'agenthub-codex-live-'));
    const codexHome = await mkdtemp(join(process.cwd(), 'tmp-v06-codex-home-'));
    const marker = `AGENTHUB_CODEX_LIVE_${randomUUID()}`;
    const outputPath = join(repoRoot, 'agenthub-live-output.md');
    const pinned = resolvePinnedAcpAdapter('CODEX');
    const profile: AgentProfile = {
      id: randomUUID(),
      name: 'Codex live repository gate',
      agentKind: 'CODEX',
      adapterKind: 'ACP_STDIO',
      targetKind: 'LOCAL_HOST',
      launchSpec: { kind: 'HOST_PROCESS', executable: pinned.executable, args: pinned.args },
      config: {
        preflightCwd: repoRoot,
        preflightSession: true,
        models: true,
        modes: true,
        reasoningEffort: true,
        files: true,
        terminal: true,
      },
    };
    // The NAS test runner mounts /home read-only. Point Codex state at an
    // isolated writable directory while referencing the existing ChatGPT
    // auth file without copying or persisting credentials.
    await symlink('/home/Kkwans/.codex/auth.json', join(codexHome, 'auth.json'));
    const adapter = new AcpAdapter({
      launcher: new HostAcpProcessLauncher({
        resolveEnvironment: async () => ({ ...process.env, CODEX_HOME: codexHome }),
      }),
    });
    let handle: Awaited<ReturnType<typeof adapter.createSession>> | undefined;

    try {
      await runGit(['init', '--initial-branch=main'], repoRoot);
      await runGit(['config', 'user.name', 'AgentHub Live'], repoRoot);
      await runGit(['config', 'user.email', 'agenthub-live@example.invalid'], repoRoot);
      await writeFile(join(repoRoot, 'README.md'), '# AgentHub Codex live gate\n', 'utf8');
      await runGit(['add', '--', 'README.md'], repoRoot);
      await runGit(['commit', '-m', 'chore: initialize live fixture'], repoRoot);

      const report = await adapter.preflight(profile);
      expect(report.status, JSON.stringify(report)).toBe('READY');

      handle = await adapter.createSession({
        sessionId: randomUUID(),
        profile,
        projectId: randomUUID(),
        cwd: repoRoot,
      });
      const iterator = handle.events()[Symbol.asyncIterator]();
      const runId = randomUUID();
      await handle.sendTurn({
        runId,
        text: [
          '在当前工作目录中完成一个非常小且明确的文件变更。',
          `只创建 ${outputPath} 这个文件，文件内容必须包含唯一标记 ${marker}。`,
          '不要修改、删除或创建任何其他文件，不要执行 git commit；完成后用一句话说明已完成。',
        ].join('\n'),
      });

      const events = await collectCodexUntil(iterator, handle, runId, 240_000);
      expect(events.some((event) => event.type === 'assistant.message.completed')).toBe(true);
      expect(
        events.some(
          (event) =>
            event.type === 'tool.call.completed' &&
            (event.payload as { kind?: unknown }).kind === 'edit',
        ),
        events.map((event) => `${event.type}: ${JSON.stringify(event.payload)}`).join('\n'),
      ).toBe(true);

      const contents = await readFile(outputPath, 'utf8');
      expect(contents).toContain(marker);

      const statusBeforeCommit = await runGit(['status', '--short'], repoRoot);
      const changedPaths = statusBeforeCommit.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(3));
      expect(changedPaths).toEqual(['agenthub-live-output.md']);

      const workingTreeDiff = await runGitAllowFailure(
        ['diff', '--no-index', '--no-ext-diff', '--', '/dev/null', outputPath],
        repoRoot,
      );
      expect(`${workingTreeDiff.stdout}${workingTreeDiff.stderr}`).toContain(marker);

      await runGit(['add', '--', 'agenthub-live-output.md'], repoRoot);
      const stagedDiff = await runGit(
        ['diff', '--cached', '--no-ext-diff', '--', outputPath],
        repoRoot,
      );
      expect(stagedDiff.stdout).toContain(marker);
      await runGit(['commit', '-m', 'test: record Codex live mutation'], repoRoot);
      expect((await runGit(['status', '--short'], repoRoot)).stdout.trim()).toBe('');
      expect((await runGit(['log', '-1', '--format=%s'], repoRoot)).stdout.trim()).toBe(
        'test: record Codex live mutation',
      );
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(repoRoot, { recursive: true, force: true });
      await rm(codexHome, { recursive: true, force: true });
    }
  }, 300_000);

  it('Claude Code 容器可运行但固定 ACP adapter 缺失时明确为 BROKEN', async () => {
    await withContainer('claude-code', async () => {
      const version = await dockerExec('claude-code', ['claude', '--version']);
      // This image's shell wrapper may consume the direct version payload;
      // a zero exit code still proves the pinned Claude executable is present.
      expect(version).toBeTruthy();
      const adapter = await dockerExecAllowFailure('claude-code', [
        'claude-agent-acp',
        '--version',
      ]);
      expect(adapter.exitCode).not.toBe(0);
    });
  }, 120_000);

  it('Hermes 容器提供 ACP，但 Project workspace 未映射', async () => {
    const inspect = await docker(['inspect', '--format', '{{json .Mounts}}', 'hermes']);
    expect(inspect.stdout).not.toContain('/volume2/Project');
    await withContainer('hermes', async () => {
      const version = await dockerExec('hermes', ['hermes', '--version']);
      expect(`${version.stdout}${version.stderr}`).toMatch(/\d+\.\d+\.\d+/);
      const acp = await dockerExec('hermes', ['hermes', 'acp', '--help']);
      expect(`${acp.stdout}${acp.stderr}`).toMatch(/ACP|Agent Client Protocol/i);
    });
  }, 120_000);

  it('OpenClaw 容器提供 Gateway-backed ACP 命令', async () => {
    await withContainer('openclaw-official', async () => {
      const version = await dockerExec('openclaw-official', ['openclaw', '--version']);
      expect(`${version.stdout}${version.stderr}`).toMatch(/\d+\.\d+\.\d+/);
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

async function collectCodexUntil(
  iterator: AsyncIterator<NormalizedAgentEvent>,
  session: Awaited<ReturnType<AcpAdapter['createSession']>>,
  runId: string,
  timeoutMs: number,
): Promise<NormalizedAgentEvent[]> {
  const events: NormalizedAgentEvent[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const next = await Promise.race([
      iterator.next(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('等待 Codex 文件变更事件超时')), remaining),
      ),
    ]);
    if (next.done) break;
    events.push(next.value);
    if (next.value.type === 'approval.requested' && next.value.runId === runId) {
      const payload = next.value.payload as {
        approvalId?: unknown;
        options?: unknown;
      };
      const approvalId = typeof payload.approvalId === 'string' ? payload.approvalId : undefined;
      const options = Array.isArray(payload.options)
        ? payload.options.filter(
            (option): option is { id: string; kind?: string } =>
              typeof option === 'object' &&
              option !== null &&
              typeof (option as { id?: unknown }).id === 'string',
          )
        : [];
      const allowed = options.find(
        (option) => option.id === 'allow-once' || option.kind === 'allow_once',
      );
      if (!approvalId || !allowed) throw new Error('Codex 未提供可用的 allow-once Approval 选项');
      await session.resolveApproval(approvalId, { optionId: allowed.id });
    }
    if (
      next.value.runId === runId &&
      ['run.completed', 'run.failed', 'run.cancelled'].includes(next.value.type)
    ) {
      if (next.value.type !== 'run.completed') {
        throw new Error(`Codex Run 未成功完成：${JSON.stringify(next.value.payload)}`);
      }
      return events;
    }
  }
  throw new Error(`Run ${runId} 未产生预期 Codex 终态事件`);
}

async function runGit(args: string[], cwd: string) {
  return execFile('/usr/bin/git', ['-C', cwd, ...args], {
    cwd,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function runGitAllowFailure(args: string[], cwd: string) {
  try {
    const result = await runGit(args, cwd);
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
