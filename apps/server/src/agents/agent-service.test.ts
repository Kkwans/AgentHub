import { randomUUID } from 'node:crypto';

import {
  AcpLauncherError,
  HostAcpProcessLauncher,
  type AcpProcessLauncher,
  type LaunchedAcpProcess,
} from '@agenthub/adapter-acp';
import { AgentRepository, createPgliteDatabase, ExecutionTargetRepository } from '@agenthub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentService } from './agent-service.js';

describe('Agent 注册与预检', () => {
  let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
  let agents: AgentRepository<(typeof database)['db']>;
  let targets: ExecutionTargetRepository<(typeof database)['db']>;

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    agents = new AgentRepository(database.db);
    targets = new ExecutionTargetRepository(database.db);
  });

  afterAll(async () => {
    await database.close();
  });

  async function seedTarget(kind: 'LOCAL_HOST' | 'DOCKER_CONTAINER') {
    const id = randomUUID();
    return targets.create({
      id,
      name: kind === 'LOCAL_HOST' ? '测试宿主机' : '测试容器',
      kind,
      hostname: 'agenthub-test',
      os: 'linux',
      arch: 'arm64',
      status: kind === 'LOCAL_HOST' ? 'READY' : 'STOPPED',
      ...(kind === 'DOCKER_CONTAINER'
        ? {
            containerName: 'hermes',
            expectedContainerId: 'a'.repeat(64),
            startPolicy: 'MANUAL',
            workspaceMappingsJson: [{ hostRoot: '/tmp', containerRoot: '/workspace' }],
          }
        : {}),
    });
  }

  it('为 Codex 固定 adapter 版本，不复用宿主机 CLI 路径作为协议服务', async () => {
    const target = await seedTarget('LOCAL_HOST');
    const service = new AgentService(agents, targets, new NeverLaunch());
    const created = await service.register({
      name: 'Codex',
      targetId: target.id,
      agentKind: 'CODEX',
    });

    expect(created.executable).toBe(process.execPath);
    expect(created.argsJson[0]).toContain('@agentclientprotocol+codex-acp@1.1.14');
    expect(created.configJson).toMatchObject({ pinnedVersion: '1.1.14' });
  });

  it('缺失 executable 时返回 MISSING，并持久化预检状态', async () => {
    const target = await seedTarget('LOCAL_HOST');
    const service = new AgentService(agents, targets, new HostAcpProcessLauncher());
    const created = await service.register({
      name: '缺失的 Custom ACP',
      targetId: target.id,
      agentKind: 'CUSTOM_ACP',
      executable: '/definitely-missing/agenthub-acp',
    });

    const report = await service.preflight(created.id, { cwd: '/tmp' });
    const stored = await agents.get(created.id);
    expect(report.status).toBe('MISSING');
    expect(stored?.status).toBe('MISSING');
    expect(stored?.lastPreflightAt).toBeInstanceOf(Date);
  });

  it('Docker MANUAL 容器停止时返回 STOPPED，不启动容器', async () => {
    const target = await seedTarget('DOCKER_CONTAINER');
    const service = new AgentService(agents, targets, new StoppedLauncher());
    const created = await service.register({
      name: 'Hermes',
      targetId: target.id,
      agentKind: 'HERMES',
    });

    const report = await service.preflight(created.id, { cwd: '/tmp' });
    expect(report.status).toBe('STOPPED');
    expect(report.repair?.summary).toContain('手动启动');
  });
});

class NeverLaunch implements AcpProcessLauncher {
  launch(): Promise<LaunchedAcpProcess> {
    throw new Error('不应启动进程');
  }
}

class StoppedLauncher implements AcpProcessLauncher {
  launch(): Promise<LaunchedAcpProcess> {
    throw new AcpLauncherError('TARGET_STOPPED', '测试容器已停止');
  }
}
