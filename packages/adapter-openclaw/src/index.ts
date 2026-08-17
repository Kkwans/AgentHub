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
  commandStyle?: 'AGENT_COMMAND' | 'AGENT_EXEC';
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
  /**
   * Use the single-turn exec transport when the installed Gateway-backed ACP
   * bridge is known to omit terminal chat events. This is intentionally an
   * adapter-level switch so the core domain remains vendor agnostic.
   */
  preferExec?: boolean;
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
      if (this.options.preferExec) {
        const fallback = await this.probeExec(profile);
        if (fallback.available) {
          this.modes.set(profile.id, 'EXEC');
          return this.execFallbackReport(primary, fallback, true);
        }
        return {
          ...primary,
          status: 'BROKEN',
          checks: [
            ...primary.checks,
            {
              id: 'openclaw-exec-fallback',
              label: 'OpenClaw agent exec 回退',
              status: 'FAIL',
              message: fallback.message,
            },
          ],
          repair: {
            summary: '当前部署要求使用 agent exec 回退，但该命令不可用；请修复 OpenClaw ACP 或安装 agent exec。',
          },
        };
      }
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

    const fallback = await this.probeExec(profile);
    if (!fallback.available) return primary;

    this.modes.set(profile.id, 'EXEC');
    return this.execFallbackReport(primary, fallback, false);
  }

  private probeExec(profile: AgentProfile): Promise<OpenClawExecProbe> {
    const cwd =
      typeof profile.config.preflightCwd === 'string' ? profile.config.preflightCwd : '/tmp';
    return this.options.exec.probe(profile, cwd);
  }

  private execFallbackReport(
    primary: PreflightReport,
    fallback: OpenClawExecProbe,
    forced: boolean,
  ): PreflightReport {
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
          message: forced
            ? '当前 ACP 版本未回传 Prompt 终态，已切换到已验证的单回合回退'
            : fallback.message,
        },
      ],
      repair: {
        summary: forced
          ? 'OpenClaw ACP Prompt 终态事件不可用；当前使用 agent exec 保证消息可发送。'
          : '当前仅可使用单回合回退；请修复 OpenClaw Gateway/ACP 后恢复完整能力',
      },
    };
  }

  async getCapabilities(profile: AgentProfile): Promise<AgentCapabilities> {
    const mode = this.transportFor(profile.id);
    if (mode === 'ACP') return this.options.primary.getCapabilities(profile);
    if (mode === 'EXEC') return structuredClone(OPENCLAW_EXEC_CAPABILITIES);
    const report = await this.preflight(profile);
    if (report.status !== 'READY') return structuredClone(NO_AGENT_CAPABILITIES);
    return this.transportFor(profile.id) === 'ACP'
      ? this.options.primary.getCapabilities(profile)
      : structuredClone(OPENCLAW_EXEC_CAPABILITIES);
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSessionHandle> {
    if (this.transportFor(input.profile.id) !== 'EXEC') {
      return this.options.primary.createSession(input);
    }
    return new OpenClawExecSession(input, this.options.exec, this.now);
  }

  loadSession(input: LoadAgentSessionInput): Promise<AgentSessionHandle> {
    if (this.transportFor(input.profile.id) === 'EXEC') {
      throw new OpenClawAdapterError('CAPABILITY_UNSUPPORTED', 'OpenClaw exec 回退不支持 load');
    }
    if (!this.options.primary.loadSession) {
      throw new OpenClawAdapterError('CAPABILITY_UNSUPPORTED', 'OpenClaw ACP 不支持 load');
    }
    return this.options.primary.loadSession(input);
  }

  resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionHandle> {
    if (this.transportFor(input.profile.id) === 'EXEC') {
      throw new OpenClawAdapterError('CAPABILITY_UNSUPPORTED', 'OpenClaw exec 回退不支持 resume');
    }
    if (!this.options.primary.resumeSession) {
      throw new OpenClawAdapterError('CAPABILITY_UNSUPPORTED', 'OpenClaw ACP 不支持 resume');
    }
    return this.options.primary.resumeSession(input);
  }

  /**
   * The server creates a fresh adapter instance when it resolves a runtime
   * for Session creation. Keep the deployment-level preference deterministic
   * instead of relying only on the in-memory result of a previous preflight.
   */
  private transportFor(profileId: string): 'ACP' | 'EXEC' | undefined {
    if (this.options.preferExec) return 'EXEC';
    return this.modes.get(profileId);
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
          const text = extractExecText(result.stdout);
          if (text) this.emit('assistant.message.completed', { text }, input.runId);
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

function extractExecText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return '';
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const result = (parsed as { result?: unknown }).result;
      const payloads =
        result && typeof result === 'object'
          ? (result as { payloads?: unknown }).payloads
          : undefined;
      if (Array.isArray(payloads)) {
        return payloads
          .map((payload) =>
            payload && typeof payload === 'object' && typeof (payload as { text?: unknown }).text === 'string'
              ? (payload as { text: string }).text
              : '',
          )
          .filter(Boolean)
          .join('\n');
      }
    }
  } catch {
    // Older OpenClaw exec variants return plain text instead of JSON.
  }
  return trimmed;
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
