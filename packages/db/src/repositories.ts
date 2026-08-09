import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import type { AgentHubDatabase } from './client.js';
import {
  agents,
  agentSessions,
  approvalRequests,
  executionTargets,
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
