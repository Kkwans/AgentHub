import { createHash } from 'node:crypto';
import { DatabaseInvariantError } from './repositories.js';

/** Generation zero deliberately preserves the already-persisted v1 review key. */
export function deriveWorktreeMergeOperationId(
  executionId: string,
  runId: string | null,
  generation = 0,
): string {
  if (!runId)
    throw new DatabaseInvariantError('WORKTREE_GIT_REVIEW_MISSING', '缺少可信审阅 Run，已禁止合并');
  if (!Number.isInteger(generation) || generation < 0 || generation > 2147483647)
    throw new DatabaseInvariantError(
      'WORKTREE_GIT_ATTEMPT_INVALID',
      'Git 合并代际无效，已禁止合并',
    );
  const identity =
    generation === 0
      ? ['agenthub.worktree-merge.v1', executionId, runId]
      : ['agenthub.worktree-merge.v2', executionId, runId, generation];
  const hex = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
