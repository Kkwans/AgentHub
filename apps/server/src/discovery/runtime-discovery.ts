import { hostname, platform, arch } from 'node:os';
import { isAbsolute, posix, resolve } from 'node:path';
import { realpathSync } from 'node:fs';

import type { AgentHubDatabase, ExecutionTargetRepository } from '@agenthub/db';

import { AppError } from '../errors.js';
import {
  DockerSocketEngineClient,
  type DockerEngineClient,
  type DockerEngineContainerInspect,
  type DockerEngineContainerSummary,
} from './docker-engine-client.js';
import type { ExecutionTargetService } from '../docker/execution-target-service.js';

export type RuntimeCandidateState = 'READY' | 'STOPPED' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'BROKEN';

export interface RuntimeCandidate {
  candidateId: string;
  kind: 'LOCAL_HOST' | 'DOCKER_CONTAINER';
  displayName: string;
  state: RuntimeCandidateState;
  targetId?: string;
  containerId?: string;
  image?: string;
  statusText?: string;
  workspaceMappings: Array<{ hostRoot: string; containerRoot: string }>;
  adoptable: boolean;
  reasonCode?: string;
}

export interface RuntimeDiscoveryOptions {
  docker?: DockerEngineClient;
  workspaceRoots?: string[];
}

export class RuntimeDiscoveryService {
  private readonly docker: DockerEngineClient;
  private readonly workspaceRoots: string[];

  constructor(
    private readonly targets: ExecutionTargetRepository<AgentHubDatabase>,
    private readonly executionTargets: ExecutionTargetService,
    options: RuntimeDiscoveryOptions = {},
  ) {
    this.docker = options.docker ?? new DockerSocketEngineClient();
    this.workspaceRoots = (options.workspaceRoots ?? [])
      .filter((root) => isAbsolute(root))
      .map((root) => {
        try {
          return realpathSync(resolve(root));
        } catch {
          return resolve(root);
        }
      });
  }

  async list(): Promise<RuntimeCandidate[]> {
    const registered = await this.targets.list();
    const local = registered.find((target) => target.kind === 'LOCAL_HOST');
    const candidates: RuntimeCandidate[] = [
      {
        candidateId: 'host:local',
        kind: 'LOCAL_HOST',
        displayName: `本机（${hostname()}）`,
        state: 'READY',
        ...(local ? { targetId: local.id } : {}),
        workspaceMappings: [],
        adoptable: !local,
      },
    ];

    let containers: DockerEngineContainerSummary[];
    try {
      containers = await this.docker.listContainers(true);
    } catch (error) {
      candidates.push({
        candidateId: 'docker:engine',
        kind: 'DOCKER_CONTAINER',
        displayName: 'Docker Engine',
        state: 'UNAVAILABLE',
        workspaceMappings: [],
        adoptable: false,
        reasonCode: error instanceof AppError ? error.code : 'DOCKER_ENGINE_UNAVAILABLE',
      });
      return candidates;
    }

    for (const [index, container] of containers.entries()) {
      const target = registered.find(
        (item) => item.kind === 'DOCKER_CONTAINER' && item.expectedContainerId === container.id,
      );
      const inspect = await this.inspectQuietly(container.id);
      const mappings = inspect ? inferWorkspaceMappings(inspect.mounts, this.workspaceRoots) : [];
      const running = inspect?.state.running ?? container.state === 'running';
      candidates.push({
        candidateId: `docker:${container.id}`,
        kind: 'DOCKER_CONTAINER',
        displayName: cleanContainerName(container.names[0]) || `Docker 容器 ${index + 1}`,
        state: running ? 'READY' : 'STOPPED',
        ...(target ? { targetId: target.id } : {}),
        containerId: container.id,
        image: inspect?.image || container.image,
        statusText: inspect?.state.status || container.status,
        workspaceMappings: mappings,
        adoptable: !target,
        ...(inspect ? {} : { reasonCode: 'DOCKER_INSPECT_FAILED' }),
      });
    }
    return candidates;
  }

  async rescan(): Promise<RuntimeCandidate[]> {
    return this.list();
  }

  async adopt(candidateId: string) {
    const candidate = (await this.list()).find((item) => item.candidateId === candidateId);
    if (!candidate) throw new AppError(404, 'RUNTIME_CANDIDATE_NOT_FOUND', 'Runtime 候选不存在');
    if (candidate.targetId) return this.targets.get(candidate.targetId);
    if (!candidate.adoptable) {
      throw new AppError(409, 'RUNTIME_CANDIDATE_NOT_ADOPTABLE', '该 Runtime 当前不能接管', {
        state: candidate.state,
      });
    }
    if (candidate.kind === 'LOCAL_HOST') {
      return this.executionTargets.register({
        name: candidate.displayName,
        kind: 'LOCAL_HOST',
        hostname: hostname(),
        os: platform(),
        arch: arch(),
      });
    }
    if (!candidate.containerId)
      throw new AppError(409, 'RUNTIME_CANDIDATE_INVALID', 'Docker 候选缺少容器身份');
    const inspected = await this.docker.inspectContainer(candidate.containerId);
    if (inspected.id !== candidate.containerId) {
      throw new AppError(409, 'CONTAINER_REPLACED', '容器身份已变化，请重新扫描');
    }
    const registration = {
      name: candidate.displayName,
      kind: 'DOCKER_CONTAINER',
      hostname: hostname(),
      os: platform(),
      arch: arch(),
      containerName: inspected.name,
      expectedContainerId: inspected.id,
      startPolicy: 'MANUAL',
      workspaceMappings: inferWorkspaceMappings(inspected.mounts, this.workspaceRoots),
    } as const;
    const discovered = this.executionTargets as ExecutionTargetService & {
      registerDiscovered?: ExecutionTargetService['registerDiscovered'];
    };
    return discovered.registerDiscovered
      ? discovered.registerDiscovered(registration, inspected)
      : this.executionTargets.register(registration);
  }

  private async inspectQuietly(id: string): Promise<DockerEngineContainerInspect | undefined> {
    try {
      return await this.docker.inspectContainer(id);
    } catch {
      return undefined;
    }
  }
}

function cleanContainerName(name: string | undefined): string {
  return (name ?? '').replace(/^\//, '').trim();
}

function inferWorkspaceMappings(
  mounts: DockerEngineContainerInspect['mounts'],
  allowedRoots: readonly string[],
): Array<{ hostRoot: string; containerRoot: string }> {
  return mounts
    .filter(
      (mount) =>
        mount.type === 'bind' &&
        mount.rw &&
        isAbsolute(mount.source) &&
        isAbsolute(mount.destination),
    )
    .filter((mount) => {
      if (allowedRoots.length === 0) return false;
      try {
        const canonicalSource = realpathSync(mount.source);
        return allowedRoots.some((root) => isWithin(root, canonicalSource));
      } catch {
        return false;
      }
    })
    .sort((left, right) => right.source.length - left.source.length)
    .flatMap((mount) => {
      try {
        return [
          {
            hostRoot: realpathSync(mount.source),
            containerRoot: posix.normalize(mount.destination),
          },
        ];
      } catch {
        return [];
      }
    });
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${posix.sep}`)
  );
}
