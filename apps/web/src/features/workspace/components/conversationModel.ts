import type { ApprovalRecord, EventRecord, MessageRecord } from '../../../lib/api';

/**
 * Conversation 的显示层模型。
 *
 * 这里刻意只依赖 AgentHub API records，而不依赖 ACP、OpenClaw 或其它
 * provider 类型。事件 payload 仍然是服务端的已归一化 JSON；本文件只读取
 * 用于展示的稳定字段，并对旧/新 delta 字段做兼容处理。
 */

export const CONVERSATION_WINDOW_SIZE = 500;
export const CONVERSATION_WINDOW_STEP = 250;

export type ConversationMessageItem = {
  kind: 'message';
  id: string;
  createdAt: string;
  message: MessageRecord;
  /** 事件流创建的临时消息在完整 MessageRecord 到达前为 true。 */
  streaming?: boolean;
  turnId?: string;
};

export type ConversationThoughtItem = {
  kind: 'thought';
  id: string;
  createdAt: string;
  updatedAt: string;
  runId: string | null;
  firstSeq: number;
  text: string;
  streaming?: boolean;
  turnId?: string;
};

export type ConversationToolItem = {
  kind: 'tool';
  id: string;
  createdAt: string;
  event: EventRecord;
  firstSeq: number;
  updatedAt?: string;
  turnId?: string;
};

export type ConversationPlanItem = {
  kind: 'plan';
  id: string;
  createdAt: string;
  firstSeq: number;
  event: EventRecord;
  updatedAt?: string;
  turnId?: string;
};

export type ConversationApprovalItem = {
  kind: 'approval';
  id: string;
  createdAt: string;
  firstSeq: number;
  approval: ApprovalRecord;
  /** 请求事件存在时用于回溯因果位置；历史数据可能没有该事件。 */
  requestEvent?: EventRecord;
  turnId?: string;
};

export type ConversationTimelineItem =
  | ConversationMessageItem
  | ConversationThoughtItem
  | ConversationToolItem
  | ConversationPlanItem
  | ConversationApprovalItem;

/** Stable name for consumers that render entries without the timeline helpers. */
export type ConversationEntryView = ConversationTimelineItem;

export type ConversationToolGroup = {
  kind: 'tool-group';
  id: string;
  createdAt: string;
  firstSeq: number;
  events: EventRecord[];
  turnId?: string;
};

export type ConversationTurn = {
  id: string;
  runId: string | null;
  createdAt: string;
  firstSeq: number;
  userMessage?: MessageRecord;
  entries: ConversationTimelineItem[];
};

export type ToolExecutionSummary = {
  operations: number;
  files: number;
  commands: number;
  searches: number;
};

type ApprovalRecordWithTimeline = ApprovalRecord & {
  /** requestedAt/resolvedAt are returned by the API but were historically omitted from the UI type. */
  requestedAt?: string | null;
  resolvedAt?: string | null;
  createdAt?: string | null;
  sequence?: number | null;
  seq?: number | null;
};

type EventPayload = Record<string, unknown>;

const TERMINAL_TOOL_STATUSES = new Set(['completed', 'failed']);

function isRecord(value: unknown): value is EventPayload {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readEventText(payload: EventPayload): string | undefined {
  // `delta` is the explicit shape; `text` is the current normalized AgentHub
  // shape and can represent either an incremental or cumulative snapshot.
  return readString(payload.delta) ?? readString(payload.text) ?? readString(payload.content);
}

/**
 * Merge both incremental chunks and cumulative snapshots without duplicating
 * content when a reconnect replays the latest snapshot.
 */
export function mergeConversationText(previous: string, incoming: string): string {
  if (!incoming) return previous;
  if (!previous) return incoming;
  if (incoming === previous) return previous;
  if (incoming.startsWith(previous)) return incoming;

  // Some adapters send an overlapping suffix/prefix around a chunk boundary.
  const maxOverlap = Math.min(previous.length, incoming.length);
  for (let length = maxOverlap; length > 0; length -= 1) {
    if (previous.slice(-length) === incoming.slice(0, length)) {
      return `${previous}${incoming.slice(length)}`;
    }
  }
  return `${previous}${incoming}`;
}

function parsedTime(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = Date.parse(value);
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function compareTimelineItems(
  left: ConversationTimelineItem,
  right: ConversationTimelineItem,
): number {
  const byTime = parsedTime(left.createdAt) - parsedTime(right.createdAt);
  if (byTime !== 0) return byTime;

  const leftSeq = firstSequence(left);
  const rightSeq = firstSequence(right);
  if (leftSeq !== rightSeq) return leftSeq - rightSeq;

  // Message records and event records have separate sequence domains. When
  // both are tied, a user message is the natural start of the turn, followed
  // by thought/tool/approval, then the assistant response.
  return itemKindOrder(left.kind) - itemKindOrder(right.kind);
}

function itemKindOrder(kind: ConversationTimelineItem['kind']): number {
  switch (kind) {
    case 'message':
      return 0;
    case 'thought':
      return 1;
    case 'plan':
      return 2;
    case 'tool':
      return 3;
    case 'approval':
      return 4;
  }
}

function firstSequence(item: ConversationTimelineItem): number {
  switch (item.kind) {
    case 'message':
      return Number.isFinite(item.message.sequence)
        ? item.message.sequence
        : Number.MAX_SAFE_INTEGER;
    case 'thought':
      return item.firstSeq;
    case 'tool':
      return item.firstSeq;
    case 'plan':
      return item.firstSeq;
    case 'approval':
      return item.firstSeq;
  }
}

function eventOrder(left: EventRecord, right: EventRecord): number {
  const byTime = parsedTime(left.createdAt) - parsedTime(right.createdAt);
  if (byTime !== 0) return byTime;
  return left.seq - right.seq || left.id.localeCompare(right.id);
}

function eventIdentity(event: EventRecord): string {
  const payload = event.payloadJson;
  const messageId = readString(payload.messageId);
  return `${event.runId ?? event.sessionId}:${messageId ?? 'default'}`;
}

function toolIdentity(event: EventRecord): string {
  const toolCallId = readString(event.payloadJson.toolCallId);
  return toolCallId ? `tool:${toolCallId}` : `event:${event.id}`;
}

function approvalIds(approval: ApprovalRecordWithTimeline): string[] {
  const candidate = approval as ApprovalRecordWithTimeline & { externalId?: unknown };
  return [approval.id, readString(candidate.externalId)].filter((value): value is string =>
    Boolean(value),
  );
}

function approvalEventMatches(approval: ApprovalRecordWithTimeline, event: EventRecord): boolean {
  if (event.type !== 'approval.requested' && event.type !== 'approval.resolved') return false;
  const payload = event.payloadJson;
  const eventIds = [
    readString(payload.approvalRequestId),
    readString(payload.approvalId),
    readString(payload.externalId),
    readString(payload.requestId),
  ].filter((value): value is string => Boolean(value));
  const ids = approvalIds(approval);
  return eventIds.some((eventId) => ids.includes(eventId));
}

function approvalRequestedAt(
  approval: ApprovalRecordWithTimeline,
  requestEvent?: EventRecord,
): string {
  return (
    approval.requestedAt ??
    requestEvent?.createdAt ??
    approval.createdAt ??
    approval.resolvedAt ??
    ''
  );
}

function approvalSequence(
  approval: ApprovalRecordWithTimeline,
  requestEvent?: EventRecord,
): number {
  if (requestEvent) return requestEvent.seq;
  const candidate = approval.sequence ?? approval.seq;
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? candidate
    : Number.MAX_SAFE_INTEGER;
}

function makeMessageItem(message: MessageRecord, streaming = false): ConversationMessageItem {
  return {
    kind: 'message',
    id: message.id,
    createdAt: message.createdAt,
    message,
    ...(streaming ? { streaming: true } : {}),
  };
}

function syntheticAssistantMessage(
  id: string,
  runId: string | null,
  text: string,
  sequence: number,
  createdAt: string,
): MessageRecord {
  return {
    id,
    runId,
    role: 'ASSISTANT',
    kind: 'TEXT',
    text,
    sequence,
    createdAt,
  };
}

function toolStatus(event: EventRecord): string | undefined {
  const payloadStatus = readString(event.payloadJson.status);
  if (payloadStatus) return payloadStatus.toLowerCase();
  if (event.type.endsWith('.failed')) return 'failed';
  if (event.type.endsWith('.completed')) return 'completed';
  return event.type.endsWith('.started') || event.type.endsWith('.progress')
    ? 'running'
    : undefined;
}

function mergeToolEvent(previous: EventRecord, incoming: EventRecord): EventRecord {
  const previousStatus = toolStatus(previous);
  const incomingStatus = toolStatus(incoming);
  const previousIsTerminal = previousStatus ? TERMINAL_TOOL_STATUSES.has(previousStatus) : false;
  const incomingIsTerminal = incomingStatus ? TERMINAL_TOOL_STATUSES.has(incomingStatus) : false;

  // Keep the latest payload for details/status, except when an out-of-order
  // replay would regress a completed/failed tool back to running.
  const latest = previousIsTerminal && !incomingIsTerminal ? previous : incoming;
  const payloadJson = { ...previous.payloadJson, ...incoming.payloadJson };
  if (previousIsTerminal && !incomingIsTerminal && previousStatus)
    payloadJson.status = previousStatus;
  return {
    ...latest,
    id: previous.id,
    seq: Math.min(previous.seq, incoming.seq),
    createdAt: previous.createdAt,
    payloadJson,
  };
}

function assistantEquivalent(left: string | null | undefined, right: string): boolean {
  const leftText = left?.trim() ?? '';
  const rightText = right.trim();
  return Boolean(
    leftText &&
    rightText &&
    (leftText === rightText || leftText.startsWith(rightText) || rightText.startsWith(leftText)),
  );
}

/**
 * Convert messages and normalized events into a single causal timeline.
 *
 * The third argument is optional to preserve the previous call contract. If
 * Approval records have no matching request event (older sessions), their
 * requestedAt fallback still places them in the correct approximate position.
 */
export function buildConversationTimeline(
  messages: MessageRecord[],
  events: EventRecord[],
  approvals: ApprovalRecord[] = [],
): ConversationTimelineItem[] {
  const orderedEvents = [...events]
    .filter((event) => event.payloadJson.ignored !== true)
    .sort(eventOrder);
  const timeline: ConversationTimelineItem[] = messages.map((message) => makeMessageItem(message));
  const assistantItems = new Map<string, ConversationMessageItem>();
  const assistantActive = new Map<string, string>();
  const assistantSegments = new Map<string, number>();
  const thoughtItems = new Map<string, ConversationThoughtItem>();
  const thoughtActive = new Map<string, string>();
  const thoughtSegments = new Map<string, number>();
  const toolItems = new Map<string, ConversationToolItem>();
  const planItems = new Map<string, ConversationPlanItem>();
  const approvalRequestEvents = orderedEvents.filter(
    (event) => event.type === 'approval.requested' || event.type === 'approval.resolved',
  );

  for (const event of orderedEvents) {
    const payload = event.payloadJson;
    if (event.type === 'assistant.message.delta' || event.type === 'assistant.message.completed') {
      const completionWithoutMessageId =
        event.type === 'assistant.message.completed' && !readString(payload.messageId);
      if (event.runId) {
        const runPrefix = `${event.runId}:`;
        for (const identity of thoughtActive.keys()) {
          if (identity.startsWith(runPrefix)) thoughtActive.delete(identity);
        }
        // Some ACP adapters emit one completion snapshot for the whole Run
        // without carrying the messageId used by individual delta segments.
        // Settle every active assistant segment in that case; otherwise each
        // segment keeps rendering PinHarness's streaming caret forever.
        if (completionWithoutMessageId) {
          for (const [id, item] of assistantItems) {
            if (item.message.runId !== event.runId || !item.streaming) continue;
            const settled = { ...item };
            delete settled.streaming;
            assistantItems.set(id, settled);
          }
          // The completion payload is a cumulative snapshot. Once delta
          // segments already exist, adding it as a new item would duplicate
          // the whole answer after those settled segments.
          if ([...assistantItems.values()].some((item) => item.message.runId === event.runId)) {
            continue;
          }
        }
      }
      const text = readEventText(payload);
      if (!text) continue;
      const identity = eventIdentity(event);
      const activeId = assistantActive.get(identity);
      const previous = activeId ? assistantItems.get(activeId) : undefined;
      const isDelta = event.type === 'assistant.message.delta';
      if (previous) {
        const message = previous.message;
        const nextItem: ConversationMessageItem = {
          ...previous,
          message: {
            ...message,
            text: mergeConversationText(message.text ?? '', text),
            sequence: Math.min(message.sequence, event.seq),
          },
        };
        if (isDelta) nextItem.streaming = true;
        else delete nextItem.streaming;
        assistantItems.set(activeId!, nextItem);
      } else {
        const messageId = readString(payload.messageId);
        const segment = assistantSegments.get(identity) ?? 0;
        assistantSegments.set(identity, segment + 1);
        const id = `assistant:${identity}:${messageId ?? event.seq}:${segment}`;
        const item = makeMessageItem(
          syntheticAssistantMessage(id, event.runId, text, event.seq, event.createdAt),
          isDelta,
        );
        assistantItems.set(id, item);
        assistantActive.set(identity, id);
      }
      continue;
    }

    if (event.type === 'agent.thought.delta') {
      if (event.runId) {
        const runPrefix = `${event.runId}:`;
        for (const identity of assistantActive.keys()) {
          if (identity.startsWith(runPrefix)) assistantActive.delete(identity);
        }
      }
      const text = readEventText(payload);
      if (!text) continue;
      const messageId = readString(payload.messageId);
      const identity = `${event.runId ?? event.sessionId}:${messageId ?? 'default'}`;
      const activeId = thoughtActive.get(identity);
      const previous = activeId ? thoughtItems.get(activeId) : undefined;
      const segment = thoughtSegments.get(identity) ?? 0;
      const id = activeId ?? `thought:${identity}${segment ? `:${segment}` : ''}`;
      thoughtItems.set(
        id,
        previous
          ? {
              ...previous,
              updatedAt: event.createdAt,
              text: mergeConversationText(previous.text, text),
              streaming: true,
            }
          : {
              kind: 'thought',
              id,
              createdAt: event.createdAt,
              updatedAt: event.createdAt,
              runId: event.runId,
              firstSeq: event.seq,
              text,
              streaming: true,
            },
      );
      if (!activeId) {
        thoughtSegments.set(identity, segment + 1);
        thoughtActive.set(identity, id);
      }
      continue;
    }

    // A text stream separated by a thought/tool/approval belongs to distinct
    // causal entries. This avoids moving post-tool text ahead of the tool when
    // several provider deltas share one messageId.
    if (
      event.runId &&
      (event.type.startsWith('tool.') ||
        event.type === 'agent.plan.updated' ||
        event.type.startsWith('approval.'))
    ) {
      const runPrefix = `${event.runId}:`;
      for (const identity of assistantActive.keys()) {
        if (identity.startsWith(runPrefix)) assistantActive.delete(identity);
      }
      for (const identity of thoughtActive.keys()) {
        if (identity.startsWith(runPrefix)) thoughtActive.delete(identity);
      }
    }

    if (event.type === 'agent.plan.updated') {
      const planId = readString(payload.planId) ?? 'default';
      const identity = `${event.runId ?? event.sessionId}:${planId}`;
      const previous = planItems.get(identity);
      planItems.set(
        identity,
        previous
          ? {
              ...previous,
              updatedAt: event.createdAt,
              event,
            }
          : {
              kind: 'plan',
              id: `plan:${identity}`,
              createdAt: event.createdAt,
              firstSeq: event.seq,
              updatedAt: event.createdAt,
              event,
            },
      );
      continue;
    }

    if (!event.type.startsWith('tool.')) continue;
    const id = toolIdentity(event);
    const previous = toolItems.get(id);
    toolItems.set(
      id,
      previous
        ? {
            ...previous,
            updatedAt: event.createdAt,
            event: mergeToolEvent(previous.event, event),
          }
        : {
            kind: 'tool',
            id,
            createdAt: event.createdAt,
            firstSeq: event.seq,
            updatedAt: event.createdAt,
            event,
          },
    );
  }

  // Reconcile event-stream assistant text with the authoritative completed
  // message. This prevents a completed response from appearing twice while
  // still allowing delta-only sessions to render immediately.
  const persistedAssistantMessages = messages.filter((message) => message.role === 'ASSISTANT');
  for (const item of assistantItems.values()) {
    const duplicate = persistedAssistantMessages.some(
      (message) =>
        message.runId === item.message.runId &&
        assistantEquivalent(message.text, item.message.text ?? ''),
    );
    if (!duplicate) timeline.push(item);
  }
  timeline.push(...thoughtItems.values(), ...planItems.values(), ...toolItems.values());

  for (const approval of approvals) {
    const approvalWithTimeline = approval as ApprovalRecordWithTimeline;
    const requestEvent = approvalRequestEvents.find((event) =>
      approvalEventMatches(approvalWithTimeline, event),
    );
    timeline.push({
      kind: 'approval',
      id: `approval:${approval.id}`,
      createdAt: approvalRequestedAt(approvalWithTimeline, requestEvent),
      firstSeq: approvalSequence(approvalWithTimeline, requestEvent),
      approval,
      ...(requestEvent ? { requestEvent } : {}),
    });
  }

  return timeline.sort(compareTimelineItems);
}

/**
 * Split a causal timeline at user messages. Items with a run ID stay attached
 * to that run's turn even when another run's event is interleaved in storage.
 */
export function buildConversationTurns(timeline: ConversationTimelineItem[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  const turnByRun = new Map<string, ConversationTurn>();
  let currentTurn: ConversationTurn | undefined;
  let defaultTurn: ConversationTurn | undefined;

  const createTurn = (id: string, item: ConversationTimelineItem): ConversationTurn => {
    const runId = itemRunId(item);
    const turn: ConversationTurn = {
      id,
      runId: runId ?? null,
      createdAt: item.createdAt,
      firstSeq: firstSequence(item),
      entries: [],
    };
    turns.push(turn);
    if (runId) turnByRun.set(runId, turn);
    return turn;
  };

  for (const item of timeline) {
    if (item.kind === 'message' && item.message.role === 'USER') {
      const turn = createTurn(`turn:${item.id}`, item);
      turn.userMessage = item.message;
      currentTurn = turn;
      const runId = item.message.runId;
      if (runId) turnByRun.set(runId, turn);
      turn.entries.push({ ...item, turnId: turn.id });
      continue;
    }

    const runId = itemRunId(item);
    const turn = (runId ? turnByRun.get(runId) : undefined) ?? currentTurn;
    const target = turn ?? defaultTurn ?? (defaultTurn = createTurn('turn:default', item));
    target.entries.push({ ...item, turnId: target.id });
    if (!target.runId && runId) {
      target.runId = runId;
      turnByRun.set(runId, target);
    }
  }
  return turns;
}

function itemRunId(item: ConversationTimelineItem): string | null | undefined {
  switch (item.kind) {
    case 'message':
      return item.message.runId;
    case 'thought':
      return item.runId;
    case 'tool':
    case 'plan':
      return item.event.runId;
    case 'approval':
      return item.approval.runId;
  }
}

/** Keep adjacent tool calls readable without moving them across causal entries. */
export function groupToolTimeline(
  items: ConversationTimelineItem[],
): Array<ConversationTimelineItem | ConversationToolGroup> {
  const grouped: Array<ConversationTimelineItem | ConversationToolGroup> = [];
  for (const item of items) {
    if (item.kind !== 'tool') {
      grouped.push(item);
      continue;
    }
    const previous = grouped.at(-1);
    if (previous?.kind === 'tool') {
      grouped[grouped.length - 1] = {
        kind: 'tool-group',
        id: previous.id,
        createdAt: previous.createdAt,
        firstSeq: previous.firstSeq,
        events: [previous.event, item.event],
        ...(previous.turnId ? { turnId: previous.turnId } : {}),
      };
    } else if (previous?.kind === 'tool-group') {
      grouped[grouped.length - 1] = {
        ...previous,
        events: [...previous.events, item.event],
      };
    } else {
      grouped.push(item);
    }
  }
  return grouped;
}

export function summarizeToolExecution(events: EventRecord[]): ToolExecutionSummary {
  const files = new Set<string>();
  let commands = 0;
  let searches = 0;
  for (const event of events) {
    const payload = event.payloadJson;
    for (const path of readToolPaths(payload)) files.add(path);
    const toolName = String(payload.tool ?? payload.name ?? '').toLocaleLowerCase();
    if (typeof payload.command === 'string' || ['exec_command', 'run_tests'].includes(toolName)) {
      commands += 1;
    }
    if (typeof payload.query === 'string' || ['search', 'search_query'].includes(toolName)) {
      searches += 1;
    }
  }
  return { operations: events.length, files: files.size, commands, searches };
}

export function getConversationWindowStart(itemCount: number): number {
  return Math.max(0, itemCount - CONVERSATION_WINDOW_SIZE);
}

function readToolPaths(payload: EventPayload): string[] {
  const paths = new Set<string>();
  if (typeof payload.path === 'string' && payload.path) paths.add(payload.path);
  if (Array.isArray(payload.paths)) {
    for (const value of payload.paths) if (typeof value === 'string' && value) paths.add(value);
  }
  if (Array.isArray(payload.locations)) {
    for (const value of payload.locations) {
      if (isRecord(value) && typeof value.path === 'string' && value.path) paths.add(value.path);
    }
  }
  return [...paths];
}
