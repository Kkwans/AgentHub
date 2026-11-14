import { createServer, get } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { RuntimeOperations } from './runtime-operations.js';
import { createApp } from './app.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('HTTP runtime operation drain', () => {
  it('preserves private this, synchronous values/errors and promise identity', async () => {
    const assert = vi.fn();
    const operations = new RuntimeOperations(assert);
    const pending = deferred<number>();
    class Service {
      #value = 7;
      value() {
        return this.#value;
      }
      fail() {
        throw new Error('sync');
      }
      work() {
        return pending.promise;
      }
    }
    const service = operations.wrap(new Service());
    expect(service.value()).toBe(7);
    expect(() => service.fail()).toThrow('sync');
    expect(service.work()).toBe(pending.promise);
    const closing = operations.close();
    let finished = false;
    void closing.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(() => service.value()).toThrow('服务正在停止');
    pending.resolve(1);
    await closing;
    expect(assert).toHaveBeenCalledTimes(3);
  });

  it('settled service errors do not masquerade as incomplete work or leak rejection promises', async () => {
    const operations = new RuntimeOperations(() => {});
    const fn = operations.wrapFunction(async () => {
      throw new Error('operation failed');
    });
    await expect(fn()).rejects.toThrow('operation failed');
    await operations.close();
  });

  it('keeps timeout failure sticky even after late completion', async () => {
    const operations = new RuntimeOperations(() => {}, 10);
    const pending = deferred<void>();
    operations.wrapFunction(() => pending.promise)();
    const closing = operations.close();
    await expect(closing).rejects.toMatchObject({ code: 'RUNTIME_OPERATIONS_UNCONFIRMED' });
    pending.resolve();
    expect(operations.close()).toBe(closing);
    await expect(operations.close()).rejects.toThrow();
  });

  it('drains authentication and gates a downstream service reached after stop', async () => {
    const operations = new RuntimeOperations(() => {});
    const pending = deferred<void>();
    const writes = vi.fn();
    const service = operations.wrap({ write: writes });
    const authenticate = operations.wrapFunction(async () => {
      await pending.promise;
      // Equivalent to middleware next() entering an awaited route service.
      service.write();
    });
    const authentication = authenticate();
    const rejected = expect(authentication).rejects.toMatchObject({ code: 'RUNTIME_STOPPING' });
    let drained = false;
    const closing = operations.close();
    void closing.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    pending.resolve();
    await rejected;
    await closing;
    expect(writes).not.toHaveBeenCalled();
  });

  it('a disconnected HTTP response does not finish its awaited service work', async () => {
    const operations = new RuntimeOperations(() => {});
    const entered = deferred<void>();
    const pending = deferred<Record<string, unknown>>();
    const app = createApp({
      logger: pino({ level: 'silent' }),
      health: operations.wrapFunction(() => {
        entered.resolve();
        return pending.promise;
      }),
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no test address');
    const request = get(`http://127.0.0.1:${address.port}/api/v1/health`);
    request.on('error', () => {});
    try {
      await entered.promise;
      request.destroy();
      let finished = false;
      const closing = operations.close();
      void closing.then(() => {
        finished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(finished).toBe(false);
      pending.resolve({ fixture: true });
      await closing;
    } finally {
      pending.resolve({});
      request.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
