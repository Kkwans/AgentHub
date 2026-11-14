import { AcpAdapter } from '../../packages/adapter-acp/src/index.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  legacyFixtureEnvironment,
  readLiveSelection,
  selectedLiveSuite,
  preflightEvidence,
  cancellationConfirmed,
  liveProviders,
} from '../live/live-config.js';
import {
  runProtocolProbe,
  publicProbeFailure,
  isolatedProbeLauncher,
  readProbeCommand,
} from '../live/protocol-probe.js';
import type {
  AgentProfile,
  PreflightReport,
  NormalizedAgentEvent,
} from '../../packages/agent-core/src/index.js';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('default and unrelated environment cannot enable live work', () => {
  expect(readLiveSelection({})).toBeNull();
  expect(readLiveSelection({ AGENTHUB_LIVE_PROVIDER: 'CODEX' })).toBeNull();
  expect(() => readLiveSelection({ AGENTHUB_E2E_LIVE: '1' })).toThrow('LIVE_CONFIG_INVALID');
});
it.each(liveProviders)(
  '%s can select only explicit protocol scope without defaults',
  (provider) => {
    const selected = readLiveSelection({
      AGENTHUB_E2E_LIVE: '1',
      AGENTHUB_LIVE_PROVIDER: provider,
      AGENTHUB_LIVE_SUITE: 'preflight',
    });
    expect(selected).toEqual({ provider, suite: 'preflight' });
    expect(selectedLiveSuite(selected, 'CODEX', 'codex-session')).toBe(false);
  },
);
it('legacy requires provider, scope, credential reference and environment risk opt-in', () => {
  const env = {
    AGENTHUB_E2E_LIVE: '1',
    AGENTHUB_LIVE_PROVIDER: 'CODEX',
    AGENTHUB_LIVE_SUITE: 'discovery',
  };
  expect(() => readLiveSelection(env)).toThrow();
  expect(() => readLiveSelection({ ...env, AGENTHUB_LIVE_ALLOW_LEGACY_ENV: '1' })).toThrow();
  const selection = readLiveSelection({
    ...env,
    AGENTHUB_LIVE_ALLOW_LEGACY_ENV: '1',
    AGENTHUB_LIVE_CREDENTIAL_PATH: '/explicit/test-auth.json',
  });
  expect(selectedLiveSuite(selection, 'CODEX', 'discovery')).toBe(true);
  expect(selectedLiveSuite(selection, 'CODEX', 'worktree')).toBe(false);
});
it('rejects invalid provider, paths and secret-bearing arguments without echoing inputs', () => {
  expect(() => readProbeCommand({ AGENTHUB_LIVE_EXECUTABLE: 'relative' })).toThrow();
  for (const args of [
    ['--token', 'secret-marker'],
    ['--password=secret-marker'],
    ['arbitrary-secret'],
  ]) {
    expect(() =>
      readProbeCommand({
        AGENTHUB_LIVE_EXECUTABLE: '/bin/probe',
        AGENTHUB_LIVE_ARGS_JSON: JSON.stringify(args),
      }),
    ).toThrow('only ACP protocol selector');
  }
  expect(
    readProbeCommand({
      AGENTHUB_LIVE_EXECUTABLE: '/bin/probe',
      AGENTHUB_LIVE_ARGS_JSON: '["acp"]',
    }),
  ).toEqual({ executable: '/bin/probe', args: ['acp'] });
});
it('evidence never promotes absent/contradictory/unclean reports or exports provider text', () => {
  const report: PreflightReport = {
    status: 'READY',
    checkedAt: 'private-marker',
    detectedVersion: 'secret-marker',
    checks: [
      { id: 'process', status: 'PASS', label: 'private', message: 'private' },
      { id: 'initialize', status: 'PASS', label: 'private', message: 'private' },
      { id: 'session', status: 'SKIP', label: 'private', message: 'private' },
    ],
  };
  expect(preflightEvidence('CODEX', report, true).outcome).toBe('PASSED');
  expect(JSON.stringify(preflightEvidence('CODEX', report, true))).not.toMatch(/private|secret/);
  expect(preflightEvidence('CODEX', report, false).outcome).toBe('UNCONFIRMED');
  expect(preflightEvidence('CODEX', { ...report, checks: [] }, true).outcome).toBe('UNCONFIRMED');
  expect(
    preflightEvidence('CODEX', { ...report, checks: [...report.checks, report.checks[0]!] }, true)
      .outcome,
  ).toBe('UNCONFIRMED');
});
it('cancel notification/other run/completion never establishes cancellation', () => {
  const event = (type: string, runId: string) => ({ type, runId }) as NormalizedAgentEvent;
  expect(cancellationConfirmed([], 'a')).toBe(false);
  expect(
    cancellationConfirmed([event('run.completed', 'a'), event('run.cancelled', 'b')], 'a'),
  ).toBe(false);
  expect(cancellationConfirmed([event('run.cancelled', 'a')], 'a')).toBe(true);
});
it('controlled Node child receives isolated HOME/cwd but not host secret or auth environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agenthub-probe-contract-'));
  vi.stubEnv('AGENTHUB_TEST_HOST_SECRET', 'never-forward-marker');
  vi.stubEnv('OPENAI_API_KEY', 'test-only-host-marker');
  try {
    const profile = {
      launchSpec: {
        kind: 'HOST_PROCESS',
        executable: process.execPath,
        args: [
          '-e',
          'process.stdout.write(JSON.stringify({home:process.env.HOME,cwd:process.cwd(),secret:process.env.AGENTHUB_TEST_HOST_SECRET,key:process.env.OPENAI_API_KEY}))',
        ],
      },
    } as AgentProfile;
    const child = await isolatedProbeLauncher(root).launch(profile, root);
    let output = '';
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    const result = await child.wait();
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output)).toEqual({ home: root, cwd: root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('public probe failure never exposes nested provider cause', () => {
  const failure = Object.assign(new Error('secret-marker', { cause: new Error('secret-marker') }), {
    code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED',
  });
  const safe = publicProbeFailure(failure);
  expect(safe.message).toContain('LIVE_PROBE_CLEANUP_UNCONFIRMED');
  expect(safe.cause).toBeUndefined();
  expect(String(safe)).not.toContain('secret-marker');
});

it('legacy fixture never inherits a persistent database URL', () => {
  const env = { DATABASE_URL: 'postgres://secret-marker', CODEX_HOME: '/explicit-home' };
  expect(legacyFixtureEnvironment(env)).toEqual({
    DATABASE_URL: undefined,
    CODEX_HOME: '/explicit-home',
  });
  expect(env.DATABASE_URL).toBe('postgres://secret-marker');
});

it('legacy callback rejects without leaking assertions, subprocess causes or provider messages', async () => {
  const { publicLiveCallback } = await import('../live/live-config.js');
  const operation = publicLiveCallback(async () => {
    throw Object.assign(new Error('secret-marker', { cause: new Error('private-command') }), {
      actual: 'raw-provider',
    });
  });
  const failure = await operation().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain('LIVE_OPERATION_FAILED');
  expect((failure as Error).cause).toBeUndefined();
  expect(JSON.stringify(failure)).not.toMatch(/secret|private-command|raw-provider/);
});

it.each([
  'agent-preflight.test.ts',
  'discovery-codex.live.test.ts',
  'remote-node.live.test.ts',
  'worktree-runner.live.test.ts',
])(
  '%s wires opt-in and reporting boundaries without machine-specific credentials',
  async (file) => {
    const source = await readFile(new URL(`../live/${file}`, import.meta.url), 'utf8');
    expect(source).toContain('readLiveSelection(process.env)');
    expect(source).toContain('selectedLiveSuite(selection,');
    expect(source).toContain('publicLiveCallback(async');
    expect(source).not.toContain('/home/Kkwans');
    expect(source).not.toContain('expect(true).toBe(true)');
    expect(source).not.toContain('withContainer(');
    if (file !== 'agent-preflight.test.ts')
      expect(source).toContain('...legacyFixtureEnvironment(process.env)');
  },
);

it.each(liveProviders)(
  '%s probe selects strict non-smoke profile using mock only',
  async (provider) => {
    const preflight = vi.spyOn(AcpAdapter.prototype, 'preflight').mockResolvedValue({
      status: 'READY',
      checkedAt: '2026-11-14T00:00:00Z',
      checks: [
        { id: 'process', status: 'PASS', label: '', message: '' },
        { id: 'initialize', status: 'PASS', label: '', message: '' },
        { id: 'session', status: 'SKIP', label: '', message: '' },
      ],
    });
    const evidence = await runProtocolProbe(
      provider,
      { executable: '/not-launched/mock', args: ['acp'] },
      '/isolated/home',
      '/isolated/work',
    );
    expect(preflight).toHaveBeenCalledWith(
      expect.objectContaining({
        agentKind: provider,
        targetKind: 'LOCAL_HOST',
        config: {
          preflightCwd: '/isolated/work',
          preflightSession: false,
          preflightStrictCleanup: true,
        },
      }),
    );
    expect(evidence).toMatchObject({
      outcome: 'PASSED',
      sessionLifecycleVerified: false,
      cancellationVerified: false,
    });
  },
);
it('probe rejects uncertain cleanup with fixed diagnostics rather than success evidence', async () => {
  vi.spyOn(AcpAdapter.prototype, 'preflight').mockRejectedValue(
    Object.assign(new Error('private-marker'), { code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED' }),
  );
  await expect(
    runProtocolProbe(
      'CODEX',
      { executable: '/not-launched/mock', args: [] },
      '/isolated/home',
      '/isolated/work',
    ),
  ).rejects.toThrow('LIVE_PROBE_CLEANUP_UNCONFIRMED');
});
