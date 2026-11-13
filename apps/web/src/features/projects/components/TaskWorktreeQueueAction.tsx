import { AhButton, AhErrorState } from '@agenthub/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type TaskRecord, type WorktreeExecutionRecord } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';

export function TaskWorktreeQueueAction({
  task,
  agentId,
  eligible,
  disabled,
  uncertain,
  inFlight,
  accepted,
  onAccepted,
  onPendingChange,
  onUncertainChange,
}: {
  task: TaskRecord;
  agentId: string;
  eligible: boolean;
  disabled: boolean;
  uncertain: boolean;
  inFlight: boolean;
  accepted: boolean;
  onAccepted: (key: string) => void;
  onPendingChange: (key: string, pending: boolean) => void;
  onUncertainChange: (key: string, uncertain: boolean) => void;
}) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(uncertain);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const beforeQueueUnknown = useRef(false);
  const live = useRef(true);
  const identity = JSON.stringify([
    task.projectId,
    task.id,
    agentId,
    eligible,
    disabled,
    ['BACKLOG', 'READY'].includes(task.status) && task.sessionId === null,
  ]);
  const epoch = useRef({ identity, generation: 0 });
  if (epoch.current.identity !== identity) {
    epoch.current = { identity, generation: epoch.current.generation + 1 };
  }
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const key = `${task.projectId}:${task.id}`;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['tasks', task.projectId] });
    void client.invalidateQueries({ queryKey: ['worktrees', task.projectId] });
  };
  const markUnknown = (value: boolean) => {
    if (live.current) setUnknown(value);
    onUncertainChange(key, value);
  };
  const enqueue = async () => {
    if (
      busy.current ||
      inFlight ||
      accepted ||
      disabled ||
      !eligible ||
      !agentId ||
      uncertain ||
      unknown ||
      settled ||
      !['BACKLOG', 'READY'].includes(task.status) ||
      task.sessionId !== null
    )
      return;
    busy.current = true;
    setPending(true);
    setError('');
    setNotice('');
    onPendingChange(key, true);
    const generation = epoch.current.generation;
    let queueDispatched = false;
    try {
      if (task.status === 'BACKLOG') {
        const ready = await api.post<TaskRecord>(
          `/tasks/${encodeURIComponent(task.id)}/transition`,
          { status: 'READY' },
        );
        if (
          !ready ||
          ready.id !== task.id ||
          ready.projectId !== task.projectId ||
          ready.status !== 'READY'
        )
          throw new Error('就绪状态无法确认，请核对原任务。');
      }
      if (!live.current || epoch.current.generation !== generation) return;
      queueDispatched = true;
      const result = await api.post<{ execution: WorktreeExecutionRecord; task: TaskRecord }>(
        `/tasks/${encodeURIComponent(task.id)}/worktree/queue`,
        { agentId },
      );
      if (
        !result?.execution?.id ||
        result.execution.taskId !== task.id ||
        result.execution.projectId !== task.projectId ||
        result.execution.agentId !== agentId ||
        result.task?.id !== task.id ||
        result.task.projectId !== task.projectId ||
        result.execution.status !== 'QUEUED' ||
        result.task.status !== 'IN_PROGRESS' ||
        result.task.assignedAgentId !== agentId
      )
        throw new Error('入队响应无法确认，请核对原隔离执行。');
      onAccepted(key);
      markUnknown(false);
      if (live.current) {
        setSettled(true);
        setNotice('隔离执行队列已接收；入队不代表 Agent 已启动，请查看原任务执行状态。');
      }
    } catch (failure) {
      const rejected =
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500 &&
        [
          'VALIDATION_FAILED',
          'PROJECT_NOT_GIT',
          'PROJECT_NOT_ACTIVE',
          'REMOTE_WORKTREE_NOT_AVAILABLE',
          'AGENT_NOT_FOUND',
          'AGENT_NOT_READY',
          'AGENT_PROJECT_TARGET_MISMATCH',
        ].includes(failure.code);
      // A lost response may follow durable enqueue. Never repeat it or fall back to ordinary start.
      if (queueDispatched && !rejected) markUnknown(true);
      if (!queueDispatched && !(failure instanceof ApiError)) {
        beforeQueueUnknown.current = true;
        markUnknown(true);
      }
      if (live.current)
        setError(failure instanceof Error ? failure.message : '隔离执行结果无法确认。');
    } finally {
      busy.current = false;
      onPendingChange(key, false);
      if (live.current) setPending(false);
      refresh();
    }
  };
  const check = async () => {
    if (busy.current || inFlight) return;
    busy.current = true;
    setPending(true);
    onPendingChange(key, true);
    setError('');
    try {
      const [stored, executions] = await Promise.all([
        api.get<TaskRecord>(`/tasks/${encodeURIComponent(task.id)}`),
        api.get<WorktreeExecutionRecord[]>(
          `/worktree-executions?taskId=${encodeURIComponent(task.id)}`,
        ),
      ]);
      if (
        stored.id !== task.id ||
        stored.projectId !== task.projectId ||
        !Array.isArray(executions) ||
        executions.some((item) => item.taskId !== task.id || item.projectId !== task.projectId)
      )
        throw new Error('原任务归属无法确认。');
      if (executions.length) {
        onAccepted(key);
        markUnknown(false);
        if (live.current) {
          setSettled(true);
          setNotice(`原任务已有隔离执行，当前状态：${executions[0]!.status}。未重复入队。`);
        }
      } else if (
        beforeQueueUnknown.current &&
        stored.status === 'READY' &&
        stored.sessionId === null
      ) {
        beforeQueueUnknown.current = false;
        markUnknown(false);
        if (live.current)
          setNotice('已确认原任务就绪且没有隔离执行；此前未发送入队请求，可明确重新加入队列。');
      } else if (live.current)
        setNotice('尚未找到隔离执行；旧请求结果仍未确认，未重放入队。请稍后再次核对。');
      refresh();
    } catch (failure) {
      if (live.current) setError(failure instanceof Error ? failure.message : '无法核对原任务。');
    } finally {
      busy.current = false;
      onPendingChange(key, false);
      if (live.current) setPending(false);
    }
  };
  return (
    <>
      <p>
        隔离执行会创建受管分支与 Worktree，使用当前 Agent 和任务已保存的 Prompt
        变量。队列接收不代表已启动，不会自动合并或推送。
      </p>
      <AhButton
        size="xs"
        variant="light"
        loading={pending}
        disabled={
          disabled ||
          inFlight ||
          accepted ||
          pending ||
          !eligible ||
          !agentId ||
          uncertain ||
          unknown ||
          settled ||
          !['BACKLOG', 'READY'].includes(task.status) ||
          task.sessionId !== null
        }
        onClick={() => void enqueue()}
      >
        加入隔离执行队列
      </AhButton>
      {error ? <AhErrorState title="隔离入队未完成" description={error} /> : null}
      {unknown || uncertain ? (
        <>
          <p role="alert">入队结果未确认，已停止重复提交和普通启动。请核对原任务。</p>
          <AhButton size="xs" variant="light" disabled={pending} onClick={() => void check()}>
            核对原隔离队列
          </AhButton>
        </>
      ) : null}
      {notice ? (
        <p role="status">{notice}</p>
      ) : accepted ? (
        <p role="status">隔离执行队列已接收，请等待原执行状态更新；未重复入队。</p>
      ) : null}
    </>
  );
}
