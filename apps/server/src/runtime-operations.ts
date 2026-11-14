import { AppError } from './errors.js';

/** Tracks awaited HTTP service work, not socket lifetime or detached background jobs. */
export class RuntimeOperations {
  private accepting = true;
  private readonly pending = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  constructor(
    private readonly assertOwnership: () => void,
    private readonly timeoutMs = 5_000,
  ) {}

  wrapFunction<Args extends unknown[], Result>(
    fn: (...args: Args) => Result,
  ): (...args: Args) => Result {
    return (...args) => this.invoke(() => fn(...args));
  }

  wrap<T extends object>(target: T): T {
    return new Proxy(target, {
      get: (object, key) => {
        const value: unknown = Reflect.get(object, key, object);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => this.invoke(() => Reflect.apply(value, object, args));
      },
    });
  }

  private invoke<Result>(operation: () => Result): Result {
    if (!this.accepting)
      throw new AppError(503, 'RUNTIME_STOPPING', '服务正在停止，不能接受新的操作。');
    this.assertOwnership();
    const result = operation();
    if (
      result &&
      (typeof result === 'object' || typeof result === 'function') &&
      typeof (result as { then?: unknown }).then === 'function'
    ) {
      const pending = Promise.resolve(result);
      this.pending.add(pending);
      // Attach both handlers: do not create an unobserved rejected finally promise.
      void pending.then(
        () => this.pending.delete(pending),
        () => this.pending.delete(pending),
      );
    }
    return result;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.accepting = false;
    this.closing = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new AppError(
              503,
              'RUNTIME_OPERATIONS_UNCONFIRMED',
              '仍有操作尚未结束，保留运行归属，请人工核对。',
            ),
          ),
        this.timeoutMs,
      );
      void Promise.allSettled([...this.pending]).then(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
    return this.closing;
  }
}
