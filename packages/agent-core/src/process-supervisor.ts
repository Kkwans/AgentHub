import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';

import { redactSecrets } from './redaction.js';

export interface ProcessSpec {
  executable: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  inheritEnv?: boolean;
  timeoutMs?: number;
  protocolCancelGraceMs?: number;
  cancelGraceMs?: number;
  maxOutputBytes?: number;
  captureStdout?: boolean;
  redactValues?: string[];
  input?: string | Uint8Array;
}

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  canceled: boolean;
  durationMs: number;
}

export class ProcessSupervisorError extends Error {
  constructor(
    readonly code: 'EXECUTABLE_NOT_ABSOLUTE' | 'INVALID_PROCESS_OPTION' | 'SPAWN_FAILED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProcessSupervisorError';
  }
}

export class SupervisedProcess {
  readonly child: ChildProcessWithoutNullStreams;
  private readonly startedAt = Date.now();
  private readonly stdoutChunks: Buffer[] = [];
  private readonly stderrChunks: Buffer[] = [];
  private readonly completion: Promise<ProcessResult>;
  private capturedBytes = 0;
  private truncated = false;
  private timedOut = false;
  private canceled = false;
  private finished = false;
  private timeout: NodeJS.Timeout | undefined;

  constructor(private readonly spec: ProcessSpec) {
    validateSpec(spec);
    const detached = process.platform !== 'win32';
    this.child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd,
      env: spec.inheritEnv === false ? spec.env : { ...process.env, ...spec.env },
      shell: false,
      detached,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    if (spec.captureStdout !== false) {
      this.child.stdout.on('data', (chunk: Buffer) => this.capture(this.stdoutChunks, chunk));
    }
    this.child.stderr.on('data', (chunk: Buffer) => this.capture(this.stderrChunks, chunk));

    this.completion = new Promise<ProcessResult>((resolve, reject) => {
      let spawnError: Error | undefined;
      this.child.once('error', (error) => {
        spawnError = error;
      });
      this.child.once('close', (exitCode, signal) => {
        this.finished = true;
        if (this.timeout) clearTimeout(this.timeout);
        if (spawnError) {
          reject(
            new ProcessSupervisorError('SPAWN_FAILED', `无法启动进程：${spec.executable}`, {
              cause: spawnError,
            }),
          );
          return;
        }
        resolve({
          exitCode,
          signal,
          stdout: redactSecrets(
            Buffer.concat(this.stdoutChunks).toString('utf8'),
            spec.redactValues,
          ),
          stderr: redactSecrets(
            Buffer.concat(this.stderrChunks).toString('utf8'),
            spec.redactValues,
          ),
          truncated: this.truncated,
          timedOut: this.timedOut,
          canceled: this.canceled,
          durationMs: Date.now() - this.startedAt,
        });
      });
    });

    if (spec.input !== undefined) {
      this.child.stdin.end(spec.input);
    }
    if (spec.timeoutMs !== undefined) {
      this.timeout = setTimeout(() => {
        this.timedOut = true;
        void this.cancel();
      }, spec.timeoutMs);
      this.timeout.unref();
    }
  }

  wait(): Promise<ProcessResult> {
    return this.completion;
  }

  async cancel(protocolCancel?: () => Promise<void>): Promise<ProcessResult> {
    if (this.finished) return this.completion;
    this.canceled = true;
    if (protocolCancel) {
      try {
        await protocolCancel();
      } catch {
        // Protocol cancellation is best-effort; process termination remains authoritative.
      }
      if (this.finished) return this.completion;
      await Promise.race([
        this.completion.catch(() => undefined),
        delay(this.spec.protocolCancelGraceMs ?? 500),
      ]);
      if (this.finished) return this.completion;
    }

    this.signal('SIGTERM');
    await Promise.race([
      this.completion.catch(() => undefined),
      delay(this.spec.cancelGraceMs ?? 2_000),
    ]);
    if (!this.finished) this.signal('SIGKILL');
    return this.completion;
  }

  private capture(destination: Buffer[], chunk: Buffer): void {
    const maxOutputBytes = this.spec.maxOutputBytes ?? 4 * 1024 * 1024;
    const remaining = maxOutputBytes - this.capturedBytes;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    const accepted = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
    destination.push(accepted);
    this.capturedBytes += accepted.byteLength;
    if (accepted.byteLength < chunk.byteLength) this.truncated = true;
  }

  private signal(signal: NodeJS.Signals): void {
    if (this.finished || !this.child.pid) return;
    try {
      if (process.platform !== 'win32') process.kill(-this.child.pid, signal);
      else this.child.kill(signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') this.child.kill(signal);
    }
  }
}

export function spawnSupervisedProcess(spec: ProcessSpec): SupervisedProcess {
  return new SupervisedProcess(spec);
}

export async function runProcess(spec: ProcessSpec): Promise<ProcessResult> {
  return spawnSupervisedProcess(spec).wait();
}

function validateSpec(spec: ProcessSpec): void {
  if (!isAbsolute(spec.executable)) {
    throw new ProcessSupervisorError('EXECUTABLE_NOT_ABSOLUTE', 'executable 必须是绝对路径');
  }
  for (const [name, value] of [
    ['timeoutMs', spec.timeoutMs],
    ['protocolCancelGraceMs', spec.protocolCancelGraceMs],
    ['cancelGraceMs', spec.cancelGraceMs],
    ['maxOutputBytes', spec.maxOutputBytes],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new ProcessSupervisorError('INVALID_PROCESS_OPTION', `${name} 必须是非负安全整数`);
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    timeout.unref();
  });
}
