import { useCallback, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, authSession, type FileEntry } from '../../lib/api';

// Each mounted project owner has a distinct cache generation. Cancellation is
// not the security boundary: a transport may resolve after its signal aborts.
let nextOwner = 0;
export function useProjectDirectoryLoader(projectId?: string, realRootPath?: string) {
  const client = useQueryClient();
  const owner = useMemo(
    () => ({ id: ++nextOwner, active: false, epoch: 0 }),
    [projectId, realRootPath],
  );
  useEffect(() => {
    owner.active = true;
    owner.epoch += 1;
    const revoke = () => {
      owner.active = false;
      owner.epoch += 1;
      const filters = { queryKey: ['files', projectId, realRootPath] };
      void client.cancelQueries(filters);
      client.removeQueries(filters);
    };
    const unsubscribe = authSession.onAuthorizationRequired(revoke);
    return () => {
      unsubscribe();
      revoke();
    };
  }, [client, owner, projectId, realRootPath]);
  return useCallback(
    (path: string) => {
      if (!projectId || !owner.active)
        return Promise.reject(new Error('目录访问权限已失效，请重新打开项目'));
      const epoch = owner.epoch;
      return client.fetchQuery({
        queryKey: ['files', projectId, realRootPath, path, owner.id, epoch],
        queryFn: async ({ signal }) => {
          const entries = await api.get<FileEntry[]>(
            `/projects/${projectId}/files?depth=0&path=${encodeURIComponent(path)}`,
            { signal },
          );
          if (!owner.active || owner.epoch !== epoch || signal.aborted)
            throw new Error('目录请求已失效');
          return entries;
        },
        staleTime: 30_000,
        retry: false,
      });
    },
    [client, owner, projectId, realRootPath],
  );
}
