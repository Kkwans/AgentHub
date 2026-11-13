import type { ReviewOperationProps, ReviewOperationSnapshot } from '../components/review-operation';

type Identity = Pick<ReviewOperationSnapshot, 'projectId' | 'taskId' | 'executionId'>;
export type ReviewOwnerView = {
  projectId: string;
  taskId: string;
  routeKey: string;
  viewport: 'phone' | 'tablet' | 'wide';
  visible: boolean;
};
export type OwnedReviewOperation = Readonly<ReviewOperationSnapshot>;
const lockedPhases = new Set(['pending', 'unknown', 'checking']);
const identityKey = (value: Identity) =>
  JSON.stringify([value.projectId, value.taskId, value.executionId ?? null]);
const sameView = (a: ReviewOwnerView | null, b: ReviewOwnerView | null) =>
  a === b ||
  Boolean(
    a &&
    b &&
    a.projectId === b.projectId &&
    a.taskId === b.taskId &&
    a.routeKey === b.routeKey &&
    a.viewport === b.viewport &&
    a.visible === b.visible,
  );

/** In-memory owner; caller must hold one instance above route-owned review children.
 * Auth transitions MUST call setScope.
 * Nothing is persisted, and a full page reload cannot recover this state.
 */
export function createReviewOperationOwner() {
  let scope: string | null = null;
  let authGeneration = 0;
  let view: ReviewOwnerView | null = null;
  let epoch = 0;
  let records: readonly OwnedReviewOperation[] = Object.freeze([]);
  const listeners = new Set<() => void>();
  const dismissed = new Set<string>();
  const publish = (next: readonly OwnedReviewOperation[]) => {
    records = Object.freeze([...next]);
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => records,
    getView: (): ReviewOwnerView | null => (view ? { ...view } : null),
    setScope(next: string | null) {
      if (scope === next) return;
      scope = next;
      authGeneration += 1;
      epoch += 1;
      view = null;
      dismissed.clear();
      publish([]);
    },
    setView(next: ReviewOwnerView | null) {
      if (sameView(view, next)) return;
      view = next ? { ...next } : null;
      epoch += 1;
    },
    dismiss(identity: Identity, operationId: string): boolean {
      const key = identityKey(identity);
      const record = records.find(
        (record) => identityKey(record) === key && record.operationId === operationId,
      );
      if (!record || lockedPhases.has(record.phase)) return false;
      dismissed.add(JSON.stringify([key, operationId]));
      publish(records.filter((value) => value !== record));
      return true;
    },
    bind(
      identity: Identity,
    ): Required<Pick<ReviewOperationProps, 'onOperationChange' | 'canAutoNavigate'>> {
      const original = { ...identity };
      const identityId = identityKey(original);
      const generation = authGeneration;
      const capturedEpoch = epoch;
      const boundScope = scope;
      const authorized = () =>
        boundScope !== null && scope === boundScope && authGeneration === generation;
      return {
        canAutoNavigate: () =>
          authorized() &&
          epoch === capturedEpoch &&
          Boolean(
            view?.visible &&
            view.projectId === original.projectId &&
            view.taskId === original.taskId,
          ),
        onOperationChange(snapshot) {
          if (!authorized() || identityKey(snapshot) !== identityId || !snapshot.operationId)
            return;
          if (dismissed.has(JSON.stringify([identityId, snapshot.operationId]))) return;
          const index = records.findIndex(
            (record) =>
              identityKey(record) === identityId && record.operationId === snapshot.operationId,
          );
          const previous = records[index];
          // A random terminal callback cannot invent a completed operation.
          if (!previous && snapshot.phase !== 'pending') return;
          if (previous && !lockedPhases.has(previous.phase)) return;
          // Retrying creates a NEW operationId; it must not reset an uncertain attempt.
          if (previous && snapshot.phase === 'pending') return;
          const next = Object.freeze({
            ...original,
            operationId: snapshot.operationId,
            phase: snapshot.phase,
            message: snapshot.message,
            // Only resolved results from the validated child contract can expose a local workspace link.
            ...(snapshot.phase === 'resolved' &&
            /^\/workspace\/[^/?#]+$/.test(snapshot.resultHref ?? '')
              ? { resultHref: snapshot.resultHref }
              : {}),
          });
          publish(
            index < 0
              ? [...records, next]
              : records.map((record, i) => (i === index ? next : record)),
          );
        },
      };
    },
  };
}
export type ReviewOperationOwner = ReturnType<typeof createReviewOperationOwner>;
export function hasReviewOperationLock(
  records: readonly OwnedReviewOperation[],
  projectId?: string,
  taskId?: string,
): boolean {
  return records.some(
    (record) =>
      lockedPhases.has(record.phase) &&
      (projectId === undefined || record.projectId === projectId) &&
      (taskId === undefined || record.taskId === taskId),
  );
}
