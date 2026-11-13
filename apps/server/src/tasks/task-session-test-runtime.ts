import { randomUUID } from 'node:crypto';
import {
  RunRepository,
  SessionRepository,
  TaskStartAttemptRepository,
  type AgentHubDatabase,
} from '@agenthub/db';
import type { CreateSessionInput, StartRunInput } from '../sessions/session-service.js';
import type { TaskSessionController } from './task-service.js';

// Deterministic fake runtime with the real durable admission boundary. Hooks do
// not create their own Session rows or bypass the Task reservation contract.
export function taskSessionTestRuntime(
  db: AgentHubDatabase,
  hooks: {
    beforeCreate?: (input: CreateSessionInput) => Promise<unknown>;
    create?: (input: CreateSessionInput) => Promise<unknown>;
    start?: (sessionId: string, input: StartRunInput) => Promise<unknown>;
  } = {},
): TaskSessionController {
  const attempts = new TaskStartAttemptRepository(db);
  return {
    async createForTask(input, admission) {
      await hooks.beforeCreate?.(input);
      const id = randomUUID(),
        attemptId = randomUUID();
      await attempts.reserve({ attemptId, ...admission, session: { ...input, id } });
      if (!(await attempts.markCreateAttempted(attemptId))) throw new Error('测试预留已变化');
      await hooks.create?.(input);
      const session = await attempts.recordSessionReady(attemptId, {
        externalSessionId: `fixture-${id}`,
        startedAt: new Date(),
      });
      if (!session) throw new Error('测试Session归属已变化');
      return { ...session, taskStartAttemptId: attemptId };
    },
    async startTaskRun(sessionId, input, attemptId) {
      await hooks.start?.(sessionId, input);
      const session = await new SessionRepository(db).get(sessionId);
      return new RunRepository(db).create(
        {
          id: randomUUID(),
          sessionId,
          taskId: session!.taskId,
          status: 'RUNNING',
          dispatchState: 'ATTEMPTED',
        },
        { taskStartAttemptId: attemptId },
      );
    },
  };
}
