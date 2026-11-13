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

// Dormant persistence foundation: callers must not integrate this reservation
// until runtime phase recording, Run handoff and startup recovery are complete.
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
        session.status !== 'CREATED' ||
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
        .set({ status: phase === 'FAILED_KNOWN' ? 'FAILED' : 'STARTING', lastActiveAt: new Date() })
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
