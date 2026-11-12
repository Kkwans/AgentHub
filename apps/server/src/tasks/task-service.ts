import { RunStartError } from '../sessions/run-start-error.js';
import { DatabaseInvariantError } from '@agenthub/db';
import { taskCreationHash, type CreateTaskInput } from './task-creation-operation.js';
import { randomUUID } from 'node:crypto';

import type { TaskStatus } from '@agenthub/agent-core';
import type {
  AgentHubDatabase,
  GoalRepository,
  ProjectRepository,
  TaskRepository,
} from '@agenthub/db';

import { AppError } from '../errors.js';
import type { PromptService } from '../promptos/prompt-service.js';
import type {
  CreateSessionInput,
  StartRunInput,
  TaskRunLifecycleObserver,
} from '../sessions/session-service.js';

interface StartTaskInput {
  agentId: string;
  model?: string | undefined;
  mode?: string | undefined;
  promptVariables?: Record<string, unknown> | undefined;
}

type GoalStatus = 'DRAFT' | 'ACTIVE' | 'ACHIEVED' | 'CANCELED';

function buildTaskInstructions(task: {
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
}): string {
  return [
    task.title.trim(),
    task.description?.trim() ? `任务说明：\n${task.description.trim()}` : '',
    task.acceptanceCriteria?.trim() ? `验收标准：\n${task.acceptanceCriteria.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export interface TaskSessionController {
  create(input: CreateSessionInput): Promise<{ id: string }>;
  startRun(sessionId: string, input: StartRunInput): Promise<{ id: string }>;
}

const goalTransitions: Record<GoalStatus, readonly GoalStatus[]> = {
  DRAFT: ['ACTIVE', 'CANCELED'],
  ACTIVE: ['ACHIEVED', 'CANCELED'],
  ACHIEVED: [],
  CANCELED: [],
};

export class TaskService implements TaskRunLifecycleObserver {
  private readonly taskAdmissions = new Set<string>();

  constructor(
    private readonly goals: GoalRepository<AgentHubDatabase>,
    private readonly tasks: TaskRepository<AgentHubDatabase>,
    private readonly projects: ProjectRepository<AgentHubDatabase>,
    private readonly sessions: TaskSessionController,
    private readonly promptos?: Pick<PromptService, 'resolveTaskSelection' | 'resolveForRun'>,
  ) {}

  listGoals(projectId?: string) {
    return this.goals.list(projectId);
  }

  async getGoal(id: string) {
    const goal = await this.goals.get(id);
    if (!goal) throw new AppError(404, 'GOAL_NOT_FOUND', 'Goal 不存在');
    return goal;
  }

  async createGoal(input: {
    projectId: string;
    parentId?: string | undefined;
    title: string;
    description?: string | undefined;
    successCriteria?: string | undefined;
  }) {
    await this.requireProject(input.projectId);
    if (input.parentId) {
      const parent = await this.getGoal(input.parentId);
      if (parent.projectId !== input.projectId)
        throw new AppError(409, 'GOAL_PARENT_PROJECT_MISMATCH', '父 Goal 不属于当前 Project');
    }
    return this.goals.create({ id: randomUUID(), status: 'DRAFT', ...input });
  }

  async updateGoal(
    id: string,
    patch: {
      title?: string | undefined;
      description?: string | null | undefined;
      successCriteria?: string | null | undefined;
    },
  ) {
    await this.getGoal(id);
    return this.goals.update(id, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.successCriteria !== undefined ? { successCriteria: patch.successCriteria } : {}),
    });
  }

  async transitionGoal(id: string, to: GoalStatus) {
    const goal = await this.getGoal(id);
    const from = goal.status as GoalStatus;
    if (!goalTransitions[from]?.includes(to)) {
      throw new AppError(409, 'INVALID_GOAL_STATE_TRANSITION', 'Goal 状态不能这样变更', {
        from,
        to,
      });
    }
    return this.goals.update(id, { status: to });
  }

  listTasks(
    filters: {
      projectId?: string | undefined;
      goalId?: string | undefined;
      status?: TaskStatus | undefined;
    } = {},
  ) {
    return this.tasks.list({
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.goalId ? { goalId: filters.goalId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    });
  }

  async getTask(id: string) {
    const task = await this.tasks.get(id);
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', 'Task 不存在');
    return task;
  }

  async getCreationOperation(ownerScope: string, operationId: string) {
    const operation = await this.tasks.getCreationOperation(ownerScope, operationId);
    if (!operation)
      throw new AppError(
        404,
        'TASK_CREATION_OPERATION_NOT_FOUND',
        '当前没有已提交的创建结果；不代表原请求未执行',
      );
    if (!operation.taskId)
      throw new AppError(503, 'TASK_OPERATION_INCOMPLETE', '创建结果暂不可确认，请查询原操作');
    const task = await this.getTask(operation.taskId);
    return {
      operationId,
      projectId: operation.projectId,
      taskId: task.id,
      status: task.status,
      sessionId: task.sessionId,
    };
  }

  async createTask(input: CreateTaskInput, ownerScope?: string) {
    const { operationId, ...rawCreation } = input;
    const creation = {
      ...rawCreation,
      projectId: rawCreation.projectId.toLowerCase(),
      goalId: rawCreation.goalId?.toLowerCase(),
      parentId: rawCreation.parentId?.toLowerCase(),
      selectedPrompt: rawCreation.selectedPrompt
        ? {
            promptId: rawCreation.selectedPrompt.promptId.toLowerCase(),
            versionId: rawCreation.selectedPrompt.versionId?.toLowerCase(),
          }
        : undefined,
    };
    if (!operationId) return this.createNewTask(creation);
    if (!ownerScope) throw new AppError(401, 'AUTH_REQUIRED', '创建操作需要认证身份');
    const requestHash = taskCreationHash(creation);
    const operation = { ownerScope, operationId, requestHash };
    const replay = async () => {
      const existing = await this.tasks.getCreationOperation(ownerScope, operationId);
      if (!existing) return undefined;
      if (existing.requestHash !== requestHash)
        throw new AppError(409, 'TASK_OPERATION_PAYLOAD_MISMATCH', '同一创建操作不能更改请求内容');
      if (!existing.taskId)
        throw new AppError(503, 'TASK_OPERATION_INCOMPLETE', '创建结果暂不可确认，请查询原操作');
      return this.getTask(existing.taskId);
    };
    try {
      const existing = await replay();
      if (existing) return existing;
      return await this.createNewTask({ ...creation, title: creation.title.trim() }, operation);
    } catch (error) {
      // Another request may have committed while validation was awaiting data.
      const existing = await replay();
      if (existing) return existing;
      if (error instanceof AppError) throw error;
      if (
        error instanceof DatabaseInvariantError &&
        error.code === 'TASK_OPERATION_PAYLOAD_MISMATCH'
      )
        throw new AppError(409, error.code, '同一创建操作不能更改请求内容');
      // SQL errors can include bound task text. Do not propagate them to request logging.
      throw new AppError(
        500,
        'TASK_CREATION_FAILED',
        '创建结果暂不可确认，请使用原操作编号查询或重试',
      );
    }
  }

  private async createNewTask(
    input: Omit<CreateTaskInput, 'operationId'>,
    operation?: { ownerScope: string; operationId: string; requestHash: string },
  ) {
    await this.requireProject(input.projectId);
    if (input.goalId) await this.requireGoalProject(input.goalId, input.projectId);
    if (input.parentId) {
      const parent = await this.getTask(input.parentId);
      if (parent.projectId !== input.projectId)
        throw new AppError(409, 'TASK_PARENT_PROJECT_MISMATCH', '父 Task 不属于当前 Project');
    }
    const { selectedPrompt, ...taskInput } = input;
    if (!selectedPrompt) {
      const record = { id: randomUUID(), status: 'BACKLOG', ...taskInput };
      return operation ? this.tasks.createIdempotent(record, operation) : this.tasks.create(record);
    }
    if (!this.promptos) {
      throw new AppError(503, 'PROMPT_SELECTION_UNAVAILABLE', '当前服务未启用 PromptOS 任务绑定');
    }
    const pinned = await this.promptos.resolveTaskSelection(input.projectId, selectedPrompt);
    if (operation)
      return this.tasks.createIdempotent(
        { id: randomUUID(), status: 'BACKLOG', ...taskInput },
        operation,
        pinned,
      );
    return this.tasks.createWithPromptBinding(
      { id: randomUUID(), status: 'BACKLOG', ...taskInput },
      pinned,
    );
  }

  async updateTask(
    id: string,
    patch: {
      goalId?: string | null | undefined;
      title?: string | undefined;
      description?: string | null | undefined;
      acceptanceCriteria?: string | null | undefined;
      priority?: number | undefined;
      branch?: string | null | undefined;
      position?: string | undefined;
    },
  ) {
    const task = await this.getTask(id);
    if (patch.goalId) await this.requireGoalProject(patch.goalId, task.projectId);
    return this.tasks.update(id, {
      ...(patch.goalId !== undefined ? { goalId: patch.goalId } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.acceptanceCriteria !== undefined
        ? { acceptanceCriteria: patch.acceptanceCriteria }
        : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.branch !== undefined ? { branch: patch.branch } : {}),
      ...(patch.position !== undefined ? { position: patch.position } : {}),
    });
  }

  async transitionTask(id: string, to: TaskStatus) {
    return this.withTaskAdmission(id, async () => {
      await this.getTask(id);
      try {
        return await this.tasks.transition(
          id,
          to,
          {
            ...(to === 'DONE' ? { completedAt: new Date() } : {}),
          },
          { guardManualRunState: true },
        );
      } catch (error) {
        if (error instanceof DatabaseInvariantError && error.code === 'TASK_RUN_CANCEL_REQUIRED')
          throw new AppError(
            409,
            error.code,
            '任务执行结果尚待核对，请前往工作区处理 Run 并确认终态，再修改任务状态',
          );
        throw error;
      }
    });
  }

  async startTask(id: string, input: StartTaskInput) {
    return this.withTaskAdmission(id, () => this.startAdmittedTask(id, input), 'TASK_NOT_READY');
  }

  // Synchronous admission covers all user-driven state-changing operations in
  // this service instance, before any Session side effect. Reject overlap rather
  // than queue stale intent. Lifecycle callbacks deliberately do not acquire it.
  // This is not a distributed lease or cross-process ownership guarantee.
  private async withTaskAdmission<T>(
    id: string,
    operation: () => Promise<T>,
    conflictCode = 'TASK_OPERATION_IN_PROGRESS',
  ): Promise<T> {
    if (this.taskAdmissions.has(id)) {
      throw new AppError(409, conflictCode, 'Task 正在处理其他操作，请核对状态后重试');
    }
    this.taskAdmissions.add(id);
    try {
      return await operation();
    } finally {
      this.taskAdmissions.delete(id);
    }
  }

  private async startAdmittedTask(id: string, input: StartTaskInput) {
    const task = await this.getTask(id);
    if (task.status !== 'READY')
      throw new AppError(409, 'TASK_NOT_READY', '只有就绪的 Task 可以交给 Agent');
    const project = await this.requireProject(task.projectId);
    if (this.promptos) {
      let context;
      try {
        context = await this.promptos.resolveForRun({
          projectId: task.projectId,
          agentId: input.agentId,
          taskId: task.id,
          variables: input.promptVariables ?? {},
        });
      } catch (error) {
        if (!(error instanceof AppError) || error.status >= 500) throw error;
        throw new AppError(
          409,
          'TASK_PROMPT_RESOLUTION_FAILED',
          '任务 Prompt 无法解析，请核对绑定与版本',
          {
            reasonCode: error.code,
          },
        );
      }
      if (!context.ready) {
        throw new AppError(
          409,
          'TASK_PROMPT_VARIABLES_MISSING',
          '任务 Prompt 缺少必填变量，尚未启动 Agent',
          {
            missingVariables: context.missingVariables,
          },
        );
      }
    }
    const session = await this.sessions.create({
      projectId: task.projectId,
      agentId: input.agentId,
      taskId: task.id,
      title: task.title,
      cwd: project.realRootPath,
      ...(task.branch ? { branch: task.branch } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
    });
    await this.tasks.transition(id, 'IN_PROGRESS', {
      assignedAgentId: input.agentId,
      sessionId: session.id,
    });
    const text = buildTaskInstructions(task);
    let run: Awaited<ReturnType<TaskSessionController['startRun']>>;
    try {
      run = await this.sessions.startRun(session.id, {
        text,
        ...(input.promptVariables ? { promptVariables: input.promptVariables } : {}),
      });
    } catch (error) {
      if (error instanceof RunStartError) throw error;
      await this.tasks.transition(id, 'BLOCKED');
      throw error;
    }
    return { task: await this.getTask(id), session, run };
  }

  async reviewTask(
    id: string,
    input: { decision: 'APPROVE' } | { decision: 'REWORK'; feedback: string },
  ) {
    return this.withTaskAdmission(id, () => this.reviewAdmittedTask(id, input));
  }

  private async reviewAdmittedTask(
    id: string,
    input: { decision: 'APPROVE' } | { decision: 'REWORK'; feedback: string },
  ) {
    const task = await this.getTask(id);
    if (task.status !== 'WAITING_REVIEW')
      throw new AppError(409, 'TASK_NOT_WAITING_REVIEW', '只有待审阅的 Task 可以确认结果');
    if (input.decision === 'APPROVE') {
      const approved = await this.tasks.transition(id, 'DONE', { completedAt: new Date() });
      return { task: approved, session: null, run: null };
    }

    const feedback = input.feedback.trim();
    if (!feedback) throw new AppError(400, 'TASK_REWORK_FEEDBACK_REQUIRED', '请填写继续修改说明');
    if (!task.assignedAgentId) {
      throw new AppError(409, 'TASK_REWORK_AGENT_REQUIRED', 'Task 没有可用于继续修改的 Agent');
    }
    const project = await this.requireProject(task.projectId);
    const session = await this.sessions.create({
      projectId: task.projectId,
      agentId: task.assignedAgentId,
      taskId: task.id,
      title: `${task.title} · 继续修改`,
      cwd: project.realRootPath,
      ...(task.branch ? { branch: task.branch } : {}),
    });
    await this.tasks.transition(id, 'IN_PROGRESS', {
      sessionId: session.id,
      finalRunId: null,
      completedAt: null,
    });
    const text = [
      '请根据以下审阅反馈继续修改：',
      feedback,
      '',
      `原任务：\n${buildTaskInstructions(task)}`,
    ]
      .filter(Boolean)
      .join('\n');
    let run: Awaited<ReturnType<TaskSessionController['startRun']>>;
    try {
      run = await this.sessions.startRun(session.id, { text });
    } catch (error) {
      if (error instanceof RunStartError) throw error;
      await this.tasks.transition(id, 'BLOCKED');
      throw error;
    }
    return { task: await this.getTask(id), session, run };
  }

  async onRunCompleted(taskId: string, runId: string): Promise<boolean> {
    return this.tasks.tryApplyRunOutcome(taskId, runId, 'COMPLETED');
  }

  async onRunStopped(taskId: string, runId: string): Promise<boolean> {
    return this.tasks.tryApplyRunOutcome(taskId, runId, 'STOPPED');
  }

  private async requireProject(id: string) {
    const project = await this.projects.get(id);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project 不存在');
    return project;
  }

  private async requireGoalProject(goalId: string, projectId: string): Promise<void> {
    const goal = await this.getGoal(goalId);
    if (goal.projectId !== projectId)
      throw new AppError(409, 'TASK_GOAL_PROJECT_MISMATCH', 'Goal 不属于当前 Task 的 Project');
  }
}
