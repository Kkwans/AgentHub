import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  access,
  mkdtemp,
  mkdir,
  realpath,
  rm,
  readdir,
  writeFile,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { infrastructureChildLaunch } from './e2e-real/infrastructure-isolation.js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  observeInfrastructureChild,
  startIsolatedInfrastructureChild,
} from './e2e-real/infrastructure-child-lifecycle.js';

afterEach(() => vi.useRealTimers());
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    connected: true,
    send: vi.fn((_message: unknown, callback: () => void) => {
      callback();
      return true;
    }),
    kill: vi.fn(() => {
      child.emit('exit', null, 'SIGKILL');
      return true;
    }),
  });
  return child;
}
it('requires close acknowledgement AND process exit; close is sticky and sent once', async () => {
  const child = fakeChild();
  const lifecycle = observeInfrastructureChild(child as unknown as ChildProcess, 1000);
  child.emit('message', {
    type: 'ready',
    origin: 'http://127.0.0.1:1234',
    isolatedEnvironment: true,
    emptyPath: true,
  });
  expect((await lifecycle.ready).emptyPath).toBe(true);
  const close = lifecycle.close();
  expect(lifecycle.close()).toBe(close);
  let done = false;
  void close.then(() => {
    done = true;
  });
  child.emit('message', { type: 'closed' });
  await Promise.resolve();
  expect(done).toBe(false);
  child.emit('exit', 0, null);
  await close;
  expect(child.send).toHaveBeenCalledTimes(1);
});
it('early exit rejects readiness and never counts as graceful cleanup', async () => {
  const child = fakeChild();
  const lifecycle = observeInfrastructureChild(child as unknown as ChildProcess, 1000);
  child.emit('exit', 0, null);
  await expect(lifecycle.ready).rejects.toThrow('CHILD_EARLY_EXIT');
  await expect(lifecycle.close()).rejects.toThrow('CHILD_CLOSE_UNCONFIRMED');
});
it('spawn error without an exit event rejects promptly and never removes evidence', async () => {
  const child = fakeChild();
  const lifecycle = observeInfrastructureChild(child as unknown as ChildProcess, 1000);
  child.emit('error', new Error('synthetic spawn failure'));
  await expect(lifecycle.ready).rejects.toThrow('CHILD_PROCESS_ERROR');
  await expect(lifecycle.close()).rejects.toThrow('CHILD_PROCESS_ERROR');
});
it('never accepts non-loopback readiness as proof', async () => {
  vi.useFakeTimers();
  const child = fakeChild();
  const lifecycle = observeInfrastructureChild(child as unknown as ChildProcess, 100);
  child.emit('message', {
    type: 'ready',
    origin: 'http://example.invalid:1234',
    isolatedEnvironment: true,
    emptyPath: true,
  });
  const failed = expect(lifecycle.ready).rejects.toThrow('CHILD_READY_TIMEOUT');
  await vi.advanceTimersByTimeAsync(100);
  await failed;
  child.emit('exit', 0, null);
  await expect(lifecycle.close()).rejects.toThrow('CHILD_READY_TIMEOUT');
});
it('close failure is sticky despite a later zero exit', async () => {
  const child = fakeChild();
  const lifecycle = observeInfrastructureChild(child as unknown as ChildProcess, 1000);
  child.emit('message', { type: 'failed', code: 'CHILD_CLOSE_FAILED' });
  child.emit('exit', 0, null);
  await expect(lifecycle.close()).rejects.toThrow('CHILD_CLOSE_FAILED');
  await expect(lifecycle.close()).rejects.toThrow('CHILD_CLOSE_FAILED');
});
it('timeout terminates only the test child and does not report graceful cleanup', async () => {
  vi.useFakeTimers();
  const child = fakeChild();
  const lifecycle = observeInfrastructureChild(child as unknown as ChildProcess, 100);
  const close = lifecycle.close();
  const assertion = expect(close).rejects.toThrow('CHILD_CLOSE_TIMEOUT');
  await vi.advanceTimersByTimeAsync(100);
  await assertion;
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
});
it.skipIf(process.env.AGENTHUB_INFRA_CHILD_SMOKE !== '1')(
  'opt-in: isolated real child only starts health service, then closes and removes its own root',
  async () => {
    const app = await startIsolatedInfrastructureChild();
    expect(app.isolatedEnvironment).toBe(true);
    expect(app.emptyPath).toBe(true);
    await app.close();
    await expect(access(app.root)).rejects.toThrow();
  },
  60_000,
);

it('SIGKILL without an exit event remains unconfirmed after the second bounded deadline', async () => {
  vi.useFakeTimers();
  const child = fakeChild();
  child.kill.mockImplementation(() => true);
  const lifecycle = observeInfrastructureChild(child as unknown as ChildProcess, 100);
  const closing = lifecycle.close();
  const failed = expect(closing).rejects.toThrow('CHILD_TERMINATION_UNCONFIRMED');
  await vi.advanceTimersByTimeAsync(5100);
  await failed;
  expect(child.kill).toHaveBeenCalledTimes(1);
  expect(lifecycle.close()).toBe(closing);
});
it('parent authorizes validated startup once but never after close begins', async () => {
  const child = fakeChild();
  const lifecycle = observeInfrastructureChild(child as unknown as ChildProcess, 1000);
  child.emit('message', { type: 'validated' });
  child.emit('message', { type: 'validated' });
  expect(child.send).toHaveBeenCalledTimes(1);
  expect(child.send).toHaveBeenCalledWith({ type: 'start' }, expect.any(Function));
  const closing = lifecycle.close();
  child.emit('message', { type: 'validated' });
  expect(child.send).toHaveBeenCalledTimes(2);
  child.emit('message', { type: 'closed' });
  child.emit('exit', 0, null);
  await closing;
});
it.each(['absent', 'file', 'symlink', 'outside'] as const)(
  'socket pre-import guard %s never creates DB data',
  async (socketState) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'agenthub-infra-disconnect-')));
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
    const launch = infrastructureChildLaunch(
      root,
      fileURLToPath(new URL('../apps/web/dist', import.meta.url)),
      fileURLToPath(new URL('./e2e-real/infrastructure-child.mjs', import.meta.url)),
    );
    if (socketState === 'file') await writeFile(launch.env.DOCKER_SOCKET_PATH!, 'synthetic');
    if (socketState === 'symlink')
      await symlink(join(root, 'nonexistent'), launch.env.DOCKER_SOCKET_PATH!);
    if (socketState === 'outside') launch.env.DOCKER_SOCKET_PATH = '/synthetic/not-our-socket';
    const child = spawn(launch.executable, launch.args, {
      cwd: root,
      env: launch.env,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let didExit = false;
    let validated = false;
    const messages: unknown[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          timer = setTimeout(() => reject(new Error('STARTUP_DISCONNECT_TIMEOUT')), 5000);
          child.on('message', (message: unknown) => {
            messages.push(message);
            if (
              message &&
              typeof message === 'object' &&
              'type' in message &&
              message.type === 'validated'
            ) {
              validated = true;
              child.disconnect();
            }
          });
          child.on('error', reject);
          child.on('exit', (code, signal) => {
            didExit = true;
            resolve({ code, signal });
          });
        },
      );
      expect(validated).toBe(socketState === 'absent');
      expect(outcome).toEqual({ code: socketState === 'absent' ? 0 : 1, signal: null });
      expect(messages).toEqual(
        socketState === 'absent'
          ? [{ type: 'validated' }]
          : [{ type: 'failed', code: 'CHILD_START_FAILED' }],
      );
      await expect(access(root)).resolves.toBeUndefined();
      expect(await readdir(join(root, 'database'))).toEqual([]);
    } finally {
      clearTimeout(timer);
      if (!didExit) {
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const terminated = new Promise<void>((resolve) => {
          child.once('exit', () => {
            didExit = true;
            resolve();
          });
          killTimer = setTimeout(resolve, 5000);
        });
        child.kill('SIGKILL');
        await terminated;
        clearTimeout(killTimer);
      }
      // Only confirmed process exit permits test-owned directory removal.
      if (didExit) await rm(root, { recursive: true, force: false });
    }
  },
);
