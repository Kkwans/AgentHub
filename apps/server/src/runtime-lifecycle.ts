import type { DatabaseClient } from '@agenthub/db';
import { AppError } from './errors.js';

/** Admission closes synchronously; all runtime revocations start before any await. */
export class RuntimeLifecycle {
  private accepting = true;
  private lost = false;
  private readonly stops: Array<() => void | Promise<void>> = [];
  private closing: Promise<void> | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly database: DatabaseClient,
    onFailure: (error: unknown) => void,
  ) {
    if (!database.runtimeOwnership) throw new Error('Runtime ownership is required');
    this.unsubscribe = database.runtimeOwnership.onLost(() => {
      this.lost = true;
      void this.close().catch(onFailure);
    });
    this.assertHeld();
  }

  assertHeld(): void {
    if (!this.accepting)
      throw new AppError(503, 'RUNTIME_STOPPING', '服务正在停止，不能接受新的操作。');
    this.database.runtimeOwnership!.assertHeld();
  }

  addStop(stop: () => void | Promise<void>): void {
    this.assertHeld();
    this.stops.push(stop);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    this.closing = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    this.accepting = false;
    this.unsubscribe?.();
    const pending: Promise<void>[] = [];
    for (const stop of this.stops) {
      try {
        pending.push(Promise.resolve(stop()));
      } catch (error) {
        pending.push(Promise.reject(error));
      }
    }
    void (async () => {
      const outcomes = await Promise.allSettled(pending);
      const failures = outcomes.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      // Never deliberately release healthy ownership while shutdown is incomplete.
      // A lost database connection cannot provide such exclusion; still clean it up.
      if (!failures.length || this.lost) {
        try {
          await this.database.close();
        } catch (error) {
          failures.push({ status: 'rejected', reason: error });
        }
      }
      if (failures.length)
        throw new AggregateError(
          failures.map((item) => item.reason),
          'Runtime shutdown failed; service remains unavailable',
        );
    })().then(resolve, reject);
    return this.closing;
  }
}
