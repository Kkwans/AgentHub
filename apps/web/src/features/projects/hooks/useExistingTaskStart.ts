import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, type TaskRecord } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';
import { readTaskStartAttempts } from '../lib/task-start-attempts';
import {
  persistExistingStart,
  readExistingStart,
  refreshExistingStart,
  startEpoch,
  startScopeKey,
  subscribeExistingStart,
  writeExistingStart,
  updateExistingStartDisplay,
} from '../lib/existing-task-start-state';

const safeCodes = new Set([
  'TASK_NOT_READY',
  'TASK_OPERATION_IN_PROGRESS',
  'PROJECT_NOT_FOUND',
  'PROJECT_NOT_ACTIVE',
  'AGENT_NOT_FOUND',
  'AGENT_NOT_READY',
  'AGENT_PROJECT_TARGET_MISMATCH',
  'TASK_PROMPT_VARIABLES_MISSING',
  'TASK_PROMPT_RESOLUTION_FAILED',
]);
export function useExistingTaskStart(options: {
  projectId: string;
  task: TaskRecord | undefined;
  scope: string | null;
  agentId: string;
  eligible: boolean;
  onChanged: () => void;
  onStarted: (sessionId: string) => void;
}) {
  const { projectId, task, scope, agentId } = options;
  const key = startScopeKey(scope, projectId, task?.id);
  const state = useSyncExternalStore(subscribeExistingStart, () => readExistingStart(key));
  const latest = useRef(options);
  latest.current = options;
  const identity = JSON.stringify([key, agentId]);
  const current = useRef(identity);
  const identityGeneration = useRef(0);
  if (current.current !== identity) identityGeneration.current += 1;
  const eligibilityToken = useRef({
    identity,
    eligible: options.eligible,
    generation: 0,
  });
  if (
    eligibilityToken.current.identity !== identity ||
    eligibilityToken.current.eligible !== options.eligible
  ) {
    eligibilityToken.current = {
      identity,
      eligible: options.eligible,
      generation: eligibilityToken.current.generation + 1,
    };
  }
  current.current = identity;
  const mounted = useRef(true);
  const authorizedEpoch = useRef(startEpoch());
  const previousScope = useRef(scope);
  if (previousScope.current !== scope) {
    previousScope.current = scope;
    authorizedEpoch.current = startEpoch();
  }

  type CheckToken = { identity: string; generation: number };
  const [checkingToken, setCheckingToken] = useState<CheckToken | null>(null);
  const checkBusy = useRef<CheckToken | null>(null);
  const checking =
    checkingToken?.identity === identity && checkingToken.generation === identityGeneration.current;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const begin = async () => {
    const previous = refreshExistingStart(key);
    if (
      previous?.storageReadFailed ||
      !scope ||
      authorizedEpoch.current !== startEpoch() ||
      !task ||
      !agentId ||
      !latest.current.eligible ||
      (previous &&
        previous.phase !== 'retryable' &&
        !(previous.phase === 'confirmed' && previous.sessionId === task.sessionId))
    )
      return;
    if (!['BACKLOG', 'BLOCKED', 'READY'].includes(task.status)) return;
    const epoch = startEpoch();
    const generation = eligibilityToken.current.generation;
    const navigationGeneration = identityGeneration.current;
    const navigationActive = () =>
      mounted.current &&
      current.current === identity &&
      startEpoch() === epoch &&
      identityGeneration.current === navigationGeneration;
    const active = () =>
      mounted.current &&
      current.current === identity &&
      startEpoch() === epoch &&
      eligibilityToken.current.generation === generation;
    let stage: 'prepare' | 'start' = task.status === 'READY' ? 'start' : 'prepare';
    const update = (
      phase: 'pending' | 'unknown' | 'retryable' | 'confirmed',
      message: string,
      sessionId?: string,
    ) => {
      if (startEpoch() === epoch)
        writeExistingStart(key, {
          phase,
          stage,
          message,
          ...(sessionId ? { sessionId } : {}),
        });
    };
    if (!persistExistingStart(key, { phase: 'pending', stage, message: '' })) {
      update('retryable', '浏览器无法保存启动保护记录，本次未发送请求。恢复存储后再试。');
      return;
    }
    update('pending', stage === 'prepare' ? '正在准备原任务…' : '正在启动原任务…');
    try {
      if (stage === 'prepare') {
        const prepared = await api.post<TaskRecord>(`/tasks/${task.id}/transition`, {
          status: 'READY',
        });
        if (
          prepared?.id !== task.id ||
          prepared.projectId !== projectId ||
          prepared.status !== 'READY'
        )
          throw new Error('准备响应无法确认');
        if (!active() || !latest.current.eligible) {
          update('unknown', '上下文已变化，未继续启动；请核对原任务。');
          return;
        }
        stage = 'start';
        update('pending', '正在启动原任务…');
      }
      const result = await api.post<{
        task: TaskRecord;
        session: { id: string; taskId: string; projectId: string };
        run: { id: string; sessionId: string };
      }>(`/tasks/${task.id}/start`, { agentId });
      if (
        !result?.session?.id ||
        !result.run?.id ||
        result.task?.id !== task.id ||
        result.task.projectId !== projectId ||
        result.task.sessionId !== result.session.id ||
        result.session.taskId !== task.id ||
        result.session.projectId !== projectId ||
        result.run.sessionId !== result.session.id
      )
        throw new Error('启动响应无法确认');
      update('confirmed', '本次启动已确认，可打开原会话。', result.session.id);
      if (navigationActive()) {
        latest.current.onChanged();
        latest.current.onStarted(result.session.id);
      }
    } catch (error) {
      if (readExistingStart(key)?.phase === 'confirmed') return; // UI callback failure cannot undo authoritative success.
      const safe =
        error instanceof ApiError &&
        safeCodes.has(error.code) &&
        error.status >= 400 &&
        error.status < 500;
      update(
        safe ? 'retryable' : 'unknown',
        safe
          ? error.message || '服务器明确拒绝本次操作；修正后可手动重新启动。'
          : '原操作结果未知。请只读核对，不要重复启动。',
      );
      if (active()) latest.current.onChanged();
    }
  };
  const check = async () => {
    if (
      !scope ||
      authorizedEpoch.current !== startEpoch() ||
      !task ||
      (checkBusy.current?.identity === identity &&
        checkBusy.current.generation === identityGeneration.current) ||
      state?.phase === 'pending'
    )
      return;
    const epoch = startEpoch();
    const capturedGeneration = identityGeneration.current;
    let captured = readExistingStart(key);
    if (captured?.storageReadFailed) captured = refreshExistingStart(key);
    if (!captured || captured.storageReadFailed || captured.phase === 'pending') return;
    const active = () =>
      mounted.current &&
      current.current === identity &&
      startEpoch() === epoch &&
      identityGeneration.current === capturedGeneration;
    const token = { identity, generation: capturedGeneration };
    checkBusy.current = token;
    setCheckingToken(token);
    try {
      const row = await api.get<TaskRecord>(`/tasks/${task.id}`);
      if (!active()) return;
      if (
        row?.id !== task.id ||
        row.projectId !== projectId ||
        ![
          'BACKLOG',
          'READY',
          'IN_PROGRESS',
          'WAITING_REVIEW',
          'DONE',
          'BLOCKED',
          'CANCELED',
        ].includes(row.status) ||
        !(row.sessionId == null || (typeof row.sessionId === 'string' && row.sessionId.length > 0))
      )
        throw new Error('身份不匹配');
      const attempts = await readTaskStartAttempts(projectId, task.id, active);
      if (!active() || readExistingStart(key) !== captured) return;
      updateExistingStartDisplay(key, captured, {
        message: `核对到原任务状态 ${row.status}，共 ${attempts.length} 条历史启动记录。这不证明本次请求成功，未重新启动。`,
        observedSessionId: row.sessionId ?? undefined,
      });
      latest.current.onChanged();
    } catch {
      if (active() && readExistingStart(key) === captured)
        updateExistingStartDisplay(key, captured, {
          message: '查询失败，原操作仍待核对；未重新启动。',
        });
    } finally {
      if (checkBusy.current === token) {
        checkBusy.current = null;
        if (mounted.current) setCheckingToken(null);
      }
    }
  };
  return {
    state,
    checking,
    check,
    begin,
    isPending: state?.phase === 'pending',
    locked: state?.phase === 'pending' || state?.phase === 'unknown',
    unavailable: state?.phase === 'confirmed' && state.sessionId !== task?.sessionId,
    reset: () => {
      const previous = readExistingStart(key);
      if (previous?.phase === 'retryable' && !previous.storageReadFailed)
        updateExistingStartDisplay(key, previous, {
          message: '变量已更新，可手动重新启动。',
        });
    },
  };
}
