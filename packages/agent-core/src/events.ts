import { z } from 'zod';

export const AGENT_EVENT_TYPES = [
  'session.created',
  'session.state_changed',
  'session.closed',
  'run.started',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'assistant.message.delta',
  'assistant.message.completed',
  'agent.thought.delta',
  'agent.plan.updated',
  'agent.status',
  'agent.configuration.updated',
  'agent.commands.updated',
  'tool.call.started',
  'tool.call.progress',
  'tool.call.completed',
  'tool.call.failed',
  'approval.requested',
  'approval.resolved',
  'file.changed',
  'git.status.changed',
  'usage.updated',
  'artifact.created',
  'adapter.warning',
  'adapter.disconnected',
] as const;

export const agentEventTypeSchema = z.enum(AGENT_EVENT_TYPES);
export type AgentEventType = z.infer<typeof agentEventTypeSchema>;

export interface NormalizedAgentEvent<T = Record<string, unknown>> {
  eventId: string;
  sessionId: string;
  runId?: string;
  seq: number;
  emittedAt: string;
  adapterKind: string;
  type: AgentEventType;
  payload: T;
  source?: { protocol?: string; eventType?: string };
}
