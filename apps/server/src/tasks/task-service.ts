import { randomUUID } from 'node:crypto';

import type { TaskStatus } from '@agenthub/agent-core';
import type {
  AgentHubDatabase,
  GoalRepository,
  ProjectRepository,
  TaskRepository,
} from '@agenthub/db';

import { AppError } from '../errors.js';
import type {
  CreateSessionInput,
  StartRunInput,
  TaskRunLifecycleObserver,
} from '../sessions/session-service.js';

type GoalStatus = 'DRAFT' | 'ACTIVE' | 'ACHIEVED' | 'CANCELED';

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
  constructor(
    private readonly goals: GoalRepository<AgentHubDatabase>,
    private readonly tasks: TaskRepository<AgentHubDatabase>,
    private readonly projects: ProjectRepository<AgentHubDatabase>,
    private readonly sessions: TaskSessionController,
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

  async createTask(input: {
    projectId: string;
    goalId?: string | undefined;
    parentId?: string | undefined;
    title: string;
    description?: string | undefined;
    acceptanceCriteria?: string | undefined;
    priority?: number | undefined;
    branch?: string | undefined;
    position?: string | undefined;
  }) {
    await this.requireProject(input.projectId);
    if (input.goalId) await this.requireGoalProject(input.goalId, input.projectId);
    if (input.parentId) {
      const parent = await this.getTask(input.parentId);
      if (parent.projectId !== input.projectId)
        throw new AppError(409, 'TASK_PARENT_PROJECT_MISMATCH', '父 Task 不属于当前 Project');
    }
    return this.tasks.create({ id: randomUUID(), status: 'BACKLOG', ...input });
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
    await this.getTask(id);
    return this.tasks.transition(id, to, {
      ...(to === 'DONE' ? { completedAt: new Date() } : {}),
    });
  }

  async startTask(
    id: string,
    input: {
      agentId: string;
      model?: string | undefined;
      mode?: string | undefined;
      promptVariables?: Record<string, unknown> | undefined;
    },
  ) {
    const task = await this.getTask(id);
    if (task.status !== 'READY')
      throw new AppError(409, 'TASK_NOT_READY', '只有就绪的 Task 可以交给 Agent');
    const project = await this.requireProject(task.projectId);
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
    const text = [
      task.description || task.title,
      task.acceptanceCriteria ? `\n验收标准：\n${task.acceptanceCriteria}` : '',
    ]
      .join('')
      .trim();
    try {
      const run = await this.sessions.startRun(session.id, {
        text,
        ...(input.promptVariables ? { promptVariables: input.promptVariables } : {}),
      });
      return { task: await this.getTask(id), session, run };
    } catch (error) {
      await this.tasks.transition(id, 'BLOCKED');
      throw error;
    }
  }

  async reviewTask(id: string, decision: 'APPROVE' | 'REWORK') {
    const task = await this.getTask(id);
    if (task.status !== 'WAITING_REVIEW')
      throw new AppError(409, 'TASK_NOT_WAITING_REVIEW', '只有待审阅的 Task 可以确认结果');
    return this.tasks.transition(id, decision === 'APPROVE' ? 'DONE' : 'IN_PROGRESS', {
      ...(decision === 'APPROVE' ? { completedAt: new Date() } : { completedAt: null }),
    });
  }

  async onRunCompleted(taskId: string, runId: string): Promise<void> {
    const task = await this.tasks.get(taskId);
    if (task?.status === 'IN_PROGRESS') {
      await this.tasks.transition(taskId, 'WAITING_REVIEW', { finalRunId: runId });
    }
  }

  async onRunStopped(taskId: string, runId: string): Promise<void> {
    const task = await this.tasks.get(taskId);
    if (task?.status === 'IN_PROGRESS') {
      await this.tasks.transition(taskId, 'BLOCKED', { finalRunId: runId });
    }
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
