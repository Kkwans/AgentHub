import { createServer, type IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { WebSocketUpgradeRouter } from './websocket-upgrade.js';

describe('WebSocket upgrade shutdown', () => {
  it('rejects an authorized upgrade completing after router shutdown', async () => {
    const http = createServer();
    const router = new WebSocketUpgradeRouter(http);
    let authorize!: (value: boolean) => void;
    const authorization = new Promise<boolean>((resolve) => {
      authorize = resolve;
    });
    const connection = vi.fn();
    const route = router.register('/ws', {
      maxPayload: 1024,
      authorize: () => authorization,
      onConnection: connection,
    });
    const upgrade = vi.spyOn(route, 'handleUpgrade');
    const socket = new PassThrough();
    const write = vi.spyOn(socket, 'write');
    http.emit('upgrade', { url: '/ws' } as IncomingMessage, socket, Buffer.alloc(0));
    router.close();
    authorize(true);
    await vi.waitFor(() =>
      expect(write).toHaveBeenCalledWith(expect.stringContaining('503 Service Unavailable')),
    );
    expect(upgrade).not.toHaveBeenCalled();
    expect(connection).not.toHaveBeenCalled();
    expect(socket.destroyed).toBe(true);
    expect(() => router.register('/again', { maxPayload: 1, onConnection: connection })).toThrow(
      '已关闭',
    );
    route.close();
  });
});
