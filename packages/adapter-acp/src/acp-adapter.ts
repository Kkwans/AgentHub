import { Readable, Writable } from 'node:stream';

import {
  AGENT_METHODS,
  CLIENT_METHODS,
  PROTOCOL_VERSION,
  client,
  ndJsonStream,
  type AgentCapabilities as AcpAgentCapabilities,
  type ClientConnection,
  type ClientContext,
  type InitializeResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
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
  type ResumeAgentSessionInput,
} from '@agenthub/agent-core';

import { normalizeAcpSessionUpdate } from './normalization.js';
import {
  HostAcpProcessLauncher,
  type AcpProcessLauncher,
  type LaunchedAcpProcess,
} from './process-launcher.js';

interface RouteTarget {
  handle?: AcpSessionHandle;
}

interface AcpRuntime {
  process: LaunchedAcpProcess;
  connection: ClientConnection;
  agent: ClientContext;
  initialize: InitializeResponse;
  route: RouteTarget;
}

export interface AcpAdapterOptions {
  launcher?: AcpProcessLauncher;
  now?: () => Date;
}

export class AcpAdapter implements AgentRuntimeAdapter {
  readonly kind = 'ACP_STDIO';
  private readonly launcher: AcpProcessLauncher;
  private readonly now: () => Date;
  private readonly capabilityCache = new Map<string, AgentCapabilities>();

  constructor(options: AcpAdapterOptions = {}) {
    this.launcher = options.launcher ?? new HostAcpProcessLauncher();
    this.now = options.now ?? (() => new Date());
  }

  async preflight(profile: AgentProfile): Promise<PreflightReport> {
    const checkedAt = this.now().toISOString();
    const cwd =
      typeof profile.config.preflightCwd === 'string' ? profile.config.preflightCwd : '/tmp';
    let runtime: AcpRuntime | undefined;
    try {
      runtime = await this.open(profile, cwd);
      const capabilities = mapAcpCapabilities(runtime.initialize.agentCapabilities, profile.config);
      this.capabilityCache.set(profile.id, capabilities);
      const checks: PreflightReport['checks'] = [
        { id: 'process', label: 'ACP adapter 进程', status: 'PASS', message: '已启动' },
        {
          id: 'initialize',
          label: 'ACP initialize',
          status: 'PASS',
          message: `协议版本 ${runtime.initialize.protocolVersion}`,
        },
      ];

      if (profile.config.preflightSession === true) {
        const response = await runtime.agent.request(AGENT_METHODS.session_new, {
          cwd,
          mcpServers: [],
        });
        checks.push({
          id: 'session',
          label: 'ACP session/new',
          status: 'PASS',
          message: '已创建测试 Session',
        });
        if (runtime.initialize.agentCapabilities?.sessionCapabilities?.close) {
          await runtime.agent.request(AGENT_METHODS.session_close, {
            sessionId: response.sessionId,
          });
        }
      } else {
        checks.push({
          id: 'session',
          label: 'ACP session/new',
          status: 'SKIP',
          message: 'Profile 未启用 preflight Session smoke',
        });
      }

      return {
        status: 'READY',
        checkedAt,
        ...(runtime.initialize.agentInfo?.version
          ? { detectedVersion: runtime.initialize.agentInfo.version }
          : {}),
        checks,
      };
    } catch (error) {
      const authRequired = /auth|required|login/i.test(error instanceof Error ? error.message : '');
      return {
        status: authRequired ? 'AUTH_REQUIRED' : 'BROKEN',
        checkedAt,
        checks: [
          {
            id: 'initialize',
            label: 'ACP initialize',
            status: 'FAIL',
            message: authRequired ? 'Agent 需要先完成原生登录' : 'ACP adapter 无法完成初始化',
          },
        ],
        repair: {
          summary: authRequired
            ? '请使用供应商原生命令完成登录后重试'
            : '请检查 pinned adapter、Agent executable 与运行日志',
        },
      };
    } finally {
      if (runtime) await closeRuntime(runtime);
    }
  }

  async getCapabilities(profile: AgentProfile): Promise<AgentCapabilities> {
    const cached = this.capabilityCache.get(profile.id);
    if (cached) return structuredClone(cached);
    const report = await this.preflight(profile);
    if (report.status !== 'READY') return structuredClone(NO_AGENT_CAPABILITIES);
    return structuredClone(this.capabilityCache.get(profile.id) ?? NO_AGENT_CAPABILITIES);
  }

  async createSession(input: CreateAgentSessionInput): Promise<AgentSessionHandle> {
    const runtime = await this.open(input.profile, input.cwd);
    const handle = new AcpSessionHandle(input.sessionId, runtime, this.now);
    runtime.route.handle = handle;
    try {
      const response = await runtime.agent.request(AGENT_METHODS.session_new, {
        cwd: input.cwd,
        mcpServers: [],
        ...(input.additionalRoots?.length ? { additionalDirectories: input.additionalRoots } : {}),
      });
      handle.attach(response.sessionId, runtime.initialize.agentCapabilities);
      if (input.mode && response.modes?.availableModes.some((mode) => mode.id === input.mode)) {
        await runtime.agent.request(AGENT_METHODS.session_set_mode, {
          sessionId: response.sessionId,
          modeId: input.mode,
        });
      }
      return handle;
    } catch (error) {
      await closeRuntime(runtime);
      throw error;
    }
  }

  async loadSession(input: LoadAgentSessionInput): Promise<AgentSessionHandle> {
    return this.restoreSession(input, 'load');
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionHandle> {
    return this.restoreSession(input, 'resume');
  }

  private async restoreSession(
    input: LoadAgentSessionInput | ResumeAgentSessionInput,
    method: 'load' | 'resume',
  ): Promise<AgentSessionHandle> {
    const runtime = await this.open(input.profile, input.cwd);
    const capabilities = runtime.initialize.agentCapabilities;
    if (method === 'load' && !capabilities?.loadSession) {
      await closeRuntime(runtime);
      throw new AcpAdapterError('CAPABILITY_UNSUPPORTED', 'Agent 不支持 session/load');
    }
    if (method === 'resume' && !capabilities?.sessionCapabilities?.resume) {
      await closeRuntime(runtime);
      throw new AcpAdapterError('CAPABILITY_UNSUPPORTED', 'Agent 不支持 session/resume');
    }

    const handle = new AcpSessionHandle(input.sessionId, runtime, this.now);
    runtime.route.handle = handle;
    const request = {
      sessionId: input.externalSessionId,
      cwd: input.cwd,
      mcpServers: [],
      ...(input.additionalRoots?.length ? { additionalDirectories: input.additionalRoots } : {}),
    };
    try {
      if (method === 'load') await runtime.agent.request(AGENT_METHODS.session_load, request);
      else await runtime.agent.request(AGENT_METHODS.session_resume, request);
      handle.attach(input.externalSessionId, capabilities);
      return handle;
    } catch (error) {
      await closeRuntime(runtime);
      throw error;
    }
  }

  private async open(profile: AgentProfile, cwd: string): Promise<AcpRuntime> {
    const launched = await this.launcher.launch(profile, cwd);
    const route: RouteTarget = {};
    const app = client({ name: 'AgentHub' })
      .onRequest(CLIENT_METHODS.session_request_permission, (context) => {
        if (!route.handle) return { outcome: { outcome: 'cancelled' } };
        return route.handle.onPermission(String(context.requestId), context.params);
      })
      .onNotification(CLIENT_METHODS.session_update, (context) => {
        route.handle?.onSessionUpdate(context.params);
      });
    const stream = ndJsonStream(
      Writable.toWeb(launched.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(launched.stdout) as ReadableStream<Uint8Array>,
    );
    const connection = app.connect(stream);
    try {
      const initialize = await connection.agent.request(AGENT_METHODS.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { plan: {} },
        clientInfo: { name: 'agenthub', title: 'AgentHub', version: '0.1.0' },
      });
      if (initialize.protocolVersion !== PROTOCOL_VERSION) {
        throw new AcpAdapterError(
          'ACP_PROTOCOL_UNSUPPORTED',
          `Agent 返回 ACP v${initialize.protocolVersion}，当前仅支持 v${PROTOCOL_VERSION}`,
        );
      }
      return { process: launched, connection, agent: connection.agent, initialize, route };
    } catch (error) {
      connection.close(error);
      await launched.cancel();
      throw error;
    }
  }
}

class AcpSessionHandle implements AgentSessionHandle {
  private readonly queue = new AsyncEventQueue<NormalizedAgentEvent>();
  private readonly approvals = new Map<
    string,
    {
      options: Set<string>;
      resolve: (response: RequestPermissionResponse) => void;
    }
  >();
  private seq = 0;
  private eventCounter = 0;
  private sessionId: string | undefined;
  private capabilities: AcpAgentCapabilities | undefined;
  private activeRunId: string | undefined;
  private messageText = '';
  private closed = false;

  constructor(
    private readonly agentHubSessionId: string,
    private readonly runtime: AcpRuntime,
    private readonly now: () => Date,
  ) {
    void runtime.process.wait().then(
      (result) => {
        if (!this.closed && !result.canceled) {
          this.emit('adapter.disconnected', { exitCode: result.exitCode, signal: result.signal });
        }
      },
      () => {
        if (!this.closed) this.emit('adapter.disconnected', { reason: 'process_error' });
      },
    );
  }

  get externalSessionId(): string | undefined {
    return this.sessionId;
  }

  attach(sessionId: string, capabilities?: AcpAgentCapabilities): void {
    this.sessionId = sessionId;
    this.capabilities = capabilities;
    this.emit('session.created', { externalSessionId: sessionId });
  }

  events(): AsyncIterable<NormalizedAgentEvent> {
    return this.queue;
  }

  async sendTurn(input: AgentTurnInput): Promise<AgentRunRef> {
    const sessionId = this.requireSession();
    if (this.closed) throw new AcpAdapterError('SESSION_CLOSED', 'Session 已关闭');
    if (this.activeRunId) throw new AcpAdapterError('RUN_ALREADY_ACTIVE', '当前已有运行中的 Run');
    this.activeRunId = input.runId;
    this.messageText = '';
    this.emit('run.started', {}, input.runId);

    void this.runtime.agent
      .request(AGENT_METHODS.session_prompt, {
        sessionId,
        prompt: [{ type: 'text', text: input.text }],
      })
      .then((response) => {
        const runId = this.activeRunId;
        if (!runId) return;
        if (this.messageText) {
          this.emit('assistant.message.completed', { text: this.messageText }, runId);
        }
        if (response.usage) {
          this.emit(
            'usage.updated',
            {
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              totalTokens: response.usage.totalTokens,
            },
            runId,
          );
        }
        if (response.stopReason === 'cancelled') {
          this.emit('run.cancelled', { stopReason: response.stopReason }, runId);
        } else if (response.stopReason === 'refusal') {
          this.emit(
            'run.failed',
            { code: 'AGENT_REFUSED', stopReason: response.stopReason },
            runId,
          );
        } else {
          this.emit('run.completed', { stopReason: response.stopReason }, runId);
        }
        this.activeRunId = undefined;
      })
      .catch((error: unknown) => {
        const runId = this.activeRunId;
        if (runId) {
          this.emit(
            'run.failed',
            { code: 'ACP_PROMPT_FAILED', message: safeErrorMessage(error) },
            runId,
          );
          this.activeRunId = undefined;
        }
      });
    return { runId: input.runId };
  }

  async resolveApproval(id: string, decision: ApprovalDecision): Promise<void> {
    const pending = this.approvals.get(id);
    if (!pending) throw new AcpAdapterError('APPROVAL_NOT_PENDING', 'Approval 不存在或已经处理');
    if (!pending.options.has(decision.optionId)) {
      throw new AcpAdapterError(
        'APPROVAL_OPTION_INVALID',
        'Approval 选项不是 Agent 提供的合法选项',
      );
    }
    this.approvals.delete(id);
    pending.resolve({ outcome: { outcome: 'selected', optionId: decision.optionId } });
    this.emit(
      'approval.resolved',
      { approvalId: id, optionId: decision.optionId },
      this.activeRunId,
    );
  }

  async cancel(runId?: string): Promise<void> {
    if (!this.activeRunId || (runId && runId !== this.activeRunId)) {
      throw new AcpAdapterError('RUN_NOT_ACTIVE', '没有可取消的 Run');
    }
    for (const [approvalId, pending] of this.approvals) {
      pending.resolve({ outcome: { outcome: 'cancelled' } });
      this.approvals.delete(approvalId);
    }
    await this.runtime.agent.notify(AGENT_METHODS.session_cancel, {
      sessionId: this.requireSession(),
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.approvals.values()) {
      pending.resolve({ outcome: { outcome: 'cancelled' } });
    }
    this.approvals.clear();
    const sessionId = this.sessionId;
    if (sessionId && this.capabilities?.sessionCapabilities?.close) {
      try {
        await this.runtime.agent.request(AGENT_METHODS.session_close, { sessionId });
      } catch {
        // Connection shutdown below remains authoritative.
      }
    }
    this.emit('session.closed', {});
    this.runtime.connection.close();
    await this.runtime.process.cancel();
    this.queue.close();
  }

  onPermission(requestId: string, request: RequestPermissionRequest) {
    const approvalId = `acp:${requestId}`;
    return new Promise<RequestPermissionResponse>((resolve) => {
      this.approvals.set(approvalId, {
        options: new Set(request.options.map((option) => option.optionId)),
        resolve,
      });
      this.emit(
        'approval.requested',
        {
          approvalId,
          externalId: requestId,
          toolCallId: request.toolCall.toolCallId,
          title: request.toolCall.title ?? 'Agent 请求权限',
          options: request.options.map((option) => ({
            id: option.optionId,
            label: option.name,
            kind: option.kind,
          })),
        },
        this.activeRunId,
      );
    });
  }

  onSessionUpdate(notification: SessionNotification): void {
    if (this.sessionId && notification.sessionId !== this.sessionId) return;
    const updates = normalizeAcpSessionUpdate(notification.update);
    for (const update of updates) {
      if (update.type === 'assistant.message.delta' && typeof update.payload.text === 'string') {
        this.messageText += update.payload.text;
      }
      this.emit(update.type, update.payload, this.activeRunId, update.sourceEventType);
    }
  }

  private requireSession(): string {
    if (!this.sessionId)
      throw new AcpAdapterError('SESSION_NOT_INITIALIZED', 'ACP Session 尚未初始化');
    return this.sessionId;
  }

  private emit(
    type: NormalizedAgentEvent['type'],
    payload: Record<string, unknown>,
    runId?: string,
    sourceEventType?: string,
  ): void {
    this.seq += 1;
    this.eventCounter += 1;
    this.queue.push({
      eventId: `${this.agentHubSessionId}-acp-${this.eventCounter}`,
      sessionId: this.agentHubSessionId,
      ...(runId ? { runId } : {}),
      seq: this.seq,
      emittedAt: this.now().toISOString(),
      adapterKind: 'ACP_STDIO',
      type,
      payload,
      source: { protocol: 'acp-v1', ...(sourceEventType ? { eventType: sourceEventType } : {}) },
    });
  }
}

export class AcpAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AcpAdapterError';
  }
}

export function mapAcpCapabilities(
  capabilities: AcpAgentCapabilities | undefined,
  hints: Record<string, unknown> = {},
): AgentCapabilities {
  return {
    sessions: {
      create: true,
      load: Boolean(capabilities?.loadSession),
      resume: Boolean(capabilities?.sessionCapabilities?.resume),
      close: Boolean(capabilities?.sessionCapabilities?.close),
    },
    prompts: {
      text: true,
      images: Boolean(capabilities?.promptCapabilities?.image),
      resources: true,
    },
    interaction: {
      streaming: true,
      approvals: true,
      questions: Boolean(hints.questions),
      plan: true,
    },
    workspace: {
      files: hints.files !== false,
      terminal: Boolean(hints.terminal),
      additionalRoots: Boolean(capabilities?.sessionCapabilities?.additionalDirectories),
      mcpStdio: Boolean(hints.mcpStdio),
      mcpHttp: Boolean(capabilities?.mcpCapabilities?.http),
    },
    configuration: {
      models: Boolean(hints.models),
      modes: Boolean(hints.modes),
      reasoningEffort: Boolean(hints.reasoningEffort),
    },
    telemetry: { tokenUsage: true, cost: Boolean(hints.cost) },
  };
}

async function closeRuntime(runtime: AcpRuntime): Promise<void> {
  runtime.connection.close();
  await runtime.process.cancel();
}

function safeErrorMessage(error: unknown): string {
  return error instanceof AcpAdapterError ? error.message : 'ACP 请求失败';
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T): void {
    if (this.ended) return;
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
