import { expect, it } from 'vitest';
import type { EventRecord, MessageRecord } from '../../../lib/api';
import { buildConversationTimeline } from './conversationModel';

// Reproduces the real ACP contract: separated deltas around a tool, then one
// cumulative completion persisted as one MessageRecord. Not a fixture rewrite.
it('renders opening/tool/conclusion once when a complete persisted ACP answer arrives', () => {
  const opening = '我会先核对状态，再补充取消检查。';
  const conclusion = '\n\n演示改动已准备好。';
  const events: EventRecord[] = [
    {
      id: 'opening',
      sessionId: 's',
      runId: 'r',
      seq: 1,
      type: 'assistant.message.delta',
      payloadJson: { text: opening },
      createdAt: '2026-11-14T13:00:01Z',
    },
    {
      id: 'tool',
      sessionId: 's',
      runId: 'r',
      seq: 2,
      type: 'tool.call.completed',
      payloadJson: { toolCallId: 'call', name: '读取代码', status: 'completed' },
      createdAt: '2026-11-14T13:00:02Z',
    },
    {
      id: 'conclusion',
      sessionId: 's',
      runId: 'r',
      seq: 3,
      type: 'assistant.message.delta',
      payloadJson: { text: conclusion },
      createdAt: '2026-11-14T13:00:03Z',
    },
    {
      id: 'completion',
      sessionId: 's',
      runId: 'r',
      seq: 4,
      type: 'assistant.message.completed',
      payloadJson: { text: opening + conclusion },
      createdAt: '2026-11-14T13:00:04Z',
    },
  ];
  const saved: MessageRecord = {
    id: 'saved',
    runId: 'r',
    role: 'ASSISTANT',
    kind: 'TEXT',
    text: opening + conclusion,
    sequence: 2,
    createdAt: '2026-11-14T13:00:04Z',
  };
  const timeline = buildConversationTimeline([saved], events);
  const rendered = timeline
    .filter((entry) => entry.kind === 'message')
    .map((entry) => entry.displayText ?? entry.message.text)
    .join('');
  expect(rendered.split('演示改动已准备好。')).toHaveLength(2);
  expect(timeline.map((entry) => entry.kind)).toEqual(['message', 'tool', 'message']);
  expect(timeline[0]).toMatchObject({
    message: saved,
    displayText: opening,
    copyText: opening + conclusion,
    persisted: true,
  });
  expect(timeline.filter((item) => item.kind === 'message' && item.persisted)).toHaveLength(1);
  expect(timeline[2]).toMatchObject({
    message: { text: conclusion },
    copyText: '',
    persisted: false,
  });
});

function sample(runId: string | null = 'r', savedText = '开始。\n\n结束。') {
  const record: MessageRecord = {
    id: 'saved',
    runId,
    role: 'ASSISTANT',
    kind: 'TEXT',
    text: savedText,
    sequence: 99,
    createdAt: '2026-11-14T13:00:04Z',
  };
  const events: EventRecord[] = [
    ['assistant.message.delta', { text: '开始。' }],
    ['tool.call.completed', { toolCallId: 'call', name: '读取', status: 'completed' }],
    ['assistant.message.delta', { text: '\n\n结束。' }],
    ['assistant.message.completed', { text: savedText }],
  ].map(([type, payload], index) => ({
    id: `e${index}`,
    sessionId: 's',
    runId,
    seq: index + 1,
    type: type as string,
    payloadJson: payload as Record<string, unknown>,
    createdAt: '2026-11-14T13:00:01Z',
  }));
  return { record, events };
}
it('preserves causal order even when all events share a timestamp and saved sequence is a different domain', () => {
  const { record, events } = sample();
  const items = buildConversationTimeline([record], events);
  expect(items.map((item) => item.kind)).toEqual(['message', 'tool', 'message']);
  expect(items[0]).toMatchObject({ message: record, eventSequence: 1 });
  expect(
    items
      .filter((item) => item.kind === 'message')
      .map((item) => item.copyText)
      .filter(Boolean),
  ).toEqual([record.text]);
});
it.each(['partial', 'multiple', 'null-run', 'nonexact', 'no-completion'] as const)(
  'does not manufacture a split saved identity from ambiguous %s evidence',
  (kind) => {
    const { record, events } = sample(
      kind === 'null-run' ? null : 'r',
      kind === 'nonexact' ? '开始。\n\n改过的结束。' : undefined,
    );
    const saved =
      kind === 'multiple' ? [record, { ...record, id: 'other', sequence: 100 }] : [record];
    const source =
      kind === 'partial'
        ? events.slice(1)
        : kind === 'no-completion'
          ? events.slice(0, -1)
          : events;
    const items = buildConversationTimeline(saved, source);
    expect(items.some((item) => item.kind === 'message' && item.displayText !== undefined)).toBe(
      false,
    );
    expect(
      items.flatMap((item) => (item.kind === 'message' && item.persisted ? [item.message] : [])),
    ).toEqual(saved);
  },
);
it('reconciles only the matching run without dropping another run that happens to share its text', () => {
  const { record, events } = sample();
  const other = events.map((event) => ({ ...event, id: `other-${event.id}`, runId: 'other' }));
  const items = buildConversationTimeline([record], [...events, ...other]);
  expect(
    items.filter((item) => item.kind === 'message' && item.message.runId === 'other'),
  ).toHaveLength(2);
  expect(items.filter((item) => item.kind === 'message' && item.persisted)).toHaveLength(1);
});
