#!/usr/bin/env node

import { dirname, isAbsolute, resolve } from 'node:path';
import { mkdir, open, unlink } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

const outputArgument = process.argv[2];
const tokenName = process.argv[3] ?? `nas-lan-${new Date().toISOString().slice(0, 10)}`;
const apiOrigin = process.env.AGENTHUB_API_ORIGIN ?? 'http://127.0.0.1:3210';

if (!outputArgument || !isAbsolute(outputArgument)) {
  process.stderr.write('用法：create-deployment-token.mjs <绝对输出路径> [token 名称]\n');
  process.exit(2);
}

const outputPath = resolve(outputArgument);
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
const output = await open(outputPath, 'wx', 0o600);

let tokenId;
try {
  const authStatus = await request('/api/v1/auth/status');
  if (!authStatus.localTrusted) {
    throw new Error('创建部署 token 前，旧服务必须仍处于 loopback local_trusted 模式');
  }

  const created = await request('/api/v1/auth/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: tokenName }),
  });
  if (typeof created.id !== 'string' || typeof created.token !== 'string') {
    throw new Error('AgentHub 返回了无效的 token 创建响应');
  }
  tokenId = created.id;
  await output.writeFile(`${created.token}\n`, { encoding: 'utf8' });
  await output.sync();
  await output.close();
  process.stdout.write(`已创建部署 API token：${created.id}\n`);
  process.stdout.write(`明文仅保存到 root-only 文件：${outputPath}\n`);
} catch (error) {
  await output.close().catch(() => undefined);
  await unlink(outputPath).catch(() => undefined);
  if (tokenId) {
    await request(`/api/v1/auth/tokens/${tokenId}`, { method: 'DELETE' }).catch(() => undefined);
  }
  throw error;
}

async function request(path, init) {
  const response = await globalThis.fetch(new URL(path, apiOrigin), init);
  const payload = await response.json().catch(() => undefined);
  if (!response.ok || !payload?.data) {
    const code = payload?.error?.code ?? `HTTP_${response.status}`;
    throw new Error(`AgentHub API 请求失败：${code}`);
  }
  return payload.data;
}
