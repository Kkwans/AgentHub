import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface NodeDaemonConfig {
  serverUrl: string;
  dataDir: string;
  name: string;
  roots: string[];
  registrationToken?: string | undefined;
}

export function loadNodeDaemonConfig(
  environment: NodeJS.ProcessEnv = process.env,
): NodeDaemonConfig {
  const serverUrl = environment.AGENTHUB_NODE_SERVER_URL;
  if (!serverUrl) throw new Error('AGENTHUB_NODE_SERVER_URL 未配置');
  assertSecureNodeUrl(serverUrl);

  const rawRoots = environment.AGENTHUB_NODE_ROOTS_JSON;
  if (!rawRoots) throw new Error('AGENTHUB_NODE_ROOTS_JSON 未配置');
  let roots: unknown;
  try {
    roots = JSON.parse(rawRoots);
  } catch {
    throw new Error('AGENTHUB_NODE_ROOTS_JSON 不是合法 JSON');
  }
  if (
    !Array.isArray(roots) ||
    roots.length === 0 ||
    roots.length > 32 ||
    roots.some((root) => typeof root !== 'string' || root.length === 0)
  ) {
    throw new Error('AGENTHUB_NODE_ROOTS_JSON 必须是 1..32 个路径组成的数组');
  }

  return {
    serverUrl,
    dataDir: resolve(environment.AGENTHUB_NODE_DATA_DIR ?? resolve(homedir(), '.agenthub-node')),
    name: environment.AGENTHUB_NODE_NAME?.trim() || 'AgentHub Node',
    roots: roots as string[],
    ...(environment.AGENTHUB_NODE_REGISTRATION_TOKEN
      ? { registrationToken: environment.AGENTHUB_NODE_REGISTRATION_TOKEN }
      : {}),
  };
}

export function assertSecureNodeUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol === 'wss:') return;
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol === 'ws:' && loopback) return;
  throw new Error('Remote Node 生产连接必须使用 wss://；ws:// 仅允许 loopback');
}
