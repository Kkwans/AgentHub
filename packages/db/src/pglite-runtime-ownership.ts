import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { RuntimeOwnershipError, type RuntimeOwnershipGuard } from './runtime-ownership.js';

/** Linux/local-filesystem single-writer guard. The persistent lock inode must never be unlinked.
 * flock(2) belongs to the shared open-file-description: the parent FD keeps it after flock exits.
 * This is advisory, not fencing for an old uncooperative process or an external Agent.
 */
export async function acquirePgliteRuntimeOwnership(
  dataDir: string,
): Promise<{ guard: RuntimeOwnershipGuard; dataDir: string }> {
  let canonicalDataDir = dataDir;
  let state: 'held' | 'lost' | 'released' = 'held';
  let fd: number | undefined;
  let checkIdentity = () => {};
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const lose = () => {
    if (state !== 'held') return;
    state = 'lost';
    if (timer) clearInterval(timer);
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* All admission subscribers must be notified. */
      }
    }
    listeners.clear();
  };
  try {
    if (dataDir !== 'memory://') {
      if (process.platform !== 'linux' || /^[a-z][a-z\d+.-]*:\/\//i.test(dataDir))
        throw new RuntimeOwnershipError('RUNTIME_OWNERSHIP_UNSUPPORTED');
      mkdirSync(resolve(dataDir), { recursive: true });
      const canonical = realpathSync(resolve(dataDir));
      canonicalDataDir = canonical;
      const directory = statSync(canonical);
      if (!directory.isDirectory())
        throw new RuntimeOwnershipError('RUNTIME_OWNERSHIP_UNAVAILABLE');
      // Adjacent, not inside PGDATA: a new cluster must see an empty data directory.
      const lockPath = `${canonical}.agenthub-runtime.lock`;
      fd = openSync(lockPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
      const lock = fstatSync(fd);
      if (!lock.isFile() || lock.nlink !== 1)
        throw new RuntimeOwnershipError('RUNTIME_OWNERSHIP_UNAVAILABLE');
      const result = spawnSync('/usr/bin/flock', ['-n', '-E', '75', '3'], {
        stdio: ['ignore', 'ignore', 'ignore', fd],
        timeout: 5_000,
      });
      if (result.error || result.signal || result.status !== 0) {
        throw new RuntimeOwnershipError(
          !result.error && !result.signal && result.status === 75
            ? 'RUNTIME_OWNERSHIP_HELD'
            : 'RUNTIME_OWNERSHIP_UNAVAILABLE',
        );
      }
      checkIdentity = () => {
        const currentLock = statSync(lockPath);
        const currentDirectory = statSync(canonical);
        if (
          currentLock.dev !== lock.dev ||
          currentLock.ino !== lock.ino ||
          currentLock.nlink !== 1 ||
          currentDirectory.dev !== directory.dev ||
          currentDirectory.ino !== directory.ino ||
          realpathSync(resolve(dataDir)) !== canonical
        )
          throw new RuntimeOwnershipError('RUNTIME_OWNERSHIP_LOST');
      };
      checkIdentity();
      timer = setInterval(() => {
        try {
          checkIdentity();
        } catch {
          lose();
        }
      }, 1_000);
      timer.unref();
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    throw error instanceof RuntimeOwnershipError
      ? error
      : new RuntimeOwnershipError('RUNTIME_OWNERSHIP_UNAVAILABLE');
  }
  const guard: RuntimeOwnershipGuard = {
    assertHeld() {
      if (state === 'held') {
        try {
          checkIdentity();
        } catch {
          lose();
        }
      }
      if (state !== 'held') throw new RuntimeOwnershipError('RUNTIME_OWNERSHIP_LOST');
    },
    onLost(listener) {
      if (state === 'lost') listener();
      else if (state === 'held') listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async release() {
      if (state === 'released') return;
      state = 'released';
      if (timer) clearInterval(timer);
      listeners.clear();
      if (fd !== undefined) {
        closeSync(fd);
        fd = undefined;
      }
    },
  };
  return { guard, dataDir: canonicalDataDir };
}
