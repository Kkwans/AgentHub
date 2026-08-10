import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import {
  REMOTE_NODE_PROTOCOL_VERSION,
  remoteNodeSignaturePayload,
  type RemoteNodeServerMessage,
} from '@agenthub/shared';
import { createPgliteDatabase, RemoteNodeRepository, type DatabaseClient } from '@agenthub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { RemoteNodeGateway } from './remote-node-gateway.js';
import { RemoteNodeService } from './remote-node-service.js';
import { WebSocketUpgradeRouter } from '../websocket-upgrade.js';

describe('Remote Node WebSocket Gateway', () => {
  let database: DatabaseClient;
  let httpServer: Server;
  let service: RemoteNodeService;
  let gateway: RemoteNodeGateway;
  let upgradeRouter: WebSocketUpgradeRouter;
  let apiRoot: string;

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    service = new RemoteNodeService(new RemoteNodeRepository(database.db));
    httpServer = createServer();
    upgradeRouter = new WebSocketUpgradeRouter(httpServer);
    gateway = new RemoteNodeGateway(upgradeRouter, service);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('测试端口不可用');
    apiRoot = `ws://127.0.0.1:${address.port}/node/ws`;
  });

  afterAll(async () => {
    await gateway.close();
    upgradeRouter.close();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => (error ? reject(error) : resolve())),
    );
    await database.close();
  });

  it('完成注册、RPC result、Session event 与离线状态闭环', async () => {
    const token = await service.createRegistrationToken({
      name: 'Gateway fixture',
      allowedRoots: ['/srv/gateway-fixture'],
    });
    const keys = generateKeyPairSync('ed25519');
    const socket = new WebSocket(apiRoot);
    const messages = messageQueue(socket);
    await onceOpen(socket);
    const challenge = await messages.next('node.challenge');
    socket.send(
      JSON.stringify({
        type: 'node.register',
        protocolVersion: REMOTE_NODE_PROTOCOL_VERSION,
        registrationToken: token.token,
        publicKey: keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
        signature: sign(
          null,
          remoteNodeSignaturePayload('register', 'register', challenge.challenge!),
          keys.privateKey,
        ).toString('base64'),
        metadata: {
          name: 'Gateway fixture',
          hostname: 'gateway-test',
          os: 'linux',
          arch: 'arm64',
          daemonVersion: '0.2.0',
        },
        roots: ['/srv/gateway-fixture'],
        inventory: [],
      }),
    );
    const registered = await messages.next('node.registered');
    expect(gateway.isConnected(registered.nodeId!)).toBe(true);

    const duplicate = new WebSocket(apiRoot);
    const duplicateMessages = messageQueue(duplicate);
    await onceOpen(duplicate);
    const duplicateClosed = onceClose(duplicate);
    const duplicateChallenge = await duplicateMessages.next('node.challenge');
    duplicate.send(
      JSON.stringify({
        type: 'node.authenticate',
        protocolVersion: REMOTE_NODE_PROTOCOL_VERSION,
        nodeId: registered.nodeId,
        signature: sign(
          null,
          remoteNodeSignaturePayload(
            'authenticate',
            registered.nodeId!,
            duplicateChallenge.challenge!,
          ),
          keys.privateKey,
        ).toString('base64'),
        metadata: {
          name: 'Gateway duplicate',
          hostname: 'gateway-test',
          os: 'linux',
          arch: 'arm64',
          daemonVersion: '0.2.0',
        },
        roots: ['/srv/gateway-fixture'],
        inventory: [],
      }),
    );
    const duplicateError = await duplicateMessages.next('node.error');
    expect(duplicateError.error?.code).toBe('REMOTE_NODE_ALREADY_CONNECTED');
    await duplicateClosed;

    const rpc = gateway.request(registered.nodeId!, 'project.preflight', {
      rootPath: '/srv/gateway-fixture/project',
    });
    const command = await messages.next('node.command');
    socket.send(
      JSON.stringify({
        type: 'node.result',
        requestId: command.requestId,
        ok: true,
        result: { status: 'READY' },
      }),
    );
    await expect(rpc).resolves.toEqual({ status: 'READY' });

    const events: Array<Record<string, unknown>> = [];
    const unsubscribe = gateway.subscribeSession(
      registered.nodeId!,
      '11111111-1111-4111-8111-111111111111',
      (event) => events.push(event),
      () => undefined,
    );
    socket.send(
      JSON.stringify({
        type: 'node.event',
        sessionId: '11111111-1111-4111-8111-111111111111',
        event: { type: 'assistant.message.delta', payload: { text: '远程' } },
      }),
    );
    await waitFor(() => events.length === 1);
    unsubscribe();

    socket.close(1000, '测试完成');
    await waitFor(async () => (await service.diagnostics(registered.nodeId!)).status === 'OFFLINE');
    expect((await service.diagnostics(registered.nodeId!)).connected).toBe(false);
  });
});

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function onceClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once('close', () => resolve()));
}

function messageQueue(socket: WebSocket) {
  const queue: RemoteNodeServerMessage[] = [];
  const waiters: Array<(message: RemoteNodeServerMessage) => void> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as RemoteNodeServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  return {
    async next<T extends RemoteNodeServerMessage['type']>(type: T) {
      const message =
        queue.shift() ??
        (await new Promise<RemoteNodeServerMessage>((resolve) => waiters.push(resolve)));
      expect(message.type).toBe(type);
      return message as Extract<RemoteNodeServerMessage, { type: T }>;
    },
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('等待测试条件超时');
}
