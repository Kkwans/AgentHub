import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RemoteNodeClient } from '../apps/node/src/node-client.js';
import {
  RemoteNodeGateway,
  type RemoteNodeRpcError,
} from '../apps/server/src/remote-nodes/remote-node-gateway.js';
import { RemoteNodeService } from '../apps/server/src/remote-nodes/remote-node-service.js';
import { WebSocketUpgradeRouter } from '../apps/server/src/websocket-upgrade.js';
import {
  createPgliteDatabase,
  RemoteNodeRepository,
  type DatabaseClient,
} from '../packages/db/src/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('AgentHub Node daemon integration', () => {
  let fixtureRoot: string;
  let database: DatabaseClient;
  let httpServer: Server;
  let service: RemoteNodeService;
  let gateway: RemoteNodeGateway;
  let upgradeRouter: WebSocketUpgradeRouter;
  let serverUrl: string;

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'agenthub-node-daemon-'));
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    service = new RemoteNodeService(new RemoteNodeRepository(database.db));
    httpServer = createServer();
    upgradeRouter = new WebSocketUpgradeRouter(httpServer);
    gateway = new RemoteNodeGateway(upgradeRouter, service);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('测试端口不可用');
    serverUrl = `ws://127.0.0.1:${address.port}/node/ws`;
  });

  afterAll(async () => {
    await gateway.close();
    upgradeRouter.close();
    await new Promise<void>((resolve, reject) =>
      httpServer.close((error) => (error ? reject(error) : resolve())),
    );
    await database.close();
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('daemon 生成设备身份、完成注册并返回固定 allow-list 错误', async () => {
    const token = await service.createRegistrationToken({
      name: 'Daemon fixture',
      allowedRoots: [fixtureRoot],
    });
    const client = new RemoteNodeClient({
      serverUrl,
      dataDir: join(fixtureRoot, 'identity'),
      name: 'Daemon fixture',
      roots: [fixtureRoot],
      registrationToken: token.token,
    });
    const running = client.run();
    const node = await waitForNode(service);
    expect(node.status).toBe('ONLINE');
    expect(node.allowedRootsJson).toEqual([fixtureRoot]);
    expect(node.inventoryJson.some((entry) => entry.agentKind === 'CODEX')).toBe(true);
    await expect(gateway.request(node.id, 'project.preflight', {})).rejects.toEqual(
      expect.objectContaining<Partial<RemoteNodeRpcError>>({
        code: 'REMOTE_NODE_COMMAND_UNSUPPORTED',
      }),
    );

    client.stop();
    await running;
    await waitFor(async () => (await service.diagnostics(node.id)).status === 'OFFLINE');
  });
});

async function waitForNode(service: RemoteNodeService) {
  let found: Awaited<ReturnType<RemoteNodeService['list']>>[number] | undefined;
  await waitFor(async () => {
    found = (await service.list())[0];
    return found?.status === 'ONLINE';
  });
  if (!found) throw new Error('Remote Node 未注册');
  return found;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('等待测试条件超时');
}
