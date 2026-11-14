import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api, authSession, type MessageRecord } from '../../lib/api';
import type { MessageQueryState } from './workspace-types';
import {
  getPreviousMessageCursor,
  mergeSessionMessages,
  MESSAGE_PAGE_SIZE,
} from './messageHistory';

// A query is shared by observers; only its actual initiating hook may explicitly cancel it.
const inFlightOwners = new WeakMap<QueryClient, Map<string, symbol>>();

export function useSessionMessages(sessionId: string, enabled = true): MessageQueryState {
  const client = useQueryClient();
  const requests = useRef(new Map<string, symbol>());
  const [revoked, setRevoked] = useState(false);
  const authorized = useRef(true);
  if (!inFlightOwners.has(client)) inFlightOwners.set(client, new Map());
  useEffect(() => {
    const ownedRequests = requests.current;
    const cancelOwned = () => {
      const token = ownedRequests.get(sessionId);
      if (!token || inFlightOwners.get(client)?.get(sessionId) !== token) return;
      void client.cancelQueries(
        { queryKey: ['messages', sessionId], exact: true },
        { revert: false },
      );
    };
    const unsubscribe = authSession.onAuthorizationRequired(() => {
      authorized.current = false;
      setRevoked(true);
      cancelOwned();
    });
    return () => {
      unsubscribe();
      cancelOwned();
    };
  }, [client, sessionId]);
  const query = useInfiniteQuery({
    queryKey: ['messages', sessionId],
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) });
      if (pageParam !== undefined) params.set('beforeSequence', String(pageParam));
      const token = Symbol('session-message-read');
      requests.current.set(sessionId, token);
      inFlightOwners.get(client)!.set(sessionId, token);
      try {
        return await api.get<MessageRecord[]>(
          `/sessions/${sessionId}/messages?${params.toString()}`,
          { signal },
        );
      } finally {
        if (requests.current.get(sessionId) === token) requests.current.delete(sessionId);
        if (inFlightOwners.get(client)?.get(sessionId) === token)
          inFlightOwners.get(client)!.delete(sessionId);
      }
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: () => undefined,
    getPreviousPageParam: (firstPage) => getPreviousMessageCursor(firstPage),
    enabled: Boolean(sessionId) && enabled && !revoked,
    refetchInterval: 3_000,
  });

  return {
    data: mergeSessionMessages([], query.data?.pages.flat() ?? []),
    error: query.error ?? null,
    isLoading: query.isLoading,
    refetch: () => (authorized.current ? query.refetch() : Promise.resolve(undefined)),
    hasPrevious: query.hasPreviousPage,
    isFetchingPrevious: query.isFetchingPreviousPage,
    fetchPrevious: () =>
      !authorized.current ? Promise.resolve(undefined) : query.fetchPreviousPage(),
  };
}
