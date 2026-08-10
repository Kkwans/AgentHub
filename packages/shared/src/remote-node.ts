import { z } from 'zod';

export const REMOTE_NODE_PROTOCOL_VERSION = 'agenthub-node-v1';

export const remoteAgentKindSchema = z.enum([
  'CODEX',
  'CLAUDE_CODE',
  'OPENCODE',
  'HERMES',
  'OPENCLAW',
]);

export const remoteAgentInventoryEntrySchema = z
  .object({
    key: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    agentKind: remoteAgentKindSchema,
    adapterKind: z.enum(['ACP_STDIO', 'OPENCLAW_GATEWAY']),
    status: z.enum(['AVAILABLE', 'MISSING', 'BROKEN']),
    detectedVersion: z.string().max(160).optional(),
    capabilities: z
      .object({
        sessions: z.boolean(),
        streaming: z.boolean(),
        approvals: z.boolean(),
        files: z.boolean(),
        terminal: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type RemoteAgentInventoryEntry = z.infer<typeof remoteAgentInventoryEntrySchema>;

export const remoteNodeMetadataSchema = z
  .object({
    name: z.string().min(1).max(120),
    hostname: z.string().min(1).max(255),
    os: z.string().min(1).max(80),
    arch: z.string().min(1).max(80),
    daemonVersion: z.string().min(1).max(80),
  })
  .strict();

export type RemoteNodeMetadata = z.infer<typeof remoteNodeMetadataSchema>;

const rootsSchema = z.array(z.string().min(1).max(4_096)).min(1).max(32);
const inventorySchema = z.array(remoteAgentInventoryEntrySchema).max(32);
const signatureSchema = z.string().min(40).max(256);
const publicKeySchema = z.string().min(40).max(2_048);

export const remoteNodeCommandNameSchema = z.enum([
  'project.preflight',
  'fs.list',
  'fs.read',
  'agent.preflight',
  'agent.capabilities',
  'session.create',
  'session.run',
  'session.approval',
  'session.cancel',
  'session.close',
]);

export type RemoteNodeCommandName = z.infer<typeof remoteNodeCommandNameSchema>;

export const remoteNodeClientMessageSchema = z.union([
  z
    .object({
      type: z.literal('node.register'),
      protocolVersion: z.literal(REMOTE_NODE_PROTOCOL_VERSION),
      registrationToken: z.string().min(32).max(512),
      publicKey: publicKeySchema,
      signature: signatureSchema,
      metadata: remoteNodeMetadataSchema,
      roots: rootsSchema,
      inventory: inventorySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('node.authenticate'),
      protocolVersion: z.literal(REMOTE_NODE_PROTOCOL_VERSION),
      nodeId: z.string().uuid(),
      signature: signatureSchema,
      metadata: remoteNodeMetadataSchema,
      roots: rootsSchema,
      inventory: inventorySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('node.heartbeat'),
      nodeId: z.string().uuid(),
      sentAt: z.string().datetime({ offset: true }),
      metadata: remoteNodeMetadataSchema,
      roots: rootsSchema,
      inventory: inventorySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('node.result'),
      requestId: z.string().uuid(),
      ok: z.literal(true),
      result: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal('node.result'),
      requestId: z.string().uuid(),
      ok: z.literal(false),
      error: z
        .object({ code: z.string().min(1).max(120), message: z.string().min(1).max(4_000) })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('node.event'),
      sessionId: z.string().uuid(),
      event: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z.object({ type: z.literal('node.ping') }).strict(),
]);

export type RemoteNodeClientMessage = z.infer<typeof remoteNodeClientMessageSchema>;

export type RemoteNodeServerMessage =
  | {
      type: 'node.challenge';
      protocolVersion: typeof REMOTE_NODE_PROTOCOL_VERSION;
      challenge: string;
      expiresAt: string;
    }
  | { type: 'node.registered'; nodeId: string; targetId: string }
  | { type: 'node.authenticated'; nodeId: string; targetId: string }
  | {
      type: 'node.command';
      requestId: string;
      command: RemoteNodeCommandName;
      payload: Record<string, unknown>;
    }
  | { type: 'node.pong' }
  | { type: 'node.error'; error: { code: string; message: string } };

export function remoteNodeSignaturePayload(
  mode: 'register' | 'authenticate',
  subject: string,
  challenge: string,
): Uint8Array {
  return new TextEncoder().encode(
    `${REMOTE_NODE_PROTOCOL_VERSION}\n${mode}\n${subject}\n${challenge}`,
  );
}
