import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { infrastructureChildLaunch } from './infrastructure-isolation.js';

type Ready = { origin: string; isolatedEnvironment: true; emptyPath: true };
/** Exported for fake-IPC lifecycle tests. No raw child output or environment is exposed. */
export function observeInfrastructureChild(child: ChildProcess, timeoutMs = 20_000) {
  let readyResolve!: (value: Ready) => void;
  let readyReject!: (reason: Error) => void;
  const ready = new Promise<Ready>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // Observe even when an early exit races the caller's await.
  void ready.catch(() => undefined);
  let exitedResolve!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    exitedResolve = resolve;
  });
  let closed = false;
  let startSent = false;
  let failure: string | undefined;
  let closePromise: Promise<void> | undefined;
  const timer = setTimeout(() => {
    failure = 'CHILD_READY_TIMEOUT';
    readyReject(new Error(failure));
  }, timeoutMs);
  child.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const value = message as Record<string, unknown>;
    if (value.type === 'validated' && !startSent && !closePromise) {
      startSent = true;
      try {
        child.send({ type: 'start' }, () => undefined);
      } catch {
        failure = 'CHILD_START_SEND_FAILED';
        clearTimeout(timer);
        readyReject(new Error(failure));
      }
      return;
    }
    if (
      value.type === 'ready' &&
      typeof value.origin === 'string' &&
      /^http:\/\/127\.0\.0\.1:[1-9]\d*$/.test(value.origin) &&
      value.isolatedEnvironment === true &&
      value.emptyPath === true
    ) {
      clearTimeout(timer);
      readyResolve({ origin: value.origin, isolatedEnvironment: true, emptyPath: true });
    } else if (value.type === 'closed') closed = true;
    else if (value.type === 'failed') {
      failure = value.code === 'CHILD_CLOSE_FAILED' ? 'CHILD_CLOSE_FAILED' : 'CHILD_START_FAILED';
      clearTimeout(timer);
      readyReject(new Error(failure));
    }
  });
  child.on('error', () => {
    failure = 'CHILD_PROCESS_ERROR';
    clearTimeout(timer);
    readyReject(new Error(failure));
    if (!child.pid) exitedResolve({ code: null, signal: null });
  });
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    readyReject(new Error(failure ?? 'CHILD_EARLY_EXIT'));
    exitedResolve({ code, signal });
  });
  return {
    ready,
    close(): Promise<void> {
      return (closePromise ??= (async () => {
        if (child.connected) {
          try {
            child.send({ type: 'close' }, () => undefined);
          } catch {
            failure ??= 'CHILD_CLOSE_SEND_FAILED';
          }
        }
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const outcome = await Promise.race([
          exited,
          new Promise<null>((resolve) => {
            deadline = setTimeout(() => resolve(null), timeoutMs);
          }),
        ]);
        clearTimeout(deadline);
        if (!outcome) {
          child.kill('SIGKILL');
          // SIGKILL is a last-resort test-process cleanup, never graceful shutdown evidence.
          let killDeadline: ReturnType<typeof setTimeout> | undefined;
          const terminated = await Promise.race([
            exited,
            new Promise<null>((resolve) => {
              killDeadline = setTimeout(() => resolve(null), 5000);
            }),
          ]);
          clearTimeout(killDeadline);
          throw new Error(terminated ? 'CHILD_CLOSE_TIMEOUT' : 'CHILD_TERMINATION_UNCONFIRMED');
        }
        if (failure || !closed || outcome.code !== 0 || outcome.signal)
          throw new Error(failure ?? 'CHILD_CLOSE_UNCONFIRMED');
      })());
    },
  };
}

/** Dedicated opt-in helper; never changes the ordinary Git/ACP browser fixture. */
export async function startIsolatedInfrastructureChild() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'agenthub-infrastructure-')));
  for (const name of [
    'empty-bin',
    'home',
    'config',
    'cache',
    'local-data',
    'codex',
    'tmp',
    'database',
    'worktrees',
    'workspace',
  ])
    await mkdir(join(root, name));
  const entry = fileURLToPath(new URL('./infrastructure-child.mjs', import.meta.url));
  const web = fileURLToPath(new URL('../../apps/web/dist', import.meta.url));
  const launch = infrastructureChildLaunch(root, web, entry);
  const child = spawn(launch.executable, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    shell: false,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const observed = observeInfrastructureChild(child);
  try {
    const proof = await observed.ready;
    const response = await fetch(`${proof.origin}/api/v1/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const health = (await response.json()) as { data?: { database?: string; web?: boolean } };
    if (!response.ok || health.data?.database !== 'pglite' || health.data.web !== true)
      throw new Error('CHILD_HEALTH_INVALID');
    let closePromise: Promise<void> | undefined;
    return {
      ...proof,
      root,
      close: () =>
        (closePromise ??= (async () => {
          await observed.close();
          await rm(root, { recursive: true, force: false });
        })()),
    };
  } catch (error) {
    try {
      await observed.close();
    } catch {
      throw new Error('INFRASTRUCTURE_START_CLEANUP_UNCONFIRMED');
    }
    // A failed launch retains its isolated directory for diagnosis, even if exit was confirmed.
    throw error;
  }
}
