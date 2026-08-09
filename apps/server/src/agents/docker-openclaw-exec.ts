import {
  type OpenClawExecLauncher,
  type OpenClawExecProbe,
  type OpenClawExecProcess,
} from '@agenthub/adapter-openclaw';
import { spawnSupervisedProcess, type AgentProfile } from '@agenthub/agent-core';

import { AppError } from '../errors.js';
import type { DockerControlService, DockerTarget } from '../docker/docker-control.js';

export class DockerOpenClawExecLauncher implements OpenClawExecLauncher {
  constructor(
    private readonly docker: DockerControlService,
    private readonly dockerExecutable = '/usr/bin/docker',
  ) {}

  async probe(profile: AgentProfile, cwd: string): Promise<OpenClawExecProbe> {
    const { target, command } = requireOpenClawDockerProfile(profile);
    try {
      const result = await this.docker.execAgentCommand(
        target,
        { command, args: ['agent', 'exec', '--help'] },
        cwd,
      );
      const output = `${result.stdout}\n${result.stderr}`;
      const hasExecUsage = /Usage:\s+openclaw agent exec(?:\s|\[)/i.test(output);
      return {
        available: result.exitCode === 0 && hasExecUsage,
        message:
          result.exitCode === 0 && hasExecUsage
            ? 'ACP 不可用，已验证 openclaw agent exec 单回合回退'
            : '当前 OpenClaw 版本未提供 agent exec 子命令',
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      return { available: false, message: '无法验证 openclaw agent exec' };
    }
  }

  async launch(profile: AgentProfile, cwd: string, prompt: string): Promise<OpenClawExecProcess> {
    const { target, command } = requireOpenClawDockerProfile(profile);
    const containerCwd = await this.docker.prepareForRun(target, cwd);
    const supervised = spawnSupervisedProcess({
      executable: this.dockerExecutable,
      args: [
        'exec',
        '-i',
        '-w',
        containerCwd,
        target.expectedContainerId,
        command,
        'agent',
        'exec',
        prompt,
      ],
      maxOutputBytes: 4 * 1024 * 1024,
      cancelGraceMs: 2_000,
    });
    return {
      wait: () => supervised.wait(),
      cancel: () => supervised.cancel(),
    };
  }
}

function requireOpenClawDockerProfile(profile: AgentProfile): {
  target: DockerTarget;
  command: string;
} {
  const launch = profile.launchSpec;
  if (
    profile.agentKind !== 'OPENCLAW' ||
    launch.kind !== 'DOCKER_EXEC' ||
    launch.command !== 'openclaw'
  ) {
    throw new AppError(
      400,
      'OPENCLAW_EXEC_PROFILE_INVALID',
      'OpenClaw exec 回退只接受固定的 Docker openclaw Profile',
    );
  }
  return {
    target: {
      id: profile.id,
      containerName: launch.containerName,
      expectedContainerId: launch.expectedContainerId,
      startPolicy: launch.startPolicy,
      workspaceMappings: launch.workspaceMappings,
    },
    command: launch.command,
  };
}
