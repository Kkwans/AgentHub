/** Optional UI coordination only: never replaces server eligibility or confirmation. */
export type ReviewOperationPhase = 'pending' | 'unknown' | 'checking' | 'resolved' | 'retryable';
export type ReviewOperationSnapshot = {
  projectId: string;
  taskId: string;
  executionId?: string;
  operationId: string;
  /** Exact planned merge target captured before POST, never a retry predecessor. */
  gitMergeAttempt?: Readonly<{ runId: string; operationId: string }>;
  /** Exact target validated by an authoritative recovery check, not a generic rejection. */
  gitMergeRetryProof?: Readonly<{ runId: string; operationId: string }>;
  phase: ReviewOperationPhase;
  message: string;
  /** Only present on resolved snapshots, after response identity validation. */
  resultHref?: string;
};
export type ReviewOperationProps = {
  onOperationChange?: (snapshot: ReviewOperationSnapshot) => void;
  /** Capture an epoch-aware predicate when submitting, not a later render's predicate. */
  canAutoNavigate?: () => boolean;
  /** Called synchronously at submit, after committed route/view effects. */
  captureNavigationGate?: () => () => boolean;
};
// Unique within this page lifetime even on non-secure LAN origins without randomUUID.
let nextOperationId = 0;
export function createReviewOperation(
  identity: Pick<
    ReviewOperationSnapshot,
    'projectId' | 'taskId' | 'executionId' | 'gitMergeAttempt'
  >,
  notify: ReviewOperationProps['onOperationChange'],
) {
  const operationId = `review:${Date.now()}:${++nextOperationId}`;
  return (phase: ReviewOperationPhase, message: string, resultHref?: string) =>
    notify?.({
      ...identity,
      operationId,
      phase,
      message,
      ...(phase === 'resolved' && resultHref ? { resultHref } : {}),
    });
}
