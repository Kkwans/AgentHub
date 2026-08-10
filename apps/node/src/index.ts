#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { loadNodeDaemonConfig } from './config.js';
import { AgentHubNodeCommandExecutor } from './command-executor.js';
import { resolveNodeRoots } from './inventory.js';
import { RemoteNodeClient } from './node-client.js';

export { assertSecureNodeUrl, loadNodeDaemonConfig, type NodeDaemonConfig } from './config.js';
export { AgentHubNodeCommandExecutor } from './command-executor.js';
export { NodeIdentity, type DeviceRecord } from './identity.js';
export { discoverAgentInventory, nodeMetadata, resolveNodeRoots } from './inventory.js';
export { NodeCommandError, RemoteNodeClient, type NodeCommandExecutor } from './node-client.js';

async function main(): Promise<void> {
  const config = loadNodeDaemonConfig();
  const roots = await resolveNodeRoots(config.roots);
  const client = new RemoteNodeClient(config, new AgentHubNodeCommandExecutor(roots));
  const stop = () => client.stop();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await client.run();
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `AgentHub Node 启动失败：${error instanceof Error ? error.message : '未知错误'}\n`,
    );
    process.exitCode = 1;
  });
}
