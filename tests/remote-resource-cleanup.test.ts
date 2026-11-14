import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { createRequire } from 'node:module';
import type WebSocketType from '../apps/node/node_modules/@types/ws/index.js';
const WebSocket = createRequire(new URL('../apps/node/package.json', import.meta.url))(
  'ws',
) as typeof WebSocketType;
import {
  ResourceCleanupUnconfirmedError,
  isResourceCleanupUnconfirmed,
} from '../packages/agent-core/dist/index.js';
import {
  AgentRepository,
  ExecutionTargetRepository,
  RemoteNodeRepository,
  createPgliteDatabase,
  type DatabaseClient,
} from '../packages/db/dist/index.js';
import type { RemoteNodeCommandName } from '../packages/shared/src/index.js';
import { NodeCommandError, RemoteNodeClient } from '../apps/node/src/node-client.js';
import {
  RemoteNodeGateway,
  RemoteNodeRpcError,
} from '../apps/server/src/remote-nodes/remote-node-gateway.js';
import { RemoteNodeService } from '../apps/server/src/remote-nodes/remote-node-service.js';
import { RemoteAgentAdapter } from '../apps/server/src/remote-nodes/remote-agent-adapter.js';
import { WebSocketUpgradeRouter } from '../apps/server/src/websocket-upgrade.js';
import { AgentService } from '../apps/server/src/agents/agent-service.js';

let root: string, db: DatabaseClient, server: Server, router: WebSocketUpgradeRouter;
let nodes: RemoteNodeService, gateway: RemoteNodeGateway;
const clients: RemoteNodeClient[] = [],
  loops: Promise<{ error?: unknown }>[] = [],
  nodeIds: string[] = [];
const received: Array<{ requestId: string; command: string }> = [];
let execute: (command: RemoteNodeCommandName) => Promise<Record<string, unknown>>;
let sent: MockInstance<WebSocketType['send']>;
const unknown = () =>
  new ResourceCleanupUnconfirmedError({ cause: new Error('private provider secret') });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'agenthub-remote-resource-'));
  db = await createPgliteDatabase({ dataDir: 'memory://' });
  nodes = new RemoteNodeService(new RemoteNodeRepository(db.db));
  server = createServer();
  router = new WebSocketUpgradeRouter(server);
  gateway = new RemoteNodeGateway(router, nodes);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});
afterAll(async () => {
  for (const client of clients) client.stop();
  await observeNodeOutcomes();
  sent?.mockRestore();
  await gateway?.close();
  router?.close();
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await db?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
let generation = 0;
beforeEach(async () => {
  for (const client of clients) client.stop();
  await observeNodeOutcomes();
  sent?.mockRestore();
  clients.length = 0;
  loops.length = 0;
  nodeIds.length = 0;
  generation += 1;
  execute = async () => {
    throw unknown();
  };
  received.length = 0;
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture bind failed');
  for (let index = 0; index < 2; index += 1) {
    const token = await nodes.createRegistrationToken({
      name: `resource-${generation}-${index}`,
      allowedRoots: [root],
    });
    const client = new RemoteNodeClient(
      {
        serverUrl: `ws://127.0.0.1:${address.port}/node/ws`,
        dataDir: join(root, `identity-${generation}-${index}`),
        name: `resource-${generation}-${index}`,
        roots: [root],
        registrationToken: token.token,
      },
      { execute: async (command) => execute(command) },
      async () => [],
    );
    clients.push(client);
    // Observe immediately, then assert every rejected lifecycle before replacing fixtures.
    loops.push(
      client.run().then(
        () => ({}),
        (error: unknown) => ({ error }),
      ),
    );
    await waitFor(async () =>
      (await nodes.list()).some(
        (node) => node.name === `resource-${generation}-${index}` && node.status === 'ONLINE',
      ),
    );
    nodeIds.push(
      (await nodes.list()).find((node) => node.name === `resource-${generation}-${index}`)!.id,
    );
  }
  socket(0).on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'node.command') received.push(message);
  });
  sent = vi.spyOn(socket(0), 'send');
});

async function observeNodeOutcomes() {
  for (const outcome of await Promise.all(loops)) {
    if ('error' in outcome) {
      expect(outcome.error).toBeInstanceOf(ResourceCleanupUnconfirmedError);
      expect((outcome.error as Error).cause).toBeUndefined();
    }
  }
}

function socket(index: number): WebSocketType {
  return (clients[index] as unknown as { socket: WebSocketType }).socket;
}

it.each(['agent.preflight', 'agent.capabilities', 'session.create'] as const)(
  '%s真实Node JSON往返只重建固定generic，无cause或供应商文本',
  async (command) => {
    const error = await gateway
      .request(nodeIds[0]!, command, {})
      .catch((failure: unknown) => failure);
    expect(isResourceCleanupUnconfirmed(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RESOURCE_CLEANUP_UNCONFIRMED',
      message: new ResourceCleanupUnconfirmedError().message,
    });
    expect((error as Error).cause).toBeUndefined();
    const raw = sent.mock.calls
      .map((call) => String(call[0]))
      .find((value) => value.includes('node.result'))!;
    expect(JSON.parse(raw).error).toEqual({
      code: 'RESOURCE_CLEANUP_UNCONFIRMED',
      message: new ResourceCleanupUnconfirmedError().message,
    });
    expect(raw).not.toMatch(/private|cause|stack/);
  },
);

it('普通失败和仅同名错误码不升级为generic', async () => {
  for (const failure of [
    new Error('ordinary'),
    new NodeCommandError('RESOURCE_CLEANUP_UNCONFIRMED', 'not the contract'),
    new NodeCommandError('NODE_DECLINED', 'known rejection'),
  ]) {
    execute = async () => {
      throw failure;
    };
    const error = await gateway
      .request(nodeIds[0]!, 'session.create', {})
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(RemoteNodeRpcError);
    expect(isResourceCleanupUnconfirmed(error)).toBe(false);
    expect((error as RemoteNodeRpcError).code).toBe(
      failure instanceof NodeCommandError && failure.code === 'NODE_DECLINED'
        ? 'NODE_DECLINED'
        : 'REMOTE_NODE_COMMAND_FAILED',
    );
  }
});
it('非资源命令不升级generic语义', async () => {
  const error = await gateway.request(nodeIds[0]!, 'fs.read', {}).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(RemoteNodeRpcError);
  expect(isResourceCleanupUnconfirmed(error)).toBe(false);
});
it('其他认证Node或错误requestId的未知响应不能结算原资源请求', async () => {
  let fail!: (error: Error) => void;
  execute = () =>
    new Promise((_, reject) => {
      fail = reject;
    });
  const completed = vi.fn();
  const pending = gateway.request(nodeIds[0]!, 'session.create', {}).then(completed, (error) => {
    completed();
    return error;
  });
  await waitFor(() => received.length === 1);
  const message = {
    type: 'node.result',
    requestId: received[0]!.requestId,
    ok: false,
    error: { code: 'RESOURCE_CLEANUP_UNCONFIRMED', message: 'untrusted diagnostic' },
  };
  socket(1).send(JSON.stringify(message));
  socket(0).send(JSON.stringify({ ...message, requestId: randomUUID() }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(completed).not.toHaveBeenCalled();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture bind failed');
  const stranger = new WebSocket(`ws://127.0.0.1:${address.port}/node/ws`);
  const denied = new Promise<{ error: { code: string } }>((resolve) =>
    stranger.on('message', (data) => {
      const response = JSON.parse(data.toString());
      if (response.type === 'node.error') resolve(response);
    }),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      stranger.once('open', resolve);
      stranger.once('error', reject);
    });
    stranger.send(JSON.stringify(message));
    expect((await denied).error.code).toBe('REMOTE_NODE_AUTH_REQUIRED');
    expect(completed).not.toHaveBeenCalled();
  } finally {
    stranger.close();
  }
  fail(unknown());
  expect(isResourceCleanupUnconfirmed(await pending)).toBe(true);
});
it.each(['agent.preflight', 'agent.capabilities', 'session.create', 'fs.read'] as const)(
  '%s RPC超时按资源风险分类，迟到结果不重新结算',
  async (command) => {
    let finish!: (result: Record<string, unknown>) => void;
    execute = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const request = gateway.request(nodeIds[0]!, command, {}, 1000);
    const observed = request.catch((error: unknown) => error);
    await waitFor(() => received.length === 1);
    const error = await observed;
    expect(error).toMatchObject({
      code: command === 'fs.read' ? 'REMOTE_NODE_RPC_TIMEOUT' : 'RESOURCE_CLEANUP_UNCONFIRMED',
    });
    expect(isResourceCleanupUnconfirmed(error)).toBe(command !== 'fs.read');
    finish({ status: 'READY' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(request).rejects.toBe(error);
  },
);
it.each(['agent.preflight', 'agent.capabilities', 'timeout'] as const)(
  '%s真实远程拒绝到AgentService仍保持sticky清理未知',
  async (failingCommand) => {
    let finish: ((result: Record<string, unknown>) => void) | undefined;
    const originalRequest = gateway.request.bind(gateway);
    const requestSpy =
      failingCommand === 'timeout'
        ? vi
            .spyOn(gateway, 'request')
            .mockImplementation((nodeId, command, payload) =>
              originalRequest(nodeId, command, payload, 1000),
            )
        : undefined;
    execute = async (command) => {
      if (failingCommand === 'timeout')
        return new Promise((resolve) => {
          finish = resolve;
        });
      if (command === failingCommand) throw unknown();
      return { status: 'READY', checkedAt: new Date().toISOString(), checks: [] };
    };
    const node = (await nodes.list()).find((node) => node.id === nodeIds[0])!;
    const agents = new AgentRepository(db.db);
    const agent = await agents.create({
      id: randomUUID(),
      targetId: node.targetId,
      name: 'fixture',
      agentKind: 'CODEX',
      adapterKind: 'ACP_STDIO',
      executable: '/fixture-not-executed',
      argsJson: [],
      configJson: { remoteInventoryKey: 'codex' },
      status: 'READY',
    });
    const service = new AgentService(
      agents,
      new ExecutionTargetRepository(db.db),
      {
        launch: async () => {
          throw new Error('local launch forbidden');
        },
      },
      undefined,
      new RemoteAgentAdapter(gateway),
    );
    try {
      await expect(service.preflight(agent.id, { cwd: root })).rejects.toBeInstanceOf(
        ResourceCleanupUnconfirmedError,
      );
    } finally {
      requestSpy?.mockRestore();
    }
    if (finish) {
      finish({ status: 'READY', checkedAt: new Date().toISOString(), checks: [] });
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    await expect(service.shutdownConnectionChecks()).rejects.toMatchObject({
      code: 'AGENT_CHECK_SHUTDOWN_UNCONFIRMED',
    });
    await expect(service.shutdownConnectionChecks()).rejects.toMatchObject({
      code: 'AGENT_CHECK_SHUTDOWN_UNCONFIRMED',
    });
    await expect(service.preflight(agent.id, { cwd: root })).rejects.toMatchObject({
      code: 'AGENT_CHECK_UNAVAILABLE',
    });
    expect((await agents.get(agent.id))?.lastPreflightAt).toBeNull();
  },
);
it.each(['session.create', 'fs.read'] as const)(
  '%s同步发送失败清理pending与timer，不留下孤儿拒绝',
  async (command) => {
    const connection = gatewayState().connections.get(nodeIds[0]!)!;
    const failure = new Error('fixture send failed');
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    const send = vi.spyOn(connection.socket, 'send').mockImplementationOnce(() => {
      throw failure;
    });
    try {
      const error = await gateway
        .request(nodeIds[0]!, command, {}, 1000)
        .catch((error: unknown) => error);
      if (command === 'fs.read') expect(error).toBe(failure);
      else expect(isResourceCleanupUnconfirmed(error)).toBe(true);
      expect(connection.pending.size).toBe(0);
      expect(gatewayState().pending.size).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(unhandled).toEqual([]);
      expect(received).toHaveLength(0);
    } finally {
      send.mockRestore();
      process.off('unhandledRejection', onUnhandled);
    }
  },
);
it.each(['session.create', 'fs.read'] as const)(
  '%s发送时socket状态变化不能silent drop',
  async (command) => {
    const connection = gatewayState().connections.get(nodeIds[0]!)!;
    const state = vi
      .spyOn(connection.socket, 'readyState', 'get')
      .mockReturnValueOnce(WebSocket.OPEN)
      .mockReturnValue(WebSocket.CLOSING);
    try {
      const error = await gateway
        .request(nodeIds[0]!, command, {})
        .catch((error: unknown) => error);
      expect(error).toMatchObject({
        code: command === 'fs.read' ? 'REMOTE_NODE_DISCONNECTED' : 'RESOURCE_CLEANUP_UNCONFIRMED',
      });
      expect(connection.pending.size).toBe(0);
      expect(gatewayState().pending.size).toBe(0);
      expect(received).toHaveLength(0);
    } finally {
      state.mockRestore();
    }
  },
);
it('发送前OFFLINE不创建pending，也不伪称资源已获取', async () => {
  await expect(gateway.request(randomUUID(), 'session.create', {})).rejects.toMatchObject({
    code: 'REMOTE_NODE_OFFLINE',
  });
  expect(gatewayState().pending.size).toBe(0);
});
it('实际断线时已pending资源未知，非资源仍保留断线错误', async () => {
  let calls = 0;
  execute = () => {
    calls += 1;
    return new Promise(() => {});
  };
  const resource = gateway
    .request(nodeIds[1]!, 'session.create', {})
    .catch((error: unknown) => error);
  const read = gateway.request(nodeIds[1]!, 'fs.read', {}).catch((error: unknown) => error);
  await waitFor(() => calls === 2);
  clients[1]!.stop();
  await loops[1];
  expect(isResourceCleanupUnconfirmed(await resource)).toBe(true);
  expect(await read).toMatchObject({ code: 'REMOTE_NODE_DISCONNECTED' });
  expect(gatewayState().pending.size).toBe(0);
});
function gatewayState() {
  return gateway as unknown as {
    connections: Map<string, { socket: WebSocketType; pending: Set<string> }>;
    pending: Map<string, unknown>;
  };
}
async function waitFor(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('fixture condition timed out');
}
