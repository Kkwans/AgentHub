import { describe, expect, it } from 'vitest';

import type { EventRecord, MessageRecord } from '../../../lib/api';
import { buildConversationTimeline } from './Conversation';

describe('buildConversationTimeline', () => {
  it('将用户消息、思考、工具调用和 Agent 响应按真实时间合并为单一流水线', () => {
    const messages = [
      {
        id: 'message-user',
        runId: 'run-1',
        role: 'USER',
        kind: 'TEXT',
        text: '检查当前实现',
        sequence: 1,
        createdAt: '2026-08-30T01:00:00.000Z',
      },
      {
        id: 'message-agent',
        runId: 'run-1',
        role: 'ASSISTANT',
        kind: 'TEXT',
        text: '检查完成',
        sequence: 2,
        createdAt: '2026-08-30T01:02:00.000Z',
      },
    ] satisfies MessageRecord[];
    const events = [
      {
        id: 'event-thought-1',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 1,
        type: 'agent.thought.delta',
        payloadJson: { messageId: 'thought-1', text: '先读取布局，' },
        createdAt: '2026-08-30T01:00:20.000Z',
      },
      {
        id: 'event-thought-2',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 2,
        type: 'agent.thought.delta',
        payloadJson: { messageId: 'thought-1', text: '再核验约束。' },
        createdAt: '2026-08-30T01:00:40.000Z',
      },
      {
        id: 'event-tool-started',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 3,
        type: 'tool.call.started',
        payloadJson: { toolCallId: 'call-1', name: 'read_file' },
        createdAt: '2026-08-30T01:01:00.000Z',
      },
      {
        id: 'event-tool',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 4,
        type: 'tool.call.completed',
        payloadJson: {
          toolCallId: 'call-1',
          status: 'completed',
          locations: [{ path: 'WorkspacePage.tsx' }],
        },
        createdAt: '2026-08-30T01:01:30.000Z',
      },
      {
        id: 'event-ignored',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 5,
        type: 'tool.call.completed',
        payloadJson: { ignored: true },
        createdAt: '2026-08-30T01:01:30.000Z',
      },
    ] satisfies EventRecord[];

    const timeline = buildConversationTimeline(messages, events);
    expect(timeline.map((item) => item.id)).toEqual([
      'message-user',
      'thought:run-1:thought-1',
      'tool:call-1',
      'message-agent',
    ]);
    expect(timeline[1]).toMatchObject({
      kind: 'thought',
      createdAt: '2026-08-30T01:00:20.000Z',
      updatedAt: '2026-08-30T01:00:40.000Z',
      text: '先读取布局，再核验约束。',
    });
    expect(timeline[2]).toMatchObject({
      kind: 'tool',
      createdAt: '2026-08-30T01:01:00.000Z',
      event: {
        type: 'tool.call.completed',
        payloadJson: {
          name: 'read_file',
          status: 'completed',
          locations: [{ path: 'WorkspacePage.tsx' }],
        },
      },
    });
  });
});
