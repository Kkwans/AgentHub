import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { posix, win32 } from 'node:path';

import { remoteNodeSignaturePayload, type RemoteNodeClientMessage } from '@agenthub/shared';
import {
  DatabaseInvariantError,
  type AgentHubDatabase,
  type RemoteNodeRepository,
} from '@agenthub/db';

import { AppError } from '../errors.js';

type RegisterMessage = Extract<RemoteNodeClientMessage, { type: 'node.register' }>;
type AuthenticateMessage = Extract<RemoteNodeClientMessage, { type: 'node.authenticate' }>;
type HeartbeatMessage = Extract<RemoteNodeClientMessage, { type: 'node.heartbeat' }>;

export interface RemoteNodeConnectionController {
  isConnected(nodeId: string): boolean;
  disconnect(nodeId: string, code: number, reason: string): void;
}

export interface RemoteNodePublisher {
  publish(topic: string, event: Record<string, unknown>): void;
}

export class RemoteNodeService {
  private controller?: RemoteNodeConnectionController;

  constructor(
    private readonly nodes: RemoteNodeRepository<AgentHubDatabase>,
    private readonly publisher?: RemoteNodePublisher,
  ) {}

  attachController(controller: RemoteNodeConnectionController): void {
    this.controller = controller;
  }

  async createRegistrationToken(input: {
    name: string;
    allowedRoots: string[];
    expiresInMinutes?: number | undefined;
  }) {
    const allowedRoots = normalizeAuthorizedRoots(input.allowedRoots);
    const expiresInMinutes = input.expiresInMinutes ?? 15;
    const token = `ahrn_${randomBytes(32).toString('base64url')}`;
    const created = await this.nodes.createRegistrationToken({
      id: randomUUID(),
      name: input.name,
      tokenHash: hashToken(token),
      allowedRoots,
      expiresAt: new Date(Date.now() + expiresInMinutes * 60_000),
    });
    return {
      id: created.id,
      name: created.name,
      allowedRoots: created.allowedRootsJson,
      expiresAt: created.expiresAt,
      createdAt: created.createdAt,
      token,
    };
  }

  list() {
    return this.nodes.list();
  }

  async diagnostics(id: string) {
    const node = await this.requireNode(id);
    return {
      id: node.id,
      targetId: node.targetId,
      status: node.status,
      connected: this.controller?.isConnected(id) ?? false,
      fingerprint: node.fingerprint,
      protocolVersion: node.protocolVersion,
      daemonVersion: node.daemonVersion,
      allowedRoots: node.allowedRootsJson,
      inventory: node.inventoryJson,
      lastSeenAt: node.lastSeenAt,
      revokedAt: node.revokedAt,
    };
  }

  async revoke(id: string) {
    try {
      const node = await this.nodes.revoke(id);
      this.controller?.disconnect(id, 4003, '设备身份已撤销');
      this.publish('remote_node.revoked', node);
      return {
        id: node.id,
        targetId: node.targetId,
        status: node.status,
        revokedAt: node.revokedAt,
      };
    } catch (error) {
      throw repositoryError(error);
    }
  }

  async register(message: RegisterMessage, challenge: string) {
    const roots = normalizeAuthorizedRoots(message.roots);
    const key = parseEd25519PublicKey(message.publicKey);
    const valid = verify(
      null,
      remoteNodeSignaturePayload('register', 'register', challenge),
      key,
      Buffer.from(message.signature, 'base64'),
    );
    if (!valid) throw new AppError(401, 'REMOTE_NODE_SIGNATURE_INVALID', '设备签名无效');
    const fingerprint = createHash('sha256')
      .update(key.export({ format: 'der', type: 'spki' }))
      .digest('hex');
    try {
      const registered = await this.nodes.register({
        tokenHash: hashToken(message.registrationToken),
        nodeId: randomUUID(),
        targetId: randomUUID(),
        publicKey: message.publicKey,
        fingerprint,
        protocolVersion: message.protocolVersion,
        metadata: message.metadata,
        roots,
        inventory: message.inventory,
        now: new Date(),
      });
      this.publish('remote_node.registered', registered.node);
      return registered;
    } catch (error) {
      throw repositoryError(error);
    }
  }

  async authenticate(message: AuthenticateMessage, challenge: string) {
    const node = await this.requireNode(message.nodeId);
    if (node.revokedAt || node.status === 'REVOKED') {
      throw new AppError(401, 'REMOTE_NODE_REVOKED', '设备身份已撤销');
    }
    const roots = normalizeAuthorizedRoots(message.roots);
    assertRootsEqual(node.allowedRootsJson, roots);
    const key = parseEd25519PublicKey(node.publicKey);
    const valid = verify(
      null,
      remoteNodeSignaturePayload('authenticate', message.nodeId, challenge),
      key,
      Buffer.from(message.signature, 'base64'),
    );
    if (!valid) throw new AppError(401, 'REMOTE_NODE_SIGNATURE_INVALID', '设备签名无效');
    try {
      return await this.nodes.updateHeartbeat(message.nodeId, {
        metadata: message.metadata,
        roots,
        inventory: message.inventory,
        now: new Date(),
      });
    } catch (error) {
      throw repositoryError(error);
    }
  }

  async heartbeat(message: HeartbeatMessage) {
    const node = await this.requireNode(message.nodeId);
    const roots = normalizeAuthorizedRoots(message.roots);
    assertRootsEqual(node.allowedRootsJson, roots);
    try {
      const updated = await this.nodes.updateHeartbeat(message.nodeId, {
        metadata: message.metadata,
        roots,
        inventory: message.inventory,
        now: new Date(),
      });
      this.publish('remote_node.heartbeat', updated);
      return updated;
    } catch (error) {
      throw repositoryError(error);
    }
  }

  async markOffline(id: string) {
    const node = await this.nodes.markOffline(id);
    if (node) this.publish('remote_node.offline', node);
    return node;
  }

  private async requireNode(id: string) {
    const node = await this.nodes.get(id);
    if (!node) throw new AppError(404, 'REMOTE_NODE_NOT_FOUND', 'Remote Node 不存在');
    return node;
  }

  private publish(type: string, node: { id: string; targetId: string }): void {
    const event = { type, nodeId: node.id, targetId: node.targetId };
    this.publisher?.publish('remote-nodes', event);
  }
}

function hashToken(token: string): string {
  return `sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

function parseEd25519PublicKey(encoded: string) {
  try {
    const key = createPublicKey({
      key: Buffer.from(encoded, 'base64'),
      format: 'der',
      type: 'spki',
    });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519');
    return key;
  } catch (error) {
    throw new AppError(400, 'REMOTE_NODE_PUBLIC_KEY_INVALID', '设备 public key 无效', undefined, {
      cause: error,
    });
  }
}

export function normalizeAuthorizedRoots(roots: string[]): string[] {
  const normalized = roots.map((value) => {
    if (value.includes('\0')) {
      throw new AppError(400, 'REMOTE_NODE_ROOT_INVALID', 'Node root 包含非法字符');
    }
    const windows = /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
    if (!windows && !posix.isAbsolute(value)) {
      throw new AppError(400, 'REMOTE_NODE_ROOT_NOT_ABSOLUTE', 'Node root 必须是绝对路径');
    }
    const root = windows ? win32.normalize(value) : posix.normalize(value);
    const parsed = windows ? win32.parse(root) : posix.parse(root);
    if (root === parsed.root) {
      throw new AppError(400, 'REMOTE_NODE_ROOT_TOO_BROAD', 'Node root 不得是文件系统根目录');
    }
    return root;
  });
  const unique = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  if (unique.length === 0) {
    throw new AppError(400, 'REMOTE_NODE_ROOT_REQUIRED', '至少配置一个 Node root');
  }
  return unique;
}

function assertRootsEqual(expected: string[], actual: string[]): void {
  if (expected.length !== actual.length || expected.some((root, index) => root !== actual[index])) {
    throw new AppError(409, 'REMOTE_NODE_ROOTS_MISMATCH', 'Node roots 与登记授权范围不一致');
  }
}

function repositoryError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof DatabaseInvariantError) {
    const status = error.code === 'REMOTE_NODE_NOT_FOUND' ? 404 : 409;
    return new AppError(status, error.code, error.message, undefined, { cause: error });
  }
  return new AppError(500, 'REMOTE_NODE_OPERATION_FAILED', 'Remote Node 操作失败', undefined, {
    cause: error,
  });
}
