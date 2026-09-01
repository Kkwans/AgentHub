import { describe, expect, it } from 'vitest';

import type { EventRecord, MessageRecord } from '../../../lib/api';
import {
  buildConversationTimeline,
  groupToolTimeline,
  summarizeToolExecution,
} from './Conversation';

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

  it('为连续工具调用计算文件、命令和搜索摘要', () => {
    const events = [
      {
        id: 'tool-read',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 1,
        type: 'tool.call.completed',
        payloadJson: { tool: 'read_file', locations: [{ path: 'src/App.tsx' }] },
        createdAt: '2026-08-30T01:00:00.000Z',
      },
      {
        id: 'tool-command',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 2,
        type: 'tool.call.completed',
        payloadJson: { tool: 'exec_command', command: 'pnpm test', path: 'src/App.tsx' },
        createdAt: '2026-08-30T01:00:01.000Z',
      },
      {
        id: 'tool-search',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 3,
        type: 'tool.call.completed',
        payloadJson: {
          tool: 'search',
          query: 'Composer',
          paths: ['src/App.tsx', 'src/Composer.tsx'],
        },
        createdAt: '2026-08-30T01:00:02.000Z',
      },
    ] satisfies EventRecord[];

    expect(summarizeToolExecution(events)).toEqual({
      operations: 3,
      files: 2,
      commands: 1,
      searches: 1,
    });
  });

  it('只合并连续工具调用，消息或思考会开启新的执行组', () => {
    const events = [
      {
        id: 'tool-1',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 1,
        type: 'tool.call.completed',
        payloadJson: { toolCallId: 'call-1', tool: 'read_file', path: 'a.ts' },
        createdAt: '2026-08-30T01:00:00.000Z',
      },
      {
        id: 'tool-2',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 2,
        type: 'tool.call.completed',
        payloadJson: { toolCallId: 'call-2', tool: 'exec_command', command: 'pnpm test' },
        createdAt: '2026-08-30T01:00:01.000Z',
      },
      {
        id: 'tool-3',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 3,
        type: 'tool.call.completed',
        payloadJson: { toolCallId: 'call-3', tool: 'search', query: 'agent' },
        createdAt: '2026-08-30T01:00:02.000Z',
      },
    ] satisfies EventRecord[];
    const items = buildConversationTimeline([], events);
    const grouped = groupToolTimeline(items);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      kind: 'tool-group',
      events: [events[0], events[1], events[2]],
    });
  });
});
