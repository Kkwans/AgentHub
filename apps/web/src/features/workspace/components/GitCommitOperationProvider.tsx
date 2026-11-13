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
import { api } from '../../../lib/api';
import { authSession } from '../../../lib/auth-api';
import { browserCreationScope } from '../../projects/lib/task-creation-recovery';
import {
  createGitCommitOwner,
  type GitCommitInput,
  type GitCommitOperation,
} from '../lib/git-commit-owner';

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
  const submit = (input: GitCommitInput, onCommitted: () => void, onRefreshError: () => void) => {
    if (!context) return Promise.reject(new Error('Git 提交保护不可用，未发起写入。'));
    return context.owner.submit(
      input,
      (original) =>
        api.post<unknown>(`/projects/${original.projectId}/git/commit`, {
          mode: 'SELECTED',
          paths: original.paths,
          message: original.message,
        }),
      async (original) => {
        const current = () =>
          context.owner
            .getSnapshot()
            .some((record) => record.input === original && record.phase === 'committed');
        if (!current()) return;
        onCommitted();
        if (!current()) return;
        try {
          await Promise.all(
            ['git-status', 'git-diff', 'git-commits', 'git-branches'].map((key) =>
              context.client.invalidateQueries({ queryKey: [key, original.projectId] }),
            ),
          );
        } catch {
          if (current()) onRefreshError();
        }
      },
    );
  };
  return { owner, operations, submit };
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
