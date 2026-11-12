import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

import { websocketClientMessageSchema, type WebSocketServerMessage } from '@agenthub/shared';
import { WebSocket, type WebSocketServer } from 'ws';
import type { WebSocketUpgradeRouter } from './websocket-upgrade.js';

export interface ReplayEventSource {
  listAfter(
    sessionId: string,
    afterSeq: number,
    limit?: number,
  ): Promise<Array<Record<string, unknown>>>;
}

export interface ConnectionAuthorization {
  isActive(): boolean;
  dispose(): void;
}

export interface WebSocketAuthenticator {
  authorize(headers: IncomingHttpHeaders): Promise<boolean>;
  authorizeConnection(
    headers: IncomingHttpHeaders,
    onInvalidated: () => void,
  ): Promise<ConnectionAuthorization | undefined>;
}

interface ClientState {
  readonly id: string;
  readonly socket: WebSocket;
  readonly topics: Set<string>;
  authorization?: ConnectionAuthorization;
  authorizationReady?: Promise<void>;
  authorized: boolean;
}

export class TopicBroker {
  private readonly server: WebSocketServer;
  private readonly clients = new Set<ClientState>();

  constructor(
    upgradeRouter: WebSocketUpgradeRouter,
    private readonly replaySource?: ReplayEventSource,
    private readonly authenticator?: WebSocketAuthenticator,
  ) {
    this.server = upgradeRouter.register('/ws', {
      maxPayload: 1024 * 1024,
      ...(authenticator
        ? {
            authorize: async (request) => {
              return authenticator.authorize(request.headers);
            },
          }
        : {}),
      onConnection: (socket, request) => this.onConnection(socket, request),
    });
  }

  publish(topic: string, event: Record<string, unknown>): void {
    for (const client of this.clients) {
      if (client.topics.has(topic)) this.send(client, { type: 'event', topic, event });
    }
  }

  async close(): Promise<void> {
    for (const client of [...this.clients]) {
      this.removeClient(client);
      client.socket.close(1001, '服务器正在关闭');
    }
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private onConnection(socket: WebSocket, request: IncomingMessage): void {
    const client: ClientState = {
      id: randomUUID(),
      socket,
      topics: new Set(),
      authorized: !this.authenticator,
    };
    this.clients.add(client);
    client.authorizationReady = this.authorizeClient(client, request.headers);

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        this.sendError(client, 'WS_BINARY_UNSUPPORTED', 'WebSocket 不接受二进制消息');
        return;
      }
      void this.handleMessage(client, data.toString()).catch(() => {
        this.sendError(client, 'WS_REPLAY_FAILED', 'WebSocket 历史事件补流失败');
      });
    });
    socket.on('close', () => this.removeClient(client));
    socket.on('error', () => this.removeClient(client));
  }

  private async authorizeClient(client: ClientState, headers: IncomingHttpHeaders): Promise<void> {
    if (this.authenticator) {
      try {
        const authorization = await this.authenticator.authorizeConnection(headers, () => {
          this.removeClient(client);
          client.socket.close(1008, '登录已失效，请重新登录');
        });
        if (
          !authorization ||
          !this.clients.has(client) ||
          client.socket.readyState !== WebSocket.OPEN
        ) {
          authorization?.dispose();
          this.removeClient(client);
          client.socket.close(1008, '登录已失效，请重新登录');
          return;
        }
        client.authorization = authorization;
        client.authorized = authorization.isActive();
      } catch {
        this.removeClient(client);
        client.socket.close(1008, '登录验证失败');
        return;
      }
    }
    this.send(client, { type: 'connection.ready', event: { connectionId: client.id } });
  }

  private removeClient(client: ClientState): void {
    client.authorized = false;
    client.authorization?.dispose();
    client.topics.clear();
    this.clients.delete(client);
  }

  private isAuthorized(client: ClientState): boolean {
    return (
      this.clients.has(client) && client.authorized && (client.authorization?.isActive() ?? true)
    );
  }

  private async handleMessage(client: ClientState, raw: string): Promise<void> {
    await client.authorizationReady;
    if (!this.isAuthorized(client)) return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      this.sendError(client, 'WS_INVALID_JSON', 'WebSocket 消息不是合法 JSON');
      return;
    }

    const parsed = websocketClientMessageSchema.safeParse(decoded);
    if (!parsed.success) {
      this.sendError(client, 'WS_VALIDATION_FAILED', 'WebSocket 消息不符合协议');
      return;
    }

    if (parsed.data.type === 'ping') {
      this.send(client, { type: 'pong' });
      return;
    }
    if (parsed.data.type === 'unsubscribe') {
      for (const topic of parsed.data.topics) client.topics.delete(topic);
      this.send(client, { type: 'unsubscribed', topics: parsed.data.topics });
      return;
    }

    for (const topic of parsed.data.topics) client.topics.add(topic);
    this.send(client, { type: 'subscribed', topics: parsed.data.topics });

    if (!this.replaySource) return;
    for (const topic of parsed.data.topics) {
      if (!this.isAuthorized(client)) return;
      if (!topic.startsWith('session:')) continue;
      const sessionId = topic.slice('session:'.length);
      const afterSeq = parsed.data.afterSeq?.[topic] ?? 0;
      const events = await this.replaySource.listAfter(sessionId, afterSeq);
      if (!this.isAuthorized(client)) return;
      for (const event of events) this.send(client, { type: 'event', topic, event });
    }
  }

  private send(client: ClientState, message: WebSocketServerMessage): void {
    if (this.isAuthorized(client) && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }

  private sendError(client: ClientState, code: string, message: string): void {
    this.send(client, { type: 'error', error: { code, message } });
  }
}
