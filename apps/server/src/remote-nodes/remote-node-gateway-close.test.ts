import { REMOTE_NODE_PROTOCOL_VERSION } from '@agenthub/shared';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { RemoteNodeGateway } from './remote-node-gateway.js';
import type { RemoteNodeService } from './remote-node-service.js';
import type { WebSocketUpgradeRouter } from '../websocket-upgrade.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const nodeId = '00000000-0000-4000-8000-000000000001';
function fixture(
  markOffline: () => Promise<void>,
  authenticateBarrier?: Promise<void>,
  timeout = 1000,
) {
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(() => {
      socket.readyState = 3;
      socket.emit('close');
    }),
  });
  let connect!: (socket: unknown) => void;
  const server = { clients: new Set([socket]), close: (callback: () => void) => callback() };
  const nodes = {
    attachController: vi.fn(),
    heartbeat: vi.fn(async () => {}),
    markOffline: vi.fn(markOffline),
    authenticate: vi.fn(async () => {
      await authenticateBarrier;
      return { id: nodeId, targetId: nodeId };
    }),
  };
  const router = {
    register: (_: string, options: { onConnection: typeof connect }) => {
      connect = options.onConnection;
      return server;
    },
  };
  const gateway = new RemoteNodeGateway(
    router as unknown as WebSocketUpgradeRouter,
    nodes as unknown as RemoteNodeService,
    timeout,
  );
  connect(socket);
  const authentication = Buffer.from(
    JSON.stringify({
      type: 'node.authenticate',
      protocolVersion: REMOTE_NODE_PROTOCOL_VERSION,
      nodeId,
      signature: 'a'.repeat(80),
      metadata: {
        name: 'test',
        hostname: 'test',
        os: 'linux',
        arch: 'arm64',
        daemonVersion: '0.2.0',
      },
      roots: ['/tmp'],
      inventory: [],
    }),
  );
  socket.emit('message', authentication, false);
  return { gateway, socket, nodes, connect, server, authentication };
}

describe('Gateway asynchronous close drain', () => {
  it('waits for final OFFLINE write and shares a single close result', async () => {
    const write = deferred();
    const f = fixture(() => write.promise);
    await vi.waitFor(() => expect(f.gateway.isConnected(nodeId)).toBe(true));
    let closed = false;
    const closing = f.gateway.close();
    expect(f.gateway.close()).toBe(closing);
    void closing.then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(f.nodes.markOffline).toHaveBeenCalledOnce());
    expect(closed).toBe(false);
    write.resolve();
    await closing;
    expect(closed).toBe(true);
  });
  it('failed offline write keeps close rejection sticky', async () => {
    const f = fixture(async () => {
      throw new Error('private DB diagnostic');
    });
    await vi.waitFor(() => expect(f.gateway.isConnected(nodeId)).toBe(true));
    const closing = f.gateway.close();
    await expect(closing).rejects.toMatchObject({ code: 'REMOTE_NODE_GATEWAY_CLOSE_UNCONFIRMED' });
    expect(f.gateway.close()).toBe(closing);
    await expect(closing).rejects.not.toThrow('private DB diagnostic');
  });
  it('late authentication is drained then marked offline without accepting a connection', async () => {
    const auth = deferred();
    const write = deferred();
    const f = fixture(() => write.promise, auth.promise);
    await vi.waitFor(() => expect(f.nodes.authenticate).toHaveBeenCalledOnce());
    let closed = false;
    const closing = f.gateway.close();
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    auth.resolve();
    await vi.waitFor(() => expect(f.nodes.markOffline).toHaveBeenCalledOnce());
    expect(closed).toBe(false);
    expect(f.gateway.isConnected(nodeId)).toBe(false);
    write.resolve();
    await closing;
  });
  it('waits for an admitted heartbeat before the final OFFLINE write', async () => {
    const heartbeat = deferred();
    const f = fixture(async () => {});
    await vi.waitFor(() => expect(f.gateway.isConnected(nodeId)).toBe(true));
    f.nodes.heartbeat.mockImplementation(() => heartbeat.promise);
    const auth = JSON.parse(f.authentication.toString()) as Record<string, unknown>;
    delete auth.signature;
    delete auth.protocolVersion;
    f.socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({ ...auth, type: 'node.heartbeat', sentAt: new Date().toISOString() }),
      ),
      false,
    );
    await vi.waitFor(() => expect(f.nodes.heartbeat).toHaveBeenCalledOnce());
    const closing = f.gateway.close();
    await Promise.resolve();
    expect(f.nodes.markOffline).not.toHaveBeenCalled();
    heartbeat.resolve();
    await closing;
    expect(f.nodes.markOffline).toHaveBeenCalledOnce();
  });
  it('does not mark an existing active node offline after a duplicate late authentication', async () => {
    const f = fixture(async () => {});
    await vi.waitFor(() => expect(f.gateway.isConnected(nodeId)).toBe(true));
    const late = deferred();
    f.nodes.authenticate.mockImplementation(async () => {
      await late.promise;
      return { id: nodeId, targetId: nodeId };
    });
    const duplicate = Object.assign(new EventEmitter(), {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(() => {
        duplicate.readyState = 3;
        duplicate.emit('close');
      }),
    });
    f.server.clients.add(duplicate);
    f.connect(duplicate);
    duplicate.emit('message', f.authentication, false);
    await vi.waitFor(() => expect(f.nodes.authenticate).toHaveBeenCalledTimes(2));
    duplicate.close();
    late.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(f.nodes.markOffline).not.toHaveBeenCalled();
    expect(f.gateway.isConnected(nodeId)).toBe(true);
    await f.gateway.close();
    expect(f.nodes.markOffline).toHaveBeenCalledOnce();
  });
  it('serializes replacement authentication after the old final OFFLINE write', async () => {
    const write = deferred();
    const f = fixture(() => write.promise);
    await vi.waitFor(() => expect(f.gateway.isConnected(nodeId)).toBe(true));
    f.socket.close();
    await vi.waitFor(() => expect(f.nodes.markOffline).toHaveBeenCalledOnce());
    const replacement = Object.assign(new EventEmitter(), {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(() => {
        replacement.readyState = 3;
        replacement.emit('close');
      }),
    });
    f.server.clients.add(replacement);
    f.connect(replacement);
    replacement.emit('message', f.authentication, false);
    await Promise.resolve();
    expect(f.nodes.authenticate).toHaveBeenCalledTimes(1);
    write.resolve();
    await vi.waitFor(() => expect(f.nodes.authenticate).toHaveBeenCalledTimes(2));
    expect(f.gateway.isConnected(nodeId)).toBe(true);
    await f.gateway.close();
    expect(f.nodes.markOffline).toHaveBeenCalledTimes(2);
  });
  it('timeout remains rejected after the write eventually finishes', async () => {
    const write = deferred();
    const f = fixture(() => write.promise, undefined, 30);
    await vi.waitFor(() => expect(f.gateway.isConnected(nodeId)).toBe(true));
    const closing = f.gateway.close();
    await expect(closing).rejects.toMatchObject({ code: 'REMOTE_NODE_GATEWAY_CLOSE_UNCONFIRMED' });
    write.resolve();
    await Promise.resolve();
    expect(f.gateway.close()).toBe(closing);
    await expect(closing).rejects.toMatchObject({ code: 'REMOTE_NODE_GATEWAY_CLOSE_UNCONFIRMED' });
  });
});
