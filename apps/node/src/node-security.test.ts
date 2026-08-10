import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assertSecureNodeUrl } from './config.js';
import { NodeIdentity } from './identity.js';
import { resolveNodeRoots } from './inventory.js';

describe('AgentHub Node 本地安全边界', () => {
  const created: string[] = [];

  afterEach(async () => {
    for (const directory of created.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('只允许 loopback 明文 WS，远端必须使用 WSS', () => {
    expect(() => assertSecureNodeUrl('ws://127.0.0.1:3210/node/ws')).not.toThrow();
    expect(() => assertSecureNodeUrl('wss://agenthub.example.com/node/ws')).not.toThrow();
    expect(() => assertSecureNodeUrl('ws://192.168.1.20:3210/node/ws')).toThrow(/wss/);
    expect(() => assertSecureNodeUrl('https://agenthub.example.com/node/ws')).toThrow(/wss/);
  });

  it('设备 private key 权限为 0600 且重载身份不变化', async () => {
    const dataDir = await temporary('agenthub-node-identity-');
    const first = await NodeIdentity.loadOrCreate(dataDir);
    const second = await NodeIdentity.loadOrCreate(dataDir);
    expect(second.publicKey).toBe(first.publicKey);
    expect((await stat(join(dataDir, 'device-private-key.pem'))).mode & 0o777).toBe(0o600);
  });

  it('Node root 必须是非文件系统根的真实目录', async () => {
    const root = await temporary('agenthub-node-root-');
    await expect(resolveNodeRoots([root])).resolves.toEqual([root]);
    await expect(resolveNodeRoots(['/'])).rejects.toThrow(/根目录/);
    await expect(resolveNodeRoots(['relative'])).rejects.toThrow(/绝对路径/);
  });

  async function temporary(prefix: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    created.push(directory);
    return directory;
  }
});
