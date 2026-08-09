import {
  NO_AGENT_CAPABILITIES,
  type AgentCapabilities,
  type AgentProfile,
  type AgentRunRef,
  type AgentRuntimeAdapter,
  type AgentSessionHandle,
  type AgentTurnInput,
  type ApprovalDecision,
  type CreateAgentSessionInput,
  type LoadAgentSessionInput,
  type NormalizedAgentEvent,
  type PreflightReport,
  type ProcessResult,
  type ResumeAgentSessionInput,
} from '@agenthub/agent-core';

export interface OpenClawExecProbe {
  available: boolean;
  version?: string;
  message: string;
}

export interface OpenClawExecProcess {
  wait(): Promise<ProcessResult>;
  cancel(): Promise<ProcessResult>;
}

export interface OpenClawExecLauncher {
  probe(profile: AgentProfile, cwd: string): Promise<OpenClawExecProbe>;
  launch(profile: AgentProfile, cwd: string, prompt: string): Promise<OpenClawExecProcess>;
}

export interface OpenClawAdapterOptions {
  primary: AgentRuntimeAdapter;
  exec: OpenClawExecLauncher;
  now?: () => Date;
}

export class OpenClawAdapter implements AgentRuntimeAdapter {
  readonly kind = 'OPENCLAW_GATEWAY';
  private readonly modes = new Map<string, 'ACP' | 'EXEC'>();
  private readonly now: () => Date;

  constructor(private readonly options: OpenClawAdapterOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async preflight(profile: AgentProfile): Promise<PreflightReport> {
    const primary = await this.options.primary.preflight(profile);
    if (primary.status === 'READY') {
      this.modes.set(profile.id, 'ACP');
      return primary;
    }
    if (
      primary.status === 'STOPPED' ||
      primary.status === 'WORKSPACE_UNMAPPED' ||
      primary.status === 'CONTAINER_REPLACED'
    ) {
      return primary;
    }

    const cwd =
      typeof profile.config.preflightCwd === 'string' ? profile.config.preflightCwd : '/tmp';
    const fallback = await this.options.exec.probe(profile, cwd);
    if (!fallback.available) return primary;

    this.modes.set(profile.id, 'EXEC');
    return {
      status: 'READY',
      checkedAt: this.now().toISOString(),
      ...(fallback.version ? { detectedVersion: fallback.version } : {}),
      checks: [
        ...primary.checks,
        {
          id: 'openclaw-exec-fallback',
          label: 'OpenClaw agent exec 回退',
          status: 'WARN',
          message: fallback.message,
        },
      ],
      repair: {
        summary: '当前仅可使用单回合回退；请修复 OpenClaw Gateway/ACP 后恢复完整能力',
      },
    };
  }

  async getCapabilities(profile: AgentProfile): Promise<AgentCapabilities> {
    const mode = this.modes.get(profile.id);
    if (mode === 'ACP') return this.options.primary.getCapabilities(profile);
    if (mode === 'EXEC') return structuredClone(OPENCLAW_EXEC_CAPABILITIES);
    const report = await this.preflight(profile);
    if (report.status !== 'READY') return structuredClone(NO_AGENT_CAPABILITIES);
    return this.modes.get(profile.id) === 'ACP'
      ? this.options.primary.getCapabilities(profile)
      : structuredClone(OPENCLAW_EXEC_CAPABILITIES);
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSessionHandle> {
    if (this.modes.get(input.profile.id) !== 'EXEC') {
      return this.options.primary.createSession(input);
    }
    return new OpenClawExecSession(input, this.options.exec, this.now);
  }

  loadSession(input: LoadAgentSessionInput): Promise<AgentSessionHandle> {
    if (this.modes.get(input.profile.id) === 'EXEC') {
      throw new OpenClawAdapterError('CAPABILITY_UNSUPPORTED', 'OpenClaw exec 回退不支持 load');
    }
    if (!this.options.primary.loadSession) {
      throw new OpenClawAdapterError('CAPABILITY_UNSUPPORTED', 'OpenClaw ACP 不支持 load');
    }
    return this.options.primary.loadSession(input);
  }

  resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionHandle> {
    if (this.modes.get(input.profile.id) === 'EXEC') {
      throw new OpenClawAdapterError('CAPABILITY_UNSUPPORTED', 'OpenClaw exec 回退不支持 resume');
    }
    if (!this.options.primary.resumeSession) {
      throw new OpenClawAdapterError('CAPABILITY_UNSUPPORTED', 'OpenClaw ACP 不支持 resume');
    }
    return this.options.primary.resumeSession(input);
  }
}

export const OPENCLAW_EXEC_CAPABILITIES: AgentCapabilities = {
  sessions: { create: true, load: false, resume: false, close: true },
  prompts: { text: true, images: false, resources: false },
  interaction: { streaming: false, approvals: false, questions: false, plan: false },
  workspace: {
    files: false,
    terminal: false,
    additionalRoots: false,
    mcpStdio: false,
    mcpHttp: false,
  },
  configuration: { models: false, modes: false, reasoningEffort: false },
  telemetry: { tokenUsage: false, cost: false },
};

class OpenClawExecSession implements AgentSessionHandle {
  readonly externalSessionId = undefined;
  private readonly queue = new AsyncEventQueue<NormalizedAgentEvent>();
  private sequence = 0;
  private active: { runId: string; process: OpenClawExecProcess } | undefined;
  private closed = false;

  constructor(
    private readonly input: CreateAgentSessionInput,
    private readonly launcher: OpenClawExecLauncher,
    private readonly now: () => Date,
  ) {
    this.emit('session.created', { transport: 'openclaw-agent-exec', persistent: false });
  }

  events(): AsyncIterable<NormalizedAgentEvent> {
    return this.queue;
  }

  async sendTurn(input: AgentTurnInput): Promise<AgentRunRef> {
    if (this.closed) throw new OpenClawAdapterError('SESSION_CLOSED', 'Session 已关闭');
    if (this.active) throw new OpenClawAdapterError('RUN_ALREADY_ACTIVE', '当前已有运行中的 Run');
    const process = await this.launcher.launch(this.input.profile, this.input.cwd, input.text);
    this.active = { runId: input.runId, process };
    this.emit('run.started', { transport: 'openclaw-agent-exec' }, input.runId);
    void process.wait().then(
      (result) => {
        if (!this.active || this.active.runId !== input.runId) return;
        if (result.canceled) {
          this.emit('run.cancelled', {}, input.runId);
        } else if (result.exitCode === 0) {
          this.emit('assistant.message.completed', { text: result.stdout }, input.runId);
          this.emit('run.completed', { exitCode: result.exitCode }, input.runId);
        } else {
          this.emit(
            'run.failed',
            { code: 'OPENCLAW_EXEC_FAILED', exitCode: result.exitCode },
            input.runId,
          );
        }
        this.active = undefined;
      },
      () => {
        if (!this.active || this.active.runId !== input.runId) return;
        this.emit('run.failed', { code: 'OPENCLAW_EXEC_FAILED' }, input.runId);
        this.active = undefined;
      },
    );
    return { runId: input.runId };
  }

  resolveApproval(_id: string, _decision: ApprovalDecision): Promise<void> {
    throw new OpenClawAdapterError(
      'CAPABILITY_UNSUPPORTED',
      'OpenClaw exec 回退不支持交互式 Approval',
    );
  }

  async cancel(runId?: string): Promise<void> {
    if (!this.active || (runId && runId !== this.active.runId)) {
      throw new OpenClawAdapterError('RUN_NOT_ACTIVE', '没有可取消的 Run');
    }
    await this.active.process.cancel();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.active) await this.active.process.cancel();
    this.emit('session.closed', {});
    this.queue.close();
  }

  private emit(
    type: NormalizedAgentEvent['type'],
    payload: Record<string, unknown>,
    runId?: string,
  ): void {
    this.sequence += 1;
    this.queue.push({
      eventId: `${this.input.sessionId}-openclaw-${this.sequence}`,
      sessionId: this.input.sessionId,
      ...(runId ? { runId } : {}),
      seq: this.sequence,
      emittedAt: this.now().toISOString(),
      adapterKind: 'OPENCLAW_EXEC',
      type,
      payload,
      source: { protocol: 'openclaw-agent-exec' },
    });
  }
}

export class OpenClawAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OpenClawAdapterError';
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
