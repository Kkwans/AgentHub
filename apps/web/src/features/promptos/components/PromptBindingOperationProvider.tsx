import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { authSession } from '../../../lib/auth-api';
import {
  createBindingOperationOwner,
  type BindingOperationOwner,
  type BindingOperationSnapshot,
} from '../lib/binding-operation-owner';
const Context = createContext<BindingOperationOwner | null>(null);
const empty: BindingOperationSnapshot = Object.freeze({
  records: Object.freeze([]),
  authorized: false,
  epoch: 0,
});
const noSubscribe = () => () => undefined;
const emptySnapshot = () => empty;
export function useBindingOperations() {
  const owner = useContext(Context);
  const snapshot = useSyncExternalStore(
    owner?.subscribe ?? noSubscribe,
    owner?.getSnapshot ?? emptySnapshot,
  );
  return { owner, operations: snapshot.records };
}
export function PromptBindingOperationProvider({ children }: PropsWithChildren) {
  const mode = useAuthMode();
  const user = useAuthUser();
  const scope =
    mode === 'local_trusted' ? mode : mode === 'token' && user?.id ? `token:${user.id}` : null;
  return (
    <ScopedOperations key={scope ?? 'unauthorized'} scope={scope}>
      {children}
    </ScopedOperations>
  );
}
function ScopedOperations({ children, scope }: PropsWithChildren<{ scope: string | null }>) {
  const client = useQueryClient();
  const [owner] = useState(() =>
    createBindingOperationOwner((promptId) => {
      void client.invalidateQueries({ queryKey: ['prompt-bindings', promptId] });
    }),
  );
  useLayoutEffect(() => {
    if (scope) owner.activate();
    const unsubscribe = authSession.onAuthorizationRequired(owner.revoke);
    return () => {
      owner.revoke();
      unsubscribe();
    };
  }, [owner, scope]);
  return <Context.Provider value={owner}>{children}</Context.Provider>;
}
