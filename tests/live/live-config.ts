import { isAbsolute } from 'node:path';
import type { NormalizedAgentEvent, PreflightReport } from '../../packages/agent-core/src/index.js';

export const liveProviders = ['CODEX', 'CLAUDE_CODE', 'OPENCODE', 'HERMES', 'OPENCLAW'] as const;
export type LiveProvider = (typeof liveProviders)[number];
export const liveSuites = [
  'preflight',
  'codex-session',
  'discovery',
  'remote-node',
  'worktree',
] as const;
export type LiveSuite = (typeof liveSuites)[number];
export interface LiveSelection {
  provider: LiveProvider;
  suite: LiveSuite;
  credentialPath?: string;
}

/** Pure opt-in parsing: no filesystem, credential reads, process launch or defaults. */
export function readLiveSelection(env: NodeJS.ProcessEnv): LiveSelection | null {
  if (env.AGENTHUB_E2E_LIVE !== '1') return null;
  const provider = env.AGENTHUB_LIVE_PROVIDER;
  const suite = env.AGENTHUB_LIVE_SUITE;
  if (!liveProviders.includes(provider as LiveProvider) || !liveSuites.includes(suite as LiveSuite))
    throw new Error('LIVE_CONFIG_INVALID: explicit supported provider and suite are required');
  if (suite !== 'preflight' && provider !== 'CODEX')
    throw new Error('LIVE_CONFIG_INVALID: this lifecycle suite supports CODEX only');
  const credentialPath = env.AGENTHUB_LIVE_CREDENTIAL_PATH;
  if (
    credentialPath !== undefined &&
    (!isAbsolute(credentialPath) || credentialPath.includes('\0'))
  )
    throw new Error('LIVE_CONFIG_INVALID: credential reference must be an absolute path');
  if (suite !== 'preflight' && env.AGENTHUB_LIVE_ALLOW_LEGACY_ENV !== '1')
    throw new Error(
      'LIVE_CONFIG_INVALID: legacy suites require explicit inherited-environment risk opt-in',
    );
  if (suite !== 'preflight' && !credentialPath)
    throw new Error(
      'LIVE_CONFIG_INVALID: legacy Codex suite requires an explicit credential reference',
    );
  return {
    provider: provider as LiveProvider,
    suite: suite as LiveSuite,
    ...(credentialPath ? { credentialPath } : {}),
  };
}

export function selectedLiveSuite(
  selection: LiveSelection | null,
  provider: LiveProvider,
  suite: LiveSuite,
) {
  return selection?.provider === provider && selection.suite === suite;
}

/** No raw report, paths, versions, repair commands or provider messages are retained. */
export function preflightEvidence(
  provider: LiveProvider,
  report: PreflightReport,
  cleanupConfirmed: boolean,
) {
  const required = { process: 'PASS', initialize: 'PASS', session: 'SKIP' } as const;
  const passed =
    report.status === 'READY' &&
    cleanupConfirmed &&
    Object.entries(required).every(
      ([id, status]) =>
        report.checks.filter((check) => check.id === id).length === 1 &&
        report.checks.some((check) => check.id === id && check.status === status),
    );
  return {
    provider,
    scope: 'LOCAL_HOST_PROTOCOL_ONLY' as const,
    smokeSession: false as const,
    outcome: passed ? ('PASSED' as const) : ('UNCONFIRMED' as const),
    cleanupConfirmed,
    sessionLifecycleVerified: false as const,
    cancellationVerified: false as const,
  };
}

export function cancellationConfirmed(events: NormalizedAgentEvent[], runId: string): boolean {
  return events.some((event) => event.runId === runId && event.type === 'run.cancelled');
}

/** Legacy provider environment remains opt-in and non-isolated; persistent DB is never inherited. */
export function legacyFixtureEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, DATABASE_URL: undefined };
}

/** Legacy diagnostics are private provider output; test reporters receive failure, not raw data. */
export function publicLiveCallback<T extends unknown[], R>(
  operation: (...args: T) => Promise<R>,
): (...args: T) => Promise<R> {
  return async (...args: T) => {
    try {
      return await operation(...args);
    } catch {
      throw new Error(
        'LIVE_OPERATION_FAILED: provider operation or cleanup unconfirmed; raw diagnostics withheld',
      );
    }
  };
}
