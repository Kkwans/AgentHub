import { useEffect, useRef, useState } from 'react';
import { api, authSession } from '../../../lib/api';

type Snapshot = {
  id: string;
  projectId: string;
  status: string;
  sessionId?: unknown;
  assignedAgentId?: unknown;
};
type State = { busy: boolean; unknown: boolean; message: string; status?: string };
const empty: State = { busy: false, unknown: false, message: '' };
function snapshot(value: unknown, projectId: string, taskId: string): Snapshot {
  if (!value || typeof value !== 'object') throw new Error('任务状态无法确认');
  const row = value as Snapshot;
  if (
    row.id !== taskId ||
    row.projectId !== projectId ||
    !['BACKLOG', 'READY', 'IN_PROGRESS', 'WAITING_REVIEW', 'DONE', 'BLOCKED', 'CANCELED'].includes(
      row.status,
    )
  )
    throw new Error('任务身份或状态无法确认');
  return row;
}

// Only changes the selected manual Task's state. Never creates a Task, Session or Run.
export function useManualTaskStart(
  projectId: string,
  taskId: string | undefined,
  scope: string | null,
  onChanged: () => void,
) {
  const identity = `${scope ?? 'unauthorized'}:${projectId}:${taskId ?? ''}`;
  const current = useRef(identity);
  const generation = useRef(0);
  if (current.current !== identity) {
    current.current = identity;
    generation.current += 1;
  }
  const mounted = useRef(true);
  const pending = useRef(false);
  const [pendingState, setPendingState] = useState(false);
  const callback = useRef(onChanged);
  callback.current = onChanged;
  const records = useRef(new Map<string, State>());
  const [, redraw] = useState(0);
  const revoked = useRef(false);
  const previousScope = useRef(scope);
  if (previousScope.current !== scope) {
    previousScope.current = scope;
    revoked.current = false;
  }
  const state = records.current.get(identity) ?? empty;
  useEffect(() => {
    mounted.current = true;
    const stop = authSession.onAuthorizationRequired(() => {
      revoked.current = true;
      generation.current += 1;
      redraw((value) => value + 1);
    });
    return () => {
      mounted.current = false;
      generation.current += 1;
      stop();
    };
  }, []);

  const operate = async (write: boolean) => {
    const previous = records.current.get(identity) ?? empty;
    if (
      !mounted.current ||
      current.current !== identity ||
      !taskId ||
      !scope ||
      revoked.current ||
      pending.current ||
      (write && previous.unknown && !previous.status)
    )
      return;
    const frozen = { projectId, taskId, identity, generation: generation.current };
    const live = () =>
      mounted.current &&
      !revoked.current &&
      current.current === frozen.identity &&
      generation.current === frozen.generation;
    const update = (value: State) => {
      if (live()) {
        records.current.set(frozen.identity, value);
        redraw((version) => version + 1);
      }
    };
    pending.current = true;
    setPendingState(true);
    update({
      ...previous,
      busy: true,
      message: write ? '正在核对并开始手工任务…' : '正在查询原任务状态…',
    });
    let attempted = false;
    try {
      let task = snapshot(
        await api.get<unknown>(`/tasks/${encodeURIComponent(frozen.taskId)}`),
        frozen.projectId,
        frozen.taskId,
      );
      if (!live()) return;
      if (task.sessionId != null || task.assignedAgentId != null) {
        update({
          busy: false,
          unknown: false,
          message: '任务已有 Agent 或 Session 归属，请核对执行信息；未启动手工任务。',
        });
        return;
      }
      if (task.status === 'IN_PROGRESS') {
        update({
          busy: false,
          unknown: false,
          status: task.status,
          message: '任务已标记为进行中；没有启动 Agent。',
        });
        callback.current();
        return;
      }
      if (!['BACKLOG', 'READY'].includes(task.status)) {
        update({
          busy: false,
          unknown: false,
          status: task.status,
          message: '任务状态已变化，已停止手工开始；请查看最新状态。',
        });
        callback.current();
        return;
      }
      if (!write) {
        update({
          busy: false,
          unknown: true,
          status: task.status,
          message:
            '已查到原任务状态，但查询不代表先前请求已结束。可明确选择继续手工开始；不会新建任务或启动 Agent。',
        });
        callback.current();
        return;
      }
      for (const next of task.status === 'BACKLOG' ? ['READY', 'IN_PROGRESS'] : ['IN_PROGRESS']) {
        if (!live()) return;
        attempted = true;
        update({
          busy: true,
          unknown: true,
          message: '状态变更已提交，等待结果；离开后需先核对原任务。',
        });
        task = snapshot(
          await api.post<unknown>(`/tasks/${encodeURIComponent(frozen.taskId)}/transition`, {
            status: next,
          }),
          frozen.projectId,
          frozen.taskId,
        );
        if (!live()) return;
        if (task.status !== next || task.sessionId != null || task.assignedAgentId != null)
          throw new Error('任务状态已变化，已停止后续操作');
        callback.current();
      }
      update({
        busy: false,
        unknown: false,
        status: 'IN_PROGRESS',
        message: '任务已标记为进行中；没有启动 Agent。',
      });
    } catch {
      update({
        busy: false,
        unknown: attempted || previous.unknown,
        message:
          attempted || previous.unknown
            ? '操作结果尚未确认，已停止后续写入。请查询原任务，再明确决定是否继续；旧请求可能仍在处理。'
            : '无法核对任务，未提交状态变更。请重试查询。',
      });
    } finally {
      pending.current = false;
      if (mounted.current) setPendingState(false);
    }
  };
  return {
    ...state,
    unavailable: !scope || revoked.current,
    busy: pendingState,
    begin: () => operate(true),
    check: () => operate(false),
  };
}
