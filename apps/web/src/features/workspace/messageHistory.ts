import type { MessageRecord } from '../../lib/api';

export const MESSAGE_PAGE_SIZE = 100;

/** Merge overlapping realtime/refetch pages while keeping the oldest-first timeline order. */
export function mergeSessionMessages(
  existing: MessageRecord[],
  incoming: MessageRecord[],
): MessageRecord[] {
  const bySequence = new Map<number, MessageRecord>();
  for (const message of [...existing, ...incoming]) bySequence.set(message.sequence, message);
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

/** A full page proves there may be an older page; a short page is the history boundary. */
export function getPreviousMessageCursor(
  page: MessageRecord[],
  pageSize = MESSAGE_PAGE_SIZE,
): number | undefined {
  if (page.length < pageSize) return undefined;
  const oldest = page.reduce<number | undefined>(
    (current, message) =>
      current === undefined || message.sequence < current ? message.sequence : current,
    undefined,
  );
  return oldest !== undefined && oldest > 0 ? oldest : undefined;
}
