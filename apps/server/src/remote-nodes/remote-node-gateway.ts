import { ResourceCleanupUnconfirmedError } from '@agenthub/agent-core';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  REMOTE_NODE_PROTOCOL_VERSION,
  remoteNodeClientMessageSchema,
  type RemoteNodeCommandName,
  type RemoteNodeServerMessage,
} from '@agenthub/shared';
import { WebSocket, type WebSocketServer } from 'ws';

import { AppError } from '../errors.js';
import type { WebSocketUpgradeRouter } from '../websocket-upgrade.js';
import type { RemoteNodeConnectionController, RemoteNodeService } from './remote-node-service.js';

interface AuthenticatedConnection {
  nodeId: string;
  targetId: string;
  socket: WebSocket;
  lastSeenAt: number;
  pending: Set<string>;
}

interface PendingRequest {
  nodeId: string;
  command: RemoteNodeCommandName;
  resolve(value: Record<string, unknown>): void;
  reject(error: unknown): void;
  timer: NodeJS.Timeout;
}

interface SessionListener {
  nodeId: string;
  onEvent(event: Record<string, unknown>): void;
  onDisconnect(): void;
}

export class RemoteNodeRpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RemoteNodeRpcError';
  }
}

export class RemoteNodeGateway implements RemoteNodeConnectionController {
  private readonly server: WebSocketServer;
  private readonly connections = new Map<string, AuthenticatedConnection>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly sessionListeners = new Map<string, Set<SessionListener>>();
  private readonly staleTimer: NodeJS.Timeout;
  private stopping = false;
  private closePromise?: Promise<void>;
  private readonly handlers = new Set<Promise<void>>();
  private offlineFailed = false;
  private stateWrites: Promise<void> = Promise.resolve();

  constructor(
    upgradeRouter: WebSocketUpgradeRouter,
    private readonly nodes: RemoteNodeService,
    private readonly closeTimeoutMs = 5_000,
  ) {
    this.server = upgradeRouter.register('/node/ws', {
      maxPayload: 1024 * 1024,
      onConnection: (socket) => this.onConnection(socket),
    });
    this.staleTimer = setInterval(() => this.closeStaleConnections(), 15_000);
    this.staleTimer.unref();
    nodes.attachController(this);
  }

  isConnected(nodeId: string): boolean {
    return this.connections.get(nodeId)?.socket.readyState === WebSocket.OPEN;
  }

  disconnect(nodeId: string, code: number, reason: string): void {
    this.connections.get(nodeId)?.socket.close(code, reason);
  }

  async request(
    nodeId: string,
    command: RemoteNodeCommandName,
    payload: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<Record<string, unknown>> {
    const connection = this.connections.get(nodeId);
    if (this.stopping || !connection || connection.socket.readyState !== WebSocket.OPEN) {
      throw new RemoteNodeRpcError('REMOTE_NODE_OFFLINE', 'Remote Node 当前离线');
    }
    const requestId = randomUUID();
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(requestId);
          connection.pending.delete(requestId);
          reject(
            resourceRequestFailure(
              command,
              new RemoteNodeRpcError('REMOTE_NODE_RPC_TIMEOUT', 'Remote Node 请求超时'),
            ),
          );
        },
        Math.min(Math.max(timeoutMs, 1_000), 120_000),
      );
      timer.unref();
      this.pending.set(requestId, { nodeId, command, resolve, reject, timer });
      connection.pending.add(requestId);
    });
    try {
      if (!this.send(connection.socket, { type: 'node.command', requestId, command, payload }))
        throw new RemoteNodeRpcError('REMOTE_NODE_DISCONNECTED', 'Remote Node 发送时连接已断开');
    } catch (error) {
      // Reject the already-created result, not a separate async throw that leaves
      // its timer/promise orphaned. A transport failure cannot prove non-delivery.
      const pending = this.pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        connection.pending.delete(requestId);
        pending.reject(resourceRequestFailure(command, error));
      }
    }
    return result;
  }

  subscribeSession(
    nodeId: string,
    sessionId: string,
    onEvent: (event: Record<string, unknown>) => void,
    onDisconnect: () => void,
  ): () => void {
    const listeners = this.sessionListeners.get(sessionId) ?? new Set();
    const listener = { nodeId, onEvent, onDisconnect };
    listeners.add(listener);
    this.sessionListeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.sessionListeners.delete(sessionId);
    };
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.stopping = true;
    clearInterval(this.staleTimer);
    this.closePromise = Promise.resolve().then(async () => {
      let timer: NodeJS.Timeout | undefined;
      const drain = async () => {
        for (const connection of this.connections.values()) {
          this.rejectPending(
            connection,
            'REMOTE_NODE_GATEWAY_CLOSED',
            'Remote Node Gateway 已关闭',
          );
        }
        for (const socket of this.server.clients) socket.close(1001, '服务器正在关闭');
        await new Promise<void>((resolve, reject) => {
          this.server.close((error) => (error ? reject(error) : resolve()));
        });
        // WebSocket close only confirms transport shutdown, not asynchronous DB writes.
        while (this.handlers.size) await Promise.all([...this.handlers]);
        if (this.offlineFailed) throw new Error('offline write unconfirmed');
      };
      try {
        await Promise.race([
          drain(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('gateway drain timeout')),
              this.closeTimeoutMs,
            );
          }),
        ]);
      } catch {
        throw new RemoteNodeRpcError(
          'REMOTE_NODE_GATEWAY_CLOSE_UNCONFIRMED',
          'Remote Node Gateway 关闭尚未确认',
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
    });
    return this.closePromise;
  }

  private track(work: Promise<void>): void {
    const observed = work.catch(() => {
      this.offlineFailed = true;
    });
    this.handlers.add(observed);
    void observed.then(() => this.handlers.delete(observed));
  }

  private onConnection(socket: WebSocket): void {
    if (this.stopping) {
      socket.close(1001, '服务器正在关闭');
      return;
    }
    const challenge = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + 30_000;
    let authenticated: AuthenticatedConnection | undefined;
    this.send(socket, {
      type: 'node.challenge',
      protocolVersion: REMOTE_NODE_PROTOCOL_VERSION,
      challenge,
      expiresAt: new Date(expiresAt).toISOString(),
    });

    socket.on('message', (data, isBinary) => {
      if (this.stopping || socket.readyState !== WebSocket.OPEN) return;
      if (isBinary) {
        this.fail(socket, 'REMOTE_NODE_BINARY_UNSUPPORTED', 'Node WebSocket 不接受二进制消息');
        return;
      }
      const work = this.handleMessage(socket, data.toString(), {
        challenge,
        expiresAt,
        get authenticated() {
          return authenticated;
        },
        setAuthenticated: (value) => {
          authenticated = value;
        },
      }).catch((error) => this.handleError(socket, error));
      this.track(work);
    });
    socket.on('close', () => {
      if (!authenticated || this.connections.get(authenticated.nodeId)?.socket !== socket) return;
      this.connections.delete(authenticated.nodeId);
      this.rejectPending(authenticated, 'REMOTE_NODE_DISCONNECTED', 'Remote Node 连接已断开');
      this.disconnectSessionListeners(authenticated.nodeId);
      const nodeId = authenticated.nodeId;
      this.track(
        this.serializeState(async () => {
          // A replacement accepted earlier in this queue owns the ONLINE state.
          if (this.connections.has(nodeId)) return;
          await this.nodes.markOffline(nodeId);
        }),
      );
    });
    socket.on('error', () => {
      // close handler owns authoritative state transition.
    });
  }

  private serializeState(work: () => Promise<void>): Promise<void> {
    const result = this.stateWrites.then(work);
    this.stateWrites = result.catch(() => undefined);
    return result;
  }

  private handleMessage(...args: Parameters<RemoteNodeGateway['applyMessage']>): Promise<void> {
    let type: unknown;
    try {
      type = (JSON.parse(args[1]) as { type?: unknown }).type;
    } catch {
      /* validated below */
    }
    // Keep RPC result/event delivery independent of potentially slow DB writes.
    return ['node.register', 'node.authenticate', 'node.heartbeat'].includes(String(type))
      ? this.serializeState(() => this.applyMessage(...args))
      : this.applyMessage(...args);
  }

  private async applyMessage(
    socket: WebSocket,
    raw: string,
    state: {
      challenge: string;
      expiresAt: number;
      readonly authenticated: AuthenticatedConnection | undefined;
      setAuthenticated(value: AuthenticatedConnection): void;
    },
  ): Promise<void> {
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new AppError(400, 'REMOTE_NODE_INVALID_JSON', 'Node 消息不是合法 JSON');
    }
    const parsed = remoteNodeClientMessageSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new AppError(400, 'REMOTE_NODE_MESSAGE_INVALID', 'Node 消息不符合协议');
    }
    const message = parsed.data;
    if (!state.authenticated) {
      if (Date.now() > state.expiresAt) {
        throw new AppError(401, 'REMOTE_NODE_CHALLENGE_EXPIRED', '设备 challenge 已过期');
      }
      if (message.type === 'node.register') {
        const registered = await this.nodes.register(message, state.challenge);
        if (this.stopping || socket.readyState !== WebSocket.OPEN) {
          try {
            if (!this.connections.has(registered.node.id))
              await this.nodes.markOffline(registered.node.id);
          } catch {
            this.offlineFailed = true;
          }
          return;
        }
        const connection = this.acceptConnection(socket, registered.node.id, registered.target.id);
        state.setAuthenticated(connection);
        this.send(socket, {
          type: 'node.registered',
          nodeId: registered.node.id,
          targetId: registered.target.id,
        });
        return;
      }
      if (message.type === 'node.authenticate') {
        const node = await this.nodes.authenticate(message, state.challenge);
        if (this.stopping || socket.readyState !== WebSocket.OPEN) {
          try {
            if (!this.connections.has(node.id)) await this.nodes.markOffline(node.id);
          } catch {
            this.offlineFailed = true;
          }
          return;
        }
        const connection = this.acceptConnection(socket, node.id, node.targetId);
        state.setAuthenticated(connection);
        this.send(socket, { type: 'node.authenticated', nodeId: node.id, targetId: node.targetId });
        return;
      }
      throw new AppError(401, 'REMOTE_NODE_AUTH_REQUIRED', 'Node 必须先完成设备认证');
    }

    state.authenticated.lastSeenAt = Date.now();
    if (message.type === 'node.heartbeat') {
      if (message.nodeId !== state.authenticated.nodeId) {
        throw new AppError(401, 'REMOTE_NODE_ID_MISMATCH', 'Heartbeat 的 Node ID 不匹配');
      }
      await this.nodes.heartbeat(message);
      return;
    }
    if (message.type === 'node.result') {
      this.resolvePending(state.authenticated, message);
      return;
    }
    if (message.type === 'node.event') {
      for (const listener of this.sessionListeners.get(message.sessionId) ?? []) {
        if (listener.nodeId === state.authenticated.nodeId) listener.onEvent(message.event);
      }
      return;
    }
    if (message.type === 'node.ping') {
      this.send(socket, { type: 'node.pong' });
      return;
    }
    throw new AppError(409, 'REMOTE_NODE_ALREADY_AUTHENTICATED', 'Node 已完成认证');
  }

  private acceptConnection(socket: WebSocket, nodeId: string, targetId: string) {
    const existing = this.connections.get(nodeId);
    if (existing?.socket.readyState === WebSocket.OPEN) {
      throw new AppError(409, 'REMOTE_NODE_ALREADY_CONNECTED', '该 Remote Node 已有活动连接');
    }
    const connection: AuthenticatedConnection = {
      nodeId,
      targetId,
      socket,
      lastSeenAt: Date.now(),
      pending: new Set(),
    };
    this.connections.set(nodeId, connection);
    return connection;
  }

  private resolvePending(
    connection: AuthenticatedConnection,
    message: Extract<
      ReturnType<typeof remoteNodeClientMessageSchema.parse>,
      { type: 'node.result' }
    >,
  ): void {
    const pending = this.pending.get(message.requestId);
    if (!pending || pending.nodeId !== connection.nodeId) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    connection.pending.delete(message.requestId);
    if (message.ok) pending.resolve(message.result);
    else if (
      message.error.code === 'RESOURCE_CLEANUP_UNCONFIRMED' &&
      isResourceCommand(pending.command)
    ) {
      // Only a matched resource request from this authenticated Node can restore
      // the in-process safety contract. Never trust remote diagnostic text/cause.
      pending.reject(new ResourceCleanupUnconfirmedError());
    } else pending.reject(new RemoteNodeRpcError(message.error.code, message.error.message));
  }

  private rejectPending(connection: AuthenticatedConnection, code: string, message: string): void {
    for (const requestId of connection.pending) {
      const pending = this.pending.get(requestId);
      if (!pending) continue;
      clearTimeout(pending.timer);
      pending.reject(
        resourceRequestFailure(pending.command, new RemoteNodeRpcError(code, message)),
      );
      this.pending.delete(requestId);
    }
    connection.pending.clear();
  }

  private closeStaleConnections(): void {
    const cutoff = Date.now() - 45_000;
    for (const connection of this.connections.values()) {
      if (connection.lastSeenAt < cutoff) connection.socket.close(4000, 'Heartbeat 超时');
    }
  }

  private disconnectSessionListeners(nodeId: string): void {
    for (const [sessionId, listeners] of this.sessionListeners) {
      for (const listener of [...listeners]) {
        if (listener.nodeId !== nodeId) continue;
        listeners.delete(listener);
        listener.onDisconnect();
      }
      if (listeners.size === 0) this.sessionListeners.delete(sessionId);
    }
  }

  private handleError(socket: WebSocket, error: unknown): void {
    const appError =
      error instanceof AppError
        ? error
        : new AppError(500, 'REMOTE_NODE_GATEWAY_ERROR', 'Remote Node Gateway 处理失败');
    this.fail(socket, appError.code, appError.message);
    if (appError.status >= 401) socket.close(4001, appError.code);
  }

  private fail(socket: WebSocket, code: string, message: string): void {
    this.send(socket, { type: 'node.error', error: { code, message } });
  }

  private send(socket: WebSocket, message: RemoteNodeServerMessage): boolean {
    if (socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }
}

function isResourceCommand(command: RemoteNodeCommandName): boolean {
  return ['agent.preflight', 'agent.capabilities', 'session.create'].includes(command);
}

/** A registered resource request may have executed remotely even without a response.
 * This is uncertainty, never proof of remote termination or permission to replay.
 */
function resourceRequestFailure(command: RemoteNodeCommandName, error: unknown): unknown {
  return isResourceCommand(command) ? new ResourceCleanupUnconfirmedError() : error;
}
