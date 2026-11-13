import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { authSession } from '../../../lib/auth-api';
import { browserCreationScope } from '../../projects/lib/task-creation-recovery';
import { createGitCommitOwner, type GitCommitOperation } from '../lib/git-commit-owner';

type Owner = ReturnType<typeof createGitCommitOwner>;
const Context = createContext<{ owner: Owner; client: QueryClient } | null>(null);
const empty: readonly GitCommitOperation[] = Object.freeze([]);
const noSubscribe = () => () => undefined;
const emptySnapshot = () => empty;
export function useGitCommitOperations() {
  const context = useContext(Context);
  const owner = context?.owner ?? null;
  const operations = useSyncExternalStore(
    owner?.subscribe ?? noSubscribe,
    owner?.getSnapshot ?? emptySnapshot,
  );
  return { owner, operations, client: context?.client };
}
/** Below AccessGate, above Routes. Route changes retain records; auth changes do not. */
export function GitCommitOperationProvider({ children }: PropsWithChildren) {
  const scope = browserCreationScope(useAuthMode(), useAuthUser());
  return (
    <ScopedOperations key={scope ?? 'unauthorized'} scope={scope}>
      {children}
    </ScopedOperations>
  );
}
function ScopedOperations({ children, scope }: PropsWithChildren<{ scope: string | null }>) {
  const [owner] = useState(createGitCommitOwner);
  const client = useQueryClient();
  useLayoutEffect(() => {
    if (scope) owner.activate();
    const unsubscribe = authSession.onAuthorizationRequired(owner.revoke);
    return () => {
      owner.revoke();
      unsubscribe();
    };
  }, [owner, scope]);
  return <Context.Provider value={{ owner, client }}>{children}</Context.Provider>;
}
