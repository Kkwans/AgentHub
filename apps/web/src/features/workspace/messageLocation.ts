import type { MessageRecord } from '../../lib/api';
import type { SavedMessageTarget } from './sessionMessageSearch';
export type MessageLocationRequest = {
  target: SavedMessageTarget;
  signal: AbortSignal;
  complete: (error?: Error) => void;
};
export function oldestMessageSequence(rows: MessageRecord[]): number | undefined {
  return rows.reduce<number | undefined>(
    (oldest, row) => (oldest === undefined ? row.sequence : Math.min(oldest, row.sequence)),
    undefined,
  );
}
export function inspectLocationMessages(rows: MessageRecord[], target: SavedMessageTarget) {
  if (!target.id || !Number.isSafeInteger(target.sequence) || target.sequence < 1)
    throw new Error('目标消息身份无效。');
  const ids = new Map<string, number>();
  const sequences = new Map<number, string>();
  for (const row of rows) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      !Number.isSafeInteger(row.sequence) ||
      row.sequence < 1 ||
      (ids.has(row.id) && ids.get(row.id) !== row.sequence) ||
      (sequences.has(row.sequence) && sequences.get(row.sequence) !== row.id)
    )
      throw new Error('历史消息序号冲突，无法安全定位。');
    ids.set(row.id, row.sequence);
    sequences.set(row.sequence, row.id);
  }
  const found = rows.find((row) => row.id === target.id);
  if (found && (found.sequence !== target.sequence || !['USER', 'ASSISTANT'].includes(found.role)))
    throw new Error('目标消息身份与搜索结果不一致。');
  if (found) return true;
  const oldest = oldestMessageSequence(rows);
  if (oldest !== undefined && oldest <= target.sequence)
    throw new Error('已读取目标位置，但原消息不存在；请重新搜索。');
  return false;
}
/** Cancellation bounds waiting even when a shared read or renderer ignores its signal. */
export function waitForLocation<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      signal.removeEventListener('abort', cancel);
      reject(new Error('定位已取消。'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', cancel);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', cancel);
        reject(error);
      },
    );
    if (signal.aborted) cancel();
  });
}
