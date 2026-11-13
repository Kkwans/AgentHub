import { useSyncExternalStore } from 'react';
import type { OwnedReviewOperation, ReviewOperationOwner } from '../lib/review-operation-owner';

/** Subscribe only. Component unmount must not clear the higher-lifetime owner. */
const empty: readonly OwnedReviewOperation[] = Object.freeze([]);
const emptySnapshot = () => empty;
const noopSubscribe = () => () => undefined;
export function useReviewOperationOwner(owner: ReviewOperationOwner | null) {
  return useSyncExternalStore(
    owner?.subscribe ?? noopSubscribe,
    owner?.getSnapshot ?? emptySnapshot,
    owner?.getSnapshot ?? emptySnapshot,
  );
}
