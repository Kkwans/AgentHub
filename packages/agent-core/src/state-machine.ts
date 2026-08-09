export type SessionStatus =
  | 'CREATED'
  | 'STARTING'
  | 'READY'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'DISCONNECTED'
  | 'FAILED'
  | 'CLOSED';

export type RunStatus =
  | 'QUEUED'
  | 'STARTING'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'CANCELING'
  | 'CANCELED'
  | 'COMPLETED'
  | 'FAILED'
  | 'DISCONNECTED';

export type TaskStatus =
  'BACKLOG' | 'READY' | 'IN_PROGRESS' | 'WAITING_REVIEW' | 'DONE' | 'BLOCKED' | 'CANCELED';

export class InvalidStateTransitionError<TState extends string> extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';

  constructor(
    readonly entity: 'SESSION' | 'RUN' | 'TASK',
    readonly from: TState,
    readonly to: TState,
  ) {
    super(`${entity} 不允许从 ${from} 转换为 ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

const sessionTransitions: Record<SessionStatus, readonly SessionStatus[]> = {
  CREATED: ['STARTING', 'FAILED', 'CLOSED'],
  STARTING: ['READY', 'FAILED', 'DISCONNECTED', 'CLOSED'],
  READY: ['RUNNING', 'FAILED', 'DISCONNECTED', 'CLOSED'],
  RUNNING: ['READY', 'WAITING_APPROVAL', 'FAILED', 'DISCONNECTED', 'CLOSED'],
  WAITING_APPROVAL: ['RUNNING', 'READY', 'FAILED', 'DISCONNECTED', 'CLOSED'],
  DISCONNECTED: ['READY', 'FAILED', 'CLOSED'],
  FAILED: ['CLOSED'],
  CLOSED: [],
};

const runTransitions: Record<RunStatus, readonly RunStatus[]> = {
  QUEUED: ['STARTING', 'CANCELED', 'FAILED'],
  STARTING: ['RUNNING', 'CANCELING', 'CANCELED', 'FAILED', 'DISCONNECTED'],
  RUNNING: ['WAITING_APPROVAL', 'CANCELING', 'CANCELED', 'COMPLETED', 'FAILED', 'DISCONNECTED'],
  WAITING_APPROVAL: ['RUNNING', 'CANCELING', 'CANCELED', 'FAILED', 'DISCONNECTED'],
  CANCELING: ['CANCELED', 'FAILED'],
  DISCONNECTED: ['RUNNING', 'CANCELING', 'CANCELED', 'FAILED'],
  CANCELED: [],
  COMPLETED: [],
  FAILED: [],
};

const taskTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  BACKLOG: ['READY', 'CANCELED'],
  READY: ['IN_PROGRESS', 'BLOCKED', 'CANCELED'],
  IN_PROGRESS: ['WAITING_REVIEW', 'BLOCKED', 'CANCELED'],
  WAITING_REVIEW: ['DONE', 'IN_PROGRESS', 'BLOCKED', 'CANCELED'],
  BLOCKED: ['READY', 'IN_PROGRESS', 'CANCELED'],
  DONE: [],
  CANCELED: [],
};

export function transitionSession(from: SessionStatus, to: SessionStatus): SessionStatus {
  return assertTransition('SESSION', sessionTransitions, from, to);
}

export function transitionRun(from: RunStatus, to: RunStatus): RunStatus {
  return assertTransition('RUN', runTransitions, from, to);
}

export function transitionTask(from: TaskStatus, to: TaskStatus): TaskStatus {
  return assertTransition('TASK', taskTransitions, from, to);
}

function assertTransition<TState extends string>(
  entity: 'SESSION' | 'RUN' | 'TASK',
  transitions: Record<TState, readonly TState[]>,
  from: TState,
  to: TState,
): TState {
  if (!transitions[from].includes(to)) throw new InvalidStateTransitionError(entity, from, to);
  return to;
}
