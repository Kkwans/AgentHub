import { generateKeyPairSync, sign } from 'node:crypto';

import {
  REMOTE_NODE_PROTOCOL_VERSION,
  remoteNodeSignaturePayload,
  type RemoteNodeClientMessage,
} from '@agenthub/shared';
import { createPgliteDatabase, RemoteNodeRepository, type DatabaseClient } from '@agenthub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RemoteNodeService } from './remote-node-service.js';

type RegisterMessage = Extract<RemoteNodeClientMessage, { type: 'node.register' }>;
type AuthenticateMessage = Extract<RemoteNodeClientMessage, { type: 'node.authenticate' }>;

describe('Remote Node 身份服务', () => {
  let database: DatabaseClient;
  let repository: RemoteNodeRepository<(typeof database)['db']>;
  let service: RemoteNodeService;

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    repository = new RemoteNodeRepository(database.db);
    service = new RemoteNodeService(repository);
  });

  afterAll(async () => {
    await database.close();
  });

  it('单次 token 注册 Ed25519 设备并阻止复用、伪造与撤销后认证', async () => {
    const root = '/srv/agenthub/projects';
    const token = await service.createRegistrationToken({
      name: '远程开发机',
      allowedRoots: [root],
      expiresInMinutes: 15,
    });
    expect(token.token).toMatch(/^ahrn_/);

    const keys = generateKeyPairSync('ed25519');
    const challenge = 'registration-challenge';
    const register = registrationMessage(
      token.token,
      root,
      keys.privateKey,
      keys.publicKey,
      challenge,
    );
    const registered = await service.register(register, challenge);
    expect(registered.target).toMatchObject({ kind: 'REMOTE_NODE', status: 'READY' });
    expect((await service.list())[0]).not.toHaveProperty('publicKey');

    await expect(service.register(register, challenge)).rejects.toMatchObject({
      code: 'REMOTE_NODE_REGISTRATION_TOKEN_USED',
    });

    const authenticateChallenge = 'authenticate-challenge';
    const authenticate = authenticationMessage(
      registered.node.id,
      root,
      keys.privateKey,
      authenticateChallenge,
    );
    await expect(service.authenticate(authenticate, authenticateChallenge)).resolves.toMatchObject({
      status: 'ONLINE',
    });
    await expect(
      service.authenticate(
        { ...authenticate, signature: Buffer.from('forged').toString('base64') },
        authenticateChallenge,
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_NODE_SIGNATURE_INVALID' });

    await service.revoke(registered.node.id);
    await expect(service.authenticate(authenticate, authenticateChallenge)).rejects.toMatchObject({
      code: 'REMOTE_NODE_REVOKED',
    });
  });

  it('拒绝根目录授权和过期 registration token', async () => {
    await expect(
      service.createRegistrationToken({ name: '过宽', allowedRoots: ['/'] }),
    ).rejects.toMatchObject({ code: 'REMOTE_NODE_ROOT_TOO_BROAD' });

    const keys = generateKeyPairSync('ed25519');
    const rawToken = 'ahrn_' + 'x'.repeat(43);
    await repository.createRegistrationToken({
      id: crypto.randomUUID(),
      name: '已过期',
      tokenHash: `sha256:${await sha256(rawToken)}`,
      allowedRoots: ['/srv/expired'],
      expiresAt: new Date(Date.now() - 1_000),
    });
    const challenge = 'expired-challenge';
    await expect(
      service.register(
        registrationMessage(rawToken, '/srv/expired', keys.privateKey, keys.publicKey, challenge),
        challenge,
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_NODE_REGISTRATION_TOKEN_EXPIRED' });
  });
});

function registrationMessage(
  token: string,
  root: string,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'],
  challenge: string,
): RegisterMessage {
  return {
    type: 'node.register',
    protocolVersion: REMOTE_NODE_PROTOCOL_VERSION,
    registrationToken: token,
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    signature: sign(
      null,
      remoteNodeSignaturePayload('register', 'register', challenge),
      privateKey,
    ).toString('base64'),
    metadata: metadata(),
    roots: [root],
    inventory: inventory(),
  };
}

function authenticationMessage(
  nodeId: string,
  root: string,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  challenge: string,
): AuthenticateMessage {
  return {
    type: 'node.authenticate',
    protocolVersion: REMOTE_NODE_PROTOCOL_VERSION,
    nodeId,
    signature: sign(
      null,
      remoteNodeSignaturePayload('authenticate', nodeId, challenge),
      privateKey,
    ).toString('base64'),
    metadata: metadata(),
    roots: [root],
    inventory: inventory(),
  };
}

function metadata() {
  return {
    name: '测试 Node',
    hostname: 'remote-test',
    os: 'linux',
    arch: 'arm64',
    daemonVersion: '0.2.0',
  };
}

function inventory() {
  return [
    {
      key: 'codex',
      name: 'Codex',
      agentKind: 'CODEX' as const,
      adapterKind: 'ACP_STDIO' as const,
      status: 'AVAILABLE' as const,
      capabilities: {
        sessions: true,
        streaming: true,
        approvals: true,
        files: true,
        terminal: true,
      },
    },
  ];
}

async function sha256(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
