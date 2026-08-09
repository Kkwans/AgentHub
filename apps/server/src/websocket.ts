import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { websocketClientMessageSchema, type WebSocketServerMessage } from '@agenthub/shared';
import { WebSocket, WebSocketServer } from 'ws';

export interface ReplayEventSource {
  listAfter(
    sessionId: string,
    afterSeq: number,
    limit?: number,
  ): Promise<Array<Record<string, unknown>>>;
}

export interface WebSocketAuthenticator {
  authorizeHeader(header: string | undefined): Promise<boolean>;
}

interface ClientState {
  readonly id: string;
  readonly socket: WebSocket;
  readonly topics: Set<string>;
}

export class TopicBroker {
  private readonly server: WebSocketServer;
  private readonly clients = new Set<ClientState>();

  constructor(
    httpServer: Server,
    private readonly replaySource?: ReplayEventSource,
    authenticator?: WebSocketAuthenticator,
  ) {
    this.server = new WebSocketServer({
      server: httpServer,
      path: '/ws',
      maxPayload: 1024 * 1024,
      ...(authenticator
        ? {
            verifyClient: (info, done) => {
              const credential =
                info.req.headers.authorization ?? info.req.headers['sec-websocket-protocol'];
              void authenticator
                .authorizeHeader(credential)
                .then((allowed) => done(allowed, allowed ? undefined : 401, '需要有效 token'))
                .catch(() => done(false, 401, '需要有效 token'));
            },
          }
        : {}),
    });
    this.server.on('connection', (socket) => this.onConnection(socket));
  }

  publish(topic: string, event: Record<string, unknown>): void {
    for (const client of this.clients) {
      if (client.topics.has(topic)) this.send(client.socket, { type: 'event', topic, event });
    }
  }

  async close(): Promise<void> {
    for (const client of this.clients) client.socket.close(1001, '服务器正在关闭');
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private onConnection(socket: WebSocket): void {
    const client: ClientState = { id: randomUUID(), socket, topics: new Set() };
    this.clients.add(client);
    this.send(socket, { type: 'connection.ready', event: { connectionId: client.id } });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        this.sendError(socket, 'WS_BINARY_UNSUPPORTED', 'WebSocket 不接受二进制消息');
        return;
      }
      void this.handleMessage(client, data.toString()).catch(() => {
        this.sendError(socket, 'WS_REPLAY_FAILED', 'WebSocket 历史事件补流失败');
      });
    });
    socket.on('close', () => this.clients.delete(client));
    socket.on('error', () => this.clients.delete(client));
  }

  private async handleMessage(client: ClientState, raw: string): Promise<void> {
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      this.sendError(client.socket, 'WS_INVALID_JSON', 'WebSocket 消息不是合法 JSON');
      return;
    }

    const parsed = websocketClientMessageSchema.safeParse(decoded);
    if (!parsed.success) {
      this.sendError(client.socket, 'WS_VALIDATION_FAILED', 'WebSocket 消息不符合协议');
      return;
    }

    if (parsed.data.type === 'ping') {
      this.send(client.socket, { type: 'pong' });
      return;
    }
    if (parsed.data.type === 'unsubscribe') {
      for (const topic of parsed.data.topics) client.topics.delete(topic);
      this.send(client.socket, { type: 'unsubscribed', topics: parsed.data.topics });
      return;
    }

    for (const topic of parsed.data.topics) client.topics.add(topic);
    this.send(client.socket, { type: 'subscribed', topics: parsed.data.topics });

    if (!this.replaySource) return;
    for (const topic of parsed.data.topics) {
      if (!topic.startsWith('session:')) continue;
      const sessionId = topic.slice('session:'.length);
      const afterSeq = parsed.data.afterSeq?.[topic] ?? 0;
      const events = await this.replaySource.listAfter(sessionId, afterSeq);
      for (const event of events) this.send(client.socket, { type: 'event', topic, event });
    }
  }

  private send(socket: WebSocket, message: WebSocketServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    this.send(socket, { type: 'error', error: { code, message } });
  }
}
