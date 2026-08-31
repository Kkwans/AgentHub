import { describe, expect, it } from 'vitest';

import type { MessageRecord } from '../../lib/api';
import {
  getPreviousMessageCursor,
  mergeSessionMessages,
  MESSAGE_PAGE_SIZE,
} from './messageHistory';

function message(sequence: number, text = `消息 ${sequence}`): MessageRecord {
  return {
    id: `message-${sequence}`,
    runId: null,
    role: 'ASSISTANT',
    kind: 'TEXT',
    text,
    sequence,
    createdAt: new Date(sequence * 1_000).toISOString(),
  };
}

describe('session message history', () => {
  it('按 sequence 合并重叠页并让较新的页覆盖重复项', () => {
    expect(
      mergeSessionMessages([message(3), message(4)], [message(2), message(3, '更新')]),
    ).toEqual([message(2), message(3, '更新'), message(4)]);
  });

  it('只有完整页才提供 beforeSequence 游标', () => {
    const page = Array.from({ length: MESSAGE_PAGE_SIZE }, (_, index) => message(index + 11));
    expect(getPreviousMessageCursor(page)).toBe(11);
    expect(getPreviousMessageCursor(page.slice(1))).toBeUndefined();
    expect(getPreviousMessageCursor([])).toBeUndefined();
  });
});
