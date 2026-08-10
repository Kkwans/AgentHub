import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join, parse } from 'node:path';
import { arch, hostname, platform } from 'node:os';

import {
  AGENTHUB_VERSION,
  type RemoteAgentInventoryEntry,
  type RemoteNodeMetadata,
} from '@agenthub/shared';

export async function resolveNodeRoots(configured: string[]): Promise<string[]> {
  const roots: string[] = [];
  for (const configuredRoot of configured) {
    if (!isAbsolute(configuredRoot)) throw new Error(`Node root 不是绝对路径：${configuredRoot}`);
    const root = await realpath(configuredRoot);
    if (root === parse(root).root) throw new Error(`Node root 不得是文件系统根目录：${root}`);
    if (!(await stat(root)).isDirectory()) throw new Error(`Node root 不是目录：${root}`);
    await access(root, constants.R_OK);
    roots.push(root);
  }
  return [...new Set(roots)].sort((left, right) => left.localeCompare(right));
}

export function nodeMetadata(name: string): RemoteNodeMetadata {
  return {
    name,
    hostname: hostname(),
    os: platform(),
    arch: arch(),
    daemonVersion: AGENTHUB_VERSION,
  };
}

export async function discoverAgentInventory(): Promise<RemoteAgentInventoryEntry[]> {
  const definitions: Array<{
    key: string;
    name: string;
    agentKind: RemoteAgentInventoryEntry['agentKind'];
    adapterKind: RemoteAgentInventoryEntry['adapterKind'];
    command: string;
    capabilities: RemoteAgentInventoryEntry['capabilities'];
  }> = [
    {
      key: 'codex',
      name: 'Codex',
      agentKind: 'CODEX',
      adapterKind: 'ACP_STDIO',
      command: 'codex',
      capabilities: {
        sessions: true,
        streaming: true,
        approvals: true,
        files: true,
        terminal: true,
      },
    },
    {
      key: 'claude-code',
      name: 'Claude Code',
      agentKind: 'CLAUDE_CODE',
      adapterKind: 'ACP_STDIO',
      command: 'claude',
      capabilities: {
        sessions: true,
        streaming: true,
        approvals: true,
        files: true,
        terminal: true,
      },
    },
    {
      key: 'opencode',
      name: 'OpenCode',
      agentKind: 'OPENCODE',
      adapterKind: 'ACP_STDIO',
      command: 'opencode',
      capabilities: {
        sessions: true,
        streaming: true,
        approvals: true,
        files: true,
        terminal: true,
      },
    },
    {
      key: 'hermes',
      name: 'Hermes',
      agentKind: 'HERMES',
      adapterKind: 'ACP_STDIO',
      command: 'hermes',
      capabilities: {
        sessions: true,
        streaming: true,
        approvals: true,
        files: true,
        terminal: true,
      },
    },
    {
      key: 'openclaw',
      name: 'OpenClaw',
      agentKind: 'OPENCLAW',
      adapterKind: 'OPENCLAW_GATEWAY',
      command: 'openclaw',
      capabilities: {
        sessions: true,
        streaming: true,
        approvals: true,
        files: false,
        terminal: false,
      },
    },
  ];
  return Promise.all(
    definitions.map(async (definition) => ({
      key: definition.key,
      name: definition.name,
      agentKind: definition.agentKind,
      adapterKind: definition.adapterKind,
      status: (await findExecutable(definition.command))
        ? ('AVAILABLE' as const)
        : ('MISSING' as const),
      capabilities: definition.capabilities,
    })),
  );
}

async function findExecutable(name: string): Promise<string | undefined> {
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(isAbsolute)) {
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH without invoking a shell.
    }
  }
  return undefined;
}
