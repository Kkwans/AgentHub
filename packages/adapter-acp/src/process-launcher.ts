import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import type { Readable, Writable } from 'node:stream';

import {
  spawnSupervisedProcess,
  type AgentProfile,
  type ProcessResult,
} from '@agenthub/agent-core';

export interface LaunchedAcpProcess {
  readonly stdout: Readable;
  readonly stdin: Writable;
  wait(): Promise<ProcessResult>;
  cancel(protocolCancel?: () => Promise<void>): Promise<ProcessResult>;
}

export interface AcpProcessLauncher {
  launch(profile: AgentProfile, cwd: string): Promise<LaunchedAcpProcess>;
}

export interface HostProcessLauncherOptions {
  resolveEnvironment?: (profile: AgentProfile) => Promise<NodeJS.ProcessEnv>;
  /** Optional identity used for host Agent processes (the server may stay root). */
  runAs?: { uid: number; gid: number };
}

export class HostAcpProcessLauncher implements AcpProcessLauncher {
  constructor(private readonly options: HostProcessLauncherOptions = {}) {}

  async launch(profile: AgentProfile, cwd: string): Promise<LaunchedAcpProcess> {
    if (profile.launchSpec.kind !== 'HOST_PROCESS') {
      throw new AcpLauncherError('LAUNCH_KIND_UNSUPPORTED', 'Host launcher 只支持 HOST_PROCESS');
    }
    try {
      await access(profile.launchSpec.executable, constants.X_OK);
    } catch (error) {
      throw new AcpLauncherError(
        'EXECUTABLE_MISSING',
        `Agent executable 不存在或不可执行：${profile.launchSpec.executable}`,
        { cause: error },
      );
    }
    const env = this.options.resolveEnvironment
      ? await this.options.resolveEnvironment(profile)
      : undefined;
    const supervised = spawnSupervisedProcess({
      executable: profile.launchSpec.executable,
      args: profile.launchSpec.args,
      cwd,
      ...(env ? { env } : {}),
      ...(this.options.runAs && process.getuid?.() === 0
        ? { uid: this.options.runAs.uid, gid: this.options.runAs.gid }
        : {}),
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

export class AcpLauncherError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AcpLauncherError';
  }
}
