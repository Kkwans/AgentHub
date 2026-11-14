import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FakeAgentAdapter } from '@agenthub/agent-core';
import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AgentService } from './agent-service.js';
import { createApp } from '../app.js';
import type { ProjectService } from '../projects/project-service.js';
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'agenthub-check-')));
  dirs.push(path);
  const target = { id: randomUUID(), kind: 'LOCAL_HOST' };
  const agent = {
    id: randomUUID(),
    targetId: target.id,
    enabled: true,
    adapterKind: 'ACP_STDIO',
    executable: '/fixture/no-real-process',
    argsJson: [],
    configJson: {},
    agentKind: 'CUSTOM_ACP',
    name: 'fixture',
  };
  const project = {
    id: randomUUID(),
    targetId: target.id,
    status: 'ACTIVE',
    rootPath: path,
    realRootPath: path,
  };
  const repo = { get: vi.fn(async () => agent), updatePreflight: vi.fn(async () => agent) };
  const targets = { get: vi.fn(async () => target) };
  const adapter = new FakeAgentAdapter();
  const probe = vi.spyOn(adapter, 'preflight').mockResolvedValue({
    status: 'READY',
    checkedAt: '2026-11-14T06:00:00Z',
    detectedVersion: 'private-version',
    checks: [
      {
        id: 'initialize',
        label: 'secret',
        status: 'PASS',
        message: 'secret-token',
        details: { secret: 'hidden' },
      },
      { id: 'session', label: '', status: 'SKIP', message: '' },
    ],
    repair: { summary: 'hidden', commands: ['secret-command'] },
  });
  const launch = vi.fn(async () => {
    throw new Error('must not launch');
  });
  const service = new AgentService(
    repo as unknown as ConstructorParameters<typeof AgentService>[0],
    targets as unknown as ConstructorParameters<typeof AgentService>[1],
    { launch },
    () => adapter,
  );
  return { path, target, agent, project, repo, adapter, probe, service };
}
it('项目派生目录、固定非烟测且只返回白名单，不透出provider文本', async () => {
  const f = await fixture();
  const gate = vi.fn();
  const report = await f.service.checkConnection(f.agent.id, f.target.id, f.project, gate);
  expect(gate).toHaveBeenCalledTimes(1);
  expect(f.probe.mock.calls[0]?.[0].config).toMatchObject({
    preflightCwd: f.path,
    preflightSession: false,
    preflightStrictCleanup: true,
  });
  expect(report).toMatchObject({
    agentId: f.agent.id,
    targetId: f.target.id,
    projectId: f.project.id,
    cwd: f.path,
    smokeSession: false,
    status: 'READY',
    checks: [
      { id: 'initialize', status: 'PASS' },
      { id: 'session', status: 'SKIP' },
    ],
  });
  expect(JSON.stringify(report)).not.toMatch(/secret|private|repair|detectedVersion/);
  expect(f.repo.updatePreflight).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.repo.updatePreflight.mock.calls)).not.toContain('private-version');
  expect(JSON.stringify(f.repo.updatePreflight.mock.calls)).not.toContain('modelOptions');
  expect(f.repo.updatePreflight).toHaveBeenCalledWith(
    f.agent.id,
    expect.objectContaining({ detectedVersion: null }),
  );
});
it.each(['target', 'project', 'inactive', 'disabled', 'docker', 'adapter'])(
  '%s边界不匹配零探测',
  async (kind) => {
    const f = await fixture();
    if (kind === 'project') f.project.targetId = randomUUID();
    if (kind === 'inactive') f.project.status = 'ARCHIVED';
    if (kind === 'disabled') f.agent.enabled = false;
    if (kind === 'docker') f.target.kind = 'DOCKER_CONTAINER';
    if (kind === 'adapter') f.agent.adapterKind = 'OPENCLAW_GATEWAY';
    await expect(
      f.service.checkConnection(
        f.agent.id,
        kind === 'target' ? randomUUID() : f.target.id,
        f.project,
      ),
    ).rejects.toBeDefined();
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.repo.updatePreflight).not.toHaveBeenCalled();
  },
);
it('目录symlink偏离登记canonical身份不启动', async () => {
  const f = await fixture();
  const other = await fixture();
  const alias = join(f.path, 'alias');
  await symlink(other.path, alias);
  await expect(
    f.service.checkConnection(f.agent.id, f.target.id, { ...f.project, rootPath: alias }),
  ).rejects.toMatchObject({ code: 'CONNECTION_CHECK_DIRECTORY_CHANGED' });
  expect(f.probe).not.toHaveBeenCalled();
});
it('最终启动gate撤销时不调用adapter', async () => {
  const f = await fixture();
  await expect(
    f.service.checkConnection(f.agent.id, f.target.id, f.project, () => {
      throw new Error('stopping');
    }),
  ).rejects.toThrow('stopping');
  expect(f.probe).not.toHaveBeenCalled();
});
it('同Agent跨legacy/new检查排他且shutdown等待先前检查', async () => {
  const f = await fixture();
  let release!: () => void;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.probe.mockImplementationOnce(async () => {
    enter();
    await barrier;
    return { status: 'MISSING', checkedAt: new Date().toISOString(), checks: [] };
  });
  const first = f.service.checkConnection(f.agent.id, f.target.id, f.project);
  await entered;
  await expect(f.service.preflight(f.agent.id, { cwd: f.path })).rejects.toMatchObject({
    code: 'AGENT_CHECK_IN_PROGRESS',
  });
  let stopped = false;
  const stop = f.service.shutdownConnectionChecks().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  release();
  await first;
  await stop;
  await expect(f.service.checkConnection(f.agent.id, f.target.id, f.project)).rejects.toMatchObject(
    { code: 'AGENT_CHECK_UNAVAILABLE' },
  );
});
it.each(['legacy', 'new'])(
  '%s未确认退出保留sticky fence，不更新READY、不允许shutdown成功',
  async (kind) => {
    const f = await fixture();
    f.probe.mockRejectedValue(
      Object.assign(new Error('unconfirmed'), { code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED' }),
    );
    await expect(
      kind === 'legacy'
        ? f.service.preflight(f.agent.id, { cwd: f.path })
        : f.service.checkConnection(f.agent.id, f.target.id, f.project),
    ).rejects.toMatchObject({ code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED' });
    expect(f.probe.mock.calls[0]?.[0].config.preflightStrictCleanup).toBe(true);
    expect(f.repo.updatePreflight).not.toHaveBeenCalled();
    await expect(f.service.shutdownConnectionChecks()).rejects.toMatchObject({
      code: 'AGENT_CHECK_SHUTDOWN_UNCONFIRMED',
    });
    await expect(f.service.shutdownConnectionChecks()).rejects.toMatchObject({
      code: 'AGENT_CHECK_SHUTDOWN_UNCONFIRMED',
    });
  },
);
it('新路由拒绝cwd/smoke注入，按projectId读取服务器项目；legacy schema不改', async () => {
  const f = await fixture();
  const get = vi.fn(async () => f.project);
  const app = createApp({ agents: f.service, projects: { get } as unknown as ProjectService });
  const body = { projectId: f.project.id, expectedTargetId: f.target.id };
  expect(
    (
      await request(app)
        .post(`/api/v1/agents/${f.agent.id}/connection-check`)
        .send({ ...body, cwd: '/escape', smokeSession: true })
    ).status,
  ).toBe(400);
  expect(f.probe).not.toHaveBeenCalled();
  const result = await request(app)
    .post(`/api/v1/agents/${f.agent.id}/connection-check`)
    .send(body);
  expect(result.status).toBe(200);
  expect(get).toHaveBeenCalledWith(f.project.id);
  expect(result.body.data.cwd).toBe(f.path);
});
it('shutdown超时永久拒绝，迟到检查结束不能让第二次关闭伪成功', async () => {
  const f = await fixture();
  let release!: () => void;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.probe.mockImplementationOnce(async () => {
    enter();
    await barrier;
    return { status: 'MISSING', checkedAt: new Date().toISOString(), checks: [] };
  });
  const check = f.service.preflight(f.agent.id, { cwd: f.path });
  await entered;
  vi.useFakeTimers();
  try {
    const stopping = f.service.shutdownConnectionChecks();
    const rejected = expect(stopping).rejects.toMatchObject({
      code: 'AGENT_CHECK_SHUTDOWN_UNCONFIRMED',
    });
    await vi.advanceTimersByTimeAsync(5_001);
    await rejected;
    release();
    await check;
    await expect(f.service.shutdownConnectionChecks()).rejects.toMatchObject({
      code: 'AGENT_CHECK_SHUTDOWN_UNCONFIRMED',
    });
  } finally {
    release();
    vi.useRealTimers();
  }
});
it('真实HTTP与隔离PGlite通过fixture ACP检查，不创建Session，持久化最近状态', async () => {
  const {
    createPgliteDatabase,
    AgentRepository,
    ExecutionTargetRepository,
    ProjectRepository,
    SessionRepository,
  } = await import('@agenthub/db');
  const { HostAcpProcessLauncher } = await import('@agenthub/adapter-acp');
  const { ProjectService } = await import('../projects/project-service.js');
  const { resolve } = await import('node:path');
  const f = await fixture();
  const db = await createPgliteDatabase({ dataDir: 'memory://' });
  const agents = new AgentRepository(db.db),
    targets = new ExecutionTargetRepository(db.db),
    projects = new ProjectRepository(db.db);
  const service = new AgentService(agents, targets, new HostAcpProcessLauncher());
  try {
    const target = await targets.create({
      id: randomUUID(),
      name: 'isolated check host',
      kind: 'LOCAL_HOST',
      hostname: 'fixture',
      os: process.platform,
      arch: process.arch,
      status: 'READY',
    });
    const project = await projects.create({
      id: randomUUID(),
      name: 'isolated check project',
      repoKind: 'NONE',
      targetId: target.id,
      rootPath: f.path,
      realRootPath: f.path,
      status: 'ACTIVE',
    });
    const agent = await service.register({
      name: 'isolated fixture ACP',
      targetId: target.id,
      agentKind: 'CUSTOM_ACP',
      executable: process.execPath,
      args: [resolve('tests/fixtures/acp/fake-agent.mjs')],
    });
    const app = createApp({ agents: service, projects: new ProjectService(projects, targets) });
    const response = await request(app)
      .post(`/api/v1/agents/${agent.id}/connection-check`)
      .send({ projectId: project.id, expectedTargetId: target.id });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      agentId: agent.id,
      projectId: project.id,
      targetId: target.id,
      cwd: f.path,
      status: 'READY',
      smokeSession: false,
    });
    expect(response.body.data.checks).toContainEqual({ id: 'session', status: 'SKIP' });
    expect(await agents.get(agent.id)).toMatchObject({
      status: 'READY',
      lastPreflightAt: expect.any(Date),
    });
    expect(await new SessionRepository(db.db).list(project.id)).toHaveLength(0);
    const unsafeAdapter = new FakeAgentAdapter();
    vi.spyOn(unsafeAdapter, 'preflight').mockResolvedValue({
      status: 'READY',
      checkedAt: new Date().toISOString(),
      detectedVersion: 'private-provider-token',
      checks: [],
    });
    const unsafeService = new AgentService(
      agents,
      targets,
      {
        launch: async () => {
          throw new Error('unused');
        },
      },
      () => unsafeAdapter,
    );
    await unsafeService.preflight(agent.id, { cwd: f.path });
    const saved = await request(app).get('/api/v1/agents');
    expect(saved.status).toBe(200);
    expect(
      saved.body.data.find((row: { id: string }) => row.id === agent.id).detectedVersion,
    ).toBeNull();
    expect(JSON.stringify(saved.body.data)).not.toContain('private-provider-token');
    expect(JSON.stringify(saved.body.data)).not.toContain('modelOptions');
    await unsafeService.shutdownConnectionChecks();
  } finally {
    await service.shutdownConnectionChecks();
    await db.close();
  }
});

it.each(['1.2.3', 'private-version', '1.2.3-secret-token', '1.2.3\nsecret'])(
  'legacy保存与返回version白名单 %s',
  async (version) => {
    const f = await fixture();
    f.probe.mockResolvedValueOnce({
      status: 'READY',
      checkedAt: new Date().toISOString(),
      detectedVersion: version,
      checks: [],
    });
    const report = await f.service.preflight(f.agent.id, { cwd: f.path });
    expect(f.repo.updatePreflight).toHaveBeenCalledWith(
      f.agent.id,
      expect.objectContaining({ detectedVersion: version === '1.2.3' ? version : null }),
    );
    expect(report.detectedVersion).toBe(version === '1.2.3' ? version : undefined);
  },
);
