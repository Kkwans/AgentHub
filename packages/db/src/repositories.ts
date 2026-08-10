import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull, max, or, sql } from 'drizzle-orm';
import {
  transitionRun,
  transitionSession,
  transitionTask,
  transitionWorktreeExecution,
  type RunStatus,
  type SessionStatus,
  type TaskStatus,
  type WorktreeExecutionStatus,
} from '@agenthub/agent-core';

import type { AgentHubDatabase } from './client.js';
import {
  agents,
  agentRuns,
  agentSessions,
  apiTokens,
  approvalRequests,
  executionTargets,
  gitSnapshots,
  goals,
  messages,
  projects,
  promptBindings,
  promptLabels,
  prompts,
  promptVersions,
  runEvents,
  skillBindings,
  skills,
  tasks,
  worktreeExecutions,
} from './schema.js';

export class DatabaseInvariantError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DatabaseInvariantError';
  }
}

export class ApiTokenRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  list() {
    return this.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
      })
      .from(apiTokens)
      .orderBy(apiTokens.createdAt);
  }

  async getByName(name: string) {
    const [token] = await this.db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(eq(apiTokens.name, name))
      .limit(1);
    return token;
  }

  async hasActive() {
    const [token] = await this.db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(isNull(apiTokens.revokedAt))
      .limit(1);
    return Boolean(token);
  }

  async findActiveByHash(tokenHash: string) {
    const [token] = await this.db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt)))
      .limit(1);
    return token;
  }

  async create(input: { id: string; name: string; tokenHash: string }) {
    const [created] = await this.db.insert(apiTokens).values(input).returning();
    if (!created) throw new DatabaseInvariantError('API_TOKEN_CREATE_FAILED', 'API token 创建失败');
    return {
      id: created.id,
      name: created.name,
      createdAt: created.createdAt,
      lastUsedAt: created.lastUsedAt,
      revokedAt: created.revokedAt,
    };
  }

  async markUsed(id: string) {
    await this.db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, id));
  }

  async revoke(id: string) {
    const [revoked] = await this.db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
      .returning();
    return revoked
      ? {
          id: revoked.id,
          name: revoked.name,
          createdAt: revoked.createdAt,
          lastUsedAt: revoked.lastUsedAt,
          revokedAt: revoked.revokedAt,
        }
      : undefined;
  }
}

export interface CreatePromptVersionInput {
  promptId: string;
  version: number;
  content: Record<string, unknown>;
  variables?: Record<string, unknown>;
  config?: Record<string, unknown>;
  changelog?: string;
  source: string;
  contentHash: string;
  createdBy: string;
}

export class PromptRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  async createPrompt(input: {
    projectId?: string;
    key: string;
    name: string;
    description?: string;
    kind: string;
    type: string;
  }) {
    const [created] = await this.db
      .insert(prompts)
      .values({ id: randomUUID(), ...input })
      .returning();
    if (!created) throw new DatabaseInvariantError('PROMPT_CREATE_FAILED', 'Prompt 创建失败');
    return created;
  }

  listPrompts(projectId?: string) {
    const base = this.db.select().from(prompts);
    return projectId
      ? base
          .where(
            and(
              isNull(prompts.archivedAt),
              or(eq(prompts.projectId, projectId), isNull(prompts.projectId)),
            ),
          )
          .orderBy(prompts.name)
      : base.where(isNull(prompts.archivedAt)).orderBy(prompts.name);
  }

  async getPrompt(id: string) {
    const [prompt] = await this.db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
    return prompt;
  }

  async updatePrompt(
    id: string,
    patch: { name?: string; description?: string | null; kind?: string },
  ) {
    const [updated] = await this.db
      .update(prompts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(prompts.id, id), isNull(prompts.archivedAt)))
      .returning();
    if (!updated) throw new DatabaseInvariantError('PROMPT_NOT_FOUND', 'Prompt 不存在');
    return updated;
  }

  async archivePrompt(id: string) {
    const [archived] = await this.db
      .update(prompts)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(prompts.id, id), isNull(prompts.archivedAt)))
      .returning();
    if (!archived) throw new DatabaseInvariantError('PROMPT_NOT_FOUND', 'Prompt 不存在');
    return archived;
  }

  listVersions(promptId: string) {
    return this.db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.promptId, promptId))
      .orderBy(desc(promptVersions.version));
  }

  async getVersion(promptId: string, version: number) {
    const [record] = await this.db
      .select()
      .from(promptVersions)
      .where(and(eq(promptVersions.promptId, promptId), eq(promptVersions.version, version)))
      .limit(1);
    return record;
  }

  async getVersionById(promptId: string, versionId: string) {
    const [record] = await this.db
      .select()
      .from(promptVersions)
      .where(and(eq(promptVersions.promptId, promptId), eq(promptVersions.id, versionId)))
      .limit(1);
    return record;
  }

  listLabels(promptId: string) {
    return this.db
      .select({
        promptId: promptLabels.promptId,
        label: promptLabels.label,
        versionId: promptLabels.versionId,
        version: promptVersions.version,
        updatedAt: promptLabels.updatedAt,
      })
      .from(promptLabels)
      .innerJoin(promptVersions, eq(promptLabels.versionId, promptVersions.id))
      .where(eq(promptLabels.promptId, promptId))
      .orderBy(promptLabels.label);
  }

  async getLabel(promptId: string, label: string) {
    const [record] = await this.db
      .select({
        promptId: promptLabels.promptId,
        label: promptLabels.label,
        versionId: promptLabels.versionId,
        version: promptVersions.version,
        updatedAt: promptLabels.updatedAt,
      })
      .from(promptLabels)
      .innerJoin(promptVersions, eq(promptLabels.versionId, promptVersions.id))
      .where(and(eq(promptLabels.promptId, promptId), eq(promptLabels.label, label)))
      .limit(1);
    return record;
  }

  async deleteLabel(promptId: string, label: string) {
    const [deleted] = await this.db
      .delete(promptLabels)
      .where(and(eq(promptLabels.promptId, promptId), eq(promptLabels.label, label)))
      .returning();
    return deleted;
  }

  listBindings(
    filters: {
      targetType?: string | undefined;
      targetId?: string | undefined;
      promptId?: string | undefined;
    } = {},
  ) {
    const conditions = [
      ...(filters.targetType ? [eq(promptBindings.targetType, filters.targetType)] : []),
      ...(filters.targetId ? [eq(promptBindings.targetId, filters.targetId)] : []),
      ...(filters.promptId ? [eq(promptBindings.promptId, filters.promptId)] : []),
    ];
    const query = this.db.select().from(promptBindings);
    return conditions.length
      ? query.where(and(...conditions)).orderBy(asc(promptBindings.priority))
      : query.orderBy(promptBindings.targetType, asc(promptBindings.priority));
  }

  async getBinding(id: string) {
    const [binding] = await this.db
      .select()
      .from(promptBindings)
      .where(eq(promptBindings.id, id))
      .limit(1);
    return binding;
  }

  async createBinding(input: typeof promptBindings.$inferInsert) {
    const [created] = await this.db.insert(promptBindings).values(input).returning();
    if (!created)
      throw new DatabaseInvariantError('PROMPT_BINDING_CREATE_FAILED', 'Prompt Binding 创建失败');
    return created;
  }

  async updateBinding(id: string, patch: Partial<typeof promptBindings.$inferInsert>) {
    const [updated] = await this.db
      .update(promptBindings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(promptBindings.id, id))
      .returning();
    if (!updated)
      throw new DatabaseInvariantError('PROMPT_BINDING_NOT_FOUND', 'Prompt Binding 不存在');
    return updated;
  }

  async deleteBinding(id: string) {
    const [deleted] = await this.db
      .delete(promptBindings)
      .where(eq(promptBindings.id, id))
      .returning();
    return deleted;
  }

  async targetExists(targetType: 'PROJECT' | 'AGENT' | 'TASK', targetId: string) {
    const table = targetType === 'PROJECT' ? projects : targetType === 'AGENT' ? agents : tasks;
    const [record] = await this.db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, targetId))
      .limit(1);
    return Boolean(record);
  }

  async createVersion(input: CreatePromptVersionInput) {
    return this.db.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(promptVersions)
        .values({
          id: randomUUID(),
          promptId: input.promptId,
          version: input.version,
          contentJson: input.content,
          variablesJson: input.variables ?? {},
          configJson: input.config ?? {},
          changelog: input.changelog,
          source: input.source,
          contentHash: input.contentHash,
          createdBy: input.createdBy,
        })
        .returning();
      if (!created)
        throw new DatabaseInvariantError('PROMPT_VERSION_CREATE_FAILED', 'Prompt 版本创建失败');

      await transaction
        .insert(promptLabels)
        .values({ promptId: input.promptId, label: 'latest', versionId: created.id })
        .onConflictDoUpdate({
          target: [promptLabels.promptId, promptLabels.label],
          set: { versionId: created.id, updatedAt: new Date() },
        });
      return created;
    });
  }

  async createNextVersion(input: Omit<CreatePromptVersionInput, 'version'>) {
    return this.db.transaction(async (transaction) => {
      const [prompt] = await transaction
        .select({ id: prompts.id })
        .from(prompts)
        .where(eq(prompts.id, input.promptId))
        .for('update')
        .limit(1);
      if (!prompt) throw new DatabaseInvariantError('PROMPT_NOT_FOUND', 'Prompt 不存在');
      const [latest] = await transaction
        .select({ version: max(promptVersions.version) })
        .from(promptVersions)
        .where(eq(promptVersions.promptId, input.promptId));
      const [created] = await transaction
        .insert(promptVersions)
        .values({
          id: randomUUID(),
          promptId: input.promptId,
          version: Number(latest?.version ?? 0) + 1,
          contentJson: input.content,
          variablesJson: input.variables ?? {},
          configJson: input.config ?? {},
          changelog: input.changelog,
          source: input.source,
          contentHash: input.contentHash,
          createdBy: input.createdBy,
        })
        .returning();
      if (!created)
        throw new DatabaseInvariantError('PROMPT_VERSION_CREATE_FAILED', 'Prompt 版本创建失败');
      await transaction
        .insert(promptLabels)
        .values({ promptId: input.promptId, label: 'latest', versionId: created.id })
        .onConflictDoUpdate({
          target: [promptLabels.promptId, promptLabels.label],
          set: { versionId: created.id, updatedAt: new Date() },
        });
      return created;
    });
  }

  async moveLabel(promptId: string, label: string, versionId: string) {
    return this.db.transaction(async (transaction) => {
      const [version] = await transaction
        .select({ id: promptVersions.id })
        .from(promptVersions)
        .where(and(eq(promptVersions.id, versionId), eq(promptVersions.promptId, promptId)))
        .limit(1);
      if (!version) {
        throw new DatabaseInvariantError(
          'PROMPT_VERSION_NOT_IN_PROMPT',
          '目标 Prompt 版本不属于当前 Prompt',
        );
      }

      const [moved] = await transaction
        .insert(promptLabels)
        .values({ promptId, label, versionId })
        .onConflictDoUpdate({
          target: [promptLabels.promptId, promptLabels.label],
          set: { versionId, updatedAt: new Date() },
        })
        .returning();
      return moved;
    });
  }
}

export class SkillRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  list(projectId?: string) {
    const query = this.db.select().from(skills);
    return projectId
      ? query
          .where(or(eq(skills.projectId, projectId), isNull(skills.projectId)))
          .orderBy(skills.name)
      : query.orderBy(skills.name);
  }

  async get(id: string) {
    const [skill] = await this.db.select().from(skills).where(eq(skills.id, id)).limit(1);
    return skill;
  }

  async upsert(input: typeof skills.$inferInsert) {
    const [existing] = await this.db
      .select({ id: skills.id })
      .from(skills)
      .where(
        and(
          input.projectId ? eq(skills.projectId, input.projectId) : isNull(skills.projectId),
          eq(skills.rootPath, input.rootPath),
        ),
      )
      .limit(1);
    if (existing) {
      const [updated] = await this.db
        .update(skills)
        .set({ ...input, id: existing.id, updatedAt: new Date() })
        .where(eq(skills.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await this.db.insert(skills).values(input).returning();
    return created;
  }

  listBindings(targetType?: string, targetId?: string) {
    const conditions = [
      ...(targetType ? [eq(skillBindings.targetType, targetType)] : []),
      ...(targetId ? [eq(skillBindings.targetId, targetId)] : []),
    ];
    const query = this.db.select().from(skillBindings);
    return conditions.length ? query.where(and(...conditions)) : query;
  }

  async createBinding(input: typeof skillBindings.$inferInsert) {
    const [created] = await this.db.insert(skillBindings).values(input).returning();
    return created;
  }
}

export class ApprovalRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  listPending(sessionId?: string) {
    const query = this.db.select().from(approvalRequests);
    return sessionId
      ? query
          .where(
            and(eq(approvalRequests.sessionId, sessionId), eq(approvalRequests.status, 'PENDING')),
          )
          .orderBy(approvalRequests.requestedAt)
      : query.where(eq(approvalRequests.status, 'PENDING')).orderBy(approvalRequests.requestedAt);
  }

  async get(id: string) {
    const [approval] = await this.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .limit(1);
    return approval;
  }

  async create(input: typeof approvalRequests.$inferInsert) {
    const [created] = await this.db.insert(approvalRequests).values(input).returning();
    if (!created) throw new DatabaseInvariantError('APPROVAL_CREATE_FAILED', 'Approval 创建失败');
    return created;
  }

  async resolveExactlyOnce(
    id: string,
    decision: 'APPROVED' | 'REJECTED' | 'CANCELED',
    response: Record<string, unknown>,
  ) {
    return this.db.transaction(async (transaction) => {
      const [resolved] = await transaction
        .update(approvalRequests)
        .set({ status: decision, responseJson: response, resolvedAt: new Date() })
        .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, 'PENDING')))
        .returning();
      if (resolved) return { changed: true as const, approval: resolved };

      const [existing] = await transaction
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, id))
        .limit(1);
      if (!existing) throw new DatabaseInvariantError('APPROVAL_NOT_FOUND', 'Approval 不存在');
      return { changed: false as const, approval: existing };
    });
  }

  async cancelPendingForRestart() {
    return this.db
      .update(approvalRequests)
      .set({
        status: 'CANCELED',
        responseJson: { reason: 'SERVER_RESTARTED' },
        resolvedAt: new Date(),
      })
      .where(eq(approvalRequests.status, 'PENDING'))
      .returning();
  }
}

export class EventRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  async append(input: {
    sessionId: string;
    runId?: string;
    type: string;
    payload: Record<string, unknown>;
    adapterEventType?: string;
  }) {
    return this.db.transaction(async (transaction) => {
      const [session] = await transaction
        .select({ lastSeq: agentSessions.lastSeq })
        .from(agentSessions)
        .where(eq(agentSessions.id, input.sessionId))
        .for('update')
        .limit(1);
      if (!session) throw new DatabaseInvariantError('SESSION_NOT_FOUND', 'Session 不存在');

      const nextSeq = session.lastSeq + 1;
      const [event] = await transaction
        .insert(runEvents)
        .values({
          id: randomUUID(),
          sessionId: input.sessionId,
          runId: input.runId,
          seq: nextSeq,
          type: input.type,
          payloadJson: input.payload,
          adapterEventType: input.adapterEventType,
        })
        .returning();
      await transaction
        .update(agentSessions)
        .set({ lastSeq: nextSeq, lastActiveAt: new Date() })
        .where(
          and(eq(agentSessions.id, input.sessionId), eq(agentSessions.lastSeq, session.lastSeq)),
        );
      if (!event) throw new DatabaseInvariantError('EVENT_APPEND_FAILED', '事件追加失败');
      return event;
    });
  }

  async listAfter(sessionId: string, afterSeq: number, limit = 500) {
    return this.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.sessionId, sessionId), sql`${runEvents.seq} > ${afterSeq}`))
      .orderBy(runEvents.seq)
      .limit(Math.min(Math.max(limit, 1), 1000));
  }
}

export class ExecutionTargetRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  list() {
    return this.db.select().from(executionTargets).orderBy(executionTargets.createdAt);
  }

  async get(id: string) {
    const [target] = await this.db
      .select()
      .from(executionTargets)
      .where(eq(executionTargets.id, id))
      .limit(1);
    return target;
  }

  async create(input: typeof executionTargets.$inferInsert) {
    const [created] = await this.db.insert(executionTargets).values(input).returning();
    if (!created) {
      throw new DatabaseInvariantError(
        'EXECUTION_TARGET_CREATE_FAILED',
        'Execution Target 创建失败',
      );
    }
    return created;
  }

  async updateObservedState(
    id: string,
    input: { status: string; lastSeenAt?: Date; capabilitiesJson?: Record<string, unknown> },
  ) {
    const [updated] = await this.db
      .update(executionTargets)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(executionTargets.id, id))
      .returning();
    if (!updated)
      throw new DatabaseInvariantError('EXECUTION_TARGET_NOT_FOUND', 'Execution Target 不存在');
    return updated;
  }

  async hasActiveSessions(id: string): Promise<boolean> {
    const [active] = await this.db
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .innerJoin(agents, eq(agentSessions.agentId, agents.id))
      .where(
        and(
          eq(agents.targetId, id),
          sql`${agentSessions.status} in ('STARTING', 'READY', 'RUNNING', 'WAITING_APPROVAL', 'DISCONNECTED')`,
        ),
      )
      .limit(1);
    return Boolean(active);
  }
}

export class AgentRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  list() {
    return this.db.select().from(agents).orderBy(agents.createdAt);
  }

  async get(id: string) {
    const [agent] = await this.db.select().from(agents).where(eq(agents.id, id)).limit(1);
    return agent;
  }

  async create(input: typeof agents.$inferInsert) {
    const [created] = await this.db.insert(agents).values(input).returning();
    if (!created) throw new DatabaseInvariantError('AGENT_CREATE_FAILED', 'Agent 创建失败');
    return created;
  }

  async updatePreflight(
    id: string,
    input: {
      status: string;
      detectedVersion?: string | null;
      capabilitiesJson?: Record<string, unknown>;
    },
  ) {
    const [updated] = await this.db
      .update(agents)
      .set({ ...input, lastPreflightAt: new Date(), updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();
    if (!updated) throw new DatabaseInvariantError('AGENT_NOT_FOUND', 'Agent 不存在');
    return updated;
  }
}

export class ProjectRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  list() {
    return this.db.select().from(projects).orderBy(projects.createdAt);
  }

  async get(id: string) {
    const [project] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return project;
  }

  async create(input: typeof projects.$inferInsert) {
    const [created] = await this.db.insert(projects).values(input).returning();
    if (!created) throw new DatabaseInvariantError('PROJECT_CREATE_FAILED', 'Project 创建失败');
    return created;
  }

  async update(id: string, patch: Partial<typeof projects.$inferInsert>) {
    const [updated] = await this.db
      .update(projects)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    if (!updated) throw new DatabaseInvariantError('PROJECT_NOT_FOUND', 'Project 不存在');
    return updated;
  }
}

export class GoalRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  list(projectId?: string) {
    const query = this.db.select().from(goals);
    return projectId
      ? query.where(eq(goals.projectId, projectId)).orderBy(goals.createdAt)
      : query.orderBy(goals.createdAt);
  }

  async get(id: string) {
    const [goal] = await this.db.select().from(goals).where(eq(goals.id, id)).limit(1);
    return goal;
  }

  async create(input: typeof goals.$inferInsert) {
    const [created] = await this.db.insert(goals).values(input).returning();
    if (!created) throw new DatabaseInvariantError('GOAL_CREATE_FAILED', 'Goal 创建失败');
    return created;
  }

  async update(id: string, patch: Partial<typeof goals.$inferInsert>) {
    const [updated] = await this.db
      .update(goals)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(goals.id, id))
      .returning();
    if (!updated) throw new DatabaseInvariantError('GOAL_NOT_FOUND', 'Goal 不存在');
    return updated;
  }
}

export class TaskRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  list(filters: { projectId?: string; goalId?: string; status?: TaskStatus } = {}) {
    const conditions = [
      ...(filters.projectId ? [eq(tasks.projectId, filters.projectId)] : []),
      ...(filters.goalId ? [eq(tasks.goalId, filters.goalId)] : []),
      ...(filters.status ? [eq(tasks.status, filters.status)] : []),
    ];
    const query = this.db.select().from(tasks);
    return conditions.length
      ? query.where(and(...conditions)).orderBy(tasks.status, asc(tasks.position), tasks.createdAt)
      : query.orderBy(tasks.status, asc(tasks.position), tasks.createdAt);
  }

  async get(id: string) {
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return task;
  }

  async create(input: typeof tasks.$inferInsert) {
    const [created] = await this.db.insert(tasks).values(input).returning();
    if (!created) throw new DatabaseInvariantError('TASK_CREATE_FAILED', 'Task 创建失败');
    return created;
  }

  async update(id: string, patch: Partial<typeof tasks.$inferInsert>) {
    const [updated] = await this.db
      .update(tasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    if (!updated) throw new DatabaseInvariantError('TASK_NOT_FOUND', 'Task 不存在');
    return updated;
  }

  async transition(id: string, to: TaskStatus, patch: Partial<typeof tasks.$inferInsert> = {}) {
    return this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ status: tasks.status })
        .from(tasks)
        .where(eq(tasks.id, id))
        .for('update')
        .limit(1);
      if (!current) throw new DatabaseInvariantError('TASK_NOT_FOUND', 'Task 不存在');
      transitionTask(current.status as TaskStatus, to);
      const [updated] = await transaction
        .update(tasks)
        .set({ ...patch, status: to, updatedAt: new Date() })
        .where(and(eq(tasks.id, id), eq(tasks.status, current.status)))
        .returning();
      if (!updated)
        throw new DatabaseInvariantError('TASK_CONCURRENT_UPDATE', 'Task 状态已被其他请求修改');
      return updated;
    });
  }
}

const activeWorktreeExecutionStatuses: WorktreeExecutionStatus[] = [
  'SETTING_UP',
  'RUNNING',
  'AWAITING_INPUT',
  'REVIEW',
  'MERGING',
];

export class WorktreeExecutionRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  list(
    filters: {
      projectId?: string;
      taskId?: string;
      status?: WorktreeExecutionStatus;
    } = {},
  ) {
    const conditions = [
      ...(filters.projectId ? [eq(worktreeExecutions.projectId, filters.projectId)] : []),
      ...(filters.taskId ? [eq(worktreeExecutions.taskId, filters.taskId)] : []),
      ...(filters.status ? [eq(worktreeExecutions.status, filters.status)] : []),
    ];
    const query = this.db.select().from(worktreeExecutions);
    return conditions.length
      ? query
          .where(and(...conditions))
          .orderBy(asc(worktreeExecutions.queuedAt), asc(worktreeExecutions.id))
      : query.orderBy(asc(worktreeExecutions.queuedAt), asc(worktreeExecutions.id));
  }

  async get(id: string) {
    const [execution] = await this.db
      .select()
      .from(worktreeExecutions)
      .where(eq(worktreeExecutions.id, id))
      .limit(1);
    return execution;
  }

  async getByRunId(runId: string) {
    const [execution] = await this.db
      .select()
      .from(worktreeExecutions)
      .where(eq(worktreeExecutions.runId, runId))
      .limit(1);
    return execution;
  }

  async getActiveForTask(taskId: string) {
    const [execution] = await this.db
      .select()
      .from(worktreeExecutions)
      .where(
        and(
          eq(worktreeExecutions.taskId, taskId),
          inArray(worktreeExecutions.status, ['QUEUED', ...activeWorktreeExecutionStatuses]),
        ),
      )
      .limit(1);
    return execution;
  }

  async getActiveForProject(projectId: string) {
    const [execution] = await this.db
      .select()
      .from(worktreeExecutions)
      .where(
        and(
          eq(worktreeExecutions.projectId, projectId),
          inArray(worktreeExecutions.status, activeWorktreeExecutionStatuses),
        ),
      )
      .limit(1);
    return execution;
  }

  async create(input: typeof worktreeExecutions.$inferInsert) {
    const [created] = await this.db.insert(worktreeExecutions).values(input).returning();
    if (!created) {
      throw new DatabaseInvariantError(
        'WORKTREE_EXECUTION_CREATE_FAILED',
        'Worktree Execution 创建失败',
      );
    }
    return created;
  }

  async enqueue(
    input: Omit<typeof worktreeExecutions.$inferInsert, 'status'> & { assignedAgentId: string },
  ) {
    return this.db.transaction(async (transaction) => {
      const [task] = await transaction
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .for('update')
        .limit(1);
      if (!task) throw new DatabaseInvariantError('TASK_NOT_FOUND', 'Task 不存在');
      transitionTask(task.status as TaskStatus, 'IN_PROGRESS');

      const { assignedAgentId, ...executionInput } = input;
      const [execution] = await transaction
        .insert(worktreeExecutions)
        .values({ ...executionInput, status: 'QUEUED' })
        .returning();
      if (!execution) {
        throw new DatabaseInvariantError(
          'WORKTREE_EXECUTION_CREATE_FAILED',
          'Worktree Execution 创建失败',
        );
      }
      const [updatedTask] = await transaction
        .update(tasks)
        .set({
          status: 'IN_PROGRESS',
          assignedAgentId,
          branch: execution.taskBranch,
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, task.id), eq(tasks.status, task.status)))
        .returning();
      if (!updatedTask) {
        throw new DatabaseInvariantError('TASK_CONCURRENT_UPDATE', 'Task 状态已被其他请求修改');
      }
      return { execution, task: updatedTask };
    });
  }

  async patch(id: string, patch: Partial<typeof worktreeExecutions.$inferInsert>) {
    const [updated] = await this.db
      .update(worktreeExecutions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(worktreeExecutions.id, id))
      .returning();
    if (!updated) {
      throw new DatabaseInvariantError('WORKTREE_EXECUTION_NOT_FOUND', 'Worktree Execution 不存在');
    }
    return updated;
  }

  async transition(
    id: string,
    to: WorktreeExecutionStatus,
    patch: Partial<typeof worktreeExecutions.$inferInsert> = {},
  ) {
    return this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ status: worktreeExecutions.status })
        .from(worktreeExecutions)
        .where(eq(worktreeExecutions.id, id))
        .for('update')
        .limit(1);
      if (!current) {
        throw new DatabaseInvariantError(
          'WORKTREE_EXECUTION_NOT_FOUND',
          'Worktree Execution 不存在',
        );
      }
      transitionWorktreeExecution(current.status as WorktreeExecutionStatus, to);
      const [updated] = await transaction
        .update(worktreeExecutions)
        .set({ ...patch, status: to, updatedAt: new Date() })
        .where(and(eq(worktreeExecutions.id, id), eq(worktreeExecutions.status, current.status)))
        .returning();
      if (!updated) {
        throw new DatabaseInvariantError(
          'WORKTREE_EXECUTION_CONCURRENT_UPDATE',
          'Worktree Execution 状态已被其他请求修改',
        );
      }
      return updated;
    });
  }

  async transitionWithTask(
    id: string,
    to: WorktreeExecutionStatus,
    taskTo: TaskStatus,
    executionPatch: Partial<typeof worktreeExecutions.$inferInsert> = {},
    taskPatch: Partial<typeof tasks.$inferInsert> = {},
  ) {
    return this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(worktreeExecutions)
        .where(eq(worktreeExecutions.id, id))
        .for('update')
        .limit(1);
      if (!current) {
        throw new DatabaseInvariantError(
          'WORKTREE_EXECUTION_NOT_FOUND',
          'Worktree Execution 不存在',
        );
      }
      const [task] = await transaction
        .select()
        .from(tasks)
        .where(eq(tasks.id, current.taskId))
        .for('update')
        .limit(1);
      if (!task) throw new DatabaseInvariantError('TASK_NOT_FOUND', 'Task 不存在');
      transitionWorktreeExecution(current.status as WorktreeExecutionStatus, to);
      transitionTask(task.status as TaskStatus, taskTo);

      const [execution] = await transaction
        .update(worktreeExecutions)
        .set({ ...executionPatch, status: to, updatedAt: new Date() })
        .where(and(eq(worktreeExecutions.id, id), eq(worktreeExecutions.status, current.status)))
        .returning();
      const [updatedTask] = await transaction
        .update(tasks)
        .set({ ...taskPatch, status: taskTo, updatedAt: new Date() })
        .where(and(eq(tasks.id, task.id), eq(tasks.status, task.status)))
        .returning();
      if (!execution || !updatedTask) {
        throw new DatabaseInvariantError(
          'WORKTREE_EXECUTION_CONCURRENT_UPDATE',
          'Worktree Execution 或 Task 状态已被其他请求修改',
        );
      }
      return { execution, task: updatedTask };
    });
  }

  async claimNext(projectId: string) {
    return this.db.transaction(async (transaction) => {
      const [active] = await transaction
        .select({ id: worktreeExecutions.id })
        .from(worktreeExecutions)
        .where(
          and(
            eq(worktreeExecutions.projectId, projectId),
            inArray(worktreeExecutions.status, activeWorktreeExecutionStatuses),
          ),
        )
        .for('update')
        .limit(1);
      if (active) return undefined;

      const [queued] = await transaction
        .select()
        .from(worktreeExecutions)
        .where(
          and(eq(worktreeExecutions.projectId, projectId), eq(worktreeExecutions.status, 'QUEUED')),
        )
        .orderBy(asc(worktreeExecutions.queuedAt), asc(worktreeExecutions.id))
        .for('update')
        .limit(1);
      if (!queued) return undefined;

      const [claimed] = await transaction
        .update(worktreeExecutions)
        .set({ status: 'SETTING_UP', startedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(worktreeExecutions.id, queued.id), eq(worktreeExecutions.status, 'QUEUED')))
        .returning();
      if (!claimed) {
        throw new DatabaseInvariantError(
          'WORKTREE_EXECUTION_CONCURRENT_UPDATE',
          'Worktree Execution 已被其他调度器领取',
        );
      }
      return claimed;
    });
  }

  async recoverInterrupted() {
    return this.db
      .update(worktreeExecutions)
      .set({
        status: 'BLOCKED',
        errorCode: 'SERVER_RESTARTED',
        errorMessage: '服务重启中断了 Worktree Execution，请检查保留的工作区后重试',
        updatedAt: new Date(),
      })
      .where(
        inArray(worktreeExecutions.status, ['SETTING_UP', 'RUNNING', 'AWAITING_INPUT', 'MERGING']),
      )
      .returning();
  }

  async listQueuedProjectIds() {
    const rows = await this.db
      .selectDistinct({ projectId: worktreeExecutions.projectId })
      .from(worktreeExecutions)
      .where(eq(worktreeExecutions.status, 'QUEUED'));
    return rows.map((row) => row.projectId);
  }
}

export class SessionRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  list(projectId?: string) {
    const query = this.db.select().from(agentSessions);
    return projectId
      ? query.where(eq(agentSessions.projectId, projectId)).orderBy(agentSessions.createdAt)
      : query.orderBy(agentSessions.createdAt);
  }

  async get(id: string) {
    const [session] = await this.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, id))
      .limit(1);
    return session;
  }

  async create(input: typeof agentSessions.$inferInsert) {
    const [created] = await this.db.insert(agentSessions).values(input).returning();
    if (!created) throw new DatabaseInvariantError('SESSION_CREATE_FAILED', 'Session 创建失败');
    return created;
  }

  async transition(
    id: string,
    to: SessionStatus,
    patch: Partial<typeof agentSessions.$inferInsert> = {},
  ) {
    return this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ status: agentSessions.status })
        .from(agentSessions)
        .where(eq(agentSessions.id, id))
        .for('update')
        .limit(1);
      if (!current) throw new DatabaseInvariantError('SESSION_NOT_FOUND', 'Session 不存在');
      transitionSession(current.status as SessionStatus, to);
      const [updated] = await transaction
        .update(agentSessions)
        .set({ ...patch, status: to, lastActiveAt: new Date() })
        .where(and(eq(agentSessions.id, id), eq(agentSessions.status, current.status)))
        .returning();
      if (!updated)
        throw new DatabaseInvariantError(
          'SESSION_CONCURRENT_UPDATE',
          'Session 状态已被其他请求修改',
        );
      return updated;
    });
  }

  async recoverInterrupted() {
    const activeSessionStates = ['STARTING', 'READY', 'RUNNING', 'WAITING_APPROVAL'] as const;
    const recovered = await this.db
      .update(agentSessions)
      .set({ status: 'DISCONNECTED', lastActiveAt: new Date() })
      .where(inArray(agentSessions.status, activeSessionStates))
      .returning();
    return recovered.map((row) => row.id);
  }
}

export class RunRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  list(sessionId: string) {
    return this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.sessionId, sessionId))
      .orderBy(agentRuns.startedAt);
  }

  listRecent(limit = 20) {
    return this.db
      .select()
      .from(agentRuns)
      .orderBy(desc(agentRuns.startedAt))
      .limit(Math.min(Math.max(limit, 1), 100));
  }

  async get(id: string) {
    const [run] = await this.db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
    return run;
  }

  async findActiveForSession(sessionId: string) {
    const [run] = await this.db
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.sessionId, sessionId),
          inArray(agentRuns.status, ['STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELING']),
        ),
      )
      .limit(1);
    return run;
  }

  async create(input: typeof agentRuns.$inferInsert) {
    const [created] = await this.db.insert(agentRuns).values(input).returning();
    if (!created) throw new DatabaseInvariantError('RUN_CREATE_FAILED', 'Run 创建失败');
    return created;
  }

  async patch(id: string, patch: Partial<typeof agentRuns.$inferInsert>) {
    const [updated] = await this.db
      .update(agentRuns)
      .set(patch)
      .where(eq(agentRuns.id, id))
      .returning();
    if (!updated) throw new DatabaseInvariantError('RUN_NOT_FOUND', 'Run 不存在');
    return updated;
  }

  async transition(id: string, to: RunStatus, patch: Partial<typeof agentRuns.$inferInsert> = {}) {
    return this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ status: agentRuns.status })
        .from(agentRuns)
        .where(eq(agentRuns.id, id))
        .for('update')
        .limit(1);
      if (!current) throw new DatabaseInvariantError('RUN_NOT_FOUND', 'Run 不存在');
      transitionRun(current.status as RunStatus, to);
      const [updated] = await transaction
        .update(agentRuns)
        .set({ ...patch, status: to })
        .where(and(eq(agentRuns.id, id), eq(agentRuns.status, current.status)))
        .returning();
      if (!updated)
        throw new DatabaseInvariantError('RUN_CONCURRENT_UPDATE', 'Run 状态已被其他请求修改');
      return updated;
    });
  }

  async recoverInterrupted() {
    const recoverable = ['STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELING'] as const;
    const disconnected = await this.db
      .update(agentRuns)
      .set({
        status: 'DISCONNECTED',
        finishedAt: new Date(),
        errorCode: 'SERVER_RESTARTED',
        errorMessage: 'AgentHub 重启导致运行连接中断',
      })
      .where(inArray(agentRuns.status, recoverable))
      .returning();
    const queued = await this.db
      .update(agentRuns)
      .set({
        status: 'FAILED',
        finishedAt: new Date(),
        errorCode: 'SERVER_RESTARTED',
        errorMessage: 'AgentHub 重启前 Run 尚未启动',
      })
      .where(eq(agentRuns.status, 'QUEUED'))
      .returning();
    return { disconnected: disconnected.map((row) => row.id), failed: queued.map((row) => row.id) };
  }
}

export class MessageRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  list(sessionId: string) {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.sequence);
  }

  async append(input: Omit<typeof messages.$inferInsert, 'id' | 'sequence'>) {
    return this.db.transaction(async (transaction) => {
      const [latest] = await transaction
        .select({ sequence: max(messages.sequence) })
        .from(messages)
        .where(eq(messages.sessionId, input.sessionId));
      const sequence = Number(latest?.sequence ?? 0) + 1;
      const [created] = await transaction
        .insert(messages)
        .values({ id: randomUUID(), sequence, ...input })
        .returning();
      if (!created) throw new DatabaseInvariantError('MESSAGE_CREATE_FAILED', 'Message 创建失败');
      return created;
    });
  }
}

export class GitSnapshotRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  async create(input: typeof gitSnapshots.$inferInsert) {
    const [created] = await this.db.insert(gitSnapshots).values(input).returning();
    if (!created)
      throw new DatabaseInvariantError('GIT_SNAPSHOT_CREATE_FAILED', 'Git snapshot 创建失败');
    return created;
  }

  list(runId: string) {
    return this.db
      .select()
      .from(gitSnapshots)
      .where(eq(gitSnapshots.runId, runId))
      .orderBy(gitSnapshots.createdAt);
  }
}
