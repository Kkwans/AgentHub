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
  type NewSessionResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionModeState,
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
  type SessionConfiguration,
  type SessionConfigurationPatch,
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
  /** session/close is best effort; transport shutdown remains authoritative. */
  sessionCloseGraceMs?: number;
}

const DEFAULT_SESSION_CLOSE_GRACE_MS = 250;

export class AcpAdapter implements AgentRuntimeAdapter {
  readonly kind = 'ACP_STDIO';
  private readonly launcher: AcpProcessLauncher;
  private readonly now: () => Date;
  private readonly sessionCloseGraceMs: number;
  private readonly capabilityCache = new Map<string, AgentCapabilities>();

  constructor(options: AcpAdapterOptions = {}) {
    this.launcher = options.launcher ?? new HostAcpProcessLauncher();
    this.now = options.now ?? (() => new Date());
    this.sessionCloseGraceMs = options.sessionCloseGraceMs ?? DEFAULT_SESSION_CLOSE_GRACE_MS;
  }

  async preflight(profile: AgentProfile): Promise<PreflightReport> {
    const checkedAt = this.now().toISOString();
    const cwd =
      typeof profile.config.preflightCwd === 'string' ? profile.config.preflightCwd : '/tmp';
    let runtime: AcpRuntime | undefined;
    try {
      runtime = await this.open(profile, cwd);
      const activeRuntime = runtime;
      const capabilities = mapAcpCapabilities(
        activeRuntime.initialize.agentCapabilities,
        profile.config,
      );
      const checks: PreflightReport['checks'] = [
        { id: 'process', label: 'ACP adapter 进程', status: 'PASS', message: '已启动' },
        {
          id: 'initialize',
          label: 'ACP initialize',
          status: 'PASS',
          message: `协议版本 ${activeRuntime.initialize.protocolVersion}`,
        },
      ];

      if (profile.config.preflightSession === true) {
        const response = await activeRuntime.agent.request(AGENT_METHODS.session_new, {
          cwd,
          mcpServers: [],
        });
        const discoveredCapabilities = mapAcpCapabilities(
          activeRuntime.initialize.agentCapabilities,
          profile.config,
          response,
        );
        this.capabilityCache.set(profile.id, discoveredCapabilities);
        checks.push({
          id: 'session',
          label: 'ACP session/new',
          status: 'PASS',
          message: '已创建测试 Session',
        });
        if (activeRuntime.initialize.agentCapabilities?.sessionCapabilities?.close) {
          await requestWithGrace(
            () =>
              activeRuntime.agent.request(AGENT_METHODS.session_close, {
                sessionId: response.sessionId,
              }),
            this.sessionCloseGraceMs,
          );
        }
      } else {
        this.capabilityCache.set(profile.id, capabilities);
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
        ...(activeRuntime.initialize.agentInfo?.version
          ? { detectedVersion: activeRuntime.initialize.agentInfo.version }
          : {}),
        checks,
      };
    } catch (error) {
      const status = preflightStatusForError(error);
      const message = preflightFailureMessage(status);
      return {
        status,
        checkedAt,
        checks: [
          {
            id: 'initialize',
            label: 'ACP initialize',
            status: 'FAIL',
            message,
          },
        ],
        repair: {
          summary: preflightRepairSummary(status, profile.config),
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
    const handle = new AcpSessionHandle(
      input.sessionId,
      runtime,
      this.now,
      this.sessionCloseGraceMs,
    );
    runtime.route.handle = handle;
    try {
      const response = await runtime.agent.request(AGENT_METHODS.session_new, {
        cwd: input.cwd,
        mcpServers: [],
        ...(input.additionalRoots?.length ? { additionalDirectories: input.additionalRoots } : {}),
      });
      handle.attach(response.sessionId, runtime.initialize.agentCapabilities, response);
      await applyRequestedSessionConfiguration(handle, input);
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

    const handle = new AcpSessionHandle(
      input.sessionId,
      runtime,
      this.now,
      this.sessionCloseGraceMs,
    );
    runtime.route.handle = handle;
    const request = {
      sessionId: input.externalSessionId,
      cwd: input.cwd,
      mcpServers: [],
      ...(input.additionalRoots?.length ? { additionalDirectories: input.additionalRoots } : {}),
    };
    try {
      const response = (await (method === 'load'
        ? runtime.agent.request(AGENT_METHODS.session_load, request)
        : runtime.agent.request(AGENT_METHODS.session_resume, request))) as Pick<
        NewSessionResponse,
        'modes' | 'configOptions'
      >;
      handle.attach(input.externalSessionId, capabilities, response);
      await applyRequestedSessionConfiguration(handle, input);
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
        clientCapabilities: {
          plan: {},
          session: { configOptions: { boolean: {} } },
        },
        clientInfo: { name: 'agenthub', title: 'AgentHub', version: '0.6.0' },
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
      let result: Awaited<ReturnType<LaunchedAcpProcess['cancel']>> | undefined;
      try {
        result = await launched.cancel();
      } catch {
        // Preserve the initialize/protocol error when process observation also fails.
      }
      if (
        result &&
        /scope upgrade pending approval|authentication required|not logged in|unauthorized/i.test(
          result.stderr,
        )
      ) {
        throw new AcpAdapterError('AUTH_REQUIRED', 'Agent 原生授权尚未完成');
      }
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
  private readonly toolCallMetadata = new Map<
    string,
    {
      kind?: string | null;
      locations?: Array<{ path: string; line?: number | null }> | null;
      title?: string | null;
      name?: string | null;
    }
  >();
  private seq = 0;
  private eventCounter = 0;
  private sessionId: string | undefined;
  private capabilities: AcpAgentCapabilities | undefined;
  private activeRunId: string | undefined;
  private messageText = '';
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private configuration: SessionConfiguration = emptySessionConfiguration();
  private modeState: SessionModeState | undefined;
  private configOptions: SessionConfigOption[] = [];
  private configurationQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly agentHubSessionId: string,
    private readonly runtime: AcpRuntime,
    private readonly now: () => Date,
    private readonly sessionCloseGraceMs: number,
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

  attach(
    sessionId: string,
    capabilities?: AcpAgentCapabilities,
    initial?: Pick<NewSessionResponse, 'modes' | 'configOptions'>,
  ): void {
    this.sessionId = sessionId;
    this.capabilities = capabilities;
    this.updateConfigurationFromAcp(initial);
    this.emit('session.created', { externalSessionId: sessionId });
  }

  events(): AsyncIterable<NormalizedAgentEvent> {
    return this.queue;
  }

  async getConfiguration(): Promise<SessionConfiguration> {
    return structuredClone(this.configuration);
  }

  setConfiguration(patch: SessionConfigurationPatch): Promise<SessionConfiguration> {
    const operation = this.configurationQueue.then(() => this.performSetConfiguration(patch));
    this.configurationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async performSetConfiguration(
    patch: SessionConfigurationPatch,
  ): Promise<SessionConfiguration> {
    const fields = Object.keys(patch).filter(
      (key) => patch[key as keyof SessionConfigurationPatch],
    );
    if (fields.length !== 1) {
      throw new AcpAdapterError('SESSION_CONFIGURATION_INVALID', '一次只能修改一个 Session 配置');
    }
    if (this.closed) throw new AcpAdapterError('SESSION_CLOSED', 'Session 已关闭');
    const sessionId = this.requireSession();

    if (patch.model) {
      const option = findConfigOption(this.configOptions, 'model', patch.model);
      if (!option) {
        throw new AcpAdapterError('SESSION_MODEL_UNSUPPORTED', `Agent 不支持模型：${patch.model}`);
      }
      const response = await this.runtime.agent.request(AGENT_METHODS.session_set_config_option, {
        sessionId,
        configId: option.id,
        value: patch.model,
      });
      this.updateConfigurationFromAcp({ configOptions: response.configOptions });
    }

    if (patch.mode) {
      const dedicatedMode = this.modeState?.availableModes.find((mode) => mode.id === patch.mode);
      if (dedicatedMode) {
        await this.runtime.agent.request(AGENT_METHODS.session_set_mode, {
          sessionId,
          modeId: patch.mode,
        });
        this.modeState = { ...this.modeState!, currentModeId: patch.mode };
        this.configuration = {
          ...this.configuration,
          current: { ...this.configuration.current, mode: patch.mode },
        };
      } else {
        const option = findConfigOption(this.configOptions, 'mode', patch.mode);
        if (!option) {
          throw new AcpAdapterError('SESSION_MODE_UNSUPPORTED', `Agent 不支持模式：${patch.mode}`);
        }
        const response = await this.runtime.agent.request(AGENT_METHODS.session_set_config_option, {
          sessionId,
          configId: option.id,
          value: patch.mode,
        });
        this.updateConfigurationFromAcp({ configOptions: response.configOptions });
      }
    }

    return structuredClone(this.configuration);
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
        const transportFailure = classifyTransportFailure(this.messageText);
        if (transportFailure) {
          this.emit(
            'run.failed',
            { code: 'AGENT_TRANSPORT_FAILED', message: transportFailure },
            runId,
          );
        } else {
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
        }
        this.activeRunId = undefined;
      })
      .catch((error: unknown) => {
        const runId = this.activeRunId;
        if (runId) {
          // codex-acp can keep its stdio wrapper alive after the bundled
          // Codex app-server child exits. In that case the prompt request
          // rejects with a closed JSON-RPC connection, but the process-level
          // wait hook never fires. Surface a normalized disconnect so the
          // Session becomes recoverable instead of returning to READY with a
          // dead activation.
          if (isConnectionFailure(error)) {
            this.emit(
              'adapter.disconnected',
              { reason: 'prompt_transport', code: 'ACP_PROMPT_FAILED' },
              runId,
            );
          } else {
            this.emit(
              'run.failed',
              { code: 'ACP_PROMPT_FAILED', message: safeErrorMessage(error) },
              runId,
            );
          }
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
    if (this.closed) throw new AcpAdapterError('SESSION_CLOSED', 'Session 已关闭');
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

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = this.performClose();
    return this.closePromise;
  }

  private async performClose(): Promise<void> {
    for (const pending of this.approvals.values()) {
      pending.resolve({ outcome: { outcome: 'cancelled' } });
    }
    this.approvals.clear();
    try {
      const sessionId = this.sessionId;
      if (sessionId && this.capabilities?.sessionCapabilities?.close) {
        await requestWithGrace(
          () => this.runtime.agent.request(AGENT_METHODS.session_close, { sessionId }),
          this.sessionCloseGraceMs,
        );
      }
    } finally {
      this.emit('session.closed', {});
      try {
        this.runtime.connection.close();
      } catch {
        // Transport shutdown is best effort; process cancellation remains authoritative.
      }
      try {
        await this.runtime.process.cancel();
      } catch {
        // A process termination timeout is reported by the supervisor; the queue still closes.
      } finally {
        this.queue.close();
      }
    }
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
    const update = this.enrichToolCallUpdate(notification.update);
    const updates = normalizeAcpSessionUpdate(update);
    for (const update of updates) {
      if (update.type === 'assistant.message.delta' && typeof update.payload.text === 'string') {
        this.messageText += update.payload.text;
      }
      if (update.type === 'agent.configuration.updated') {
        this.applyConfigurationEventPayload(update.payload);
      }
      this.emit(update.type, update.payload, this.activeRunId, update.sourceEventType);
    }
  }

  private applyConfigurationEventPayload(payload: Record<string, unknown>): void {
    const current = isRecord(payload.current) ? payload.current : {};
    const options = isRecord(payload.options) ? payload.options : {};
    const models = readModelOptions(options.models);
    const modes = readModelOptions(options.modes);
    this.configuration = {
      ...this.configuration,
      current: {
        ...this.configuration.current,
        ...(typeof current.model === 'string' ? { model: current.model } : {}),
        ...(typeof current.mode === 'string' ? { mode: current.mode } : {}),
      },
      options: {
        models: models.length ? models : this.configuration.options.models,
        modes: modes.length ? modes : this.configuration.options.modes,
      },
    };
  }

  private updateConfigurationFromAcp(
    session?: Pick<NewSessionResponse, 'modes' | 'configOptions'>,
  ): void {
    if (session?.modes) this.modeState = session.modes;
    if (session?.configOptions) this.configOptions = session.configOptions;
    const next = configurationFromAcp({
      ...(this.modeState ? { modes: this.modeState } : {}),
      configOptions: this.configOptions,
    });
    this.configuration = mergeSessionConfiguration(this.configuration, next);
  }

  private enrichToolCallUpdate(
    update: SessionNotification['update'],
  ): SessionNotification['update'] {
    if (update.sessionUpdate === 'tool_call') {
      this.toolCallMetadata.set(update.toolCallId, {
        ...(update.kind !== undefined ? { kind: update.kind } : {}),
        ...(update.locations !== undefined ? { locations: update.locations } : {}),
        ...(update.title !== undefined ? { title: update.title } : {}),
        ...(update.name !== undefined ? { name: update.name } : {}),
      });
      return update;
    }
    if (update.sessionUpdate !== 'tool_call_update') return update;

    const previous = this.toolCallMetadata.get(update.toolCallId);
    if (!previous) return update;
    const enriched = {
      ...update,
      ...(update.kind === undefined && previous.kind !== undefined ? { kind: previous.kind } : {}),
      ...(update.locations === undefined && previous.locations !== undefined
        ? { locations: previous.locations }
        : {}),
      ...(update.title === undefined && previous.title !== undefined
        ? { title: previous.title }
        : {}),
      ...(update.name === undefined && previous.name !== undefined ? { name: previous.name } : {}),
    } as SessionNotification['update'];
    this.toolCallMetadata.set(update.toolCallId, {
      ...previous,
      ...(update.kind !== undefined ? { kind: update.kind } : {}),
      ...(update.locations !== undefined ? { locations: update.locations } : {}),
      ...(update.title !== undefined ? { title: update.title } : {}),
      ...(update.name !== undefined ? { name: update.name } : {}),
    });
    if (update.status === 'completed' || update.status === 'failed') {
      this.toolCallMetadata.delete(update.toolCallId);
    }
    return enriched;
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
  session?: Pick<NewSessionResponse, 'modes' | 'configOptions'>,
): AgentCapabilities {
  const modeOptions = session?.modes?.availableModes.map((mode) => ({
    id: mode.id,
    label: mode.name,
    ...(mode.description ? { description: mode.description } : {}),
  }));
  const modelOptions = configOptionsForCategory(session?.configOptions, 'model');
  const reasoningEffortOptions = configOptionsForCategory(session?.configOptions, 'thought_level');
  const configuration: AgentCapabilities['configuration'] = {
    models: Boolean(hints.models) || modelOptions.length > 0,
    modes: Boolean(hints.modes) || (modeOptions?.length ?? 0) > 0,
    reasoningEffort: Boolean(hints.reasoningEffort) || reasoningEffortOptions.length > 0,
    ...(modelOptions.length ? { modelOptions } : {}),
    ...(modeOptions?.length ? { modeOptions } : {}),
    ...(reasoningEffortOptions.length ? { reasoningEffortOptions } : {}),
  };
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
    configuration,
    telemetry: { tokenUsage: true, cost: Boolean(hints.cost) },
  };
}

async function applyRequestedSessionConfiguration(
  handle: AcpSessionHandle,
  input: CreateAgentSessionInput,
): Promise<void> {
  if (input.model) await handle.setConfiguration?.({ model: input.model });
  if (input.mode) await handle.setConfiguration?.({ mode: input.mode });
}

function emptySessionConfiguration(): SessionConfiguration {
  return {
    supported: false,
    current: { model: null, mode: null },
    options: { models: [], modes: [] },
  };
}

function configurationFromAcp(input: {
  modes?: SessionModeState;
  configOptions?: SessionConfigOption[];
}): SessionConfiguration {
  const models = configOptionsForCategory(input.configOptions, 'model');
  const modeOptions = input.modes?.availableModes.map((mode) => ({
    id: mode.id,
    label: mode.name,
    ...(mode.description ? { description: mode.description } : {}),
  }));
  const modes = modeOptions?.length
    ? modeOptions
    : configOptionsForCategory(input.configOptions, 'mode');
  const modelValue = currentConfigValue(input.configOptions, 'model');
  const modeValue = input.modes?.currentModeId ?? currentConfigValue(input.configOptions, 'mode');
  return {
    supported: models.length > 0 || modes.length > 0,
    current: { model: modelValue, mode: modeValue },
    options: { models, modes },
  };
}

function mergeSessionConfiguration(
  previous: SessionConfiguration,
  next: SessionConfiguration,
): SessionConfiguration {
  const hasModels = next.options.models.length > 0;
  const hasModes = next.options.modes.length > 0;
  return {
    supported: previous.supported || next.supported,
    current: {
      model: hasModels ? next.current.model : previous.current.model,
      mode: hasModes ? next.current.mode : previous.current.mode,
    },
    options: {
      models: hasModels ? next.options.models : previous.options.models,
      modes: hasModes ? next.options.modes : previous.options.modes,
    },
    ...(previous.reasonCode || next.reasonCode
      ? { reasonCode: next.reasonCode ?? previous.reasonCode }
      : {}),
  };
}

function currentConfigValue(
  options: SessionConfigOption[] | undefined,
  category: string,
): string | null {
  const option = options?.find(
    (candidate): candidate is Extract<SessionConfigOption, { type: 'select' }> =>
      candidate.type === 'select' && candidate.category === category,
  );
  return option?.currentValue ?? null;
}

function readModelOptions(
  value: unknown,
): Array<{ id: string; label: string; description?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== 'string') return [];
    return [
      {
        id: candidate.id,
        label: typeof candidate.label === 'string' ? candidate.label : candidate.id,
        ...(typeof candidate.description === 'string'
          ? { description: candidate.description }
          : {}),
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findConfigOption(
  options: SessionConfigOption[] | null | undefined,
  category: string,
  value: string,
): Extract<SessionConfigOption, { type: 'select' }> | undefined {
  return options?.find(
    (option): option is Extract<SessionConfigOption, { type: 'select' }> =>
      option.type === 'select' &&
      option.category === category &&
      flattenSelectOptions(option.options).some((candidate) => candidate.value === value),
  );
}

function configOptionsForCategory(
  options: SessionConfigOption[] | null | undefined,
  category: string,
): Array<{ id: string; label: string; description?: string }> {
  const option = options?.find(
    (candidate): candidate is Extract<SessionConfigOption, { type: 'select' }> =>
      candidate.type === 'select' && candidate.category === category,
  );
  if (!option) return [];
  return flattenSelectOptions(option.options).map((candidate) => ({
    id: candidate.value,
    label: candidate.name,
    ...(candidate.description ? { description: candidate.description } : {}),
  }));
}

function flattenSelectOptions(
  options: Extract<SessionConfigOption, { type: 'select' }>['options'],
): Array<{ value: string; name: string; description?: string | null }> {
  return options.flatMap((option) => ('value' in option ? [option] : option.options));
}

async function closeRuntime(runtime: AcpRuntime): Promise<void> {
  try {
    runtime.connection.close();
  } finally {
    try {
      await runtime.process.cancel();
    } catch {
      // Preserve the original ACP operation error while still attempting cleanup.
    }
  }
}

async function requestWithGrace<T>(
  request: () => Promise<T>,
  graceMs: number,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | number | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(request)
        .catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(resolve, graceMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof AcpAdapterError ? error.message : 'ACP 请求失败';
}

function isConnectionFailure(error: unknown): boolean {
  const code = errorCode(error);
  if (code && ['CONNECTION_CLOSED', 'ECONNRESET', 'EPIPE'].includes(code)) return true;
  const message = error instanceof Error ? error.message : '';
  return /connection (?:closed|reset)|broken pipe|econnreset|epipe|not connected|socket closed/i.test(
    message,
  );
}

function classifyTransportFailure(text: string): string | undefined {
  if (
    !/falling back from websockets|stream disconnected before completion|error sending request for url|failed to save the conversation transcript/i.test(
      text,
    )
  ) {
    return undefined;
  }
  return text
    .replace(/https?:\/\/\S+/gi, '[已隐藏地址]')
    .trim()
    .slice(0, 2_000);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function preflightStatusForError(error: unknown): PreflightReport['status'] {
  const code = errorCode(error);
  if (code === 'EXECUTABLE_MISSING') return 'MISSING';
  if (code === 'TARGET_STOPPED') return 'STOPPED';
  if (code === 'WORKSPACE_UNMAPPED') return 'WORKSPACE_UNMAPPED';
  if (code === 'CONTAINER_REPLACED') return 'CONTAINER_REPLACED';
  if (code === 'ACP_PROTOCOL_UNSUPPORTED') return 'UNSUPPORTED_VERSION';
  if (code === 'AUTH_REQUIRED') return 'AUTH_REQUIRED';
  const message = error instanceof Error ? error.message : '';
  if (/auth|required|login|not logged in|unauthorized/i.test(message)) return 'AUTH_REQUIRED';
  return 'BROKEN';
}

function preflightFailureMessage(status: PreflightReport['status']): string {
  const messages: Partial<Record<PreflightReport['status'], string>> = {
    MISSING: 'Agent executable 不存在或不可执行',
    STOPPED: 'Agent 所在容器已停止',
    WORKSPACE_UNMAPPED: '当前 Project 路径未映射到 Agent 容器',
    CONTAINER_REPLACED: '容器名称或 ID 已变化',
    UNSUPPORTED_VERSION: 'Agent 返回了当前不支持的 ACP 版本',
    AUTH_REQUIRED: 'Agent 需要先完成原生授权或登录',
  };
  return messages[status] ?? 'ACP adapter 无法完成初始化';
}

function preflightRepairSummary(
  status: PreflightReport['status'],
  config: Record<string, unknown>,
): string {
  const summaries: Partial<Record<PreflightReport['status'], string>> = {
    MISSING: '请安装或修复已固定版本的 Agent adapter 后重试',
    STOPPED: '请在 Execution Target 页面手动启动容器，或为该 Profile 开启 ON_DEMAND',
    WORKSPACE_UNMAPPED: '请为该容器配置覆盖当前 Project 的只读核验 workspace mapping',
    CONTAINER_REPLACED: '请核对新容器身份并显式重新注册，不会自动接管同名容器',
    UNSUPPORTED_VERSION: '请使用与 AgentHub 锁定的 ACP v1 兼容 adapter',
    AUTH_REQUIRED: '请使用供应商原生流程完成授权或登录后重试',
  };
  if (status === 'BROKEN' && typeof config.expectedPackage === 'string') {
    const version = typeof config.expectedVersion === 'string' ? `@${config.expectedVersion}` : '';
    return `请在容器镜像中固定安装 ${config.expectedPackage}${version} 后重试；AgentHub 不会临时运行 npx latest`;
  }
  return summaries[status] ?? '请检查 pinned adapter、Agent executable 与运行日志';
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
