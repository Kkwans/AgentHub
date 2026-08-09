import {
  AcpLauncherError,
  type AcpProcessLauncher,
  type LaunchedAcpProcess,
} from '@agenthub/adapter-acp';
import { spawnSupervisedProcess, type AgentProfile } from '@agenthub/agent-core';

import { AppError } from '../errors.js';
import type { DockerControlService, DockerTarget } from '../docker/docker-control.js';

export class DockerAcpProcessLauncher implements AcpProcessLauncher {
  constructor(
    private readonly docker: DockerControlService,
    private readonly dockerExecutable = '/usr/bin/docker',
  ) {}

  async launch(profile: AgentProfile, cwd: string): Promise<LaunchedAcpProcess> {
    const launch = profile.launchSpec;
    if (launch.kind !== 'DOCKER_EXEC') {
      throw new AcpLauncherError('LAUNCH_KIND_UNSUPPORTED', 'Docker launcher 只支持 DOCKER_EXEC');
    }

    const target: DockerTarget = {
      id: profile.id,
      containerName: launch.containerName,
      expectedContainerId: launch.expectedContainerId,
      startPolicy: launch.startPolicy,
      workspaceMappings: launch.workspaceMappings,
    };

    let containerCwd: string;
    try {
      containerCwd = await this.docker.prepareForRun(target, cwd);
    } catch (error) {
      throw translateDockerError(error);
    }

    const supervised = spawnSupervisedProcess({
      executable: this.dockerExecutable,
      args: [
        'exec',
        '-i',
        ...(profile.agentKind === 'OPENCLAW'
          ? ['-e', 'OPENCLAW_HIDE_BANNER=1', '-e', 'OPENCLAW_SUPPRESS_NOTES=1']
          : []),
        '-w',
        containerCwd,
        launch.expectedContainerId,
        launch.command,
        ...launch.args,
      ],
      captureStdout: false,
      maxOutputBytes: 2 * 1024 * 1024,
      cancelGraceMs: 2_000,
      protocolCancelGraceMs: 500,
    });
    return {
      stdout: supervised.child.stdout,
      stdin: supervised.child.stdin,
      wait: () => supervised.wait(),
      cancel: (protocolCancel) => supervised.cancel(protocolCancel),
    };
  }
}

export class RoutedAcpProcessLauncher implements AcpProcessLauncher {
  constructor(
    private readonly host: AcpProcessLauncher,
    private readonly docker: AcpProcessLauncher,
  ) {}

  launch(profile: AgentProfile, cwd: string): Promise<LaunchedAcpProcess> {
    return profile.launchSpec.kind === 'DOCKER_EXEC'
      ? this.docker.launch(profile, cwd)
      : this.host.launch(profile, cwd);
  }
}

function translateDockerError(error: unknown): AcpLauncherError {
  if (!(error instanceof AppError)) {
    return new AcpLauncherError('DOCKER_LAUNCH_FAILED', '无法准备 Docker Agent 进程', {
      cause: error,
    });
  }
  const codeMap: Record<string, string> = {
    DOCKER_CONTAINER_STOPPED: 'TARGET_STOPPED',
    WORKSPACE_UNMAPPED: 'WORKSPACE_UNMAPPED',
    WORKSPACE_MAPPING_STALE: 'WORKSPACE_UNMAPPED',
    CONTAINER_REPLACED: 'CONTAINER_REPLACED',
    DOCKER_CONTAINER_NOT_FOUND: 'CONTAINER_REPLACED',
  };
  return new AcpLauncherError(codeMap[error.code] ?? 'DOCKER_LAUNCH_FAILED', error.message, {
    cause: error,
  });
}
