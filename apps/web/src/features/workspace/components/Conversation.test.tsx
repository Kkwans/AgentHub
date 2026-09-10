import { describe, expect, it } from 'vitest';

import type { ApprovalRecord, EventRecord, MessageRecord } from '../../../lib/api';
import {
  buildConversationTimeline,
  buildConversationTurns,
  CONVERSATION_WINDOW_SIZE,
  CONVERSATION_WINDOW_STEP,
  groupToolTimeline,
  getConversationWindowStart,
  mergeConversationText,
  summarizeToolExecution,
} from './Conversation';

describe('conversation windowing', () => {
  it('超过 500 项时从最新窗口开始，并按固定步长向前展开', () => {
    expect(CONVERSATION_WINDOW_SIZE).toBe(500);
    expect(CONVERSATION_WINDOW_STEP).toBe(250);
    expect(getConversationWindowStart(0)).toBe(0);
    expect(getConversationWindowStart(500)).toBe(0);
    expect(getConversationWindowStart(501)).toBe(1);
    expect(getConversationWindowStart(1_000)).toBe(500);
  });
});

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

  it('将 ACP 计划更新保留为可展开的独立时间线条目并合并同一份计划', () => {
    const events = [
      {
        id: 'plan-1',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 1,
        type: 'agent.plan.updated',
        payloadJson: {
          entries: [
            { content: '读取项目结构', priority: 'high', status: 'pending' },
            { content: '运行测试', priority: 'medium', status: 'pending' },
          ],
        },
        createdAt: '2026-08-30T01:00:01.000Z',
      },
      {
        id: 'plan-2',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 2,
        type: 'agent.plan.updated',
        payloadJson: {
          entries: [
            { content: '读取项目结构', priority: 'high', status: 'completed' },
            { content: '运行测试', priority: 'medium', status: 'in_progress' },
          ],
        },
        createdAt: '2026-08-30T01:00:02.000Z',
      },
    ] satisfies EventRecord[];

    const timeline = buildConversationTimeline([], events);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      kind: 'plan',
      firstSeq: 1,
      event: { id: 'plan-2' },
    });
    expect(timeline[0]?.kind === 'plan' && timeline[0].event.payloadJson.entries).toEqual([
      { content: '读取项目结构', priority: 'high', status: 'completed' },
      { content: '运行测试', priority: 'medium', status: 'in_progress' },
    ]);
  });

  it('兼容 delta 与累计 text，并在事件流只有 delta 时生成临时 Agent 回复', () => {
    const events = [
      {
        id: 'assistant-1',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 1,
        type: 'assistant.message.delta',
        payloadJson: { messageId: 'assistant-1', delta: '检查' },
        createdAt: '2026-08-30T01:00:01.000Z',
      },
      {
        id: 'assistant-2',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 2,
        type: 'assistant.message.delta',
        payloadJson: { messageId: 'assistant-1', text: '检查完成' },
        createdAt: '2026-08-30T01:00:02.000Z',
      },
    ] satisfies EventRecord[];

    const timeline = buildConversationTimeline([], events);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      kind: 'message',
      streaming: true,
      message: { role: 'ASSISTANT', text: '检查完成' },
    });
    expect(mergeConversationText('检查', '检查完成')).toBe('检查完成');
    expect(mergeConversationText('检查完成', '成。')).toBe('检查完成。');
  });

  it('完整 Assistant 消息到达后抑制重复 delta，但保留事件中的思考与工具顺序', () => {
    const messages = [
      {
        id: 'user-1',
        runId: 'run-1',
        role: 'USER',
        kind: 'TEXT',
        text: '请检查',
        sequence: 1,
        createdAt: '2026-08-30T01:00:00.000Z',
      },
      {
        id: 'assistant-1',
        runId: 'run-1',
        role: 'ASSISTANT',
        kind: 'TEXT',
        text: '已完成',
        sequence: 2,
        createdAt: '2026-08-30T01:00:04.000Z',
      },
    ] satisfies MessageRecord[];
    const events = [
      {
        id: 'thought-1',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 1,
        type: 'agent.thought.delta',
        payloadJson: { messageId: 'thought-1', delta: '先核验。' },
        createdAt: '2026-08-30T01:00:01.000Z',
      },
      {
        id: 'tool-1',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 2,
        type: 'tool.call.started',
        payloadJson: { toolCallId: 'call-1', name: 'read_file' },
        createdAt: '2026-08-30T01:00:02.000Z',
      },
    ] satisfies EventRecord[];

    const timeline = buildConversationTimeline(messages, events);
    expect(timeline.map((item) => item.kind)).toEqual(['message', 'thought', 'tool', 'message']);
    expect(timeline.filter((item) => item.kind === 'message')).toHaveLength(2);
    expect(timeline.at(-1)).toMatchObject({ message: { id: 'assistant-1', text: '已完成' } });
  });

  it('按请求事件把 Approval 插回真实因果位置，旧记录回退 requestedAt', () => {
    const messages = [
      {
        id: 'user-1',
        runId: 'run-1',
        role: 'USER',
        kind: 'TEXT',
        text: '请执行',
        sequence: 1,
        createdAt: '2026-08-30T01:00:00.000Z',
      },
      {
        id: 'assistant-1',
        runId: 'run-1',
        role: 'ASSISTANT',
        kind: 'TEXT',
        text: '等待确认',
        sequence: 2,
        createdAt: '2026-08-30T01:00:04.000Z',
      },
    ] satisfies MessageRecord[];
    const events = [
      {
        id: 'approval-event',
        sessionId: 'session-1',
        runId: 'run-1',
        seq: 3,
        type: 'approval.requested',
        payloadJson: { approvalId: 'provider-1', approvalRequestId: 'approval-1' },
        createdAt: '2026-08-30T01:00:03.000Z',
      },
    ] satisfies EventRecord[];
    const approval = {
      id: 'approval-1',
      sessionId: 'session-1',
      runId: 'run-1',
      title: '允许执行命令？',
      description: null,
      status: 'PENDING',
      optionsJson: [{ id: 'allow', label: '允许' }],
      selectedOptionId: null,
      deliveryId: null,
      deliveryState: null,
      deliveryAttemptCount: null,
      deliveryErrorCode: null,
      deliveryErrorMessage: null,
      requestedAt: '2026-08-30T01:00:03.000Z',
      resolvedAt: null,
    } as ApprovalRecord & { requestedAt: string; resolvedAt: null };

    const timeline = buildConversationTimeline(messages, events, [approval]);
    expect(timeline.map((item) => item.kind)).toEqual(['message', 'approval', 'message']);
    expect(timeline[1]).toMatchObject({
      kind: 'approval',
      firstSeq: 3,
      requestEvent: { id: 'approval-event' },
    });
  });

  it('把交错的 Run 事件归属到各自轮次，并且每轮只标记一个 Agent 头', () => {
    const timeline = buildConversationTimeline(
      [
        {
          id: 'user-1',
          runId: 'run-1',
          role: 'USER',
          kind: 'TEXT',
          text: '第一轮',
          sequence: 1,
          createdAt: '2026-08-30T01:00:00.000Z',
        },
        {
          id: 'user-2',
          runId: 'run-2',
          role: 'USER',
          kind: 'TEXT',
          text: '第二轮',
          sequence: 2,
          createdAt: '2026-08-30T01:00:05.000Z',
        },
      ],
      [
        {
          id: 'assistant-1',
          sessionId: 'session-1',
          runId: 'run-1',
          seq: 1,
          type: 'assistant.message.delta',
          payloadJson: { messageId: 'm-1', text: '第一轮回复' },
          createdAt: '2026-08-30T01:00:01.000Z',
        },
        {
          id: 'assistant-2',
          sessionId: 'session-1',
          runId: 'run-2',
          seq: 2,
          type: 'assistant.message.delta',
          payloadJson: { messageId: 'm-2', text: '第二轮回复' },
          createdAt: '2026-08-30T01:00:06.000Z',
        },
      ],
    );

    const turns = buildConversationTurns(timeline);
    expect(turns).toHaveLength(2);
    expect(
      turns.map((turn) => turn.entries.filter((item) => item.kind === 'message').length),
    ).toEqual([2, 2]);
    expect(turns[0]?.entries.every((item) => item.turnId === turns[0]?.id)).toBe(true);
    expect(turns[1]?.entries.every((item) => item.turnId === turns[1]?.id)).toBe(true);
  });
});
