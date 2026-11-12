import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api, authSession, type TaskRecord } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';

export type NewTaskDraft = {
  projectId: string;
  title: string;
  description: string;
  goalId: string;
  agentId: string;
  promptId: string;
};
type TaskIdentity = Pick<TaskRecord, 'id' | 'projectId' | 'status' | 'sessionId'>;
type Stage = 'create' | 'transition' | 'start' | 'check';
type CreationState = {
  draft?: NewTaskDraft | undefined;
  task?: TaskIdentity | undefined;
  busy: boolean;
  error?: string | undefined;
  unknown: boolean;
  retryable: boolean;
  sessionId?: string | undefined;
};

// Only errors known to be emitted before persistence/runtime creation qualify.
// A generic 4xx/5xx, malformed response, or transport failure is not proof that
// nothing happened. In particular an adapter failure can leave a Session.
const createRejections = new Set([
  'VALIDATION_FAILED',
  'PROJECT_NOT_FOUND',
  'PROJECT_NOT_ACTIVE',
  'GOAL_NOT_FOUND',
  'GOAL_PARENT_PROJECT_MISMATCH',
  'TASK_PARENT_PROJECT_MISMATCH',
]);
const startRejections = new Set([
  'VALIDATION_FAILED',
  'PROJECT_NOT_FOUND',
  'PROJECT_NOT_ACTIVE',
  'AGENT_NOT_FOUND',
  'AGENT_NOT_READY',
  'AGENT_PROJECT_TARGET_MISMATCH',
]);
function rejectedBeforeWrite(error: unknown, codes: Set<string>): boolean {
  return (
    error instanceof ApiError && error.status >= 400 && error.status < 500 && codes.has(error.code)
  );
}
function taskIdentity(value: unknown, projectId: string, taskId?: string): TaskIdentity {
  const task = value as Partial<TaskRecord> | null;
  if (
    !task ||
    typeof task.id !== 'string' ||
    !task.id ||
    task.projectId !== projectId ||
    (taskId !== undefined && task.id !== taskId) ||
    !['BACKLOG', 'READY', 'IN_PROGRESS', 'WAITING_REVIEW', 'DONE', 'BLOCKED', 'CANCELED'].includes(
      task.status ?? '',
    ) ||
    !(task.sessionId === null || (typeof task.sessionId === 'string' && task.sessionId.length > 0))
  ) {
    throw new Error('任务响应无法确认，请到任务列表核对。');
  }
  return task as TaskIdentity;
}

export function useNewTaskCreation(
  onStarted: (draft: NewTaskDraft, task: TaskIdentity, sessionId?: string) => void,
) {
  const client = useQueryClient();
  const [state, setState] = useState<CreationState>({
    busy: false,
    unknown: false,
    retryable: false,
  });
  const current = useRef(state);
  const live = useRef(true);
  const busy = useRef(false);
  const update = (next: CreationState) => {
    current.current = next;
    if (live.current) setState(next);
  };
  const abandon = () => {
    live.current = false;
  };
  useEffect(() => {
    live.current = true;
    const unsubscribe = authSession.onAuthorizationRequired(abandon);
    return () => {
      abandon();
      unsubscribe();
    };
  }, []);

  const run = async (input?: NewTaskDraft, checkOnly = false) => {
    if (!live.current || busy.current) return;
    const previous = current.current;
    if (!input && (!previous.draft || !previous.task)) return;
    if (input && previous.draft) return;
    if (!input && !checkOnly && !previous.retryable) return;
    const draft = input ? { ...input } : previous.draft!;
    let task = previous.task;
    let stage: Stage = input ? 'create' : 'check';
    busy.current = true;
    update({ ...previous, draft, busy: true, error: undefined });
    try {
      if (input) {
        task = taskIdentity(
          await api.post<unknown>('/tasks', {
            projectId: draft.projectId,
            goalId: draft.goalId || undefined,
            title: draft.title.trim(),
            description: draft.description.trim() || undefined,
            priority: 2,
          }),
          draft.projectId,
        );
        void client.invalidateQueries({ queryKey: ['tasks'] });
        update({ draft, task, busy: true, unknown: false, retryable: true });
      } else {
        task = taskIdentity(
          await api.get<unknown>(`/tasks/${encodeURIComponent(task!.id)}`),
          draft.projectId,
          task!.id,
        );
        if (!live.current) return;
        if (checkOnly) {
          update({
            ...previous,
            task,
            busy: false,
            error: undefined,
            retryable:
              previous.retryable && !task.sessionId && ['BACKLOG', 'READY'].includes(task.status),
            sessionId: task.sessionId ?? undefined,
          });
          return;
        }
      }
      if (!live.current) return;
      if (!task) throw new Error('任务身份无法确认。');
      if (task.sessionId || !['BACKLOG', 'READY'].includes(task.status)) {
        update({
          draft,
          task,
          busy: false,
          unknown: false,
          retryable: false,
          error: '任务状态已经变化，请查看原任务，不会重新创建或启动。',
          ...(task.sessionId ? { sessionId: task.sessionId } : {}),
        });
        return;
      }
      if (!draft.agentId) {
        update({ draft, task, busy: false, unknown: false, retryable: false });
        onStarted(draft, task);
        return;
      }
      if (task.status === 'BACKLOG') {
        stage = 'transition';
        task = taskIdentity(
          await api.post<unknown>(`/tasks/${encodeURIComponent(task.id)}/transition`, {
            status: 'READY',
          }),
          draft.projectId,
          task.id,
        );
        update({ draft, task, busy: true, unknown: false, retryable: true });
        if (!live.current) return;
        if (task.status !== 'READY' || task.sessionId)
          throw new Error('任务状态无法确认，请查看原任务。');
      }
      stage = 'start';
      const result = await api.post<{
        task?: unknown;
        session?: { id?: unknown; projectId?: unknown; taskId?: unknown; agentId?: unknown };
      }>(`/tasks/${encodeURIComponent(task.id)}/start`, { agentId: draft.agentId });
      const startedTask = taskIdentity(result?.task, draft.projectId, task.id);
      if (
        typeof result?.session?.id !== 'string' ||
        !result.session.id ||
        result.session.projectId !== draft.projectId ||
        result.session.taskId !== task.id ||
        result.session.agentId !== draft.agentId ||
        startedTask.sessionId !== result.session.id
      ) {
        throw new Error('启动响应与原任务或 Agent 不一致，请核对原任务。');
      }
      task = startedTask;
      update({
        draft,
        task,
        busy: false,
        unknown: false,
        retryable: false,
        sessionId: result.session.id,
      });
      if (live.current) onStarted(draft, task, result.session.id);
    } catch (error) {
      const safeCreate = stage === 'create' && rejectedBeforeWrite(error, createRejections);
      const safeStart = stage === 'start' && rejectedBeforeWrite(error, startRejections);
      const safeTransition =
        stage === 'transition' && rejectedBeforeWrite(error, new Set(['VALIDATION_FAILED']));
      update({
        ...(safeCreate ? {} : { draft }),
        ...(task ? { task } : {}),
        busy: false,
        error: error instanceof Error ? error.message : '请求结果无法确认，请核对任务列表。',
        unknown:
          stage === 'check' ? previous.unknown : !(safeCreate || safeStart || safeTransition),
        retryable: stage === 'check' ? previous.retryable : safeStart || safeTransition,
      });
    } finally {
      busy.current = false;
    }
  };
  return {
    ...state,
    locked: Boolean(state.draft),
    submit: (draft: NewTaskDraft) => {
      void run(draft);
    },
    retry: () => {
      void run();
    },
    check: () => {
      void run(undefined, true);
    },
    abandon,
  };
}
