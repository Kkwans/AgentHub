import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

import { AcpAdapter, resolvePinnedAcpAdapter } from '@agenthub/adapter-acp';
import {
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
}

export class AgentHubNodeCommandExecutor implements NodeCommandExecutor {
  private readonly workspace: NodeWorkspace;
  private readonly sessions = new Map<string, ManagedSession>();
  private eventSink: ((sessionId: string, event: Record<string, unknown>) => void) | undefined;

  constructor(
    allowedRoots: string[],
    private readonly adapter: AgentRuntimeAdapter = new AcpAdapter(),
  ) {
    this.workspace = new NodeWorkspace(allowedRoots);
  }

  setEventSink(
    sink: ((sessionId: string, event: Record<string, unknown>) => void) | undefined,
  ): void {
    this.eventSink = sink;
  }

  async disconnect(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    this.eventSink = undefined;
    await Promise.allSettled(sessions.map((session) => session.handle.close()));
  }

  async execute(command: RemoteNodeCommandName, payload: Record<string, unknown>) {
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
        return asRecord(await this.adapter.preflight(profile));
      }
      case 'agent.capabilities': {
        const input = agentInput.parse(payload);
        const profile = await this.profile(input);
        return asRecord(await this.adapter.getCapabilities(profile));
      }
      case 'session.create':
        return this.createSession(sessionCreateInput.parse(payload));
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
        this.sessions.delete(input.sessionId);
        await session.handle.close();
        return { closed: true };
      }
    }
  }

  private async createSession(input: z.infer<typeof sessionCreateInput>) {
    if (this.sessions.has(input.sessionId)) {
      throw new NodeCommandError('REMOTE_SESSION_EXISTS', '远程 Session 已存在');
    }
    const profile = await this.profile(input);
    const handle = await this.adapter.createSession({
      sessionId: input.sessionId,
      profile,
      projectId: input.projectId,
      cwd: input.cwd,
      ...(input.model ? { model: input.model } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
    });
    const managed: ManagedSession = { handle, lastSeq: 0 };
    this.sessions.set(input.sessionId, managed);
    void this.forwardEvents(input.sessionId, managed);
    return {
      externalSessionId: handle.externalSessionId ?? '',
    };
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
        session.lastSeq = Math.max(session.lastSeq, event.seq);
        this.eventSink?.(sessionId, event as unknown as Record<string, unknown>);
      }
    } catch {
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
