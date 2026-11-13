import { AppError } from '../errors.js';
import { GitWriteCoordinatorError, type GitWriteCoordinator } from './git-write-coordinator.js';
import type { GitWriteResource } from './git-write-resource.js';

export type ManagedGitWriteKind = 'COMMIT' | 'WORKTREE_CREATE' | 'WORKTREE_MERGE';
export interface ManagedGitWriteContext {
  kind: ManagedGitWriteKind;
  ownerScope: string;
  operationId: string;
  projectId: string;
  expectedHead: string | null;
  payload: Record<string, unknown>;
}

// Shared production wrapper for all three managed Git writers.
// Does not serialize arbitrary callback results,
// infer commit ownership from HEAD, or protect against external Git processes.
export class ManagedGitWrites {
  constructor(private readonly coordinator: Pick<GitWriteCoordinator, 'execute'>) {}

  async run<T>(
    context: ManagedGitWriteContext,
    write: (
      resource: Readonly<GitWriteResource>,
      frozenPayload: Readonly<Record<string, unknown>>,
    ) => Promise<T>,
    observedHead: (result: T) => string | null = () => null,
  ): Promise<T> {
    const worktree = context.kind === 'WORKTREE_CREATE' || context.kind === 'WORKTREE_MERGE';
    const unknownCode = worktree ? 'WORKTREE_GIT_OUTCOME_UNKNOWN' : 'GIT_WRITE_OUTCOME_UNKNOWN';
    const prewriteCode = worktree
      ? 'WORKTREE_GIT_PREWRITE_REJECTED'
      : 'GIT_WRITE_PREWRITE_REJECTED';
    const unknown = (cause?: unknown) =>
      new AppError(
        409,
        unknownCode,
        'Git 写入结果或原始返回值尚未确认，已禁止自动重试，请读取操作记录核对',
        undefined,
        { cause },
      );
    const prewrite = (cause?: unknown) =>
      new AppError(409, prewriteCode, 'Git 写入前校验未通过，本次未执行写入', undefined, { cause });
    if (!['COMMIT', 'WORKTREE_CREATE', 'WORKTREE_MERGE'].includes(context.kind)) throw prewrite();
    let entered = false;
    let returned = false;
    let result!: T;
    let outcome: Awaited<ReturnType<GitWriteCoordinator['execute']>>;
    try {
      outcome = await this.coordinator.execute(
        {
          ownerScope: context.ownerScope,
          operationId: context.operationId,
          projectId: context.projectId,
          expectedHead: context.expectedHead,
          protocolVersion: 1,
          // The managed kind cannot be overridden by request payload. All write
          // arguments must be bound here and read from frozenPayload, not closures.
          payload: { ...context.payload, operationKind: context.kind },
        },
        async (resource, payload) => {
          entered = true;
          result = await write(resource, payload);
          returned = true;
          return { commandExit: 0, observedAfterHead: observedHead(result) };
        },
      );
    } catch (error) {
      // Callback-thrown errors are NEVER proof of prewrite rejection, even when
      // their code happens to match a coordinator validation error.
      if (
        !entered &&
        error instanceof GitWriteCoordinatorError &&
        ['GIT_OPERATION_INVALID', 'GIT_HEAD_CHANGED', 'GIT_RESOURCE_CHANGED'].includes(error.code)
      )
        throw prewrite(error);
      // Includes dropped DISPATCHED/settlement responses and claimed aliases.
      // No DB outage or request conflict is guessed to mean safe-to-retry.
      throw unknown(error);
    }
    if (outcome.operation.phase === 'REJECTED_PREWRITE') throw prewrite();
    if (
      outcome.replayed ||
      !entered ||
      !returned ||
      outcome.operation.phase !== 'COMMAND_SUCCEEDED'
    )
      throw unknown();
    // Only this invocation has T; a persisted success replay has evidence but
    // cannot reconstruct worktree paths or richer response objects safely.
    return result;
  }
}
