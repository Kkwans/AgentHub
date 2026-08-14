import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import type { IPty, IPtyForkOptions } from 'node-pty';
import type { AgentHubDatabase, ProjectRepository } from '@agenthub/db';

import { AppError } from '../errors.js';
import { resolveContainedExistingPath } from '../projects/path-security.js';
import type { SessionEventPublisher } from '../sessions/session-service.js';

interface PtyModule {
  spawn(file: string, args: string[] | string, options: IPtyForkOptions): IPty;
}

export interface TerminalCapability {
  available: boolean;
  code: 'READY' | 'PTY_NATIVE_BINDING_UNAVAILABLE';
  message: string;
  platform: NodeJS.Platform;
  arch: string;
}

interface TerminalRecord {
  id: string;
  projectId: string;
  cwd: string;
  shell: string;
  process: IPty;
  createdAt: string;
}

export class TerminalService {
  private module: PtyModule | undefined;
  private capability: TerminalCapability | undefined;
  private readonly terminals = new Map<string, TerminalRecord>();

  constructor(
    private readonly projects: ProjectRepository<AgentHubDatabase>,
    private readonly publisher: SessionEventPublisher,
    private readonly loadModule: () => Promise<PtyModule> = () => import('node-pty'),
  ) {}

  async diagnose(): Promise<TerminalCapability> {
    if (this.capability) return this.capability;
    try {
      const module = await this.loadModule();
      if (typeof module.spawn !== 'function') throw new Error('node-pty spawn 不存在');
      this.module = module;
      this.capability = {
        available: true,
        code: 'READY',
        message: 'Terminal PTY 可用',
        platform: process.platform,
        arch: process.arch,
      };
    } catch {
      this.capability = {
        available: false,
        code: 'PTY_NATIVE_BINDING_UNAVAILABLE',
        message: `当前 ${process.platform}/${process.arch} 环境缺少可加载的 node-pty native binding`,
        platform: process.platform,
        arch: process.arch,
      };
    }
    return this.capability;
  }

  async open(input: {
    projectId: string;
    path?: string;
    shell?: string;
    cols?: number;
    rows?: number;
  }) {
    await this.requireAvailable();
    const project = await this.projects.get(input.projectId);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project 不存在');
    const cwd = await resolveContainedExistingPath(project.realRootPath, input.path ?? '');
    const shell = input.shell ?? defaultShell();
    await validateShell(shell);
    const id = randomUUID();
    const terminal = this.module!.spawn(shell, [], {
      name: 'xterm-256color',
      cols: input.cols ?? 120,
      rows: input.rows ?? 32,
      cwd,
      env: sanitizedEnvironment(),
      ...ownerIds(),
    });
    const record: TerminalRecord = {
      id,
      projectId: input.projectId,
      cwd,
      shell,
      process: terminal,
      createdAt: new Date().toISOString(),
    };
    this.terminals.set(id, record);
    terminal.onData((data) => {
      this.publisher.publish(`terminal:${id}`, { type: 'terminal.output', terminalId: id, data });
    });
    terminal.onExit(({ exitCode, signal }) => {
      this.terminals.delete(id);
      this.publisher.publish(`terminal:${id}`, {
        type: 'terminal.exited',
        terminalId: id,
        exitCode,
        signal,
      });
    });
    this.publisher.publish(`terminal:${id}`, {
      type: 'terminal.opened',
      terminalId: id,
      cwd,
      shell,
    });
    return publicTerminal(record);
  }

  async input(id: string, data: string) {
    const terminal = this.requireTerminal(id);
    terminal.process.write(data);
    return publicTerminal(terminal);
  }

  async resize(id: string, cols: number, rows: number) {
    const terminal = this.requireTerminal(id);
    terminal.process.resize(cols, rows);
    this.publisher.publish(`terminal:${id}`, {
      type: 'terminal.resized',
      terminalId: id,
      cols,
      rows,
    });
    return publicTerminal(terminal);
  }

  async close(id: string) {
    const terminal = this.requireTerminal(id);
    terminal.process.kill();
    this.terminals.delete(id);
    return { ...publicTerminal(terminal), closed: true };
  }

  async shutdown(): Promise<void> {
    for (const terminal of this.terminals.values()) terminal.process.kill();
    this.terminals.clear();
  }

  private async requireAvailable(): Promise<void> {
    const capability = await this.diagnose();
    if (!capability.available) {
      throw new AppError(503, capability.code, capability.message);
    }
  }

  private requireTerminal(id: string): TerminalRecord {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new AppError(404, 'TERMINAL_NOT_FOUND', 'Terminal 不存在或已经关闭');
    return terminal;
  }
}

function publicTerminal(record: TerminalRecord) {
  return {
    id: record.id,
    projectId: record.projectId,
    cwd: record.cwd,
    shell: record.shell,
    createdAt: record.createdAt,
    topic: `terminal:${record.id}`,
  };
}

function defaultShell(): string {
  const configured = process.env.SHELL;
  return configured && isAbsolute(configured) ? configured : '/bin/bash';
}

async function validateShell(shell: string): Promise<void> {
  if (!isAbsolute(shell))
    throw new AppError(400, 'TERMINAL_SHELL_NOT_ABSOLUTE', 'Shell 必须是绝对路径');
  const allowed = new Set(
    ['/bin/bash', '/bin/sh', '/usr/bin/bash', process.env.SHELL].filter(Boolean),
  );
  if (!allowed.has(shell)) {
    throw new AppError(403, 'TERMINAL_SHELL_NOT_ALLOWED', 'Shell 不在允许列表中');
  }
  try {
    await access(shell);
  } catch (error) {
    throw new AppError(400, 'TERMINAL_SHELL_MISSING', 'Shell 不存在', undefined, { cause: error });
  }
}

function sanitizedEnvironment(): Record<string, string> {
  const allow = new Set([
    'COLORTERM',
    'HOME',
    'LANG',
    'LOGNAME',
    'PATH',
    'PWD',
    'SHELL',
    'TERM',
    'TERM_PROGRAM',
    'TMPDIR',
    'USER',
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && (allow.has(entry[0]) || entry[0].startsWith('LC_')),
    ),
  );
}

function ownerIds(): Pick<IPtyForkOptions, 'uid' | 'gid'> {
  const uid = parseOwnerId(process.env.AGENTHUB_PROJECT_OWNER_UID);
  const gid = parseOwnerId(process.env.AGENTHUB_PROJECT_OWNER_GID);
  return {
    ...(uid === undefined ? {} : { uid }),
    ...(gid === undefined ? {} : { gid }),
  };
}

function parseOwnerId(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
