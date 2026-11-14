import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { ResourceCleanupUnconfirmedError } from '@agenthub/agent-core';
import { RemoteNodeClient, type NodeCommandExecutor } from './node-client.js';
import { NodeIdentity } from './identity.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  vi.restoreAllMocks();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function fixture(
  executor: NodeCommandExecutor,
  inventory: () => Promise<[]> = async () => [],
) {
  const root = await mkdtemp(join(tmpdir(), 'node-client-drain-'));
  const workspace = join(root, 'work');
  await mkdir(workspace);
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const connections: WebSocket[] = [];
  server.on('connection', (socket) => connections.push(socket));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture');
  const client = new RemoteNodeClient(
    {
      serverUrl: `ws://127.0.0.1:${address.port}`,
      dataDir: join(root, 'identity'),
      name: 'fixture',
      roots: [workspace],
    },
    executor,
    inventory,
  );
  const running = client.run();
  const outcome = running.then(
    () => undefined,
    (error: unknown) => error,
  );
  cleanup.push(async () => {
    client.stop();
    for (const socket of server.clients) socket.terminate();
    await outcome;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  return { server, connections, client, running, outcome };
}
it('slow disconnect blocks reconnect, and stop/run wait for cleanup', async () => {
  const barrier = deferred<void>();
  const disconnect = vi.fn(() => barrier.promise);
  const f = await fixture({ execute: vi.fn(), disconnect, beginConnection: vi.fn(async () => {}) });
  await vi.waitFor(() => expect(f.connections).toHaveLength(1));
  f.connections[0]!.close(1000);
  await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(f.connections).toHaveLength(1);
  const completed = vi.fn();
  void f.running.then(completed);
  f.client.stop();
  expect(completed).not.toHaveBeenCalled();
  barrier.resolve();
  await f.running;
  expect(completed).toHaveBeenCalledOnce();
  expect(f.connections).toHaveLength(1);
});
it('confirmed disconnect permits a clean reconnect only after it settles', async () => {
  const barrier = deferred<void>();
  const disconnect = vi
    .fn()
    .mockImplementationOnce(() => barrier.promise)
    .mockResolvedValue(undefined);
  const begin = vi.fn(async () => {});
  const f = await fixture({ execute: vi.fn(), disconnect, beginConnection: begin });
  await vi.waitFor(() => expect(f.connections).toHaveLength(1));
  f.connections[0]!.close(1000);
  await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
  expect(begin).toHaveBeenCalledOnce();
  barrier.resolve();
  await vi.waitFor(() => expect(f.connections).toHaveLength(2));
  expect(begin).toHaveBeenCalledTimes(2);
  f.client.stop();
  await f.running;
});
it('cleanup failure stops automatic reconnect with fixed public error even after stop', async () => {
  const barrier = deferred<void>();
  const disconnect = vi.fn(() => barrier.promise);
  const f = await fixture({ execute: vi.fn(), disconnect });
  await vi.waitFor(() => expect(f.connections).toHaveLength(1));
  f.client.stop();
  await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
  barrier.reject(new Error('private provider detail'));
  const error = await f.outcome;
  expect(error).toBeInstanceOf(ResourceCleanupUnconfirmedError);
  expect((error as Error).cause).toBeUndefined();
  expect(String(error)).not.toContain('private');
  await new Promise((r) => setTimeout(r, 20));
  expect(f.connections).toHaveLength(1);
});
it('stop during inventory discovery opens no socket', async () => {
  const entered = deferred<void>();
  const inventory = deferred<[]>();
  const f = await fixture({ execute: vi.fn(), disconnect: vi.fn() }, () => {
    entered.resolve();
    return inventory.promise;
  });
  await entered.promise;
  f.client.stop();
  inventory.resolve([]);
  await f.running;
  expect(f.connections).toHaveLength(0);
});
it('late registration callback after stop cannot restart heartbeat or reconnect', async () => {
  const started = deferred<void>();
  const write = deferred<void>();
  vi.spyOn(NodeIdentity.prototype, 'writeDeviceRecord').mockImplementation(async () => {
    started.resolve();
    await write.promise;
  });
  const f = await fixture({ execute: vi.fn(), disconnect: vi.fn(async () => {}) });
  await vi.waitFor(() => expect(f.connections).toHaveLength(1));
  const heartbeat = vi.spyOn(
    f.client as unknown as { startHeartbeat: (...args: unknown[]) => unknown },
    'startHeartbeat',
  );
  f.connections[0]!.send(
    JSON.stringify({ type: 'node.registered', nodeId: 'fixture-node', targetId: 'fixture-target' }),
  );
  await started.promise;
  f.client.stop();
  await f.running;
  write.resolve();
  await new Promise((r) => setTimeout(r, 20));
  expect(heartbeat).not.toHaveBeenCalled();
  expect(f.connections).toHaveLength(1);
});
it('resource-unknown result closes the connection and drains rather than remaining ONLINE', async () => {
  const barrier = deferred<void>();
  const disconnect = vi.fn(() => barrier.promise);
  const f = await fixture({
    execute: async () => {
      throw new ResourceCleanupUnconfirmedError({ cause: new Error('private') });
    },
    disconnect,
  });
  await vi.waitFor(() => expect(f.connections).toHaveLength(1));
  const response = new Promise<Record<string, unknown>>((resolve) =>
    f.connections[0]!.once('message', (data) => resolve(JSON.parse(data.toString()))),
  );
  f.connections[0]!.send(
    JSON.stringify({
      type: 'node.command',
      requestId: 'fixture',
      command: 'agent.preflight',
      payload: {},
    }),
  );
  expect(await response).toMatchObject({
    ok: false,
    error: { code: 'RESOURCE_CLEANUP_UNCONFIRMED' },
  });
  await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
  const completed = vi.fn();
  void f.outcome.then(completed);
  expect(completed).not.toHaveBeenCalled();
  barrier.resolve();
  expect(await f.outcome).toBeInstanceOf(ResourceCleanupUnconfirmedError);
  expect(f.connections).toHaveLength(1);
});

it.each([false, true])(
  'resource uncertainty drains an existing real executor handle; response send failure=%s cannot reconnect',
  async (sendFails) => {
    const { FakeAgentAdapter } = await import('@agenthub/agent-core');
    const { AgentHubNodeCommandExecutor } = await import('./command-executor.js');
    const { randomUUID } = await import('node:crypto');
    const adapter = new FakeAgentAdapter({ scenario: 'idle' });
    const create = adapter.createSession.bind(adapter);
    let close!: ReturnType<typeof vi.spyOn>;
    vi.spyOn(adapter, 'createSession')
      .mockImplementationOnce(async (input) => {
        const handle = await create(input);
        close = vi.spyOn(handle, 'close');
        return handle;
      })
      .mockRejectedValue(new ResourceCleanupUnconfirmedError());
    const executor = new AgentHubNodeCommandExecutor(['/tmp'], adapter);
    const payload = {
      agentId: randomUUID(),
      projectId: randomUUID(),
      sessionId: randomUUID(),
      name: 'fixture',
      agentKind: 'CODEX',
      cwd: '/tmp',
    };
    await executor.execute('session.create', payload);
    const f = await fixture(executor);
    await vi.waitFor(() => expect(f.connections).toHaveLength(1));
    if (sendFails) {
      const socket = (f.client as unknown as { socket: WebSocket }).socket;
      vi.spyOn(socket, 'send').mockImplementationOnce(() => {
        throw new Error('fixture send failed');
      });
    }
    f.connections[0]!.send(
      JSON.stringify({
        type: 'node.command',
        requestId: 'fixture',
        command: 'session.create',
        payload: { ...payload, sessionId: randomUUID() },
      }),
    );
    expect(await f.outcome).toBeInstanceOf(ResourceCleanupUnconfirmedError);
    expect(close).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.connections).toHaveLength(1);
  },
);

it('resource unknown starts drain without waiting for the WebSocket close handshake', async () => {
  const barrier = deferred<void>();
  const disconnect = vi.fn(() => barrier.promise);
  const f = await fixture({
    execute: async () => {
      throw new ResourceCleanupUnconfirmedError();
    },
    disconnect,
  });
  await vi.waitFor(() => expect(f.connections).toHaveLength(1));
  const socket = (f.client as unknown as { socket: WebSocket }).socket;
  vi.spyOn(socket, 'close').mockImplementation(() => {});
  f.connections[0]!.send(
    JSON.stringify({
      type: 'node.command',
      requestId: 'fixture',
      command: 'agent.preflight',
      payload: {},
    }),
  );
  await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
  expect(f.connections[0]!.readyState).toBe(1); // no close event has occurred
  barrier.resolve();
  expect(await f.outcome).toBeInstanceOf(ResourceCleanupUnconfirmedError);
});

it('stop synchronously starts cleanup without waiting for the socket close event', async () => {
  const barrier = deferred<void>();
  const disconnect = vi.fn(() => barrier.promise);
  const f = await fixture({ execute: vi.fn(), disconnect });
  await vi.waitFor(() => expect(f.connections).toHaveLength(1));
  const socket = (f.client as unknown as { socket: WebSocket }).socket;
  vi.spyOn(socket, 'close').mockImplementation(() => {});
  f.client.stop();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(f.connections[0]!.readyState).toBe(1);
  const completed = vi.fn();
  void f.running.then(completed);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(completed).not.toHaveBeenCalled();
  barrier.resolve();
  await f.running;
  expect(completed).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('binary rejection immediately drains and rejects further commands despite delayed close', async () => {
  const barrier = deferred<void>();
  const disconnect = vi.fn(() => barrier.promise);
  const execute = vi.fn();
  const f = await fixture({ execute, disconnect });
  await vi.waitFor(() => expect(f.connections).toHaveLength(1));
  const socket = (f.client as unknown as { socket: WebSocket }).socket;
  vi.spyOn(socket, 'close').mockImplementation(() => {});
  f.connections[0]!.send(new Uint8Array([1]));
  await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
  expect(f.connections[0]!.readyState).toBe(1);
  f.connections[0]!.send(
    JSON.stringify({
      type: 'node.command',
      requestId: 'late',
      command: 'agent.preflight',
      payload: {},
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(execute).not.toHaveBeenCalled();
  f.client.stop();
  barrier.resolve();
  await f.running;
  expect(disconnect).toHaveBeenCalledOnce();
});
