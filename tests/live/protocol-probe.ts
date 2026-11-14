import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSupervisedProcess, type AgentProfile } from '../../packages/agent-core/src/index.js';
import { AcpAdapter, type AcpProcessLauncher } from '../../packages/adapter-acp/src/index.js';
import { preflightEvidence, type LiveProvider } from './live-config.js';

export function readProbeCommand(env: NodeJS.ProcessEnv) {
  const executable = env.AGENTHUB_LIVE_EXECUTABLE;
  if (!executable || !isAbsolute(executable) || executable.includes('\0'))
    throw new Error('LIVE_CONFIG_INVALID: explicit absolute executable required');
  let args: unknown;
  try {
    args = JSON.parse(env.AGENTHUB_LIVE_ARGS_JSON ?? '[]');
  } catch {
    throw new Error('LIVE_CONFIG_INVALID: arguments must be a JSON array');
  }
  // Deliberately narrow protocol selectors, never token/password/custom command arguments.
  if (
    !Array.isArray(args) ||
    args.length > 3 ||
    args.some((arg) => !['acp', '--acp', '--stdio'].includes(arg))
  )
    throw new Error('LIVE_CONFIG_INVALID: only ACP protocol selector arguments are accepted');
  return { executable, args: args as string[] };
}

export function isolatedProbeLauncher(home: string): AcpProcessLauncher {
  return {
    async launch(profile, cwd) {
      if (profile.launchSpec.kind !== 'HOST_PROCESS') throw new Error('LIVE_HOST_ONLY');
      const process = spawnSupervisedProcess({
        executable: profile.launchSpec.executable,
        args: profile.launchSpec.args,
        cwd,
        inheritEnv: false,
        env: {
          HOME: home,
          XDG_CONFIG_HOME: home,
          XDG_CACHE_HOME: home,
          PATH: '/usr/bin:/bin',
          LANG: 'C.UTF-8',
        },
        captureStdout: false,
        maxOutputBytes: 1024 * 1024,
        cancelGraceMs: 2000,
      });
      return {
        stdin: process.child.stdin,
        stdout: process.child.stdout,
        wait: () => process.wait(),
        cancel: (protocolCancel) => process.cancel(protocolCancel),
      };
    },
  };
}

export async function runProtocolProbe(
  provider: LiveProvider,
  command: { executable: string; args: string[] },
  home: string,
  cwd: string,
) {
  const profile: AgentProfile = {
    id: randomUUID(),
    name: 'Explicit local protocol probe',
    agentKind: provider,
    adapterKind: 'ACP_STDIO',
    targetKind: 'LOCAL_HOST',
    launchSpec: { kind: 'HOST_PROCESS', ...command },
    config: { preflightCwd: cwd, preflightSession: false, preflightStrictCleanup: true },
  };
  const adapter = new AcpAdapter({ launcher: isolatedProbeLauncher(home) });
  // A rejection is not evidence of confirmed cleanup. Do not catch and mark success.
  try {
    const report = await adapter.preflight(profile);
    return preflightEvidence(provider, report, true);
  } catch (error) {
    throw publicProbeFailure(error);
  }
}

/** Never propagate provider causes or raw diagnostics into a test reporter. */
export function publicProbeFailure(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return new Error(
    code === 'ACP_PROCESS_CLEANUP_UNCONFIRMED'
      ? 'LIVE_PROBE_CLEANUP_UNCONFIRMED: isolated directory retained; process exit not verified'
      : 'LIVE_PROBE_UNCONFIRMED: isolated directory retained; no success evidence',
  );
}
