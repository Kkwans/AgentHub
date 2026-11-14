import {
  isResourceCleanupUnconfirmed,
  ResourceCleanupUnconfirmedError,
} from '@agenthub/agent-core';
import { setTimeout as delay } from 'node:timers/promises';

import {
  REMOTE_NODE_PROTOCOL_VERSION,
  type RemoteAgentInventoryEntry,
  type RemoteNodeCommandName,
  type RemoteNodeServerMessage,
} from '@agenthub/shared';
import WebSocket from 'ws';

import type { NodeDaemonConfig } from './config.js';
import { NodeIdentity, type DeviceRecord } from './identity.js';
import { discoverAgentInventory, nodeMetadata, resolveNodeRoots } from './inventory.js';

export interface NodeCommandExecutor {
  execute(
    command: RemoteNodeCommandName,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  setEventSink?(
    sink: ((sessionId: string, event: Record<string, unknown>) => void) | undefined,
  ): void;
  disconnect?(): Promise<void>;
  beginConnection?(): Promise<void>;
}

const unsupportedExecutor: NodeCommandExecutor = {
  async execute(command) {
    throw new NodeCommandError('REMOTE_NODE_COMMAND_UNSUPPORTED', `Node 尚未实现命令 ${command}`);
  },
};

export class NodeCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NodeCommandError';
  }
}

export class RemoteNodeClient {
  private stopped = false;
  private cleanupUnconfirmed = false;
  private socket: WebSocket | undefined;
  private endConnection: (() => void) | undefined;

  constructor(
    private readonly config: NodeDaemonConfig,
    private readonly executor: NodeCommandExecutor = unsupportedExecutor,
    private readonly inventoryProvider: () => Promise<
      RemoteAgentInventoryEntry[]
    > = discoverAgentInventory,
  ) {}

  async run(): Promise<void> {
    if (this.cleanupUnconfirmed) throw new ResourceCleanupUnconfirmedError();
    if (this.stopped) return;
    const identity = await NodeIdentity.loadOrCreate(this.config.dataDir);
    if (this.stopped) return;
    const roots = await resolveNodeRoots(this.config.roots);
    if (this.stopped) return;
    let attempt = 0;
    while (!this.stopped) {
      try {
        await this.connect(identity, roots);
        attempt = 0;
      } catch (error) {
        if (isResourceCleanupUnconfirmed(error)) throw new ResourceCleanupUnconfirmedError();
        if (this.stopped) return;
        const waitMs = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5)) + Math.random() * 500;
        attempt += 1;
        process.stderr.write(`AgentHub Node 连接失败：${safeErrorMessage(error)}；稍后重试\n`);
        await delay(waitMs);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.endConnection?.();
    this.socket?.close(1000, 'Node daemon 正在停止');
  }

  private async connect(identity: NodeIdentity, roots: string[]): Promise<void> {
    let device = await identity.readDeviceRecord();
    if (this.stopped) return;
    const inventory = await this.inventoryProvider();
    if (this.stopped) return;
    await this.executor.beginConnection?.();
    if (this.stopped) {
      await this.disconnectExecutor();
      return;
    }
    const socket = new WebSocket(this.config.serverUrl, {
      maxPayload: 1024 * 1024,
      handshakeTimeout: 15_000,
    });
    this.executor.setEventSink?.((sessionId, event) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'node.event', sessionId, event }));
      }
    });
    this.socket = socket;
    let ended = false;
    let heartbeat: NodeJS.Timeout | undefined;
    let finishConnection: (() => void) | undefined;
    // Normalize the immediately-started cleanup into an owned outcome: stop can
    // revoke synchronously without creating an unobserved rejected promise.
    let cleanup: Promise<{ error?: unknown }> | undefined;
    const startCleanup = () =>
      (cleanup ??= this.disconnectExecutor().then(
        () => ({}),
        (error: unknown) => ({ error }),
      ));
    try {
      await new Promise<void>((resolve, reject) => {
        let authenticated = false;
        finishConnection = () => {
          ended = true;
          startCleanup();
          resolve();
        };
        this.endConnection = finishConnection;
        socket.once('error', (error) => {
          ended = true;
          startCleanup();
          reject(error);
        });
        socket.on('message', (data, isBinary) => {
          if (ended || this.stopped || this.socket !== socket) return;
          if (isBinary) {
            ended = true;
            startCleanup();
            try {
              socket.close(4002, '不支持二进制消息');
            } catch {
              /* cleanup must not depend on the close handshake */
            }
            reject(new Error('不支持二进制消息'));
            return;
          }
          void this.handleServerMessage(socket, data.toString(), identity, roots, inventory, device)
            .then((nextDevice) => {
              if (ended || this.stopped || this.socket !== socket) return;
              if (nextDevice) device = nextDevice;
              if (!authenticated && nextDevice) {
                authenticated = true;
                heartbeat = this.startHeartbeat(socket, nextDevice, roots, inventory);
              }
            })
            .catch((error) => {
              if (ended || this.socket !== socket) return;
              try {
                socket.close(4002, 'Node 消息处理失败');
              } catch {
                /* finally still drains */
              }
              startCleanup();
              reject(error);
            });
        });
        socket.once('close', (code, reason) => {
          ended = true;
          startCleanup();
          if (heartbeat) clearInterval(heartbeat);
          if (this.stopped || code === 1000) resolve();
          else reject(new Error(`连接关闭 ${String(code)} ${reason.toString()}`));
        });
      });
    } finally {
      ended = true;
      if (heartbeat) clearInterval(heartbeat);
      if (this.socket === socket) this.socket = undefined;
      if (this.endConnection === finishConnection) this.endConnection = undefined;
      try {
        this.executor.setEventSink?.(undefined);
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
          socket.close(1000, 'Node 连接清理');
      } finally {
        await this.requireCleanup(startCleanup());
      }
    }
  }

  private async requireCleanup(cleanup: Promise<{ error?: unknown }>): Promise<void> {
    const outcome = await cleanup;
    if ('error' in outcome) throw outcome.error;
  }

  private async disconnectExecutor(): Promise<void> {
    try {
      await this.executor.disconnect?.();
      if (this.cleanupUnconfirmed) throw new ResourceCleanupUnconfirmedError();
    } catch {
      this.stopped = true;
      this.cleanupUnconfirmed = true;
      throw new ResourceCleanupUnconfirmedError();
    }
  }

  private async handleServerMessage(
    socket: WebSocket,
    raw: string,
    identity: NodeIdentity,
    roots: string[],
    inventory: RemoteAgentInventoryEntry[],
    device: DeviceRecord | undefined,
  ): Promise<DeviceRecord | undefined> {
    const message = JSON.parse(raw) as RemoteNodeServerMessage;
    if (message.type === 'node.challenge') {
      if (message.protocolVersion !== REMOTE_NODE_PROTOCOL_VERSION) {
        throw new Error(`不支持协议 ${message.protocolVersion}`);
      }
      if (device) {
        socket.send(
          JSON.stringify({
            type: 'node.authenticate',
            protocolVersion: REMOTE_NODE_PROTOCOL_VERSION,
            nodeId: device.nodeId,
            signature: identity.sign('authenticate', device.nodeId, message.challenge),
            metadata: nodeMetadata(this.config.name),
            roots,
            inventory,
          }),
        );
      } else {
        if (!this.config.registrationToken) {
          throw new Error('首次注册需要 AGENTHUB_NODE_REGISTRATION_TOKEN');
        }
        socket.send(
          JSON.stringify({
            type: 'node.register',
            protocolVersion: REMOTE_NODE_PROTOCOL_VERSION,
            registrationToken: this.config.registrationToken,
            publicKey: identity.publicKey,
            signature: identity.sign('register', 'register', message.challenge),
            metadata: nodeMetadata(this.config.name),
            roots,
            inventory,
          }),
        );
      }
      return undefined;
    }
    if (message.type === 'node.registered') {
      const registered = { nodeId: message.nodeId, targetId: message.targetId };
      await identity.writeDeviceRecord(registered);
      process.stdout.write(`AgentHub Node 已注册：${message.nodeId}\n`);
      return registered;
    }
    if (message.type === 'node.authenticated') {
      process.stdout.write(`AgentHub Node 已连接：${message.nodeId}\n`);
      return { nodeId: message.nodeId, targetId: message.targetId };
    }
    if (message.type === 'node.command') {
      await this.handleCommand(socket, message.requestId, message.command, message.payload);
      return device;
    }
    if (message.type === 'node.error') {
      throw new NodeCommandError(message.error.code, message.error.message);
    }
    return device;
  }

  private startHeartbeat(
    socket: WebSocket,
    device: DeviceRecord,
    roots: string[],
    inventory: RemoteAgentInventoryEntry[],
  ): NodeJS.Timeout {
    const send = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          type: 'node.heartbeat',
          nodeId: device.nodeId,
          sentAt: new Date().toISOString(),
          metadata: nodeMetadata(this.config.name),
          roots,
          inventory,
        }),
      );
    };
    send();
    const timer = setInterval(send, 15_000);
    timer.unref();
    return timer;
  }

  private async handleCommand(
    socket: WebSocket,
    requestId: string,
    command: RemoteNodeCommandName,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const result = await this.executor.execute(command, payload);
      socket.send(JSON.stringify({ type: 'node.result', requestId, ok: true, result }));
    } catch (error) {
      const failure = isResourceCleanupUnconfirmed(error)
        ? new NodeCommandError(
            'RESOURCE_CLEANUP_UNCONFIRMED',
            new ResourceCleanupUnconfirmedError().message,
          )
        : error instanceof NodeCommandError && error.code !== 'RESOURCE_CLEANUP_UNCONFIRMED'
          ? error
          : new NodeCommandError('REMOTE_NODE_COMMAND_FAILED', safeErrorMessage(error));
      const resourceUnknown = isResourceCleanupUnconfirmed(error);
      if (resourceUnknown) {
        this.cleanupUnconfirmed = true;
        this.stopped = true;
      }
      const response = JSON.stringify({
        type: 'node.result',
        requestId,
        ok: false,
        error: { code: failure.code, message: failure.message },
      });
      if (resourceUnknown) {
        try {
          socket.send(response);
        } catch {
          /* uncertainty already sticky */
        }
        try {
          socket.close(1011, 'Node 资源清理待核对');
        } catch {
          /* drain must not wait for handshake */
        }
        throw new ResourceCleanupUnconfirmedError();
      }
      socket.send(response);
    }
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}
