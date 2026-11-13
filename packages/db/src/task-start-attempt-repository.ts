import { and, eq, inArray, or } from 'drizzle-orm';
import type { AgentHubDatabase } from './client.js';
import { DatabaseInvariantError } from './repositories.js';
import {
  agentRuns,
  agentSessions,
  tasks,
  taskStartAttempts,
  worktreeExecutions,
} from './schema.js';

export interface ReserveTaskStartInput {
  attemptId: string;
  kind: 'START' | 'REWORK';
  expectedOldSessionId: string | null;
  inputHash: string;
  session: Pick<
    typeof agentSessions.$inferInsert,
    | 'id'
    | 'taskId'
    | 'projectId'
    | 'agentId'
    | 'title'
    | 'cwd'
    | 'branch'
    | 'model'
    | 'mode'
    | 'reasoningEffort'
  >;
}

// Durable Task start ownership; all phase changes share Task -> Session -> Attempt locks.
export class TaskStartAttemptRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  async get(id: string) {
    const [attempt] = await this.db
      .select()
      .from(taskStartAttempts)
      .where(eq(taskStartAttempts.id, id))
      .limit(1);
    return attempt;
  }

  async getForTask(taskId: string) {
    return this.db.select().from(taskStartAttempts).where(eq(taskStartAttempts.taskId, taskId));
  }

  async getBySession(sessionId: string) {
    const [attempt] = await this.db
      .select()
      .from(taskStartAttempts)
      .where(eq(taskStartAttempts.sessionId, sessionId))
      .limit(1);
    return attempt;
  }

  async recordSessionReady(
    id: string,
    patch: { externalSessionId?: string | undefined; startedAt: Date },
  ) {
    return this.resolveCreated(id, 'SESSION_READY', patch);
  }

  async markUnknown(id: string, errorCode: string) {
    return this.resolveCreated(id, 'UNKNOWN', undefined, errorCode);
  }

  private async resolveCreated(
    id: string,
    phase: 'SESSION_READY' | 'UNKNOWN',
    patch?: { externalSessionId?: string | undefined; startedAt: Date },
    errorCode = 'TASK_SESSION_CREATE_UNKNOWN',
  ) {
    const candidate = await this.get(id);
    if (!candidate) return undefined;
    return this.db.transaction(async (transaction) => {
      const [task] = await transaction
        .select()
        .from(tasks)
        .where(eq(tasks.id, candidate.taskId))
        .for('update')
        .limit(1);
      const [session] = await transaction
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, candidate.sessionId))
        .for('update')
        .limit(1);
      const [attempt] = await transaction
        .select()
        .from(taskStartAttempts)
        .where(eq(taskStartAttempts.id, id))
        .for('update')
        .limit(1);
      if (
        !task ||
        !session ||
        !attempt ||
        attempt.taskId !== task.id ||
        attempt.sessionId !== session.id ||
        !['CREATE_ATTEMPTED', ...(phase === 'UNKNOWN' ? ['SESSION_READY'] : [])].includes(
          attempt.phase,
        ) ||
        task.status !== 'IN_PROGRESS' ||
        task.sessionId !== session.id ||
        task.assignedAgentId !== attempt.agentId ||
        task.projectId !== attempt.projectId ||
        session.taskId !== task.id ||
        session.agentId !== attempt.agentId ||
        session.projectId !== attempt.projectId ||
        session.latestRunId !== null ||
        ![
          'STARTING',
          ...(phase === 'UNKNOWN' ? ['READY', 'DISCONNECTED', 'FAILED', 'CLOSED'] : []),
        ].includes(session.status)
      )
        return undefined;
      const [run] = await transaction
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(eq(agentRuns.sessionId, session.id))
        .limit(1);
      if (run) return undefined;
      await transaction
        .update(taskStartAttempts)
        .set({ phase, errorCode: phase === 'UNKNOWN' ? errorCode : null, updatedAt: new Date() })
        .where(eq(taskStartAttempts.id, id));
      const [updated] = await transaction
        .update(agentSessions)
        .set({
          status:
            phase === 'SESSION_READY'
              ? 'READY'
              : session.status === 'CLOSED'
                ? 'CLOSED'
                : 'DISCONNECTED',
          ...(phase === 'SESSION_READY' ? patch : {}),
          lastActiveAt: new Date(),
        })
        .where(eq(agentSessions.id, session.id))
        .returning();
      return updated;
    });
  }

  async recoverAfterRestart() {
    const candidates = await this.db
      .select()
      .from(taskStartAttempts)
      .where(inArray(taskStartAttempts.phase, ['RESERVED', 'CREATE_ATTEMPTED', 'SESSION_READY']));
    const released: string[] = [],
      unknown: string[] = [];
    for (const candidate of candidates) {
      if (candidate.phase === 'RESERVED') {
        if (await this.releaseUnattempted(candidate.id)) released.push(candidate.id);
      } else if (await this.markUnknown(candidate.id, 'TASK_SESSION_CREATE_RECOVERY_REQUIRED'))
        unknown.push(candidate.id);
    }
    return { released, unknown };
  }

  async reserve(input: ReserveTaskStartInput) {
    if (!input.session.taskId || !input.inputHash)
      throw new DatabaseInvariantError(
        'TASK_START_RESERVATION_INVALID',
        '启动预留缺少任务或输入标识',
      );
    return this.db.transaction(async (transaction) => {
      const [task] = await transaction
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.session.taskId!))
        .for('update')
        .limit(1);
      if (!task) throw new DatabaseInvariantError('TASK_NOT_FOUND', 'Task 不存在');
      if (
        task.status !== (input.kind === 'START' ? 'READY' : 'WAITING_REVIEW') ||
        task.sessionId !== input.expectedOldSessionId ||
        task.projectId !== input.session.projectId ||
        (input.kind === 'REWORK' && task.assignedAgentId !== input.session.agentId)
      )
        throw new DatabaseInvariantError(
          'TASK_START_OWNERSHIP_CHANGED',
          '任务启动归属已变化，尚未创建会话',
        );
      // Queue admission uses the same Task lock. Do not invert its E -> T order.
      const [managed] = await transaction
        .select({ id: worktreeExecutions.id })
        .from(worktreeExecutions)
        .where(eq(worktreeExecutions.taskId, task.id))
        .limit(1);
      if (managed)
        throw new DatabaseInvariantError('TASK_WORKTREE_MANAGED', '该任务由隔离执行管理');
      const [pending] = await transaction
        .select({ id: taskStartAttempts.id })
        .from(taskStartAttempts)
        .where(
          and(
            eq(taskStartAttempts.taskId, task.id),
            inArray(taskStartAttempts.phase, [
              'RESERVED',
              'CREATE_ATTEMPTED',
              'SESSION_READY',
              'UNKNOWN',
            ]),
          ),
        )
        .limit(1);
      const [blocking] = await transaction
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(
          and(
            or(
              eq(agentRuns.taskId, task.id),
              ...(task.sessionId ? [eq(agentRuns.sessionId, task.sessionId)] : []),
            ),
            or(
              inArray(agentRuns.status, [
                'QUEUED',
                'STARTING',
                'RUNNING',
                'WAITING_APPROVAL',
                'CANCELING',
                'DISCONNECTED',
              ]),
              and(
                eq(agentRuns.dispatchState, 'LEGACY_UNKNOWN'),
                inArray(agentRuns.status, ['FAILED', 'CANCELED']),
                inArray(agentRuns.errorCode, [
                  'CANCEL_CONFIRMATION_TIMEOUT',
                  'AGENT_RUN_CANCEL_FAILED',
                  'AGENT_RUN_START_FAILED',
                  'SERVER_RESTARTED',
                ]),
              ),
              eq(agentRuns.errorCode, 'RUN_PREPARATION_RECOVERY_REQUIRED'),
            ),
          ),
        )
        .limit(1);
      if (pending || blocking)
        throw new DatabaseInvariantError(
          'TASK_START_UNRESOLVED',
          '任务存在未决启动或运行，请核对原操作',
        );
      // Existing no-Run sessions carry no durable proof that external creation
      // was never attempted. Do not "repair" them by starting another process.
      const previousSessions = await transaction
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.taskId, task.id));
      const previousAttempts = await transaction
        .select()
        .from(taskStartAttempts)
        .where(eq(taskStartAttempts.taskId, task.id));
      const previousRuns = await transaction
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.taskId, task.id));
      for (const previous of previousSessions) {
        const proof = previousAttempts.find((row) => row.sessionId === previous.id);
        if (proof?.phase === 'FAILED_KNOWN') continue;
        const last = previousRuns.find(
          (run) => run.id === previous.latestRunId && run.sessionId === previous.id,
        );
        if (
          !last ||
          !['COMPLETED', 'FAILED', 'CANCELED'].includes(last.status) ||
          (last.dispatchState === 'LEGACY_UNKNOWN' && last.status !== 'COMPLETED') ||
          last.errorCode === 'RUN_PREPARATION_RECOVERY_REQUIRED'
        )
          throw new DatabaseInvariantError(
            'TASK_START_UNRESOLVED',
            '历史会话创建或执行结果未确认，不能重复启动',
          );
      }
      const [session] = await transaction
        .insert(agentSessions)
        .values({ ...input.session, taskId: task.id, status: 'CREATED' })
        .returning();
      const [attempt] = await transaction
        .insert(taskStartAttempts)
        .values({
          id: input.attemptId,
          taskId: task.id,
          sessionId: input.session.id,
          projectId: task.projectId,
          agentId: input.session.agentId,
          expectedOldSessionId: input.expectedOldSessionId,
          kind: input.kind,
          inputHash: input.inputHash,
          phase: 'RESERVED',
        })
        .returning();
      const [updatedTask] = await transaction
        .update(tasks)
        .set({
          status: 'IN_PROGRESS',
          sessionId: input.session.id,
          assignedAgentId: input.session.agentId,
          finalRunId: null,
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id))
        .returning();
      if (!session || !attempt || !updatedTask)
        throw new DatabaseInvariantError('TASK_START_RESERVATION_FAILED', '启动预留未完整保存');
      return { attempt, session, task: updatedTask };
    });
  }

  // Only the caller receiving a record from this one-shot CAS may invoke the
  // adapter. A retry that finds CREATE_ATTEMPTED must never invoke it again.
  async markCreateAttempted(id: string) {
    return this.resolveReserved(id, 'CREATE_ATTEMPTED');
  }

  // Recovery may release only positive RESERVED evidence, never FAILED/timeout
  // inference. This shares locks/CAS with markCreateAttempted.
  async releaseUnattempted(id: string) {
    return this.resolveReserved(id, 'FAILED_KNOWN');
  }

  private async resolveReserved(id: string, phase: 'CREATE_ATTEMPTED' | 'FAILED_KNOWN') {
    const candidate = await this.get(id);
    if (!candidate) return undefined;
    return this.db.transaction(async (transaction) => {
      // All updates to attempts must use Task -> Session -> Attempt.
      const [task] = await transaction
        .select()
        .from(tasks)
        .where(eq(tasks.id, candidate.taskId))
        .for('update')
        .limit(1);
      const [session] = await transaction
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.id, candidate.sessionId))
        .for('update')
        .limit(1);
      const [attempt] = await transaction
        .select()
        .from(taskStartAttempts)
        .where(eq(taskStartAttempts.id, id))
        .for('update')
        .limit(1);
      if (
        !task ||
        !session ||
        !attempt ||
        attempt.taskId !== task.id ||
        attempt.sessionId !== session.id ||
        attempt.phase !== 'RESERVED' ||
        task.status !== 'IN_PROGRESS' ||
        task.sessionId !== attempt.sessionId ||
        task.assignedAgentId !== attempt.agentId ||
        task.projectId !== attempt.projectId ||
        session.taskId !== task.id ||
        session.agentId !== attempt.agentId ||
        session.projectId !== attempt.projectId ||
        !['CREATED', ...(phase === 'FAILED_KNOWN' ? ['CLOSED'] : [])].includes(session.status) ||
        session.latestRunId !== null
      )
        return undefined;
      // Defend against inconsistent legacy/manual rows, not just latestRunId.
      const [run] = await transaction
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(eq(agentRuns.sessionId, session.id))
        .limit(1);
      if (run) return undefined;
      const [updated] = await transaction
        .update(taskStartAttempts)
        .set({
          phase,
          errorCode: phase === 'FAILED_KNOWN' ? 'TASK_START_NOT_ATTEMPTED' : null,
          updatedAt: new Date(),
        })
        .where(and(eq(taskStartAttempts.id, id), eq(taskStartAttempts.phase, 'RESERVED')))
        .returning();
      if (!updated) return undefined;
      await transaction
        .update(agentSessions)
        .set({
          status:
            phase === 'FAILED_KNOWN'
              ? session.status === 'CLOSED'
                ? 'CLOSED'
                : 'FAILED'
              : 'STARTING',
          lastActiveAt: new Date(),
        })
        .where(eq(agentSessions.id, session.id));
      if (phase === 'FAILED_KNOWN')
        await transaction
          .update(tasks)
          .set({ status: 'BLOCKED', updatedAt: new Date() })
          .where(eq(tasks.id, task.id));
      return updated;
    });
  }
}
