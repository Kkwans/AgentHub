import { describe, expect, it } from 'vitest';

import type { MessageRecord } from '../../../lib/api';
import type { ChatEntryRendererProps } from './ChatEntryRenderer';
import { areChatEntryRendererPropsEqual } from './ChatEntryRenderer';

const message: MessageRecord = {
  id: 'message-1',
  runId: 'run-1',
  role: 'ASSISTANT',
  kind: 'TEXT',
  text: '已完成',
  sequence: 2,
  createdAt: '2026-09-10T08:00:00.000Z',
};
const onResolve = () => undefined;

function props(overrides: Partial<ChatEntryRendererProps> = {}): ChatEntryRendererProps {
  return {
    item: {
      kind: 'message',
      id: message.id,
      createdAt: message.createdAt,
      message,
    },
    resolving: undefined,
    resolveError: undefined,
    resolveVariables: undefined,
    activeThoughtId: undefined,
    onResolve,
    ...overrides,
  };
}

describe('ChatEntryRenderer memo comparison', () => {
  it('ignores fresh timeline wrappers when visual message fields are unchanged', () => {
    const previous = props();
    const next = props({
      item: {
        kind: 'message',
        id: message.id,
        createdAt: message.createdAt,
        message: { ...message },
      },
    });

    expect(areChatEntryRendererPropsEqual(previous, next)).toBe(true);
  });

  it('rerenders when streaming text or control state changes', () => {
    const previous = props();
    const changedText = props({
      item: {
        kind: 'message',
        id: message.id,
        createdAt: message.createdAt,
        streaming: true,
        message: { ...message, text: '已完成，已验证' },
      },
    });
    const changedControl = props({ resolving: 'approval-1' });

    expect(areChatEntryRendererPropsEqual(previous, changedText)).toBe(false);
    expect(areChatEntryRendererPropsEqual(previous, changedControl)).toBe(false);
  });
});
