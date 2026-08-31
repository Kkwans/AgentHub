import { useInfiniteQuery } from '@tanstack/react-query';

import { api, type MessageRecord } from '../../lib/api';
import type { MessageQueryState } from './workspace-types';
import {
  getPreviousMessageCursor,
  mergeSessionMessages,
  MESSAGE_PAGE_SIZE,
} from './messageHistory';

export function useSessionMessages(sessionId: string, enabled = true): MessageQueryState {
  const query = useInfiniteQuery({
    queryKey: ['messages', sessionId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) });
      if (pageParam !== undefined) params.set('beforeSequence', String(pageParam));
      return api.get<MessageRecord[]>(`/sessions/${sessionId}/messages?${params.toString()}`);
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: () => undefined,
    getPreviousPageParam: (firstPage) => getPreviousMessageCursor(firstPage),
    enabled: Boolean(sessionId) && enabled,
    refetchInterval: 3_000,
  });

  return {
    data: mergeSessionMessages([], query.data?.pages.flat() ?? []),
    error: query.error ?? null,
    isLoading: query.isLoading,
    refetch: query.refetch,
    hasPrevious: query.hasPreviousPage,
    isFetchingPrevious: query.isFetchingPreviousPage,
    fetchPrevious: () => query.fetchPreviousPage(),
  };
}
