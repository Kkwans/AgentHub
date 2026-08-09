import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { AgentEventType } from '@agenthub/agent-core';

export interface NormalizedUpdate {
  type: AgentEventType;
  payload: Record<string, unknown>;
  sourceEventType: string;
}

export function normalizeAcpSessionUpdate(update: SessionUpdate): NormalizedUpdate[] {
  const sourceEventType = update.sessionUpdate;
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      if (update.content.type !== 'text') return [];
      return [
        {
          type: 'assistant.message.delta',
          payload: {
            text: update.content.text,
            ...(update.messageId ? { messageId: update.messageId } : {}),
          },
          sourceEventType,
        },
      ];
    case 'tool_call':
      return [
        {
          type: 'tool.call.started',
          payload: toolPayload(update),
          sourceEventType,
        },
      ];
    case 'tool_call_update': {
      const type =
        update.status === 'completed'
          ? 'tool.call.completed'
          : update.status === 'failed'
            ? 'tool.call.failed'
            : 'tool.call.progress';
      const normalized: NormalizedUpdate[] = [
        { type, payload: toolPayload(update), sourceEventType },
      ];
      if (
        update.status === 'completed' &&
        (update.kind === 'edit' || update.kind === 'delete' || update.kind === 'move') &&
        update.locations?.length
      ) {
        normalized.push({
          type: 'file.changed',
          payload: {
            toolCallId: update.toolCallId,
            paths: update.locations.map((location) => location.path),
          },
          sourceEventType,
        });
      }
      return normalized;
    }
    case 'plan':
      return [
        {
          type: 'agent.plan.updated',
          payload: {
            entries: update.entries.map((entry) => ({
              content: entry.content,
              priority: entry.priority,
              status: entry.status,
            })),
          },
          sourceEventType,
        },
      ];
    case 'plan_update':
      return [
        {
          type: 'agent.plan.updated',
          payload: { planId: update.plan.planId, update: sanitizePlanUpdate(update.plan) },
          sourceEventType,
        },
      ];
    case 'plan_removed':
      return [
        {
          type: 'agent.plan.updated',
          payload: { planId: update.planId, removed: true },
          sourceEventType,
        },
      ];
    case 'usage_update':
      return [
        {
          type: 'usage.updated',
          payload: {
            used: update.used,
            size: update.size,
            ...(update.cost
              ? { cost: { amount: update.cost.amount, currency: update.cost.currency } }
              : {}),
          },
          sourceEventType,
        },
      ];
    case 'current_mode_update':
      return [
        {
          type: 'agent.status',
          payload: { mode: update.currentModeId },
          sourceEventType,
        },
      ];
    case 'session_info_update':
      return [
        {
          type: 'agent.status',
          payload: {
            ...(update.title ? { title: update.title } : {}),
            ...(update.updatedAt ? { updatedAt: update.updatedAt } : {}),
          },
          sourceEventType,
        },
      ];
    case 'agent_thought_chunk':
    case 'user_message_chunk':
    case 'available_commands_update':
    case 'config_option_update':
      return [];
  }
}

function toolPayload(update: {
  toolCallId: string;
  title?: string | null;
  name?: string | null;
  kind?: string | null;
  status?: string | null;
  locations?: Array<{ path: string; line?: number | null }> | null;
}): Record<string, unknown> {
  return {
    toolCallId: update.toolCallId,
    ...(update.title ? { title: update.title } : {}),
    ...(update.name ? { name: update.name } : {}),
    ...(update.kind ? { kind: update.kind } : {}),
    ...(update.status ? { status: update.status } : {}),
    ...(update.locations
      ? {
          locations: update.locations.map((location) => ({
            path: location.path,
            ...(location.line === undefined || location.line === null
              ? {}
              : { line: location.line }),
          })),
        }
      : {}),
  };
}

function sanitizePlanUpdate(
  plan: Extract<SessionUpdate, { sessionUpdate: 'plan_update' }>['plan'],
) {
  if (plan.type === 'items') {
    return {
      type: 'items',
      entries: plan.entries.map((entry) => ({
        content: entry.content,
        priority: entry.priority,
        status: entry.status,
      })),
    };
  }
  if (plan.type === 'markdown') {
    return { type: 'markdown', content: plan.content };
  }
  return { type: 'file', uri: plan.uri };
}
