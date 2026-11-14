import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '@agenthub/db';
import { RuntimeLifecycle } from './runtime-lifecycle.js';
function fixture() {
  let held = true;
  const listeners = new Set<() => void>();
  const close = vi.fn(async () => undefined);
  const database = {
    db: {},
    mode: 'pglite',
    close,
    runtimeOwnership: {
      assertHeld: () => {
        if (!held) throw new Error('lost');
      },
      onLost: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      release: async () => undefined,
    },
  } as unknown as DatabaseClient;
  const failures = vi.fn();
  const lifecycle = new RuntimeLifecycle(database, failures);
  return {
    lifecycle,
    close,
    failures,
    lose() {
      held = false;
      for (const listener of listeners) listener();
    },
  };
}
describe('runtime ownership lifecycle', () => {
  it('starts every revocation synchronously before waiting and closes DB last', async () => {
    const f = fixture();
    let release!: () => void;
    const pending = new Promise<void>((done) => {
      release = done;
    });
    const first = vi.fn(() => pending),
      second = vi.fn(async () => undefined);
    f.lifecycle.addStop(first);
    f.lifecycle.addStop(second);
    const closing = f.lifecycle.close();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(() => f.lifecycle.assertHeld()).toThrow();
    expect(f.close).not.toHaveBeenCalled();
    expect(f.lifecycle.close()).toBe(closing);
    release();
    await closing;
    expect(f.close).toHaveBeenCalledOnce();
  });
  it('publishes the closing promise before synchronously invoking callbacks', async () => {
    const f = fixture();
    let nested: Promise<void> | undefined;
    const stop = vi.fn(() => {
      nested = f.lifecycle.close();
    });
    f.lifecycle.addStop(stop);
    const closing = f.lifecycle.close();
    expect(nested).toBe(closing);
    await closing;
    expect(stop).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
  });
  it('ownership loss immediately rejects admission and stops registered resources', async () => {
    const f = fixture();
    const stop = vi.fn(async () => undefined);
    f.lifecycle.addStop(stop);
    f.lose();
    expect(stop).toHaveBeenCalledOnce();
    expect(() => f.lifecycle.assertHeld()).toThrow();
    await f.lifecycle.close();
    expect(f.close).toHaveBeenCalledOnce();
    expect(f.failures).not.toHaveBeenCalled();
  });
  it('healthy ownership is retained if any shutdown failed, while other stops still run', async () => {
    const f = fixture();
    const next = vi.fn(async () => undefined);
    f.lifecycle.addStop(() => {
      throw new Error('stop failed');
    });
    f.lifecycle.addStop(next);
    await expect(f.lifecycle.close()).rejects.toThrow('Runtime shutdown failed');
    expect(next).toHaveBeenCalledOnce();
    expect(f.close).not.toHaveBeenCalled();
    expect(() => f.lifecycle.assertHeld()).toThrow();
  });
  it('lost ownership cleans DB even when runtime cleanup failed and reports failure', async () => {
    const f = fixture();
    f.lifecycle.addStop(async () => {
      throw new Error('failed');
    });
    f.lose();
    await expect(f.lifecycle.close()).rejects.toThrow();
    expect(f.close).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(f.failures).toHaveBeenCalledOnce());
  });
  it('rejects resource registration after closing', async () => {
    const f = fixture();
    await f.lifecycle.close();
    expect(() => f.lifecycle.addStop(() => {})).toThrow();
  });
});
