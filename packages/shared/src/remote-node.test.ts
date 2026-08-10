import { describe, expect, it } from 'vitest';

import {
  REMOTE_NODE_PROTOCOL_VERSION,
  remoteNodeClientMessageSchema,
  remoteNodeSignaturePayload,
} from './remote-node.js';

describe('Remote Node 共享协议', () => {
  it('签名 payload 使用固定 domain 与换行格式', () => {
    expect(
      new TextDecoder().decode(remoteNodeSignaturePayload('authenticate', 'node-id', 'challenge')),
    ).toBe(`${REMOTE_NODE_PROTOCOL_VERSION}\nauthenticate\nnode-id\nchallenge`);
  });

  it('拒绝 inventory 中的未声明 secret 字段', () => {
    const parsed = remoteNodeClientMessageSchema.safeParse({
      type: 'node.authenticate',
      protocolVersion: REMOTE_NODE_PROTOCOL_VERSION,
      nodeId: '11111111-1111-4111-8111-111111111111',
      signature: 'a'.repeat(80),
      metadata: {
        name: 'Node',
        hostname: 'host',
        os: 'linux',
        arch: 'arm64',
        daemonVersion: '0.2.0',
      },
      roots: ['/workspace'],
      inventory: [
        {
          key: 'codex',
          name: 'Codex',
          agentKind: 'CODEX',
          adapterKind: 'ACP_STDIO',
          status: 'AVAILABLE',
          capabilities: {
            sessions: true,
            streaming: true,
            approvals: true,
            files: true,
            terminal: true,
          },
          apiToken: '不得上报',
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
