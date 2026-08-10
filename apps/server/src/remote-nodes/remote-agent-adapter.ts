import {
  agentEventTypeSchema,
  type AgentCapabilities,
  type AgentProfile,
  type AgentRunRef,
  type AgentRuntimeAdapter,
  type AgentSessionHandle,
  type AgentTurnInput,
  type ApprovalDecision,
  type CreateAgentSessionInput,
  type NormalizedAgentEvent,
  type PreflightReport,
} from '@agenthub/agent-core';
import { z } from 'zod';

import { RemoteNodeRpcError, type RemoteNodeGateway } from './remote-node-gateway.js';

const normalizedEventSchema = z.object({
  eventId: z.string().min(1),
  sessionId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  seq: z.number().int().nonnegative(),
  emittedAt: z.string().datetime({ offset: true }),
  adapterKind: z.string().min(1),
  type: agentEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  source: z
    .object({ protocol: z.string().optional(), eventType: z.string().optional() })
    .optional(),
});

export class RemoteAgentAdapter implements AgentRuntimeAdapter {
  readonly kind = 'REMOTE_NODE';

  constructor(private readonly gateway: RemoteNodeGateway) {}

  async preflight(profile: AgentProfile): Promise<PreflightReport> {
    const target = remoteTarget(profile);
    return (await this.gateway.request(
      target.nodeId,
      'agent.preflight',
      agentPayload(profile, preflightCwd(profile), profile.config.preflightSession === true),
      60_000,
    )) as unknown as PreflightReport;
  }

  async getCapabilities(profile: AgentProfile): Promise<AgentCapabilities> {
    const target = remoteTarget(profile);
    const capabilities = (await this.gateway.request(
      target.nodeId,
      'agent.capabilities',
      agentPayload(profile, preflightCwd(profile), false),
      60_000,
    )) as unknown as AgentCapabilities;
    return {
      ...capabilities,
      sessions: { ...capabilities.sessions, load: false, resume: false },
    };
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSessionHandle> {
    const target = remoteTarget(input.profile);
    const stream = new RemoteEventStream();
    const unsubscribe = this.gateway.subscribeSession(
      target.nodeId,
      input.sessionId,
      (raw) => {
        const parsed = normalizedEventSchema.safeParse(raw);
        if (parsed.success) stream.push(parsed.data as NormalizedAgentEvent);
        else
          stream.fail(new RemoteNodeRpcError('REMOTE_EVENT_INVALID', 'Remote Node 事件不符合协议'));
      },
      () =>
        stream.fail(new RemoteNodeRpcError('REMOTE_NODE_DISCONNECTED', 'Remote Node 连接已断开')),
    );
    try {
      const created = await this.gateway.request(
        target.nodeId,
        'session.create',
        {
          ...agentPayload(input.profile, input.cwd, false),
          sessionId: input.sessionId,
          projectId: input.projectId,
          ...(input.model ? { model: input.model } : {}),
          ...(input.mode ? { mode: input.mode } : {}),
        },
        60_000,
      );
      return new RemoteAgentSessionHandle(
        this.gateway,
        target.nodeId,
        input.sessionId,
        typeof created.externalSessionId === 'string' && created.externalSessionId
          ? created.externalSessionId
          : undefined,
        stream,
        unsubscribe,
      );
    } catch (error) {
      unsubscribe();
      stream.fail(error instanceof Error ? error : new Error('远程 Session 创建失败'));
      throw error;
    }
  }
}

class RemoteAgentSessionHandle implements AgentSessionHandle {
  private closed = false;

  constructor(
    private readonly gateway: RemoteNodeGateway,
    private readonly nodeId: string,
    private readonly sessionId: string,
    readonly externalSessionId: string | undefined,
    private readonly stream: RemoteEventStream,
    private readonly unsubscribe: () => void,
  ) {}

  events(): AsyncIterable<NormalizedAgentEvent> {
    return this.stream;
  }

  async sendTurn(input: AgentTurnInput): Promise<AgentRunRef> {
    const result = await this.gateway.request(this.nodeId, 'session.run', {
      sessionId: this.sessionId,
      runId: input.runId,
      text: input.text,
      ...(input.content ? { content: input.content } : {}),
    });
    return {
      runId: input.runId,
      ...(typeof result.externalRunId === 'string' && result.externalRunId
        ? { externalRunId: result.externalRunId }
        : {}),
    };
  }

  async resolveApproval(id: string, decision: ApprovalDecision): Promise<void> {
    await this.gateway.request(this.nodeId, 'session.approval', {
      sessionId: this.sessionId,
      approvalId: id,
      optionId: decision.optionId,
    });
  }

  async cancel(runId?: string): Promise<void> {
    await this.gateway.request(this.nodeId, 'session.cancel', {
      sessionId: this.sessionId,
      ...(runId ? { runId } : {}),
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.gateway.request(this.nodeId, 'session.close', { sessionId: this.sessionId });
    } finally {
      this.unsubscribe();
      this.stream.end();
    }
  }
}

class RemoteEventStream implements AsyncIterable<NormalizedAgentEvent> {
  private readonly values: NormalizedAgentEvent[] = [];
  private readonly waiters: Array<{
    resolve(value: IteratorResult<NormalizedAgentEvent>): void;
    reject(error: Error): void;
  }> = [];
  private terminalError: Error | undefined;
  private ended = false;

  push(event: NormalizedAgentEvent): void {
    if (this.ended || this.terminalError) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value: event, done: false });
    else this.values.push(event);
  }

  fail(error: Error): void {
    if (this.ended || this.terminalError) return;
    this.terminalError = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<NormalizedAgentEvent> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value) return { value, done: false };
        if (this.terminalError) throw this.terminalError;
        if (this.ended) return { value: undefined, done: true };
        return new Promise<IteratorResult<NormalizedAgentEvent>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
    };
  }
}

function remoteTarget(profile: AgentProfile) {
  if (profile.launchSpec.kind !== 'REMOTE_AGENT') {
    throw new RemoteNodeRpcError('REMOTE_AGENT_PROFILE_INVALID', 'Agent 不是 Remote Node Profile');
  }
  return profile.launchSpec;
}

function preflightCwd(profile: AgentProfile): string {
  const cwd = profile.config.preflightCwd;
  if (typeof cwd !== 'string') {
    throw new RemoteNodeRpcError('REMOTE_AGENT_CWD_REQUIRED', 'Remote Agent 缺少 cwd');
  }
  return cwd;
}

function agentPayload(profile: AgentProfile, cwd: string, smokeSession: boolean) {
  return {
    agentId: profile.id,
    name: profile.name,
    agentKind: profile.agentKind,
    cwd,
    ...(profile.defaultModel ? { defaultModel: profile.defaultModel } : {}),
    ...(profile.defaultMode ? { defaultMode: profile.defaultMode } : {}),
    ...(smokeSession ? { smokeSession: true } : {}),
  };
}
