import { createHash, randomUUID } from 'node:crypto';

import type {
  AgentRuntimeAdapter,
  AgentSessionHandle,
  NormalizedAgentEvent,
  RunStatus,
  SessionStatus,
} from '@agenthub/agent-core';
import { runProcess } from '@agenthub/agent-core';
import type {
  AgentHubDatabase,
  ApprovalRepository,
  EventRepository,
  MessageRepository,
  ProjectRepository,
  RunRepository,
  SessionRepository,
} from '@agenthub/db';

import type { AgentService } from '../agents/agent-service.js';
import { AppError } from '../errors.js';

export interface SessionEventPublisher {
  publish(topic: string, event: Record<string, unknown>): void;
}

export interface GitHeadProbe {
  readHead(cwd: string): Promise<string | undefined>;
  capture?(
    runId: string,
    projectId: string,
    cwd: string,
    type: 'BEFORE' | 'AFTER' | 'REVIEW',
  ): Promise<unknown>;
}

export interface CreateSessionInput {
  projectId: string;
  agentId: string;
  title: string;
  cwd: string;
  branch?: string | undefined;
  model?: string | undefined;
  mode?: string | undefined;
  taskId?: string | undefined;
}

export interface StartRunInput {
  text: string;
  content?: Array<Record<string, unknown>> | undefined;
  promptVariables?: Record<string, unknown> | undefined;
}

export interface PromptContextResolver {
  resolveForRun(input: {
    projectId: string;
    agentId: string;
    taskId?: string | null;
    variables?: Record<string, unknown>;
  }): Promise<{
    ready: boolean;
    finalContext: string;
    missingVariables: string[];
    items: Array<{
      promptId: string;
      versionId: string;
      version: number;
      label: string | null;
      contentHash: string;
      bindingId: string;
      slot: string;
      targetType: string;
      targetId: string;
    }>;
  }>;
}

export interface TaskRunLifecycleObserver {
  onRunCompleted(taskId: string, runId: string): Promise<void>;
  onRunStopped?(taskId: string, runId: string, reason: 'FAILED' | 'CANCELED'): Promise<void>;
}

interface ActiveSession {
  handle: AgentSessionHandle;
  adapter: AgentRuntimeAdapter;
  projectId: string;
  consumer: Promise<void>;
}

export class SessionService {
  private readonly active = new Map<string, ActiveSession>();
  private taskLifecycle?: TaskRunLifecycleObserver;

  constructor(
    private readonly sessions: SessionRepository<AgentHubDatabase>,
    private readonly runs: RunRepository<AgentHubDatabase>,
    private readonly messages: MessageRepository<AgentHubDatabase>,
    private readonly events: EventRepository<AgentHubDatabase>,
    private readonly approvals: ApprovalRepository<AgentHubDatabase>,
    private readonly projects: ProjectRepository<AgentHubDatabase>,
    private readonly agentService: AgentService,
    private readonly publisher: SessionEventPublisher,
    private readonly git: GitHeadProbe = new HostGitHeadProbe(),
    private readonly promptContext?: PromptContextResolver,
  ) {}

  setTaskLifecycleObserver(observer: TaskRunLifecycleObserver): void {
    this.taskLifecycle = observer;
  }

  list(projectId?: string) {
    return this.sessions.list(projectId);
  }

  async get(id: string) {
    const session = await this.sessions.get(id);
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session 不存在');
    return session;
  }

  listMessages(sessionId: string) {
    return this.messages.list(sessionId);
  }

  listRuns(sessionId: string) {
    return this.runs.list(sessionId);
  }

  listApprovals(sessionId?: string) {
    return this.approvals.listPending(sessionId);
  }

  async create(input: CreateSessionInput) {
    const project = await this.projects.get(input.projectId);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project 不存在');
    const { profile, adapter } = await this.agentService.resolveRuntime(input.agentId, input.cwd);
    const id = randomUUID();
    await this.sessions.create({
      id,
      projectId: input.projectId,
      agentId: input.agentId,
      taskId: input.taskId,
      title: input.title,
      cwd: input.cwd,
      branch: input.branch,
      status: 'CREATED',
      model: input.model,
      mode: input.mode,
    });
    await this.sessions.transition(id, 'STARTING');

    try {
      const handle = await adapter.createSession({
        sessionId: id,
        profile,
        projectId: input.projectId,
        cwd: input.cwd,
        ...(input.model ? { model: input.model } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
      });
      const ready = await this.sessions.transition(id, 'READY', {
        externalSessionId: handle.externalSessionId,
        startedAt: new Date(),
      });
      this.activate(id, input.projectId, adapter, handle);
      return ready;
    } catch (error) {
      await this.sessions.transition(id, 'FAILED');
      throw new AppError(502, 'AGENT_SESSION_CREATE_FAILED', 'Agent Session 创建失败', undefined, {
        cause: error,
      });
    }
  }

  async resume(id: string) {
    const session = await this.get(id);
    if (session.status !== 'DISCONNECTED') {
      throw new AppError(409, 'SESSION_NOT_DISCONNECTED', '只有断开连接的 Session 可以恢复');
    }
    if (!session.externalSessionId) {
      throw new AppError(409, 'SESSION_NOT_RESUMABLE', '该 Session 没有可恢复的外部标识');
    }
    const { profile, adapter } = await this.agentService.resolveRuntime(
      session.agentId,
      session.cwd,
    );
    try {
      const base = {
        sessionId: session.id,
        profile,
        projectId: session.projectId,
        cwd: session.cwd,
        externalSessionId: session.externalSessionId,
        ...(session.model ? { model: session.model } : {}),
        ...(session.mode ? { mode: session.mode } : {}),
      };
      const handle = adapter.resumeSession
        ? await adapter.resumeSession(base)
        : adapter.loadSession
          ? await adapter.loadSession(base)
          : undefined;
      if (!handle) throw new AppError(409, 'SESSION_NOT_RESUMABLE', '该 Agent 不支持恢复 Session');
      const ready = await this.sessions.transition(id, 'READY');
      this.activate(id, session.projectId, adapter, handle);
      return ready;
    } catch (error) {
      if (error instanceof AppError) throw error;
      await this.sessions.transition(id, 'FAILED');
      throw new AppError(502, 'AGENT_SESSION_RESUME_FAILED', 'Agent Session 恢复失败', undefined, {
        cause: error,
      });
    }
  }

  async startRun(sessionId: string, input: StartRunInput) {
    const session = await this.get(sessionId);
    if (session.status !== 'READY') {
      throw new AppError(409, 'SESSION_NOT_READY', 'Session 当前不能启动新的 Run');
    }
    const active = this.active.get(sessionId);
    if (!active) throw new AppError(409, 'SESSION_NOT_CONNECTED', 'Session 尚未连接或需要恢复');

    const runId = randomUUID();
    const promptContext = this.promptContext
      ? await this.promptContext.resolveForRun({
          projectId: session.projectId,
          agentId: session.agentId,
          taskId: session.taskId,
          variables: input.promptVariables ?? {},
        })
      : undefined;
    if (promptContext && !promptContext.ready) {
      throw new AppError(409, 'PROMPT_VARIABLES_MISSING', 'PromptOS 缺少必填变量', {
        missingVariables: promptContext.missingVariables,
      });
    }
    const gitBeforeSha = await this.git.readHead(session.cwd);
    await this.runs.create({
      id: runId,
      sessionId,
      taskId: session.taskId,
      status: 'QUEUED',
      model: session.model,
      mode: session.mode,
      gitBeforeSha,
      metadataJson: promptContext
        ? {
            promptContext: {
              finalContextHash: createHash('sha256')
                .update(promptContext.finalContext)
                .digest('hex'),
              items: promptContext.items.map((item) => ({
                promptId: item.promptId,
                versionId: item.versionId,
                version: item.version,
                label: item.label,
                contentHash: item.contentHash,
                bindingId: item.bindingId,
                slot: item.slot,
                targetType: item.targetType,
                targetId: item.targetId,
              })),
            },
          }
        : {},
    });
    await this.captureGitSnapshot(runId, session.projectId, session.cwd, 'BEFORE');
    const userMessage = await this.messages.append({
      sessionId,
      runId,
      role: 'USER',
      kind: 'TEXT',
      text: input.text,
      contentJson: {
        content: input.content ?? [],
        ...(promptContext
          ? {
              promptContext: {
                itemCount: promptContext.items.length,
                missingVariables: promptContext.missingVariables,
              },
            }
          : {}),
      },
    });
    await this.runs.patch(runId, { inputMessageId: userMessage.id });
    await this.runs.transition(runId, 'STARTING');
    await this.runs.transition(runId, 'RUNNING');
    await this.sessions.transition(sessionId, 'RUNNING');

    try {
      const reference = await active.handle.sendTurn({
        runId,
        text: promptContext?.finalContext
          ? `${promptContext.finalContext}\n\n[用户任务]\n${input.text}`
          : input.text,
        ...(input.content ? { content: input.content } : {}),
      });
      const run = reference.externalRunId
        ? await this.runs.patch(runId, { externalRunId: reference.externalRunId })
        : await this.runs.get(runId);
      if (!run) throw new Error(`Run ${runId} 在启动后不存在`);
      return run;
    } catch (error) {
      await this.runs.transition(runId, 'FAILED', {
        finishedAt: new Date(),
        errorCode: 'AGENT_RUN_START_FAILED',
        errorMessage: 'Agent 无法启动 Run',
      });
      await this.sessions.transition(sessionId, 'READY');
      throw new AppError(502, 'AGENT_RUN_START_FAILED', 'Agent 无法启动 Run', undefined, {
        cause: error,
      });
    }
  }

  async cancelRun(sessionId: string, runId: string) {
    const active = this.active.get(sessionId);
    if (!active) throw new AppError(409, 'SESSION_NOT_CONNECTED', 'Session 尚未连接或需要恢复');
    const run = await this.runs.get(runId);
    if (!run || run.sessionId !== sessionId) throw new AppError(404, 'RUN_NOT_FOUND', 'Run 不存在');
    if (!['STARTING', 'RUNNING', 'WAITING_APPROVAL', 'DISCONNECTED'].includes(run.status)) {
      throw new AppError(409, 'RUN_NOT_CANCELABLE', 'Run 当前不能取消');
    }
    await this.runs.transition(runId, 'CANCELING');
    await active.handle.cancel(runId);
    return this.runs.get(runId);
  }

  async resolveApproval(id: string, optionId: string) {
    const approval = await this.approvals.get(id);
    if (!approval) throw new AppError(404, 'APPROVAL_NOT_FOUND', 'Approval 不存在');
    const option = approval.optionsJson.find((candidate) => candidate.id === optionId);
    if (!option) {
      throw new AppError(400, 'APPROVAL_OPTION_INVALID', 'Approval 选项不是 Agent 提供的合法选项');
    }
    const active = this.active.get(approval.sessionId);
    if (!active) throw new AppError(409, 'SESSION_NOT_CONNECTED', 'Session 尚未连接或需要恢复');
    const kind = typeof option.kind === 'string' ? option.kind : '';
    const decision = /reject|deny/i.test(kind) ? 'REJECTED' : 'APPROVED';
    const resolved = await this.approvals.resolveExactlyOnce(id, decision, { optionId });
    if (!resolved.changed) return resolved.approval;

    await this.safeRunTransition(approval.runId, 'RUNNING');
    await this.safeSessionTransition(approval.sessionId, 'RUNNING');
    try {
      await active.handle.resolveApproval(approval.externalId, { optionId });
    } catch (error) {
      await this.safeRunTransition(approval.runId, 'FAILED', {
        finishedAt: new Date(),
        errorCode: 'APPROVAL_DELIVERY_FAILED',
        errorMessage: 'Approval 决策未能发送给 Agent',
      });
      await this.safeSessionTransition(approval.sessionId, 'READY');
      throw new AppError(
        502,
        'APPROVAL_DELIVERY_FAILED',
        'Approval 决策未能发送给 Agent',
        undefined,
        { cause: error },
      );
    }
    this.publisher.publish('approvals', {
      type: 'approval.resolved',
      approvalId: id,
      sessionId: approval.sessionId,
      runId: approval.runId,
      optionId,
      status: decision,
    });
    return resolved.approval;
  }

  async close(id: string) {
    const session = await this.get(id);
    if (['RUNNING', 'WAITING_APPROVAL'].includes(session.status)) {
      throw new AppError(409, 'SESSION_HAS_ACTIVE_RUN', '请先停止当前 Run 再关闭 Session');
    }
    const active = this.active.get(id);
    if (active) {
      await active.handle.close();
      this.active.delete(id);
    }
    if (session.status === 'CLOSED') return session;
    return this.sessions.transition(id, 'CLOSED', { closedAt: new Date() });
  }

  async recoverAfterRestart() {
    const [runs, sessions, approvals] = await Promise.all([
      this.runs.recoverInterrupted(),
      this.sessions.recoverInterrupted(),
      this.approvals.cancelPendingForRestart(),
    ]);
    return { runs, sessions, approvals: approvals.map((approval) => approval.id) };
  }

  async shutdown(): Promise<void> {
    const entries = [...this.active.entries()];
    for (const [sessionId, active] of entries) {
      try {
        await active.handle.close();
      } finally {
        this.active.delete(sessionId);
        const session = await this.sessions.get(sessionId);
        if (session && session.status !== 'CLOSED') {
          await this.safeSessionTransition(sessionId, 'CLOSED', { closedAt: new Date() });
        }
      }
    }
    await Promise.allSettled(entries.map(([, active]) => active.consumer));
  }

  private activate(
    sessionId: string,
    projectId: string,
    adapter: AgentRuntimeAdapter,
    handle: AgentSessionHandle,
  ): void {
    const consumer = this.consumeEvents(sessionId, projectId, handle);
    this.active.set(sessionId, { handle, adapter, projectId, consumer });
  }

  private async consumeEvents(
    sessionId: string,
    projectId: string,
    handle: AgentSessionHandle,
  ): Promise<void> {
    try {
      for await (const event of handle.events()) {
        await this.persistEvent(event, projectId);
      }
    } catch {
      await this.safeSessionTransition(sessionId, 'DISCONNECTED');
    }
  }

  private async persistEvent(event: NormalizedAgentEvent, projectId: string): Promise<void> {
    let payload = event.payload;
    if (event.type === 'approval.requested' && event.runId) {
      const externalId =
        typeof payload.approvalId === 'string'
          ? payload.approvalId
          : String(payload.externalId ?? '');
      const approval = await this.approvals.create({
        id: randomUUID(),
        sessionId: event.sessionId,
        runId: event.runId,
        externalId,
        kind: 'TOOL_PERMISSION',
        status: 'PENDING',
        title: typeof payload.title === 'string' ? payload.title : 'Agent 请求权限',
        optionsJson: Array.isArray(payload.options)
          ? (payload.options as Array<Record<string, unknown>>)
          : [],
        requestJson: payload,
      });
      payload = { ...payload, approvalRequestId: approval.id };
      await this.safeRunTransition(event.runId, 'WAITING_APPROVAL');
      await this.safeSessionTransition(event.sessionId, 'WAITING_APPROVAL');
      this.publisher.publish('approvals', {
        type: 'approval.requested',
        approvalId: approval.id,
        sessionId: event.sessionId,
        runId: event.runId,
      });
    }

    const persisted = await this.events.append({
      sessionId: event.sessionId,
      ...(event.runId ? { runId: event.runId } : {}),
      type: event.type,
      payload,
      ...(event.source?.eventType ? { adapterEventType: event.source.eventType } : {}),
    });
    const published = persisted as unknown as Record<string, unknown>;
    this.publisher.publish(`session:${event.sessionId}`, published);
    this.publisher.publish(`project:${projectId}`, published);

    if (event.type === 'assistant.message.completed' && event.runId) {
      await this.messages.append({
        sessionId: event.sessionId,
        runId: event.runId,
        role: 'ASSISTANT',
        kind: 'TEXT',
        text: typeof payload.text === 'string' ? payload.text : '',
        contentJson: {},
      });
    }
    if (event.type === 'usage.updated' && event.runId) {
      const inputTokens = numberValue(payload.inputTokens);
      const outputTokens = numberValue(payload.outputTokens);
      if (inputTokens !== undefined || outputTokens !== undefined) {
        await this.runs.patch(event.runId, {
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
        });
      }
    }
    if (event.type === 'run.completed' && event.runId) {
      const session = await this.get(event.sessionId);
      await this.captureGitSnapshot(event.runId, session.projectId, session.cwd, 'AFTER');
      await this.safeRunTransition(event.runId, 'COMPLETED', {
        finishedAt: new Date(),
        gitAfterSha: await this.git.readHead(session.cwd),
      });
      await this.safeSessionTransition(event.sessionId, 'READY');
      const run = await this.runs.get(event.runId);
      if (run?.taskId) await this.taskLifecycle?.onRunCompleted(run.taskId, event.runId);
    }
    if (event.type === 'run.cancelled' && event.runId) {
      await this.safeRunTransition(event.runId, 'CANCELED', { finishedAt: new Date() });
      await this.safeSessionTransition(event.sessionId, 'READY');
      const run = await this.runs.get(event.runId);
      if (run?.taskId)
        await this.taskLifecycle?.onRunStopped?.(run.taskId, event.runId, 'CANCELED');
    }
    if (event.type === 'run.failed' && event.runId) {
      await this.safeRunTransition(event.runId, 'FAILED', {
        finishedAt: new Date(),
        errorCode: typeof payload.code === 'string' ? payload.code : 'AGENT_RUN_FAILED',
        errorMessage: typeof payload.message === 'string' ? payload.message : 'Agent Run 失败',
      });
      await this.safeSessionTransition(event.sessionId, 'READY');
      const run = await this.runs.get(event.runId);
      if (run?.taskId) await this.taskLifecycle?.onRunStopped?.(run.taskId, event.runId, 'FAILED');
    }
    if (event.type === 'adapter.disconnected') {
      await this.safeSessionTransition(event.sessionId, 'DISCONNECTED');
      const activeRun = event.runId
        ? await this.runs.get(event.runId)
        : await this.runs.findActiveForSession(event.sessionId);
      if (activeRun) await this.safeRunTransition(activeRun.id, 'DISCONNECTED');
    }
  }

  private async safeSessionTransition(
    id: string,
    to: SessionStatus,
    patch: Record<string, unknown> = {},
  ): Promise<void> {
    const current = await this.sessions.get(id);
    if (!current || current.status === to || current.status === 'CLOSED') return;
    await this.sessions.transition(id, to, patch);
  }

  private async safeRunTransition(
    id: string,
    to: RunStatus,
    patch: Record<string, unknown> = {},
  ): Promise<void> {
    const current = await this.runs.get(id);
    if (
      !current ||
      current.status === to ||
      ['CANCELED', 'COMPLETED', 'FAILED'].includes(current.status)
    )
      return;
    await this.runs.transition(id, to, patch);
  }

  private async captureGitSnapshot(
    runId: string,
    projectId: string,
    cwd: string,
    type: 'BEFORE' | 'AFTER' | 'REVIEW',
  ): Promise<void> {
    if (!this.git.capture) return;
    try {
      await this.git.capture(runId, projectId, cwd, type);
    } catch {
      // Git snapshots are diagnostic and must not turn a successful Agent Run into a failure.
    }
  }
}

export class HostGitHeadProbe implements GitHeadProbe {
  async readHead(cwd: string): Promise<string | undefined> {
    const result = await runProcess({
      executable: '/usr/bin/git',
      args: ['-C', cwd, 'rev-parse', 'HEAD'],
      timeoutMs: 10_000,
      maxOutputBytes: 64_000,
    });
    return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
