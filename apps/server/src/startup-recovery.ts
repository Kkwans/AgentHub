import type { AgentHubDatabase, RunRepository } from '@agenthub/db';
import type { SessionService } from './sessions/session-service.js';
import type { TaskService } from './tasks/task-service.js';
import type { WorktreeTaskService } from './worktrees/worktree-task-service.js';

// Called before listen() and before resumeQueued(). Failure is fatal to startup;
// no request may dispatch while recovery is only partially persisted.
export async function recoverRuntimeAfterRestart(services: {
  sessions: Pick<SessionService, 'recoverAfterRestart'>;
  worktrees: Pick<WorktreeTaskService, 'recoverAfterRestart'>;
  tasks: Pick<TaskService, 'recoverAfterRestart'>;
  runs: Pick<RunRepository<AgentHubDatabase>, 'clearReconciledPreparationFences'>;
}) {
  const sessions = await services.sessions.recoverAfterRestart();
  const worktrees = await services.worktrees.recoverAfterRestart();
  const tasks = await services.tasks.recoverAfterRestart();
  const preparationFences = await services.runs.clearReconciledPreparationFences();
  return { sessions, worktrees, tasks, preparationFences };
}
