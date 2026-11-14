import { inspectLocationMessages, oldestMessageSequence, waitForLocation } from './messageLocation';
import type { SavedMessageTarget } from './sessionMessageSearch';
import { useEffect, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useQueryClient,
  type QueryClient,
  type InfiniteData,
} from '@tanstack/react-query';

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
  const [navigating, setNavigating] = useState(false);
  const navigation = useRef<AbortController | null>(null);
  const cancelNavigation = useRef<() => void>(() => {});
  const identity = useRef(sessionId);
  const generation = useRef(0);
  if (identity.current !== sessionId) {
    identity.current = sessionId;
    generation.current += 1;
  }
  const cancelOwnedRead = () => {
    const token = requests.current.get(sessionId);
    if (!token || inFlightOwners.get(client)?.get(sessionId) !== token) return Promise.resolve();
    return client.cancelQueries(
      { queryKey: ['messages', sessionId], exact: true },
      { revert: false },
    );
  };
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
      navigation.current?.abort();
      generation.current += 1;
      authorized.current = false;
      setRevoked(true);
      cancelOwned();
    });
    return () => {
      generation.current += 1;
      navigation.current?.abort();
      unsubscribe();
      cancelOwned();
    };
  }, [client, sessionId]);
  const query = useInfiniteQuery({
    queryKey: ['messages', sessionId],
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) });
      if (pageParam > 0) params.set('beforeSequence', String(pageParam));
      const token = Symbol('session-message-read');
      requests.current.set(sessionId, token);
      inFlightOwners.get(client)!.set(sessionId, token);
      try {
        const incoming = await api.get<MessageRecord[]>(
          `/sessions/${sessionId}/messages?${params.toString()}`,
          { signal },
        );
        if (pageParam > 0) return incoming;
        // A newer tail window must not discard an already read boundary row.
        // Saved messages are append-only; fresh records replace matching sequences.
        const cached = client.getQueryData<InfiniteData<MessageRecord[], number>>([
          'messages',
          sessionId,
        ]);
        const latestIndex = cached?.pageParams.findIndex((cursor) => !cursor) ?? -1;
        return mergeSessionMessages(latestIndex >= 0 ? cached!.pages[latestIndex]! : [], incoming);
      } finally {
        if (requests.current.get(sessionId) === token) requests.current.delete(sessionId);
        if (inFlightOwners.get(client)?.get(sessionId) === token)
          inFlightOwners.get(client)!.delete(sessionId);
      }
    },
    // Zero is a local latest-page sentinel, never a transmitted beforeSequence.
    // Unlike undefined, it lets InfiniteQuery replay the full loaded cursor chain
    // during refetch, rather than silently dropping every page after the oldest.
    initialPageParam: 0,
    getNextPageParam: (_lastPage, _pages, lastPageParam) => {
      const cached = client.getQueryData<InfiniteData<MessageRecord[], number>>([
        'messages',
        sessionId,
      ]);
      const cursors = cached?.pageParams.map((cursor) => cursor ?? 0) ?? [];
      const index = cursors.indexOf(lastPageParam ?? 0);
      return index >= 0 ? cursors[index + 1] : undefined;
    },
    getPreviousPageParam: (firstPage) => getPreviousMessageCursor(firstPage),
    enabled: Boolean(sessionId) && enabled && !revoked,
    refetchInterval: navigating ? false : 3_000,
  });

  const locateMessage = async (
    target: SavedMessageTarget,
    signal: AbortSignal,
    reveal: (signal: AbortSignal) => Promise<void>,
    onProgress: (pages: number) => void,
  ): Promise<'located' | 'budget'> => {
    if (
      !authorized.current ||
      identity.current !== sessionId ||
      target.sessionId !== sessionId ||
      signal.aborted
    )
      throw new Error('定位已取消。');
    if (navigation.current) throw new Error('另一项历史定位仍在进行。');
    const owner = new AbortController();
    const captured = generation.current;
    navigation.current = owner;
    setNavigating(true);
    let timedOut = false;
    const cancel = () => {
      owner.abort();
      if (navigation.current === owner) void cancelOwnedRead();
    };
    cancelNavigation.current = cancel;
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      cancel();
    }, 10_000);
    const valid = () =>
      authorized.current &&
      generation.current === captured &&
      navigation.current === owner &&
      !owner.signal.aborted;
    let count = 0;
    try {
      await waitForLocation(cancelOwnedRead(), owner.signal);
      while (valid()) {
        const data = client.getQueryData<InfiniteData<MessageRecord[]>>(['messages', sessionId]);
        const rows = data?.pages.flat() ?? [];
        if (inspectLocationMessages(rows, target)) {
          await waitForLocation(reveal(owner.signal), owner.signal);
          if (!valid()) break;
          return 'located';
        }
        if (count >= 5) return 'budget';
        const before = oldestMessageSequence(rows);
        if (data?.pages.length && getPreviousMessageCursor(data.pages[0]!) === undefined)
          throw new Error('已到历史开头，未找到原消息。');
        const result = await waitForLocation(
          data?.pages.length
            ? query.fetchPreviousPage({ cancelRefetch: false })
            : query.refetch({ cancelRefetch: false }),
          owner.signal,
        );
        if (!valid()) break;
        if (result.error) throw new Error('读取历史失败，请重试定位。');
        count += 1;
        onProgress(count);
        const after = result.data?.pages.flat() ?? [];
        if (before !== undefined && (!after.length || oldestMessageSequence(after)! >= before))
          throw new Error('历史游标未前进，已停止定位。');
      }
      if (timedOut) return 'budget';
      throw new Error('定位已取消。');
    } catch (error) {
      if (timedOut) return 'budget';
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (navigation.current === owner) {
        navigation.current = null;
        cancelNavigation.current = () => {};
        setNavigating(false);
      }
    }
  };

  return {
    data: mergeSessionMessages([], query.data?.pages.flat() ?? []),
    error: query.error ?? null,
    isLoading: query.isLoading,
    refetch: () =>
      authorized.current && !navigation.current ? query.refetch() : Promise.resolve(undefined),
    hasPrevious: query.hasPreviousPage,
    isFetchingPrevious: query.isFetchingPreviousPage,
    fetchPrevious: () =>
      !authorized.current || navigation.current
        ? Promise.resolve(undefined)
        : query.fetchPreviousPage(),
    isNavigatingHistory: navigating,
    cancelHistoryNavigation: () => cancelNavigation.current(),
    locateMessage,
  };
}
