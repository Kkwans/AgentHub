import { createRequire } from 'node:module';

export type PinnedAcpAdapterKind = 'CODEX' | 'CLAUDE_CODE';

export interface PinnedAcpAdapterLaunch {
  executable: string;
  args: string[];
  packageName: string;
  version: string;
}

const requireFromAdapter = createRequire(import.meta.url);

export function resolvePinnedAcpAdapter(kind: PinnedAcpAdapterKind): PinnedAcpAdapterLaunch {
  if (kind === 'CODEX') {
    return {
      executable: process.execPath,
      args: [requireFromAdapter.resolve('@agentclientprotocol/codex-acp')],
      packageName: '@agentclientprotocol/codex-acp',
      version: '1.1.14',
    };
  }
  return {
    executable: process.execPath,
    args: [requireFromAdapter.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')],
    packageName: '@agentclientprotocol/claude-agent-acp',
    version: '0.66.0',
  };
}
