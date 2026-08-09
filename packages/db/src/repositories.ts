import { randomUUID } from 'node:crypto';

import { and, eq, inArray, max, sql } from 'drizzle-orm';
import {
  transitionRun,
  transitionSession,
  type RunStatus,
  type SessionStatus,
} from '@agenthub/agent-core';

import type { AgentHubDatabase } from './client.js';
import {
  agents,
  agentRuns,
  agentSessions,
  approvalRequests,
  executionTargets,
  gitSnapshots,
  messages,
  projects,
  promptLabels,
  prompts,
  promptVersions,
  runEvents,
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
