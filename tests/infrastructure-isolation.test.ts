import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentHubDatabase,
  AgentRepository,
  ExecutionTargetRepository,
} from '../packages/db/dist/index.js';
import type * as AgentCore from '../packages/agent-core/dist/index.js';
import { runProcess } from '../packages/agent-core/dist/index.js';
import { AgentService } from '../apps/server/src/agents/agent-service.js';
import {
  infrastructureChildLaunch,
  infrastructureEnvironment,
} from './e2e-real/infrastructure-isolation.js';

vi.mock('../packages/agent-core/dist/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof AgentCore>()),
  runProcess: vi.fn(() => {
    throw new Error('Unexpected diagnostic command');
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('infrastructure diagnostic test isolation (not an OS sandbox)', () => {
  it('does not inherit runner credentials, CLI lookup, hooks or config overrides', () => {
    const forbidden = [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'SSH_AUTH_SOCK',
      'DATABASE_URL',
      'NODE_OPTIONS',
      'HTTP_PROXY',
      'CODEX_CONFIG',
      'AGENTHUB_CODEX_PROXY_URL',
    ];
    for (const key of forbidden) vi.stubEnv(key, 'synthetic-host-secret');
    vi.stubEnv('PATH', '/synthetic/host-cli');
    vi.stubEnv('DOCKER_SOCKET_PATH', '/synthetic/host-docker.sock');
    vi.stubEnv('HOME', '/synthetic/host-home');
    vi.stubEnv('CODEX_HOME', '/synthetic/host-codex');
    const env = infrastructureEnvironment('/tmp/isolation', '/tmp/web');
    for (const key of forbidden) expect(env).not.toHaveProperty(key);
    expect(JSON.stringify(env)).not.toContain('synthetic');
    expect(env.PATH).toBe('/tmp/isolation/empty-bin');
    expect(env.DOCKER_SOCKET_PATH).toBe('/tmp/isolation/absent-docker.sock');
    for (const key of [
      'HOME',
      'CODEX_HOME',
      'XDG_CONFIG_HOME',
      'XDG_CACHE_HOME',
      'XDG_DATA_HOME',
      'TMPDIR',
    ])
      expect(env[key]).toMatch(/^\/tmp\/isolation\//);
    const launch = infrastructureChildLaunch('/tmp/isolation', '/tmp/web', '/tmp/entry.mjs');
    expect(launch).toMatchObject({
      executable: process.execPath,
      args: ['/tmp/entry.mjs'],
      shell: false,
      env,
    });
    expect(() => infrastructureEnvironment('relative', '/tmp/web')).toThrow();
    expect(() => infrastructureChildLaunch('/tmp/isolation', '/tmp/web', 'relative')).toThrow();
  });

  it('real diagnostic implementation with empty PATH starts no process or Provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-infra-isolation-'));
    try {
      const env = infrastructureEnvironment(root, join(root, 'web'));
      await mkdir(env.PATH!);
      expect(await readdir(env.PATH!)).toEqual([]);
      const launch = vi.fn(async () => {
        throw new Error('Unexpected Provider launch');
      });
      // Diagnostics needs no repository methods; fail immediately on accidental data access.
      const unavailable = new Proxy(
        {},
        {
          get: () => {
            throw new Error('Unexpected repository access');
          },
        },
      );
      const service = new AgentService(
        unavailable as AgentRepository<AgentHubDatabase>,
        unavailable as ExecutionTargetRepository<AgentHubDatabase>,
        { launch },
        undefined,
        undefined,
        async () => env,
      );
      const report = await service.hostDiagnostics();
      expect(report.opencode).toMatchObject({ status: 'MISSING' });
      expect(report.codex).not.toHaveProperty('runtimeExecutable');
      expect(report.codex).not.toHaveProperty('auth');
      // The bundled adapter can still be INSTALLED: access checks are not Provider execution.
      expect(report.codex).toHaveProperty('pinnedPackage');
      expect(runProcess).not.toHaveBeenCalled();
      expect(launch).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: false });
    }
  });
  it('positive control intercepts both discovered CLI calls at the real service import boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-infra-positive-'));
    try {
      const env = infrastructureEnvironment(root, join(root, 'web'));
      await mkdir(env.PATH!);
      const executable = join(env.PATH!, 'codex');
      // X_OK lookup sentinel, deliberately not a valid executable or shell script.
      // No Provider binary or credential is used even if the mock boundary regresses.
      await writeFile(executable, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0]), { mode: 0o700 });
      const result = {
        exitCode: 0,
        signal: null,
        stdout: 'synthetic diagnostic',
        stderr: '',
        truncated: false,
        timedOut: false,
        canceled: false,
        durationMs: 0,
      };
      vi.mocked(runProcess).mockResolvedValueOnce(result).mockResolvedValueOnce(result);
      const launch = vi.fn(async () => {
        throw new Error('Unexpected Provider launch');
      });
      const unavailable = new Proxy(
        {},
        {
          get: () => {
            throw new Error('Unexpected repository access');
          },
        },
      );
      const service = new AgentService(
        unavailable as AgentRepository<AgentHubDatabase>,
        unavailable as ExecutionTargetRepository<AgentHubDatabase>,
        { launch },
        undefined,
        undefined,
        async () => env,
      );
      const report = await service.hostDiagnostics();
      expect(runProcess).toHaveBeenCalledTimes(2);
      expect(runProcess).toHaveBeenNthCalledWith(1, {
        executable,
        args: ['--version'],
        env,
        timeoutMs: 10_000,
        maxOutputBytes: 64_000,
      });
      expect(runProcess).toHaveBeenNthCalledWith(2, {
        executable,
        args: ['login', 'status'],
        env,
        timeoutMs: 10_000,
        maxOutputBytes: 64_000,
      });
      expect(report.codex).toMatchObject({
        runtimeExecutable: executable,
        version: 'synthetic diagnostic',
        auth: 'synthetic diagnostic',
      });
      expect(launch).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: false });
    }
  });
});
