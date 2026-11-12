import { randomUUID } from 'node:crypto';
import type { AcpProcessLauncher } from '@agenthub/adapter-acp';
import type { AgentRuntimeAdapter } from '@agenthub/agent-core';
import type { AgentHubDatabase, AgentRepository, ExecutionTargetRepository } from '@agenthub/db';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { AppError } from '../errors.js';
import type { ProjectService } from '../projects/project-service.js';
import { AgentService } from './agent-service.js';

type Agent = NonNullable<Awaited<ReturnType<AgentRepository<AgentHubDatabase>['get']>>>;
type Target = NonNullable<Awaited<ReturnType<ExecutionTargetRepository<AgentHubDatabase>['get']>>>;
function fixture() {
  const hostId = randomUUID();
  const dockerId = randomUUID();
  const project = {
    id: randomUUID(),
    targetId: hostId,
    realRootPath: '/workspace/project',
    status: 'ACTIVE',
  };
  const targets = new Map<string, Target>([
    [
      hostId,
      {
        id: hostId,
        kind: 'LOCAL_HOST',
        status: 'READY',
        workspaceMappingsJson: [],
      } as unknown as Target,
    ],
    [
      dockerId,
      {
        id: dockerId,
        kind: 'DOCKER_CONTAINER',
        containerName: 'test',
        expectedContainerId: 'a'.repeat(64),
        startPolicy: 'ON_DEMAND',
        status: 'STOPPED',
        workspaceMappingsJson: [{ hostRoot: '/workspace', containerRoot: '/work' }],
      } as unknown as Target,
    ],
  ]);
  const records: Agent[] = [];
  const add = (patch: Partial<Agent> = {}) => {
    const record = {
      id: randomUUID(),
      targetId: hostId,
      enabled: true,
      status: 'READY',
      name: '测试 Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      argsJson: [],
      configJson: {},
      ...patch,
    } as Agent;
    records.push(record);
    return record;
  };
  const launch = vi.fn(() => {
    throw new Error('read API must not launch');
  });
  const adapterFactory = vi.fn(() => ({}) as AgentRuntimeAdapter);
  const repository = {
    list: vi.fn(async () => records),
    get: vi.fn(async (id: string) => records.find((a) => a.id === id)),
  };
  const service = new AgentService(
    repository as unknown as AgentRepository<AgentHubDatabase>,
    {
      get: vi.fn(async (id: string) => targets.get(id)),
    } as unknown as ExecutionTargetRepository<AgentHubDatabase>,
    { launch } as unknown as AcpProcessLauncher,
    adapterFactory,
  );
  const projects = {
    get: vi.fn(async (id: string) => {
      if (id !== project.id) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project 不存在');
      return project;
    }),
  };
  const app = createApp({
    agents: service,
    projects: projects as unknown as ProjectService,
    logger: pino({ level: 'silent' }),
  });
  return {
    service,
    project,
    targets,
    add,
    hostId,
    dockerId,
    launch,
    adapterFactory,
    app,
    projects,
  };
}

describe('项目 Agent 资格是只读注册状态而非实时健康承诺', () => {
  it('区分禁用、非就绪、缺失目标、无映射及正常注册资格', async () => {
    const f = fixture();
    const ready = f.add();
    const disabled = f.add({ enabled: false });
    const unverified = f.add({ status: 'UNVERIFIED' });
    const missing = f.add({ targetId: randomUUID() });
    const docker = f.add({ targetId: f.dockerId });
    const result = await f.service.listProjectEligibility(f.project);
    expect(result).toMatchObject({
      basis: 'REGISTERED_STATE',
      livePreflight: false,
      projectId: f.project.id,
    });
    expect(result.agents).toEqual([
      {
        agentId: ready.id,
        eligible: true,
        reason: null,
        agentStatus: 'READY',
        targetStatus: 'READY',
      },
      {
        agentId: disabled.id,
        eligible: false,
        reason: 'DISABLED',
        agentStatus: 'READY',
        targetStatus: 'READY',
      },
      {
        agentId: unverified.id,
        eligible: false,
        reason: 'NOT_READY',
        agentStatus: 'UNVERIFIED',
        targetStatus: 'READY',
      },
      {
        agentId: missing.id,
        eligible: false,
        reason: 'TARGET_MISSING',
        agentStatus: 'READY',
        targetStatus: null,
      },
      {
        agentId: docker.id,
        eligible: true,
        reason: null,
        agentStatus: 'READY',
        targetStatus: 'STOPPED',
      },
    ]);
    expect(f.launch).not.toHaveBeenCalled();
    expect(f.adapterFactory).not.toHaveBeenCalled();
  });
  it.each(['/workspace2/project', '/workspace/../outside'])(
    'Docker 映射边界与实际 runtime 拒绝一致：%s',
    async (cwd) => {
      const f = fixture();
      const agent = f.add({ targetId: f.dockerId });
      expect(
        (await f.service.listProjectEligibility({ ...f.project, realRootPath: cwd })).agents[0]
          ?.reason,
      ).toBe('INCOMPATIBLE_WORKSPACE');
      await expect(f.service.resolveRuntime(agent.id, cwd, f.hostId)).rejects.toMatchObject({
        code: 'AGENT_PROJECT_TARGET_MISMATCH',
      });
      expect(f.adapterFactory).not.toHaveBeenCalled();
    },
  );
  it('不同 targetId 的有效 Docker 映射与 runtime 一致，不被简单 ID 比较误删', async () => {
    const f = fixture();
    const agent = f.add({ targetId: f.dockerId });
    expect((await f.service.listProjectEligibility(f.project)).agents[0]?.eligible).toBe(true);
    await f.service.resolveRuntime(agent.id, f.project.realRootPath, f.hostId);
    expect(f.adapterFactory).toHaveBeenCalledTimes(1);
    expect(f.launch).not.toHaveBeenCalled();
  });
  it('报告项目禁用、项目目标缺失与 remote gateway 缺失', async () => {
    const f = fixture();
    f.add();
    expect(
      (await f.service.listProjectEligibility({ ...f.project, status: 'ARCHIVED' })).agents[0]
        ?.reason,
    ).toBe('PROJECT_INACTIVE');
    expect(
      (await f.service.listProjectEligibility({ ...f.project, targetId: randomUUID() })).agents[0]
        ?.reason,
    ).toBe('PROJECT_TARGET_MISSING');
    const remote = randomUUID();
    f.targets.set(remote, {
      id: remote,
      kind: 'REMOTE_NODE',
      status: 'READY',
      workspaceMappingsJson: [],
    } as unknown as Target);
    const agent = f.add({ targetId: remote });
    expect(
      (await f.service.listProjectEligibility({ ...f.project, targetId: remote })).agents[1]
        ?.reason,
    ).toBe('REMOTE_GATEWAY_UNAVAILABLE');
    await expect(
      f.service.resolveRuntime(agent.id, '/workspace/project', remote),
    ).rejects.toMatchObject({ code: 'REMOTE_NODE_GATEWAY_UNAVAILABLE' });
  });
  it('HTTP 仅接受项目 ID，从服务端取得路径，失效项目不可静默返回空列表', async () => {
    const f = fixture();
    f.add({ enabled: false });
    const result = await request(f.app).get(
      `/api/v1/projects/${f.project.id}/agent-eligibility?cwd=/outside`,
    );
    expect(result.status).toBe(200);
    expect(result.body.data.agents[0].reason).toBe('DISABLED');
    expect(f.projects.get).toHaveBeenCalledWith(f.project.id);
    expect((await request(f.app).get('/api/v1/projects/invalid/agent-eligibility')).status).toBe(
      400,
    );
    expect(
      (await request(f.app).get(`/api/v1/projects/${randomUUID()}/agent-eligibility`)).status,
    ).toBe(404);
    expect(f.launch).not.toHaveBeenCalled();
    expect(f.adapterFactory).not.toHaveBeenCalled();
  });
});
