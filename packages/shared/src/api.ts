import { z } from 'zod';

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown> | undefined;
}

export interface ApiErrorEnvelope {
  error: ApiErrorBody;
}

export interface ApiSuccessEnvelope<T> {
  data: T;
  requestId: string;
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export const websocketTopicSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^(session|project|terminal):[A-Za-z0-9_-]+$|^(approvals|worktrees)$/);

export const websocketClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    topics: z.array(websocketTopicSchema).min(1).max(100),
    afterSeq: z.record(z.string(), z.number().int().nonnegative()).optional(),
  }),
  z.object({
    type: z.literal('unsubscribe'),
    topics: z.array(websocketTopicSchema).min(1).max(100),
  }),
  z.object({ type: z.literal('ping') }),
]);

export type WebSocketClientMessage = z.infer<typeof websocketClientMessageSchema>;

export interface WebSocketServerMessage {
  type: 'connection.ready' | 'subscribed' | 'unsubscribed' | 'event' | 'error' | 'pong';
  topic?: string | undefined;
  topics?: string[] | undefined;
  event?: Record<string, unknown> | undefined;
  error?: Omit<ApiErrorBody, 'requestId'> | undefined;
}
