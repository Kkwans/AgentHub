import { AhButton, AhErrorState, AhTextarea } from '@agenthub/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type TaskRecord } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';

type ReviewResult = {
  task: TaskRecord;
  session: { id: string } | null;
  run: { id: string } | null;
};
const safeRejections = new Set([
  'VALIDATION_FAILED',
  'TASK_NOT_WAITING_REVIEW',
  'TASK_REWORK_FEEDBACK_REQUIRED',
  'TASK_REWORK_AGENT_REQUIRED',
  'TASK_OPERATION_IN_PROGRESS',
  'PROJECT_NOT_FOUND',
  'PROJECT_NOT_ACTIVE',
  'AGENT_NOT_FOUND',
  'AGENT_NOT_READY',
  'AGENT_PROJECT_TARGET_MISMATCH',
]);

export function TaskReviewActions({
  task,
  disabled,
  onPendingChange,
}: {
  task: TaskRecord;
  disabled: boolean;
  onPendingChange: (key: string, pending: boolean) => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState('');
  const [settled, setSettled] = useState(false);
  const busy = useRef(false);
  const resolved = useRef(false);
  const live = useRef(true);
  const latestTask = useRef(task);
  latestTask.current = task;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const current = () => live.current;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['tasks', task.projectId] });
    void client.invalidateQueries({ queryKey: ['sessions', task.projectId] });
  };
  const submit = async (decision: 'APPROVE' | 'REWORK') => {
    const trimmed = feedback.trim();
    if (
      !current() ||
      busy.current ||
      resolved.current ||
      disabled ||
      unknown ||
      checking ||
      task.status !== 'WAITING_REVIEW'
    )
      return;
    if (decision === 'REWORK' && (!task.assignedAgentId || !trimmed || trimmed.length > 100_000))
      return;
    busy.current = true;
    setPending(true);
    setError('');
    setNotice('');
    const key = `${task.projectId}:${task.id}`;
    onPendingChange(key, true);
    try {
      const result = await api.post<ReviewResult>(
        `/tasks/${encodeURIComponent(task.id)}/review`,
        decision === 'APPROVE' ? { decision } : { decision, feedback: trimmed },
      );
      if (!result?.task || result.task.id !== task.id || result.task.projectId !== task.projectId)
        throw new Error('审阅响应无法确认，请核对原任务。');
      if (decision === 'APPROVE') {
        if (result.task.status !== 'DONE' || result.session !== null || result.run !== null)
          throw new Error('完成状态无法确认，请核对原任务。');
        if (current() && latestTask.current.sessionId === task.sessionId) {
          setSettled(true);
          setNotice('任务已确认完成。');
        }
      } else {
        if (
          typeof result.session?.id !== 'string' ||
          !result.session.id.trim() ||
          typeof result.run?.id !== 'string' ||
          !result.run.id.trim() ||
          result.session.id === task.sessionId ||
          result.run.id === task.finalRunId ||
          result.task.sessionId !== result.session.id ||
          result.task.assignedAgentId !== task.assignedAgentId
        )
          throw new Error('继续修改的工作区无法确认，请核对原任务。');
        if (
          current() &&
          (latestTask.current.sessionId === task.sessionId ||
            latestTask.current.sessionId === result.session.id)
        ) {
          setSettled(true);
          navigate(`/workspace/${encodeURIComponent(result.session.id)}`);
        }
      }
      resolved.current = true;
      // Never replace a newer task snapshot with a delayed review response.
      refresh();
    } catch (failure) {
      if (current()) {
        const safe =
          failure instanceof ApiError &&
          failure.status >= 400 &&
          failure.status < 500 &&
          safeRejections.has(failure.code);
        setUnknown(!safe);
        setError(failure instanceof Error ? failure.message : '审阅请求结果无法确认。');
      }
    } finally {
      busy.current = false;
      onPendingChange(key, false);
      if (current()) setPending(false);
      refresh();
    }
  };
  const check = async () => {
    if (!current() || checking || pending) return;
    setChecking(true);
    try {
      const stored = await api.get<TaskRecord>(`/tasks/${encodeURIComponent(task.id)}`);
      if (!stored || stored.id !== task.id || stored.projectId !== task.projectId)
        throw new Error('原任务响应无法确认。');
      if (current())
        setNotice(
          stored.status === 'WAITING_REVIEW'
            ? '原任务仍显示待审阅；请求结果未确认，已停止重复提交。'
            : '原任务状态已更新，请查看最新结果。',
        );
      refresh();
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : '无法核对原任务。');
    } finally {
      if (current()) setChecking(false);
    }
  };
  const locked = disabled || pending || unknown || checking || settled;
  return (
    <>
      <p>请核对工作区结果与验收标准，再确认完成或提交修改意见。</p>
      <AhButton
        size="xs"
        variant="light"
        disabled={locked}
        loading={pending}
        onClick={() => void submit('APPROVE')}
      >
        确认达到验收标准
      </AhButton>
      <AhTextarea
        label="继续修改说明"
        value={feedback}
        minRows={3}
        disabled={locked || !task.assignedAgentId}
        onChange={(event) => setFeedback(event.currentTarget.value)}
      />
      <p>
        {task.assignedAgentId
          ? '继续修改会沿用任务原 Agent 并创建新工作区，不使用上方临时选择。'
          : '任务未分配 Agent，暂时不能请求继续修改；仍可确认完成。'}
      </p>
      {feedback.trim().length > 100_000 ? (
        <p role="alert">继续修改说明不能超过 100000 个字符。</p>
      ) : null}
      <AhButton
        size="xs"
        variant="light"
        disabled={
          locked || !task.assignedAgentId || !feedback.trim() || feedback.trim().length > 100_000
        }
        loading={pending}
        onClick={() => void submit('REWORK')}
      >
        提交继续修改
      </AhButton>
      {error ? <AhErrorState title="审阅未完成" description={error} /> : null}
      {unknown ? (
        <>
          <p role="alert">请求结果未确认，请先核对原任务，勿重复提交。</p>
          <AhButton
            size="xs"
            variant="light"
            disabled={pending || checking}
            loading={checking}
            onClick={() => void check()}
          >
            核对原任务
          </AhButton>
        </>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </>
  );
}
