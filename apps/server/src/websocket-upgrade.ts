import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type WebSocket } from 'ws';

interface WebSocketRoute {
  server: WebSocketServer;
  authorize?: ((request: IncomingMessage) => Promise<boolean>) | undefined;
}

export class WebSocketUpgradeRouter {
  private readonly routes = new Map<string, WebSocketRoute>();
  private readonly handle = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    void this.handleUpgrade(request, socket, head);
  };

  constructor(private readonly httpServer: Server) {
    httpServer.on('upgrade', this.handle);
  }

  register(
    path: string,
    options: {
      maxPayload: number;
      authorize?: ((request: IncomingMessage) => Promise<boolean>) | undefined;
      onConnection(socket: WebSocket, request: IncomingMessage): void;
    },
  ): WebSocketServer {
    if (this.routes.has(path)) throw new Error(`WebSocket path 已注册：${path}`);
    const server = new WebSocketServer({ noServer: true, maxPayload: options.maxPayload });
    server.on('connection', options.onConnection);
    this.routes.set(path, { server, authorize: options.authorize });
    return server;
  }

  close(): void {
    this.httpServer.off('upgrade', this.handle);
    this.routes.clear();
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    let path: string;
    try {
      path = new URL(request.url ?? '/', 'http://agenthub.local').pathname;
    } catch {
      rejectUpgrade(socket, 400, 'Bad Request');
      return;
    }
    const route = this.routes.get(path);
    if (!route) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    if (route.authorize) {
      try {
        if (!(await route.authorize(request))) {
          rejectUpgrade(socket, 401, 'Unauthorized');
          return;
        }
      } catch {
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
    }
    route.server.handleUpgrade(request, socket, head, (websocket) => {
      route.server.emit('connection', websocket, request);
    });
  }
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  if (socket.destroyed) return;
  socket.write(
    `HTTP/1.1 ${String(status)} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}
