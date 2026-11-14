import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from '../errors.js';

export type AgentAdmissionCheckpoint = {
  /** Recheck after awaits, immediately before the short authoritative commit. */
  assertRuntimeHeld: () => void;
};

/**
 * Unwired, process-local foundation for serializing availability CAS and new-work
 * admission. Every participating entry point must share the SAME instance.
 *
 * The callback is ONLY a short eligibility read / durable admission / CAS section.
 * Return before awaiting provider initialization, preflight, a Run or cleanup.
 * An admitted operation may finish after later disable; this is not spawn fencing.
 *
 * RuntimeOperations / the owning service must track the returned promise (including
 * queue wait) for shutdown. This class neither releases ownership nor drains resources.
 * A checkpoint cannot replace existing Task/Run claims or unknown-resource fences.
 * Merely wiring resolveRuntime does not cover existing-handle startRun, legacy
 * preflight, continuation/capability or model-summary helper sessions.
 */
export class AgentAdmissionCoordinator {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly context = new AsyncLocalStorage<{ active: boolean }>();

  constructor(private readonly assertRuntimeHeld: () => void) {}

  run<T>(
    agentId: string,
    criticalSection: (checkpoint: AgentAdmissionCheckpoint) => T | Promise<T>,
  ): Promise<T> {
    // Promise rejection, rather than a synchronous throw, preserves one public API.
    try {
      if (!agentId.trim())
        throw new AppError(400, 'AGENT_ADMISSION_ID_REQUIRED', '缺少 Agent 准入标识。');
      if (this.context.getStore()?.active)
        throw new AppError(409, 'AGENT_ADMISSION_REENTRANT', '准入临界区不能嵌套等待其他准入。');
      this.assertRuntimeHeld();
    } catch (error) {
      return Promise.reject(error);
    }
    const previous = this.tails.get(agentId) ?? Promise.resolve();
    const result = previous.then(() => {
      // Queue wait may outlive runtime ownership or shutdown admission.
      this.assertRuntimeHeld();
      const scope = { active: true };
      const checkpoint: AgentAdmissionCheckpoint = {
        assertRuntimeHeld: () => {
          if (!scope.active)
            throw new AppError(409, 'AGENT_ADMISSION_EXPIRED', '准入检查上下文已结束。');
          this.assertRuntimeHeld();
        },
      };
      return this.context.run(scope, async () => {
        try {
          return await criticalSection(checkpoint);
        } finally {
          scope.active = false;
        }
      });
    });
    // Consume queue failure without swallowing the caller's original rejection.
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(agentId, tail);
    void tail.then(() => {
      // An earlier operation must not delete its successor's queue tail.
      if (this.tails.get(agentId) === tail) this.tails.delete(agentId);
    });
    return result;
  }
}
