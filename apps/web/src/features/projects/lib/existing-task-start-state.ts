import { authSession } from '../../../lib/api';
export type ExistingStartState = {
  phase: 'pending' | 'unknown' | 'retryable' | 'confirmed';
  stage: 'prepare' | 'start';
  message: string;
  sessionId?: string | undefined;
  observedSessionId?: string | undefined;
  storageReadFailed?: boolean;
};
const records = new Map<string, ExistingStartState>();
const listeners = new Set<() => void>();
let epoch = 0;
let installed = false;
export const startScopeKey = (scope: string | null, project: string, task?: string) =>
  JSON.stringify([scope, project, task]);
export const startEpoch = () => epoch;
const prefix = 'agenthub.existing-task-start.v1:';
export function readExistingStart(key: string) {
  if (records.has(key)) return records.get(key);
  let readSucceeded = false;
  try {
    const stored = localStorage.getItem(prefix + key);
    readSucceeded = true;
    if (!stored) return undefined;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid');
    const value = parsed as Record<string, unknown>;
    if (
      !['pending', 'unknown', 'retryable', 'confirmed'].includes(String(value.phase)) ||
      !['prepare', 'start'].includes(String(value.stage))
    )
      throw new Error('invalid');
    const state: ExistingStartState = {
      phase:
        value.phase === 'retryable'
          ? 'retryable'
          : value.phase === 'confirmed' &&
              typeof value.sessionId === 'string' &&
              value.sessionId.length > 0
            ? 'confirmed'
            : 'unknown',
      ...(value.phase === 'confirmed' && typeof value.sessionId === 'string'
        ? { sessionId: value.sessionId }
        : {}),
      stage: value.stage as 'prepare' | 'start',
      message: '已恢复原任务操作记录，请先只读核对；不会自动启动。',
    };
    records.set(key, state);
    return state;
  } catch {
    const state: ExistingStartState = {
      phase: 'unknown',
      stage: 'start',
      storageReadFailed: !readSucceeded,
      message: '无法读取启动保护记录；已阻止启动，请恢复浏览器存储后核对。',
    };
    records.set(key, state);
    return state;
  }
}
export function refreshExistingStart(key: string) {
  const previous = records.get(key);
  records.delete(key);
  const restored = readExistingStart(key);
  if (restored?.storageReadFailed && previous) {
    // Reading failed, not the prior operation. Preserve positive rejection evidence,
    // but deny admission until a successful read can rule out an external marker.
    records.set(key, {
      ...previous,
      storageReadFailed: true,
      message: restored.message,
    });
  } else if (previous && (previous.phase === 'pending' || previous.phase === 'unknown')) {
    // An uncorrelated cross-tab success/rejection is not proof about our request.
    records.set(key, { ...previous, storageReadFailed: false });
  } else if (!restored && previous) {
    // Deleting storage never unlocks a genuine pending/unknown operation.
    records.set(key, { ...previous, storageReadFailed: false });
  }
  listeners.forEach((notify) => notify());
  return records.get(key);
}
export function persistExistingStart(key: string, state: ExistingStartState) {
  try {
    const value = JSON.stringify({
      phase: state.phase,
      stage: state.stage,
      ...(state.phase === 'confirmed' && state.sessionId ? { sessionId: state.sessionId } : {}),
    });
    localStorage.setItem(prefix + key, value);
    return localStorage.getItem(prefix + key) === value;
  } catch {
    return false;
  }
}
export function writeExistingStart(key: string, state: ExistingStartState) {
  persistExistingStart(key, state);
  records.set(key, state);
  listeners.forEach((listener) => listener());
}
/** Display-only observations cannot rewrite durable operation evidence. */
export function updateExistingStartDisplay(
  key: string,
  expected: ExistingStartState,
  display: Pick<ExistingStartState, 'message' | 'observedSessionId'>,
) {
  if (records.get(key) !== expected) return;
  records.set(key, { ...expected, ...display });
  listeners.forEach((listener) => listener());
}
export function subscribeExistingStart(listener: () => void) {
  if (!installed) {
    installed = true;
    window.addEventListener('storage', (event) => {
      if (event.key?.startsWith(prefix)) {
        refreshExistingStart(event.key.slice(prefix.length));
        listeners.forEach((notify) => notify());
      }
    });
    authSession.onAuthorizationRequired(() => {
      epoch += 1;
      for (const [key, state] of records)
        if (state.phase === 'pending')
          records.set(key, {
            ...state,
            phase: 'unknown',
            message: '授权已变化，原操作结果待核对；不会再次启动。',
          });
      listeners.forEach((notify) => notify());
    });
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test isolation only; never used as an operation recovery action. */
export function resetExistingStartForTests() {
  records.clear();
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) localStorage.removeItem(key);
  }
}
