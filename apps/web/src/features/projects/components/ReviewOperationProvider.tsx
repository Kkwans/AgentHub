import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { browserCreationScope } from '../lib/task-creation-recovery';
import {
  createReviewOperationOwner,
  type ReviewOperationOwner,
} from '../lib/review-operation-owner';
import type { ReviewOperationProps, ReviewOperationSnapshot } from './review-operation';

type Identity = Pick<ReviewOperationSnapshot, 'projectId' | 'taskId' | 'executionId'>;
type ReviewContext = {
  owner: ReviewOperationOwner;
  contract: (identity: Identity) => ReviewOperationProps;
};
const Context = createContext<ReviewContext | null>(null);
export const useReviewOperations = () => useContext(Context);

/** Inside AccessGate, above Routes. A new identity never renders the old owner. */
export function ReviewOperationProvider({ children }: PropsWithChildren) {
  const scope = browserCreationScope(useAuthMode(), useAuthUser());
  return (
    <ScopedOwner key={scope ?? 'unauthorized'} scope={scope}>
      {children}
    </ScopedOwner>
  );
}
function ScopedOwner({ scope, children }: PropsWithChildren<{ scope: string | null }>) {
  const [owner] = useState(() => {
    const next = createReviewOperationOwner();
    next.setScope(scope);
    return next;
  });
  const location = useLocation();
  const latestLocation = useRef(location.key);
  latestLocation.current = location.key;
  useLayoutEffect(() => {
    // Child layout effects register the current view before this parent effect.
    // StrictMode replays setup after cleanup invalidated scope; preserve only
    // that freshly registered view, never the old generation or its records.
    const registeredView = owner.getView();
    owner.setScope(scope);
    owner.setView(registeredView);
    return () => owner.setScope(null);
  }, [owner, scope]);
  const contract = (identity: Identity): ReviewOperationProps => {
    // StrictMode can replay auth effects after render. Bind at the first pending
    // notification, then freeze that binding for this submitted operation.
    let submitted: ReturnType<ReviewOperationOwner['bind']> | undefined;
    return {
      onOperationChange: (snapshot) => {
        if (!submitted && snapshot.phase === 'pending') submitted = owner.bind(identity);
        submitted?.onOperationChange(snapshot);
      },
      captureNavigationGate: () => {
        const routeKey = latestLocation.current;
        const gate = owner.bind(identity).canAutoNavigate;
        return () => latestLocation.current === routeKey && gate();
      },
    };
  };
  return <Context.Provider value={{ owner, contract }}>{children}</Context.Provider>;
}
