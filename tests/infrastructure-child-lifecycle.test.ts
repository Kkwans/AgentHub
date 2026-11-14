import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
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
