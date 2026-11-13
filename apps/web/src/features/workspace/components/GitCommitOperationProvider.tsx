import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { api } from '../../../lib/api';
import { authSession } from '../../../lib/auth-api';
import { saveGitCommitMarker, readGitCommitRecovery } from '../lib/git-commit-recovery';
import { queryGitCommitRecovery } from '../lib/git-commit-recovery-query';
import {
  newCreationOperationId,
  browserCreationScope,
} from '../../projects/lib/task-creation-recovery';
import {
  createGitCommitOwner,
  type GitCommitInput,
  type GitCommitOperation,
} from '../lib/git-commit-owner';

type Owner = ReturnType<typeof createGitCommitOwner>;
const Context = createContext<{ owner: Owner; client: QueryClient; scope: string | null } | null>(
  null,
);
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
  const recover = useCallback(
    async (projectId: string) => {
      if (!context?.scope) return;
      const { owner, scope } = context;
      const current = owner.authorization();
      if (
        !current() ||
        owner.getSnapshot().some((r) => r.input.projectId === projectId && r.phase === 'pending')
      )
        return;
      let recoveryRecord: GitCommitOperation | undefined;
      try {
        const stored = readGitCommitRecovery(window.localStorage, scope, projectId);
        if (!stored.locked) return;
        owner.recovery(projectId, '正在只读核对原 Git 操作，禁止再次提交。');
        recoveryRecord = owner
          .getSnapshot()
          .find((record) => record.input.projectId === projectId && record.phase === 'unknown');
        const result = await queryGitCommitRecovery({
          storage: window.localStorage,
          scope,
          projectId,
          isCurrent: current,
          get: (path) => api.get(path),
        });
        if (
          result.revoked ||
          !current() ||
          !recoveryRecord ||
          !owner.getSnapshot().includes(recoveryRecord)
        )
          return;
        owner.recovery(
          projectId,
          result.locked ? '原 Git 操作尚未确认；刷新页面不会重发提交，请只读核对操作记录。' : null,
        );
        if (!result.locked && current())
          await Promise.allSettled(
            ['git-status', 'git-diff', 'git-commits', 'git-branches'].map((key) =>
              context.client.invalidateQueries({ queryKey: [key, projectId] }),
            ),
          );
      } catch {
        if (current() && (!recoveryRecord || owner.getSnapshot().includes(recoveryRecord)))
          owner.recovery(projectId, 'Git 恢复记录无法读取或校验，已禁止提交。');
      }
    },
    [context],
  );
  const submit = (input: GitCommitInput, onCommitted: () => void, onRefreshError: () => void) => {
    if (!context) return Promise.reject(new Error('Git 提交保护不可用，未发起写入。'));
    return context.owner.submit(
      input,
      async (original) => {
        if (!context.scope || original.expectedHead === undefined)
          throw new Error('Git 身份或原 HEAD 未确认，未发送提交。');
        const current = context.owner.authorization();
        const marker = saveGitCommitMarker(window.localStorage, {
          scope: context.scope,
          projectId: original.projectId,
          operationId: newCreationOperationId(),
        });
        if (!current()) throw new Error('授权已失效，未发送提交。');
        const result = await api.post<unknown>(`/projects/${original.projectId}/git/commit`, {
          protocolVersion: 1,
          operationId: marker.operationId,
          expectedHead: original.expectedHead,
          mode: 'SELECTED',
          paths: original.paths,
          message: original.message,
        });
        if (
          !result ||
          typeof result !== 'object' ||
          typeof (result as { sha?: unknown }).sha !== 'string' ||
          !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test((result as { sha: string }).sha)
        )
          throw new Error('Git 响应缺少有效完整 SHA，保留原操作以只读恢复。');
        // Only an authenticated durable terminal record clears recovery evidence.
        const recovered = await queryGitCommitRecovery({
          storage: window.localStorage,
          scope: context.scope,
          projectId: original.projectId,
          isCurrent: current,
          get: (path) => api.get(path),
        });
        if (
          recovered.revoked ||
          recovered.locked ||
          !recovered.outcomes.some(
            (item) => item.operationId === marker.operationId && item.state === 'completed',
          )
        )
          throw new Error('Git 持久回执尚未确认，禁止重复提交。');
        return result;
      },
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
  return { owner, operations, submit, recover };
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
  const value = useMemo(() => ({ owner, client, scope }), [owner, client, scope]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
