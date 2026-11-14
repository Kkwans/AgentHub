import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

import { AcpAdapter, resolvePinnedAcpAdapter } from '@agenthub/adapter-acp';
import {
  isResourceCleanupUnconfirmed,
  ResourceCleanupUnconfirmedError,
  type AgentRuntimeAdapter,
  type AgentKind,
  type AgentProfile,
  type AgentSessionHandle,
  type NormalizedAgentEvent,
} from '@agenthub/agent-core';
import type { RemoteNodeCommandName } from '@agenthub/shared';
import { z } from 'zod';

import { NodeCommandError, type NodeCommandExecutor } from './node-client.js';
import { NodeWorkspace } from './workspace.js';

const agentKind = z.enum(['CODEX', 'CLAUDE_CODE', 'OPENCODE', 'HERMES', 'OPENCLAW']);
const agentInput = z.object({
  agentId: z.string().uuid(),
  name: z.string().min(1).max(120),
  agentKind,
  cwd: z.string().min(1).max(4_096),
  defaultModel: z.string().max(160).optional(),
  defaultMode: z.string().max(80).optional(),
  smokeSession: z.boolean().optional(),
});
const projectInput = z.object({ rootPath: z.string().min(1).max(4_096) });
const fileListInput = projectInput.extend({
  requestedPath: z.string().max(4_096).default(''),
  depth: z.number().int().min(0).max(6).default(2),
});
const fileReadInput = projectInput.extend({ requestedPath: z.string().min(1).max(4_096) });
const sessionCreateInput = agentInput.extend({
  sessionId: z.string().uuid(),
  projectId: z.string().uuid(),
  model: z.string().max(160).optional(),
  mode: z.string().max(80).optional(),
});
const sessionIdInput = z.object({ sessionId: z.string().uuid() });
const sessionRunInput = sessionIdInput.extend({
  runId: z.string().uuid(),
  text: z.string().min(1).max(1_000_000),
  content: z.array(z.record(z.string(), z.unknown())).max(64).optional(),
});
const approvalInput = sessionIdInput.extend({
  approvalId: z.string().min(1).max(256),
  optionId: z.string().min(1).max(256),
});
const cancelInput = sessionIdInput.extend({ runId: z.string().uuid().optional() });

interface ManagedSession {
  handle: AgentSessionHandle;
  lastSeq: number;
  epoch: number;
}

export class AgentHubNodeCommandExecutor implements NodeCommandExecutor {
  private readonly workspace: NodeWorkspace;
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly reservations = new Map<string, symbol>();
  private readonly pending = new Set<Promise<void>>();
  private readonly unconfirmed = new Set<AgentSessionHandle>();
  private readonly closes = new WeakMap<AgentSessionHandle, Promise<void>>();
  private accepting = true;
  private epoch = 0;
  private cleanupUnconfirmed = false;
  private disconnectPromise: Promise<void> | undefined;
  private eventSink: ((sessionId: string, event: Record<string, unknown>) => void) | undefined;

  constructor(
    allowedRoots: string[],
    private readonly adapter: AgentRuntimeAdapter = new AcpAdapter(),
    private readonly disconnectTimeoutMs = 5_000,
  ) {
    this.workspace = new NodeWorkspace(allowedRoots);
  }

  setEventSink(
    sink: ((sessionId: string, event: Record<string, unknown>) => void) | undefined,
  ): void {
    this.eventSink = sink;
  }

  async beginConnection(): Promise<void> {
    if (this.disconnectPromise) await this.disconnectPromise;
    if (this.cleanupUnconfirmed) throw new ResourceCleanupUnconfirmedError();
    this.disconnectPromise = undefined;
    this.accepting = true;
  }

  disconnect(): Promise<void> {
    if (!this.disconnectPromise) {
      this.accepting = false;
      this.epoch += 1;
      this.eventSink = undefined;
      this.disconnectPromise = Promise.resolve().then(() => this.drain());
    }
    return this.disconnectPromise;
  }

  private async drain(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = async () => {
      const closes = [...this.sessions.entries()].map(async ([id, session]) => {
        await this.closeHandle(session.handle);
        if (this.sessions.get(id) === session) this.sessions.delete(id);
      });
      const results = Promise.allSettled(closes);
      while (this.pending.size) await Promise.all([...this.pending]);
      if (
        (await results).some((result) => result.status === 'rejected') ||
        this.cleanupUnconfirmed ||
        this.unconfirmed.size
      )
        throw new ResourceCleanupUnconfirmedError();
    };
    try {
      await Promise.race([
        cleanup(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ResourceCleanupUnconfirmedError()),
            Math.max(1, this.disconnectTimeoutMs),
          );
        }),
      ]);
    } catch {
      this.cleanupUnconfirmed = true;
      throw new ResourceCleanupUnconfirmedError();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private assertAdmission(epoch: number): void {
    if (!this.accepting || this.epoch !== epoch)
      throw new NodeCommandError('NODE_EXECUTOR_STOPPING', 'Node 正在清理，不能执行新命令。');
  }

  private closeHandle(handle: AgentSessionHandle): Promise<void> {
    let close = this.closes.get(handle);
    if (!close) {
      this.unconfirmed.add(handle);
      close = Promise.resolve()
        .then(() => handle.close())
        .then(
          () => {
            this.unconfirmed.delete(handle);
          },
          () => {
            this.cleanupUnconfirmed = true;
            this.accepting = false;
            throw new ResourceCleanupUnconfirmedError();
          },
        );
      this.closes.set(handle, close);
    }
    return close;
  }

  async execute(command: RemoteNodeCommandName, payload: Record<string, unknown>) {
    const epoch = this.epoch;
    this.assertAdmission(epoch);
    let done!: () => void;
    const settled = new Promise<void>((resolve) => {
      done = resolve;
    });
    this.pending.add(settled);
    try {
      const result = await this.executeAdmitted(command, payload, epoch);
      this.assertAdmission(epoch);
      return result;
    } catch (error) {
      if (
        isResourceCleanupUnconfirmed(error) ||
        (error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ACP_PROCESS_CLEANUP_UNCONFIRMED')
      ) {
        this.cleanupUnconfirmed = true;
        this.accepting = false;
        throw new ResourceCleanupUnconfirmedError();
      }
      throw error;
    } finally {
      this.pending.delete(settled);
      done();
    }
  }

  private async executeAdmitted(
    command: RemoteNodeCommandName,
    payload: Record<string, unknown>,
    epoch: number,
  ) {
    switch (command) {
      case 'project.preflight': {
        const input = projectInput.parse(payload);
        return asRecord(await this.workspace.preflight(input.rootPath));
      }
      case 'fs.list': {
        const input = fileListInput.parse(payload);
        return {
          entries: await this.workspace.listFiles(input.rootPath, input.requestedPath, input.depth),
        };
      }
      case 'fs.read': {
        const input = fileReadInput.parse(payload);
        return asRecord(await this.workspace.readTextFile(input.rootPath, input.requestedPath));
      }
      case 'agent.preflight': {
        const input = agentInput.parse(payload);
        const profile = await this.profile(input);
        this.assertAdmission(epoch);
        return asRecord(
          await this.adapter.preflight({
            ...profile,
            config: { ...profile.config, preflightStrictCleanup: true },
          }),
        );
      }
      case 'agent.capabilities': {
        const input = agentInput.parse(payload);
        const profile = await this.profile(input);
        this.assertAdmission(epoch);
        return asRecord(await this.adapter.getCapabilities(profile));
      }
      case 'session.create':
        return this.createSession(sessionCreateInput.parse(payload), epoch);
      case 'session.run':
        return this.run(sessionRunInput.parse(payload));
      case 'session.approval': {
        const input = approvalInput.parse(payload);
        await this.requireSession(input.sessionId).handle.resolveApproval(input.approvalId, {
          optionId: input.optionId,
        });
        return { resolved: true };
      }
      case 'session.cancel': {
        const input = cancelInput.parse(payload);
        await this.requireSession(input.sessionId).handle.cancel(input.runId);
        return { canceled: true };
      }
      case 'session.close': {
        const input = sessionIdInput.parse(payload);
        const session = this.requireSession(input.sessionId);
        await this.closeHandle(session.handle);
        if (this.sessions.get(input.sessionId) === session) this.sessions.delete(input.sessionId);
        return { closed: true };
      }
    }
  }

  private async createSession(input: z.infer<typeof sessionCreateInput>, epoch: number) {
    if (this.sessions.has(input.sessionId) || this.reservations.has(input.sessionId))
      throw new NodeCommandError('REMOTE_SESSION_EXISTS', '远程 Session 已存在或正在创建');
    const reservation = Symbol();
    this.reservations.set(input.sessionId, reservation);
    try {
      const profile = await this.profile(input);
      this.assertAdmission(epoch);
      const handle = await this.adapter.createSession({
        sessionId: input.sessionId,
        profile,
        projectId: input.projectId,
        cwd: input.cwd,
        ...(input.model ? { model: input.model } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
      });
      if (!this.accepting || this.epoch !== epoch) {
        await this.closeHandle(handle);
        throw new NodeCommandError('NODE_EXECUTOR_STOPPING', '迟到会话已清理，未激活。');
      }
      const managed: ManagedSession = { handle, lastSeq: 0, epoch };
      this.sessions.set(input.sessionId, managed);
      void this.forwardEvents(input.sessionId, managed);
      return { externalSessionId: handle.externalSessionId ?? '' };
    } finally {
      if (this.reservations.get(input.sessionId) === reservation)
        this.reservations.delete(input.sessionId);
    }
  }

  private async run(input: z.infer<typeof sessionRunInput>) {
    const reference = await this.requireSession(input.sessionId).handle.sendTurn({
      runId: input.runId,
      text: input.text,
      ...(input.content ? { content: input.content } : {}),
    });
    return {
      runId: reference.runId,
      ...(reference.externalRunId ? { externalRunId: reference.externalRunId } : {}),
    };
  }

  private async profile(input: z.infer<typeof agentInput>): Promise<AgentProfile> {
    const cwd = await this.workspace.resolveProjectRoot(input.cwd);
    const launch = await launchFor(input.agentKind);
    return {
      id: input.agentId,
      name: input.name,
      agentKind: input.agentKind,
      adapterKind: input.agentKind === 'OPENCLAW' ? 'OPENCLAW_GATEWAY' : 'ACP_STDIO',
      targetKind: 'LOCAL_HOST',
      launchSpec: { kind: 'HOST_PROCESS', executable: launch.executable, args: launch.args },
      ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
      ...(input.defaultMode ? { defaultMode: input.defaultMode } : {}),
      config: {
        preflightCwd: cwd,
        preflightSession: input.smokeSession === true,
        models: true,
        modes: true,
        files: true,
        terminal: true,
      },
    };
  }

  private requireSession(sessionId: string): ManagedSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NodeCommandError('REMOTE_SESSION_NOT_FOUND', '远程 Session 不存在');
    return session;
  }

  private async forwardEvents(sessionId: string, session: ManagedSession): Promise<void> {
    try {
      for await (const event of session.handle.events()) {
        if (
          !this.accepting ||
          session.epoch !== this.epoch ||
          this.sessions.get(sessionId) !== session
        )
          continue;
        session.lastSeq = Math.max(session.lastSeq, event.seq);
        this.eventSink?.(sessionId, event as unknown as Record<string, unknown>);
      }
    } catch {
      if (
        !this.accepting ||
        session.epoch !== this.epoch ||
        this.sessions.get(sessionId) !== session
      )
        return;
      const disconnected: NormalizedAgentEvent = {
        eventId: randomUUID(),
        sessionId,
        seq: session.lastSeq + 1,
        emittedAt: new Date().toISOString(),
        adapterKind: 'REMOTE_NODE',
        type: 'adapter.disconnected',
        payload: { code: 'REMOTE_AGENT_DISCONNECTED', message: '远程 Agent 连接已断开' },
      };
      this.eventSink?.(sessionId, disconnected as unknown as Record<string, unknown>);
    }
  }
}

async function launchFor(kind: AgentKind): Promise<{ executable: string; args: string[] }> {
  if (kind === 'CODEX' || kind === 'CLAUDE_CODE') {
    const pinned = resolvePinnedAcpAdapter(kind);
    return { executable: pinned.executable, args: pinned.args };
  }
  const command = kind === 'OPENCODE' ? 'opencode' : kind === 'HERMES' ? 'hermes' : 'openclaw';
  const executable = await findExecutable(command);
  if (!executable) throw new NodeCommandError('REMOTE_AGENT_MISSING', `${command} 未安装`);
  return {
    executable,
    args: kind === 'OPENCODE' || kind === 'HERMES' || kind === 'OPENCLAW' ? ['acp'] : [],
  };
}

async function findExecutable(name: string): Promise<string | undefined> {
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(isAbsolute)) {
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue without invoking a shell.
    }
  }
  return undefined;
}

function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}
