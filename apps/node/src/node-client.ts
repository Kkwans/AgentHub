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
  private socket: WebSocket | undefined;

  constructor(
    private readonly config: NodeDaemonConfig,
    private readonly executor: NodeCommandExecutor = unsupportedExecutor,
  ) {}

  async run(): Promise<void> {
    const identity = await NodeIdentity.loadOrCreate(this.config.dataDir);
    const roots = await resolveNodeRoots(this.config.roots);
    let attempt = 0;
    while (!this.stopped) {
      try {
        await this.connect(identity, roots);
        attempt = 0;
      } catch (error) {
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
    this.socket?.close(1000, 'Node daemon 正在停止');
  }

  private async connect(identity: NodeIdentity, roots: string[]): Promise<void> {
    let device = await identity.readDeviceRecord();
    const inventory = await discoverAgentInventory();
    const socket = new WebSocket(this.config.serverUrl, {
      maxPayload: 1024 * 1024,
      handshakeTimeout: 15_000,
    });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      let authenticated = false;
      let heartbeat: NodeJS.Timeout | undefined;
      socket.once('error', reject);
      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          socket.close(4002, '不支持二进制消息');
          return;
        }
        void this.handleServerMessage(socket, data.toString(), identity, roots, inventory, device)
          .then((nextDevice) => {
            if (nextDevice) device = nextDevice;
            if (!authenticated && nextDevice) {
              authenticated = true;
              heartbeat = this.startHeartbeat(socket, nextDevice, roots, inventory);
            }
          })
          .catch((error) => {
            socket.close(4002, 'Node 消息处理失败');
            reject(error);
          });
      });
      socket.once('close', (code, reason) => {
        if (heartbeat) clearInterval(heartbeat);
        this.socket = undefined;
        if (this.stopped || code === 1000) resolve();
        else reject(new Error(`连接关闭 ${String(code)} ${reason.toString()}`));
      });
    });
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
      const failure =
        error instanceof NodeCommandError
          ? error
          : new NodeCommandError('REMOTE_NODE_COMMAND_FAILED', safeErrorMessage(error));
      socket.send(
        JSON.stringify({
          type: 'node.result',
          requestId,
          ok: false,
          error: { code: failure.code, message: failure.message },
        }),
      );
    }
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}
