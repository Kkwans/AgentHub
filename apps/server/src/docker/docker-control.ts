import { realpath } from 'node:fs/promises';
import { isAbsolute, posix } from 'node:path';

import { runProcess, type ProcessResult, type WorkspaceMapping } from '@agenthub/agent-core';

import { AppError } from '../errors.js';

export interface DockerTarget {
  id: string;
  containerName: string;
  expectedContainerId: string;
  startPolicy: 'MANUAL' | 'ON_DEMAND';
  workspaceMappings: WorkspaceMapping[];
}

export interface DockerLaunchCommand {
  command: string;
  args: string[];
}

export interface DockerMount {
  Type: string;
  Source: string;
  Destination: string;
  RW: boolean;
}

export interface DockerContainerState {
  id: string;
  name: string;
  status: string;
  running: boolean;
  mounts: DockerMount[];
}

export interface DockerCommandRunner {
  run(
    args: string[],
    options?: { input?: string | Uint8Array; timeoutMs?: number },
  ): Promise<ProcessResult>;
}

export interface DockerSessionGuard {
  hasActiveSessions(targetId: string): Promise<boolean>;
}

export class DockerControlService {
  constructor(
    private readonly runner: DockerCommandRunner = new DockerCliRunner(),
    private readonly sessionGuard: DockerSessionGuard = { hasActiveSessions: async () => false },
  ) {}

  async inspect(target: DockerTarget): Promise<DockerContainerState> {
    validateTarget(target);
    const template =
      '{"id":{{json .Id}},"name":{{json .Name}},"status":{{json .State.Status}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}';
    const result = await this.runner.run(
      ['inspect', '--format', template, target.expectedContainerId],
      {
        timeoutMs: 10_000,
      },
    );
    if (result.exitCode !== 0) {
      throw new AppError(404, 'DOCKER_CONTAINER_NOT_FOUND', '已注册的 Docker 容器不存在');
    }

    let state: DockerContainerState;
    try {
      state = JSON.parse(result.stdout.trim()) as DockerContainerState;
    } catch (error) {
      throw new AppError(
        502,
        'DOCKER_INSPECT_INVALID',
        'Docker inspect 返回了无法识别的数据',
        undefined,
        {
          cause: error,
        },
      );
    }
    state.name = state.name.replace(/^\//, '');
    if (state.id !== target.expectedContainerId || state.name !== target.containerName) {
      throw new AppError(409, 'CONTAINER_REPLACED', '容器名称或 ID 已变化，请重新确认后注册', {
        expectedContainerId: target.expectedContainerId,
        actualContainerId: state.id,
      });
    }
    return state;
  }

  async preflight(
    target: DockerTarget,
    hostCwd?: string,
  ): Promise<{
    status: 'READY' | 'STOPPED' | 'WORKSPACE_UNMAPPED';
    container: DockerContainerState;
    containerCwd?: string;
  }> {
    const container = await this.inspect(target);
    if (!container.running) return { status: 'STOPPED', container };
    if (!hostCwd) return { status: 'READY', container };

    const containerCwd = await mapWorkspacePath(hostCwd, target.workspaceMappings);
    if (!containerCwd) return { status: 'WORKSPACE_UNMAPPED', container };
    verifyMappingBackedByMount(target.workspaceMappings, container.mounts);
    return { status: 'READY', container, containerCwd };
  }

  async start(target: DockerTarget): Promise<DockerContainerState> {
    const before = await this.inspect(target);
    if (before.running) return before;
    const result = await this.runner.run(['start', target.expectedContainerId], {
      timeoutMs: 30_000,
    });
    if (result.exitCode !== 0) {
      throw new AppError(502, 'DOCKER_START_FAILED', 'Docker 容器启动失败');
    }
    const after = await this.inspect(target);
    if (!after.running) throw new AppError(502, 'DOCKER_START_FAILED', 'Docker 容器启动后仍未运行');
    return after;
  }

  async stop(target: DockerTarget): Promise<DockerContainerState> {
    const before = await this.inspect(target);
    if (!before.running) return before;
    if (await this.sessionGuard.hasActiveSessions(target.id)) {
      throw new AppError(
        409,
        'DOCKER_TARGET_HAS_ACTIVE_SESSIONS',
        '该容器仍有活动 Session，请先停止相关 Run 并关闭 Session',
      );
    }
    const result = await this.runner.run(['stop', '--time', '10', target.expectedContainerId], {
      timeoutMs: 20_000,
    });
    if (result.exitCode !== 0) throw new AppError(502, 'DOCKER_STOP_FAILED', 'Docker 容器停止失败');
    return this.inspect(target);
  }

  async prepareForRun(target: DockerTarget, hostCwd: string): Promise<string> {
    let preflight = await this.preflight(target, hostCwd);
    if (preflight.status === 'STOPPED' && target.startPolicy === 'ON_DEMAND') {
      await this.start(target);
      preflight = await this.preflight(target, hostCwd);
    }
    if (preflight.status === 'STOPPED') {
      throw new AppError(409, 'DOCKER_CONTAINER_STOPPED', 'Docker 容器已停止，请先手动启动');
    }
    if (preflight.status === 'WORKSPACE_UNMAPPED' || !preflight.containerCwd) {
      throw new AppError(409, 'WORKSPACE_UNMAPPED', '当前 Project 路径未映射到 Agent 容器');
    }
    return preflight.containerCwd;
  }

  async execAgentCommand(
    target: DockerTarget,
    launch: DockerLaunchCommand,
    hostCwd: string,
    input?: string | Uint8Array,
  ): Promise<ProcessResult> {
    if (!launch.command || launch.command.includes('\u0000')) {
      throw new AppError(400, 'INVALID_AGENT_COMMAND', 'Agent command 不合法');
    }
    const containerCwd = await this.prepareForRun(target, hostCwd);
    return this.runner.run(
      [
        'exec',
        '-i',
        '-w',
        containerCwd,
        target.expectedContainerId,
        launch.command,
        ...launch.args,
      ],
      input === undefined ? {} : { input },
    );
  }
}

export class DockerCliRunner implements DockerCommandRunner {
  constructor(private readonly executable = '/usr/bin/docker') {}

  run(args: string[], options: { input?: string | Uint8Array; timeoutMs?: number } = {}) {
    return runProcess({
      executable: this.executable,
      args,
      ...(options.input === undefined ? {} : { input: options.input }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      maxOutputBytes: 4 * 1024 * 1024,
    });
  }
}

export async function mapWorkspacePath(
  hostCwd: string,
  mappings: readonly WorkspaceMapping[],
): Promise<string | undefined> {
  if (!isAbsolute(hostCwd))
    throw new AppError(400, 'CWD_NOT_ABSOLUTE', 'Project cwd 必须是绝对路径');
  const realCwd = await realpath(hostCwd);
  const resolvedMappings = await Promise.all(
    mappings.map(async (mapping) => ({
      ...mapping,
      realHostRoot: await realpath(mapping.hostRoot),
    })),
  );
  const matching = resolvedMappings
    .filter(
      (mapping) =>
        realCwd === mapping.realHostRoot ||
        realCwd.startsWith(`${mapping.realHostRoot}${posix.sep}`),
    )
    .sort((left, right) => right.realHostRoot.length - left.realHostRoot.length)[0];
  if (!matching) return undefined;

  const relative = posix.relative(matching.realHostRoot, realCwd);
  const mapped = posix.resolve(matching.containerRoot, relative);
  if (
    mapped !== matching.containerRoot &&
    !mapped.startsWith(`${matching.containerRoot}${posix.sep}`)
  ) {
    throw new AppError(400, 'WORKSPACE_MAPPING_ESCAPE', 'Docker cwd 映射逃逸了 container root');
  }
  return mapped;
}

function validateTarget(target: DockerTarget): void {
  if (!/^[a-f0-9]{64}$/.test(target.expectedContainerId)) {
    throw new AppError(
      400,
      'INVALID_CONTAINER_ID',
      'Docker container ID 必须是完整的 64 位十六进制值',
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]+$/.test(target.containerName)) {
    throw new AppError(400, 'INVALID_CONTAINER_NAME', 'Docker container name 不合法');
  }
  for (const mapping of target.workspaceMappings) {
    if (!isAbsolute(mapping.hostRoot) || !posix.isAbsolute(mapping.containerRoot)) {
      throw new AppError(
        400,
        'INVALID_WORKSPACE_MAPPING',
        'Docker workspace mapping 必须使用绝对路径',
      );
    }
  }
}

function verifyMappingBackedByMount(
  mappings: readonly WorkspaceMapping[],
  mounts: readonly DockerMount[],
): void {
  for (const mapping of mappings) {
    const covered = mounts.some(
      (mount) =>
        mount.RW &&
        (mapping.hostRoot === mount.Source ||
          mapping.hostRoot.startsWith(`${mount.Source}${posix.sep}`)) &&
        (mapping.containerRoot === mount.Destination ||
          mapping.containerRoot.startsWith(`${mount.Destination}${posix.sep}`)),
    );
    if (!covered) {
      throw new AppError(409, 'WORKSPACE_MAPPING_STALE', '已注册的工作区映射与容器实际挂载不一致', {
        hostRoot: mapping.hostRoot,
        containerRoot: mapping.containerRoot,
      });
    }
  }
}
