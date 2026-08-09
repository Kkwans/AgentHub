import { randomUUID } from 'node:crypto';

import type { AgentHubDatabase, ExecutionTargetRepository } from '@agenthub/db';

import { AppError } from '../errors.js';
import type { DockerControlService, DockerTarget } from './docker-control.js';

export interface RegisterExecutionTargetInput {
  name: string;
  kind: 'LOCAL_HOST' | 'DOCKER_CONTAINER';
  hostname: string;
  os: string;
  arch: string;
  containerName?: string | undefined;
  expectedContainerId?: string | undefined;
  startPolicy?: 'MANUAL' | 'ON_DEMAND' | undefined;
  workspaceMappings?: Array<{ hostRoot: string; containerRoot: string }> | undefined;
}

export class ExecutionTargetService {
  constructor(
    private readonly repository: ExecutionTargetRepository<AgentHubDatabase>,
    private readonly docker: DockerControlService,
  ) {}

  list() {
    return this.repository.list();
  }

  async register(input: RegisterExecutionTargetInput) {
    const id = randomUUID();
    if (input.kind === 'LOCAL_HOST') {
      return this.repository.create({
        id,
        name: input.name,
        kind: input.kind,
        hostname: input.hostname,
        os: input.os,
        arch: input.arch,
        status: 'READY',
      });
    }

    if (!input.containerName || !input.expectedContainerId || !input.startPolicy) {
      throw new AppError(
        400,
        'DOCKER_TARGET_FIELDS_REQUIRED',
        'Docker Execution Target 缺少必要字段',
      );
    }
    const dockerTarget: DockerTarget = {
      id,
      containerName: input.containerName,
      expectedContainerId: input.expectedContainerId,
      startPolicy: input.startPolicy,
      workspaceMappings: input.workspaceMappings ?? [],
    };
    const state = await this.docker.inspect(dockerTarget);
    return this.repository.create({
      id,
      name: input.name,
      kind: input.kind,
      hostname: input.hostname,
      os: input.os,
      arch: input.arch,
      status: state.running ? 'READY' : 'STOPPED',
      containerName: input.containerName,
      expectedContainerId: input.expectedContainerId,
      startPolicy: input.startPolicy,
      workspaceMappingsJson: input.workspaceMappings ?? [],
      lastSeenAt: new Date(),
    });
  }

  async preflight(id: string, hostCwd?: string) {
    const target = await this.requireTarget(id);
    if (target.kind === 'LOCAL_HOST') {
      await this.repository.updateObservedState(id, { status: 'READY', lastSeenAt: new Date() });
      return { status: 'READY' as const, target };
    }
    const report = await this.docker.preflight(toDockerTarget(target), hostCwd);
    await this.repository.updateObservedState(id, {
      status: report.status,
      lastSeenAt: new Date(),
      capabilitiesJson: { docker: true },
    });
    return report;
  }

  async start(id: string) {
    const target = await this.requireDockerTarget(id);
    const state = await this.docker.start(target);
    await this.repository.updateObservedState(id, { status: 'READY', lastSeenAt: new Date() });
    return state;
  }

  async stop(id: string) {
    const target = await this.requireDockerTarget(id);
    const state = await this.docker.stop(target);
    await this.repository.updateObservedState(id, { status: 'STOPPED', lastSeenAt: new Date() });
    return state;
  }

  private async requireTarget(id: string) {
    const target = await this.repository.get(id);
    if (!target) throw new AppError(404, 'EXECUTION_TARGET_NOT_FOUND', 'Execution Target 不存在');
    return target;
  }

  private async requireDockerTarget(id: string): Promise<DockerTarget> {
    const target = await this.requireTarget(id);
    if (target.kind !== 'DOCKER_CONTAINER') {
      throw new AppError(
        409,
        'EXECUTION_TARGET_NOT_DOCKER',
        '该 Execution Target 不是 Docker 容器',
      );
    }
    return toDockerTarget(target);
  }
}

function toDockerTarget(target: {
  id: string;
  containerName: string | null;
  expectedContainerId: string | null;
  startPolicy: string | null;
  workspaceMappingsJson: Array<{ hostRoot: string; containerRoot: string }>;
}): DockerTarget {
  if (
    !target.containerName ||
    !target.expectedContainerId ||
    (target.startPolicy !== 'MANUAL' && target.startPolicy !== 'ON_DEMAND')
  ) {
    throw new AppError(500, 'DOCKER_TARGET_CONFIG_INVALID', 'Docker Execution Target 配置不完整');
  }
  return {
    id: target.id,
    containerName: target.containerName,
    expectedContainerId: target.expectedContainerId,
    startPolicy: target.startPolicy,
    workspaceMappings: target.workspaceMappingsJson,
  };
}
