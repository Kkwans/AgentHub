import type {
  AgentCapabilities,
  AgentProfile,
  AgentRunRef,
  AgentRuntimeAdapter,
  AgentSessionHandle,
  AgentTurnInput,
  ApprovalDecision,
  CreateAgentSessionInput,
  PreflightReport,
  SessionConfiguration,
  SessionConfigurationPatch,
} from './contracts.js';
import type { AgentEventType, NormalizedAgentEvent } from './events.js';

export type FakeAdapterScenario = 'complete' | 'approval' | 'fail' | 'disconnect' | 'idle';

export interface FakeAdapterOptions {
  scenario?: FakeAdapterScenario;
  capabilities?: AgentCapabilities;
  preflight?: PreflightReport;
  now?: () => Date;
  includeExternalRunId?: boolean;
  usagePayload?: Record<string, unknown>;
}

export const FAKE_AGENT_CAPABILITIES: AgentCapabilities = {
  sessions: { create: true, load: false, resume: false, close: true },
  prompts: { text: true, images: false, resources: false },
  interaction: { streaming: true, approvals: true, questions: false, plan: true },
  workspace: {
    files: true,
    terminal: false,
    additionalRoots: true,
    mcpStdio: false,
    mcpHttp: false,
  },
  configuration: {
    models: true,
    modes: true,
    reasoningEffort: false,
    modelOptions: [
      { id: 'fixture-model', label: 'Fixture Model' },
      { id: 'fixture-model-2', label: 'Fixture Model 2' },
    ],
    modeOptions: [
      { id: 'agent', label: 'Agent', description: '执行模式' },
      { id: 'plan', label: 'Plan', description: '规划模式' },
    ],
    reasoningEffortOptions: [
      { id: 'low', label: 'Low' },
      { id: 'high', label: 'High' },
    ],
  },
  telemetry: { tokenUsage: true, cost: false },
};

export class FakeAgentAdapter implements AgentRuntimeAdapter {
  readonly kind = 'FAKE';
  private sessionCounter = 0;
  private readonly scenario: FakeAdapterScenario;
  private readonly capabilities: AgentCapabilities;
  private readonly preflightReport: PreflightReport;
  private readonly now: () => Date;
  private readonly includeExternalRunId: boolean;
  private readonly usagePayload: Record<string, unknown>;

  constructor(options: FakeAdapterOptions = {}) {
    this.scenario = options.scenario ?? 'complete';
    this.capabilities = options.capabilities ?? FAKE_AGENT_CAPABILITIES;
    this.now = options.now ?? (() => new Date());
    this.includeExternalRunId = options.includeExternalRunId ?? true;
    this.usagePayload = options.usagePayload ?? { inputTokens: 2, outputTokens: 4 };
    this.preflightReport = options.preflight ?? {
      status: 'READY',
      checkedAt: this.now().toISOString(),
      detectedVersion: 'fixture-1.0.0',
      checks: [{ id: 'fixture', label: '确定性测试适配器', status: 'PASS', message: '已就绪' }],
    };
  }

  async preflight(_profile: AgentProfile): Promise<PreflightReport> {
    return structuredClone(this.preflightReport);
  }

  async getCapabilities(_profile: AgentProfile): Promise<AgentCapabilities> {
    return structuredClone(this.capabilities);
  }

  async discoverModels(_profile: AgentProfile) {
    return [{ id: 'fixture-model', label: 'Fixture Model' }];
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSessionHandle> {
    if (!this.capabilities.sessions.create)
      throw new FakeAdapterError('CAPABILITY_UNSUPPORTED', '不支持创建 Session');
    this.sessionCounter += 1;
    return new FakeAgentSession(
      input,
      `fake-session-${this.sessionCounter}`,
      this.scenario,
      this.now,
      this.includeExternalRunId,
      this.usagePayload,
    );
  }
}

export class FakeAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FakeAdapterError';
  }
}

class FakeAgentSession implements AgentSessionHandle {
  private readonly queue = new AsyncEventQueue<NormalizedAgentEvent>();
  private seq = 0;
  private eventCounter = 0;
  private activeRunId: string | undefined;
  private pendingApprovalId: string | undefined;
  private closed = false;
  private configuration: SessionConfiguration;

  constructor(
    private readonly input: CreateAgentSessionInput,
    readonly externalSessionId: string,
    private readonly scenario: FakeAdapterScenario,
    private readonly now: () => Date,
    private readonly includeExternalRunId: boolean,
    private readonly usagePayload: Record<string, unknown>,
  ) {
    this.configuration = {
      supported: true,
      current: {
        model: input.model ?? 'fixture-model',
        mode: input.mode ?? 'agent',
        reasoningEffort: 'low',
      },
      options: {
        models: [
          { id: 'fixture-model', label: 'Fixture Model' },
          { id: 'fixture-model-2', label: 'Fixture Model 2' },
        ],
        modes: [
          { id: 'agent', label: 'Agent', description: '执行模式' },
          { id: 'plan', label: 'Plan', description: '规划模式' },
        ],
        reasoningEfforts: [
          { id: 'low', label: 'Low' },
          { id: 'high', label: 'High' },
        ],
      },
    };
    this.emit('session.created', { externalSessionId });
  }

  events(): AsyncIterable<NormalizedAgentEvent> {
    return this.queue;
  }

  async getConfiguration(): Promise<SessionConfiguration> {
    return structuredClone(this.configuration);
  }

  async setConfiguration(patch: SessionConfigurationPatch): Promise<SessionConfiguration> {
    const fields = Object.keys(patch).filter(
      (key) => patch[key as keyof SessionConfigurationPatch],
    );
    if (fields.length !== 1) {
      throw new FakeAdapterError('SESSION_CONFIGURATION_INVALID', '一次只能修改一个 Session 配置');
    }
    if (
      patch.model &&
      !this.configuration.options.models.some((option) => option.id === patch.model)
    ) {
      throw new FakeAdapterError('SESSION_MODEL_UNSUPPORTED', 'Fixture 不支持该模型');
    }
    if (
      patch.mode &&
      !this.configuration.options.modes.some((option) => option.id === patch.mode)
    ) {
      throw new FakeAdapterError('SESSION_MODE_UNSUPPORTED', 'Fixture 不支持该模式');
    }
    if (
      patch.reasoningEffort &&
      !this.configuration.options.reasoningEfforts.some(
        (option) => option.id === patch.reasoningEffort,
      )
    ) {
      throw new FakeAdapterError(
        'SESSION_REASONING_EFFORT_UNSUPPORTED',
        'Fixture 不支持该推理强度',
      );
    }
    this.configuration = {
      ...this.configuration,
      current: {
        ...this.configuration.current,
        ...(patch.model ? { model: patch.model } : {}),
        ...(patch.mode ? { mode: patch.mode } : {}),
        ...(patch.reasoningEffort ? { reasoningEffort: patch.reasoningEffort } : {}),
      },
    };
    this.emit('agent.configuration.updated', {
      current: structuredClone(this.configuration.current),
      options: structuredClone(this.configuration.options),
    });
    return structuredClone(this.configuration);
  }

  async sendTurn(input: AgentTurnInput): Promise<AgentRunRef> {
    if (this.closed) throw new FakeAdapterError('SESSION_CLOSED', 'Session 已关闭');
    if (this.activeRunId) throw new FakeAdapterError('RUN_ALREADY_ACTIVE', '当前已有运行中的 Run');
    this.activeRunId = input.runId;
    this.emit('run.started', { textLength: input.text.length }, input.runId);
    this.emit('assistant.message.delta', { text: '测试响应' }, input.runId);

    switch (this.scenario) {
      case 'complete':
        this.complete(input.runId);
        break;
      case 'approval':
        this.pendingApprovalId = `fake-approval-${input.runId}`;
        this.emit(
          'approval.requested',
          {
            approvalId: this.pendingApprovalId,
            title: '允许执行 Fixture 工具吗？',
            options: [
              { id: 'allow', label: '允许' },
              { id: 'reject', label: '拒绝' },
            ],
          },
          input.runId,
        );
        break;
      case 'fail':
        this.emit(
          'run.failed',
          { code: 'FIXTURE_FAILURE', message: 'Fixture 主动失败' },
          input.runId,
        );
        this.activeRunId = undefined;
        break;
      case 'disconnect':
        this.emit('adapter.disconnected', { recoverable: true }, input.runId);
        this.activeRunId = undefined;
        break;
      case 'idle':
        break;
    }
    return this.includeExternalRunId
      ? { runId: input.runId, externalRunId: `fake-run-${input.runId}` }
      : { runId: input.runId };
  }

  async resolveApproval(id: string, decision: ApprovalDecision): Promise<void> {
    if (!this.pendingApprovalId || id !== this.pendingApprovalId) {
      throw new FakeAdapterError('APPROVAL_NOT_PENDING', 'Approval 不存在或已经处理');
    }
    const runId = this.activeRunId;
    if (!runId) throw new FakeAdapterError('RUN_NOT_ACTIVE', 'Approval 对应的 Run 已结束');
    this.pendingApprovalId = undefined;
    this.emit('approval.resolved', { approvalId: id, optionId: decision.optionId }, runId);
    if (decision.optionId === 'reject') {
      this.emit('run.failed', { code: 'APPROVAL_REJECTED', message: '用户拒绝了请求' }, runId);
      this.activeRunId = undefined;
      return;
    }
    this.complete(runId);
  }

  async cancel(runId?: string): Promise<void> {
    if (!this.activeRunId || (runId && runId !== this.activeRunId)) {
      throw new FakeAdapterError('RUN_NOT_ACTIVE', '没有可取消的 Run');
    }
    const canceledRunId = this.activeRunId;
    this.pendingApprovalId = undefined;
    this.activeRunId = undefined;
    this.emit('run.cancelled', { reason: 'user' }, canceledRunId);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.activeRunId) await this.cancel(this.activeRunId);
    this.closed = true;
    this.emit('session.closed', {});
    this.queue.close();
  }

  private complete(runId: string): void {
    this.emit('assistant.message.completed', { text: '测试响应' }, runId);
    this.emit('usage.updated', this.usagePayload, runId);
    this.emit('run.completed', { outcome: 'success' }, runId);
    this.activeRunId = undefined;
  }

  private emit(type: AgentEventType, payload: Record<string, unknown>, runId?: string): void {
    this.seq += 1;
    this.eventCounter += 1;
    this.queue.push({
      eventId: `${this.externalSessionId}-event-${this.eventCounter}`,
      sessionId: this.input.sessionId,
      ...(runId ? { runId } : {}),
      seq: this.seq,
      emittedAt: this.now().toISOString(),
      adapterKind: 'FAKE',
      type,
      payload,
      source: { protocol: 'fixture', eventType: type },
    });
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T): void {
    if (this.ended) throw new FakeAdapterError('EVENT_QUEUE_CLOSED', '事件队列已关闭');
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
