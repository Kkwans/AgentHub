import { RunStartError } from '../sessions/run-start-error.js';
import { randomUUID } from 'node:crypto';

import type { WorktreeExecutionStatus } from '@agenthub/agent-core';
import {
  DatabaseInvariantError,
  type AgentHubDatabase,
  type AgentRepository,
  type ExecutionTargetRepository,
  type ProjectRepository,
  type TaskRepository,
  type WorktreeExecutionRepository,
} from '@agenthub/db';

import { AppError } from '../errors.js';
import type {
  CreateSessionInput,
  StartRunInput,
  TaskRunLifecycleObserver,
} from '../sessions/session-service.js';
import type { WorktreeGitService } from './worktree-git-service.js';

export interface WorktreeSessionController {
  create(input: CreateSessionInput): Promise<{ id: string }>;
  createManagedWorktree(input: CreateSessionInput, managedRoot: string): Promise<{ id: string }>;
  startRun(sessionId: string, input: StartRunInput): Promise<{ id: string }>;
  cancelRun(sessionId: string, runId: string): Promise<unknown>;
}

export interface WorktreeEventPublisher {
  publish(topic: string, event: Record<string, unknown>): void;
}

export interface QueueWorktreeTaskInput {
  agentId: string;
  baseBranch?: string | undefined;
  model?: string | undefined;
  mode?: string | undefined;
  promptVariables?: Record<string, unknown> | undefined;
}

export class WorktreeTaskService implements TaskRunLifecycleObserver {
  private readonly draining = new Map<string, Promise<void>>();
  private accepting = true;

  constructor(
    private readonly executions: WorktreeExecutionRepository<AgentHubDatabase>,
    private readonly tasks: TaskRepository<AgentHubDatabase>,
    private readonly projects: ProjectRepository<AgentHubDatabase>,
    private readonly agents: AgentRepository<AgentHubDatabase>,
    private readonly targets: ExecutionTargetRepository<AgentHubDatabase>,
    private readonly sessions: WorktreeSessionController,
    private readonly git: Pick<
      WorktreeGitService,
      'inspectBase' | 'taskBranch' | 'create' | 'review' | 'commitAndMerge'
    >,
    private readonly publisher: WorktreeEventPublisher,
  ) {}

  list(filters: {
    projectId?: string | undefined;
    taskId?: string | undefined;
    status?: WorktreeExecutionStatus | undefined;
  }) {
    return this.executions.list({
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.taskId ? { taskId: filters.taskId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    });
  }

  async get(id: string) {
    const execution = await this.executions.get(id);
    if (!execution) {
      throw new AppError(404, 'WORKTREE_EXECUTION_NOT_FOUND', 'Worktree Execution 不存在');
    }
    return execution;
  }

  async queueTask(taskId: string, input: QueueWorktreeTaskInput, ownerScope?: string) {
    // Server-only enqueue context, never read from request input/config. Historical
    // internal callers remain explicitly ownerless until a safe migration exists.
    if (ownerScope !== undefined && (typeof ownerScope !== 'string' || !ownerScope.trim())) {
      throw new AppError(400, 'WORKTREE_GIT_OWNER_INVALID', 'Worktree Git 操作归属不能为空');
    }
    const gitOwnerScope = ownerScope ?? null;
    const gitCreateOperationId = ownerScope === undefined ? null : randomUUID();
    if (!this.accepting) {
      throw new AppError(503, 'WORKTREE_RUNNER_STOPPING', 'Worktree Task Runner 正在停止');
    }
    const task = await this.requireTask(taskId);
    if (task.status !== 'READY') {
      throw new AppError(409, 'TASK_NOT_READY', '只有就绪的 Task 可以加入 Worktree 队列');
    }
    const project = await this.requireProject(task.projectId);
    if (project.repoKind !== 'GIT') {
      throw new AppError(409, 'PROJECT_NOT_GIT', '只有 Git Project 可以使用 Worktree Task');
    }
    if (project.status !== 'ACTIVE') {
      throw new AppError(409, 'PROJECT_NOT_ACTIVE', 'Project 当前不可执行 Worktree Task');
    }
    const projectTarget = await this.targets.get(project.targetId);
    if (!projectTarget) {
      throw new AppError(500, 'PROJECT_TARGET_MISSING', 'Project 的 Execution Target 不存在');
    }
    if (projectTarget.kind === 'REMOTE_NODE') {
      throw new AppError(
        409,
        'REMOTE_WORKTREE_NOT_AVAILABLE',
        '当前 Remote Node 不支持隔离 Worktree，请改用普通 Session，或在本机 Git Project 中执行隔离任务',
      );
    }
    const agent = await this.agents.get(input.agentId);
    if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent 不存在');
    if (!agent.enabled || agent.status !== 'READY') {
      throw new AppError(409, 'AGENT_NOT_READY', '只有就绪且已启用的 Agent 可以执行 Task');
    }

    const executionId = randomUUID();
    const base = await this.git.inspectBase(project.realRootPath, input.baseBranch);
    const taskBranch = this.git.taskBranch(task.id, executionId);
    try {
      const queued = await this.executions.enqueue({
        id: executionId,
        gitOwnerScope,
        gitCreateOperationId,
        taskId: task.id,
        projectId: task.projectId,
        agentId: input.agentId,
        assignedAgentId: input.agentId,
        baseBranch: base.branch,
        baseSha: base.sha,
        taskBranch,
        configJson: {
          ...(input.model ? { model: input.model } : {}),
          ...(input.mode ? { mode: input.mode } : {}),
          promptVariables: { ...task.promptVariablesJson, ...input.promptVariables },
        },
      });
      this.publish('worktree.execution.queued', queued.execution);
      this.schedule(task.projectId);
      return queued;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (
        error instanceof DatabaseInvariantError &&
        ['TASK_NOT_FOUND', 'INVALID_STATE_TRANSITION'].includes(error.code)
      ) {
        throw error;
      }
      throw new AppError(
        409,
        'WORKTREE_QUEUE_CONFLICT',
        'Task 已有隔离执行或队列状态已变化',
        undefined,
        { cause: error },
      );
    }
  }

  async review(id: string) {
    const execution = await this.get(id);
    if (!execution.worktreePath) {
      throw new AppError(409, 'WORKTREE_NOT_READY', 'Worktree 尚未创建');
    }
    const project = await this.requireProject(execution.projectId);
    return this.git.review({
      projectRoot: project.realRootPath,
      worktreePath: execution.worktreePath,
      baseSha: execution.baseSha,
      taskBranch: execution.taskBranch,
    });
  }

  async rework(id: string, feedback: string) {
    const execution = await this.get(id);
    if (execution.status !== 'REVIEW' || !execution.sessionId) {
      throw new AppError(
        409,
        'WORKTREE_EXECUTION_NOT_IN_REVIEW',
        '只有待审阅且保留 Session 的 Worktree Execution 可以继续修改',
      );
    }
    await this.executions.transitionWithTask(
      id,
      'RUNNING',
      'IN_PROGRESS',
      { reviewReadyAt: null, errorCode: null, errorMessage: null },
      { finalRunId: null, completedAt: null },
    );
    let startedRun: { id: string } | undefined;
    try {
      startedRun = await this.sessions.startRun(execution.sessionId, {
        text: feedback,
        ...(execution.configJson.promptVariables
          ? { promptVariables: execution.configJson.promptVariables }
          : {}),
      });
      const bound = await this.executions.bindCurrentRun(id, {
        sessionId: execution.sessionId,
        runId: startedRun.id,
      });
      const updated = bound?.execution ?? (await this.get(id));
      if (!bound && ['RUNNING', 'AWAITING_INPUT'].includes(updated.status))
        throw new RunStartError('DISPATCH_UNKNOWN', execution.sessionId, startedRun.id);
      this.publish('worktree.execution.rework_started', updated);
      return updated;
    } catch (error) {
      if (startedRun || error instanceof RunStartError) {
        const uncertain =
          error instanceof RunStartError
            ? error
            : new RunStartError('DISPATCH_UNKNOWN', execution.sessionId, startedRun!.id);
        if (uncertain.phase === 'DISPATCH_UNKNOWN') await this.bindUnknownRun(id, uncertain);
        throw uncertain;
      }
      await this.failRunStart(id, execution.sessionId, execution.runId, error);
      throw asAppError(error, 'WORKTREE_REWORK_FAILED', 'Worktree 继续修改失败');
    }
  }

  async merge(id: string, commitMessage?: string) {
    const execution = await this.get(id);
    if (execution.status !== 'REVIEW' || !execution.worktreePath) {
      throw new AppError(
        409,
        'WORKTREE_EXECUTION_NOT_IN_REVIEW',
        '只有待审阅的 Worktree Execution 可以合并',
      );
    }
    const project = await this.requireProject(execution.projectId);
    // Claim rejection is outside the Git failure recovery block: never reset
    // a newer review/run back to REVIEW on behalf of a stale merge request.
    const claimed = await this.executions
      .claimReviewForMerge(id, {
        sessionId: execution.sessionId,
        runId: execution.runId,
      })
      .catch((error: unknown) => {
        if (error instanceof DatabaseInvariantError && error.code === 'WORKTREE_EXECUTION_CHANGED')
          throw new AppError(
            409,
            error.code,
            '隔离审阅已变化，尚未开始合并；请重新读取并确认最新结果',
          );
        throw error;
      });
    let gitCompleted = false;
    try {
      const result = await this.git.commitAndMerge({
        projectRoot: project.realRootPath,
        worktreePath: claimed.execution.worktreePath,
        baseBranch: claimed.execution.baseBranch,
        baseSha: claimed.execution.baseSha,
        taskBranch: claimed.execution.taskBranch,
        commitMessage: commitMessage || `feat(task): ${claimed.task.title}`,
      });
      gitCompleted = true;
      const completed = await this.executions.transitionWithTask(
        id,
        'DONE',
        'DONE',
        { mergeCommitSha: result.mergeCommitSha, completedAt: new Date() },
        { completedAt: new Date(), finalRunId: claimed.execution.runId },
      );
      this.publish('worktree.execution.completed', completed.execution);
      this.schedule(execution.projectId);
      return { ...completed, merge: result };
    } catch (error) {
      const normalized = asAppError(error, 'WORKTREE_MERGE_FAILED', 'Worktree 合并失败');
      if (gitCompleted || normalized.code === 'WORKTREE_GIT_OUTCOME_UNKNOWN') {
        // Git writes cannot be rolled back by resetting our queue state. Even a
        // failed completion response may hide a durable DONE transaction.
        const current = await this.get(id);
        if (current.status === 'MERGING')
          await this.executions.patch(id, {
            errorCode: 'WORKTREE_GIT_OUTCOME_UNKNOWN',
            errorMessage: 'Git 写入结果或完成记录尚未确认，已保留隔离槽位，禁止重试合并',
          });
        throw new AppError(
          409,
          'WORKTREE_GIT_OUTCOME_UNKNOWN',
          'Git 写入结果尚未确认，请勿重试',
          undefined,
          { cause: error },
        );
      }
      const review = await this.executions.transition(id, 'REVIEW', {
        errorCode: normalized.code,
        errorMessage: normalized.message,
        mergeStartedAt: null,
      });
      this.publish('worktree.execution.merge_failed', review);
      throw normalized;
    }
  }

  async cancel(id: string) {
    let execution = await this.get(id);
    if (['DONE', 'CANCELED'].includes(execution.status)) {
      throw new AppError(409, 'WORKTREE_EXECUTION_NOT_CANCELABLE', '该隔离执行已经结束');
    }
    if (execution.status === 'SETTING_UP' || execution.status === 'MERGING') {
      throw new AppError(
        409,
        'WORKTREE_EXECUTION_BUSY',
        'Worktree 正在创建或合并，请等待当前原子步骤完成',
      );
    }
    if (['RUNNING', 'AWAITING_INPUT'].includes(execution.status)) {
      const current = await this.executions.bindCurrentRun(id);
      if (!current) {
        execution = await this.get(id);
        if (!['RUNNING', 'AWAITING_INPUT'].includes(execution.status)) return execution;
        throw new AppError(409, 'WORKTREE_RUN_UNRESOLVED', '当前 Run 无法确认，未取消或释放队列');
      }
      await this.sessions.cancelRun(current.execution.sessionId!, current.run.id);
      // Cancel is a request, not proof that runtime execution stopped.
      // Only the authoritative terminal callback can release this queue slot.
      return this.get(id);
    }
    if (execution.status === 'CANCELED') return execution;

    const taskStatus = (await this.requireTask(execution.taskId)).status;
    const canceled = await this.executions
      .transitionWithTask(
        id,
        'CANCELED',
        'CANCELED',
        { completedAt: new Date(), errorCode: null, errorMessage: null },
        { completedAt: null },
        execution.status as WorktreeExecutionStatus,
      )
      .catch((error: unknown) => {
        if (
          error instanceof DatabaseInvariantError &&
          error.code === 'WORKTREE_EXECUTION_CONCURRENT_UPDATE'
        ) {
          throw new AppError(
            409,
            'WORKTREE_EXECUTION_CHANGED',
            '隔离执行状态已变化，本次未取消；请刷新后确认当前状态',
          );
        }
        throw error;
      });
    this.publish('worktree.execution.canceled', canceled.execution);
    this.schedule(execution.projectId);
    return { ...canceled, previousTaskStatus: taskStatus };
  }

  async processQueue(projectId: string): Promise<void> {
    const current = this.draining.get(projectId);
    if (current) return current;
    const draining = this.drain(projectId).finally(() => {
      if (this.draining.get(projectId) === draining) this.draining.delete(projectId);
    });
    this.draining.set(projectId, draining);
    return draining;
  }

  async onRunCompleted(taskId: string, runId: string): Promise<boolean> {
    const execution = await this.executions.applyRunOutcome(taskId, runId, 'COMPLETED');
    if (!execution) return false;
    this.publish('worktree.execution.review_ready', execution);
    return true;
  }

  async onRunStopped(
    taskId: string,
    runId: string,
    reason: 'FAILED' | 'CANCELED' | 'DISCONNECTED',
  ): Promise<boolean> {
    const execution = await this.executions.applyRunOutcome(taskId, runId, reason);
    if (!execution) return false;
    this.publish(
      reason === 'DISCONNECTED'
        ? 'worktree.execution.recovery_unresolved'
        : reason === 'CANCELED'
          ? 'worktree.execution.canceled'
          : 'worktree.execution.blocked',
      execution,
    );
    if (reason !== 'DISCONNECTED') this.schedule(execution.projectId);
    return true;
  }

  async onRunWaitingForInput(taskId: string, runId: string): Promise<boolean> {
    const execution = await this.findForRun(taskId, runId);
    if (!execution || execution.status !== 'RUNNING') return false;
    const waiting = await this.executions.transition(execution.id, 'AWAITING_INPUT', { runId });
    this.publish('worktree.execution.awaiting_input', waiting);
    return true;
  }

  async onRunResumed(taskId: string, runId: string): Promise<boolean> {
    const execution = await this.findForRun(taskId, runId);
    if (!execution || execution.status !== 'AWAITING_INPUT') return false;
    const running = await this.executions.transition(execution.id, 'RUNNING', { runId });
    this.publish('worktree.execution.resumed', running);
    return true;
  }

  async recoverAfterRestart() {
    // Repository recovery updates each Execution/Task pair atomically and leaves
    // unknown runtime outcomes in the active set so claimNext cannot bypass them.
    const recovered = await this.executions.recoverInterrupted();
    for (const [kind, ids] of Object.entries(recovered))
      for (const id of ids) {
        const execution = await this.executions.get(id);
        if (execution) this.publish(`worktree.execution.recovery_${kind}`, execution);
      }
    return { ...recovered, queuedProjects: await this.executions.listQueuedProjectIds() };
  }

  resumeQueued(projectIds: string[]): void {
    for (const projectId of projectIds) this.schedule(projectId);
  }

  async shutdown(): Promise<void> {
    this.accepting = false;
    await Promise.allSettled(this.draining.values());
  }

  private schedule(projectId: string): void {
    if (!this.accepting || this.draining.has(projectId)) return;
    queueMicrotask(() => void this.processQueue(projectId));
  }

  private async drain(projectId: string): Promise<void> {
    while (this.accepting) {
      const execution = await this.executions.claimNext(projectId);
      if (!execution) return;
      const started = await this.startClaimed(execution.id);
      if (started) return;
    }
  }

  private async startClaimed(id: string): Promise<boolean> {
    const execution = await this.get(id);
    let startedRun: { id: string } | undefined;
    let startedSessionId: string | undefined;
    let gitCreated = false;
    try {
      const [project, task] = await Promise.all([
        this.requireProject(execution.projectId),
        this.requireTask(execution.taskId),
      ]);
      const worktreePath = await this.git.create({
        projectRoot: project.realRootPath,
        projectId: execution.projectId,
        executionId: execution.id,
        taskBranch: execution.taskBranch,
        baseSha: execution.baseSha,
      });
      gitCreated = true;
      await this.executions.patch(id, { worktreePath });
      const config = execution.configJson;
      const session = await this.sessions.createManagedWorktree(
        {
          projectId: execution.projectId,
          agentId: execution.agentId,
          taskId: execution.taskId,
          title: task.title,
          cwd: worktreePath,
          branch: execution.taskBranch,
          ...(config.model ? { model: config.model } : {}),
          ...(config.mode ? { mode: config.mode } : {}),
        },
        worktreePath,
      );
      await this.executions.transitionWithTaskPatch(
        id,
        'RUNNING',
        {
          sessionId: session.id,
          errorCode: null,
          errorMessage: null,
        },
        { sessionId: session.id },
      );
      startedSessionId = session.id;
      startedRun = await this.sessions.startRun(session.id, {
        text: worktreePrompt(task, execution.baseBranch, execution.taskBranch),
        ...(config.promptVariables ? { promptVariables: config.promptVariables } : {}),
      });
      const bound = await this.executions.bindCurrentRun(id, {
        sessionId: session.id,
        runId: startedRun.id,
      });
      const running = bound?.execution ?? (await this.get(id));
      if (!bound && ['RUNNING', 'AWAITING_INPUT'].includes(running.status))
        throw new RunStartError('DISPATCH_UNKNOWN', session.id, startedRun.id);
      this.publish('worktree.execution.running', running);
      return true;
    } catch (error) {
      if (
        !startedSessionId &&
        (gitCreated || (error instanceof AppError && error.code === 'WORKTREE_GIT_OUTCOME_UNKNOWN'))
      ) {
        const current = await this.get(id);
        if (current.status === 'SETTING_UP')
          await this.executions.patch(id, {
            errorCode: 'WORKTREE_GIT_OUTCOME_UNKNOWN',
            errorMessage: 'Worktree Git 创建结果或完成记录尚未确认，已保留隔离槽位',
          });
        return true;
      }
      if (startedRun || error instanceof RunStartError) {
        const uncertain =
          error instanceof RunStartError
            ? error
            : new RunStartError('DISPATCH_UNKNOWN', startedSessionId!, startedRun!.id);
        if (uncertain.phase === 'DISPATCH_UNKNOWN') await this.bindUnknownRun(id, uncertain);
        return uncertain.phase !== 'PREPARATION_FAILED';
      }
      if (startedSessionId) {
        await this.failRunStart(id, startedSessionId, execution.runId, error);
        // A competing callback may already have released the slot while drain
        // was active; let claimNext continue rather than losing that wake-up.
        return !['BLOCKED', 'CANCELED', 'DONE'].includes((await this.get(id)).status);
      }
      await this.block(id, error);
      return false;
    }
  }

  private async failRunStart(
    id: string,
    sessionId: string,
    priorRunId: string | null,
    error: unknown,
  ) {
    const normalized = asAppError(error, 'WORKTREE_EXECUTION_FAILED', 'Worktree Execution 失败');
    const result = await this.executions.failRunStart(id, { sessionId, priorRunId }, normalized);
    if (result.execution)
      this.publish(
        result.blocked ? 'worktree.execution.blocked' : 'worktree.execution.recovery_unresolved',
        result.execution,
      );
    return result.blocked;
  }

  private async bindUnknownRun(id: string, error: RunStartError): Promise<void> {
    try {
      await this.executions.bindCurrentRun(id, { sessionId: error.sessionId, runId: error.runId });
    } catch {
      // Keep execution active. cancel() independently resolves the durable
      // current Run, so a failed binding cannot cancel an old Run or free a slot.
    }
  }

  private async block(id: string, error: unknown): Promise<void> {
    const execution = await this.get(id);
    if (['BLOCKED', 'DONE', 'CANCELED'].includes(execution.status)) return;
    const normalized = asAppError(error, 'WORKTREE_EXECUTION_FAILED', 'Worktree Execution 失败');
    const blocked = await this.executions.transitionWithTask(
      id,
      'BLOCKED',
      'BLOCKED',
      { errorCode: normalized.code, errorMessage: normalized.message },
      { finalRunId: execution.runId },
    );
    this.publish('worktree.execution.blocked', blocked.execution);
  }

  private async findForRun(taskId: string, runId: string) {
    const byRun = await this.executions.getByRunId(runId);
    if (byRun) return byRun;
    const active = await this.executions.getActiveForTask(taskId);
    return active?.taskId === taskId ? active : undefined;
  }

  private async requireTask(id: string) {
    const task = await this.tasks.get(id);
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Task 不存在');
    return task;
  }

  private async requireProject(id: string) {
    const project = await this.projects.get(id);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project 不存在');
    return project;
  }

  private publish(type: string, execution: { id: string; projectId: string; taskId: string }) {
    const event = {
      type,
      executionId: execution.id,
      projectId: execution.projectId,
      taskId: execution.taskId,
    };
    this.publisher.publish('worktrees', event);
    this.publisher.publish(`project:${execution.projectId}`, event);
  }
}

function worktreePrompt(
  task: { title: string; description: string | null; acceptanceCriteria: string | null },
  baseBranch: string,
  taskBranch: string,
): string {
  return [
    '[AgentHub Worktree Task Runner]',
    `你正在隔离任务分支 ${taskBranch} 上工作，base branch 为 ${baseBranch}。`,
    '只在当前 worktree 中修改并验证。不要合并到 base branch，不要删除 worktree 或任务分支。',
    '可以在任务分支提交；如有未提交变更，AgentHub 会在用户批准合并时创建受管提交。',
    '',
    `任务：${task.title}`,
    task.description || '',
    task.acceptanceCriteria ? `验收标准：\n${task.acceptanceCriteria}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function asAppError(error: unknown, code: string, message: string): AppError {
  if (error instanceof AppError) return error;
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown };
    if (typeof candidate.code === 'string') {
      return new AppError(
        409,
        candidate.code,
        typeof candidate.message === 'string' ? candidate.message : message,
        undefined,
        { cause: error },
      );
    }
  }
  return new AppError(500, code, message, undefined, { cause: error });
}
