import { ApiError } from '../../../lib/api-error';
import { AhButton } from '@agenthub/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, type TaskRecord, type WorktreeExecutionRecord } from '../../../lib/api';

export type WorktreeCancelState = {
  phase:
    | 'pending'
    | 'requested'
    | 'unknown'
    | 'confirmed'
    | 'resolved'
    | 'rejected'
    | 'checking'
    | 'retryable';
  message: string;
  registryKey?: string;
  uncertain?: boolean;
  safeRejected?: boolean;
};
const statuses = [
  'QUEUED',
  'SETTING_UP',
  'RUNNING',
  'AWAITING_INPUT',
  'REVIEW',
  'MERGING',
  'DONE',
  'BLOCKED',
  'CANCELED',
];
export function WorktreeCancelAction({
  execution,
  disabled,
  state,
  onStateChange,
}: {
  execution: WorktreeExecutionRecord;
  disabled: boolean;
  state: WorktreeCancelState | undefined;
  onStateChange: (key: string, value: WorktreeCancelState) => void;
}) {
  const client = useQueryClient();
  const busy = useRef(false);
  const [checking, setChecking] = useState(false);
  const key =
    state?.registryKey ??
    `${execution.projectId}:${execution.taskId}:${execution.id}:${execution.runId ?? 'no-run'}`;
  const originalRunId = execution.runId;
  const endpoint = `/worktree-executions/${encodeURIComponent(execution.id)}`;
  const validate = (value: WorktreeExecutionRecord) => {
    if (
      !value ||
      value.id !== execution.id ||
      value.projectId !== execution.projectId ||
      value.taskId !== execution.taskId ||
      !statuses.includes(value.status)
    )
      throw new Error('原隔离执行归属或状态无法确认');
    return value;
  };
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['worktrees', execution.projectId] });
    void client.invalidateQueries({ queryKey: ['tasks', execution.projectId] });
    void client.invalidateQueries({ queryKey: ['sessions'] });
  };
  const record = (value: WorktreeExecutionRecord, fromRequest: boolean) => {
    const next: WorktreeCancelState =
      ['REVIEW', 'BLOCKED'].includes(value.status) &&
      !(state?.phase === 'unknown' || state?.uncertain)
        ? {
            phase: value.status === 'BLOCKED' ? 'retryable' : 'resolved',
            message: `原隔离执行已进入 ${value.status}，不是取消成功；${value.status === 'BLOCKED' ? '可明确再次取消这个已阻塞执行' : '可继续审阅该执行'}，不自动重发取消。`,
          }
        : value.status === 'CANCELED'
          ? { phase: 'confirmed', message: '隔离执行已取消。保留分支和工作区，不自动删除或推送。' }
          : value.status === 'DONE'
            ? { phase: 'confirmed', message: '原隔离执行已完成，不是取消成功。' }
            : {
                phase: state?.phase === 'unknown' || state?.uncertain ? 'unknown' : 'requested',
                uncertain:
                  !state?.safeRejected && (state?.phase === 'unknown' || Boolean(state?.uncertain)),
                safeRejected: Boolean(state?.safeRejected),
                message: `${fromRequest ? '取消请求已发送' : '原隔离执行状态已核对'}：${value.status}。尚未确认取消完成，不重复发送取消请求。`,
              };
    onStateChange(key, next);
    if (fromRequest && value.runId && value.runId !== originalRunId) {
      onStateChange(
        `${execution.projectId}:${execution.taskId}:${execution.id}:${value.runId}`,
        next,
      );
    }
  };
  const cancel = async () => {
    if (
      busy.current ||
      (state && state.phase !== 'retryable') ||
      disabled ||
      ['SETTING_UP', 'MERGING', 'DONE', 'CANCELED'].includes(execution.status)
    )
      return;
    busy.current = true;
    onStateChange(key, { phase: 'pending', message: '正在发送隔离取消请求…' });
    try {
      const result = await api.post<
        WorktreeExecutionRecord | { execution: WorktreeExecutionRecord; task: TaskRecord }
      >(`${endpoint}/cancel`, {});
      if (result && 'execution' in result) {
        const value = validate(result.execution);
        if (
          value.status !== 'CANCELED' ||
          result.task?.id !== execution.taskId ||
          result.task.projectId !== execution.projectId ||
          result.task.status !== 'CANCELED'
        )
          throw new Error('取消任务归属无法确认');
        record(value, true);
      } else record(validate(result as WorktreeExecutionRecord), true);
    } catch (failure) {
      const rejected =
        failure instanceof ApiError &&
        failure.status === 409 &&
        [
          'WORKTREE_EXECUTION_BUSY',
          'WORKTREE_EXECUTION_NOT_CANCELABLE',
          'WORKTREE_EXECUTION_CHANGED',
          'WORKTREE_RUN_UNRESOLVED',
        ].includes(failure.code);
      onStateChange(key, {
        phase: rejected ? 'rejected' : 'unknown',
        safeRejected: rejected,
        message: rejected
          ? '取消请求未被接受，请核对原隔离执行的最新状态。'
          : '取消结果无法确认。请核对原隔离执行，勿重复提交；不会回退普通任务取消。',
      });
    } finally {
      busy.current = false;
      refresh();
    }
  };
  const check = async () => {
    if (busy.current || ['pending', 'checking'].includes(state?.phase ?? '')) return;
    busy.current = true;
    setChecking(true);
    onStateChange(key, {
      phase: 'checking',
      message: '正在核对原隔离执行…',
      uncertain: !state?.safeRejected && (state?.phase === 'unknown' || Boolean(state?.uncertain)),
      safeRejected: Boolean(state?.safeRejected),
    });
    try {
      const value = validate(await api.get<WorktreeExecutionRecord>(endpoint));
      if (
        state?.safeRejected &&
        ['QUEUED', 'RUNNING', 'AWAITING_INPUT', 'REVIEW', 'BLOCKED'].includes(value.status)
      )
        onStateChange(key, {
          phase: 'retryable',
          safeRejected: true,
          message: '原取消未被接受；已核对最新状态，可明确重新请求取消。',
        });
      else record(value, false);
    } catch {
      onStateChange(key, {
        phase: state?.safeRejected ? 'rejected' : 'unknown',
        safeRejected: Boolean(state?.safeRejected),
        message: '取消结果无法确认，读取原隔离执行失败，请稍后再次核对。',
      });
    } finally {
      busy.current = false;
      setChecking(false);
      refresh();
    }
  };
  return (
    <>
      <p>
        取消隔离执行不会合并或删除分支、工作区。运行中的取消需等待 Agent
        实际停止，发送请求不代表已停止。
      </p>
      <AhButton
        size="xs"
        variant="light"
        disabled={
          disabled ||
          Boolean(state && state.phase !== 'retryable') ||
          ['SETTING_UP', 'MERGING', 'DONE', 'CANCELED'].includes(execution.status)
        }
        loading={['pending', 'checking'].includes(state?.phase ?? '')}
        onClick={() => void cancel()}
      >
        取消隔离执行
      </AhButton>
      {['SETTING_UP', 'MERGING'].includes(execution.status) ? (
        <p>Worktree 正在创建或合并，请等待当前步骤完成。</p>
      ) : null}
      {state ? <p role="status">{state.message}</p> : null}
      {state && state.phase !== 'confirmed' ? (
        <AhButton
          size="xs"
          variant="light"
          disabled={checking || ['pending', 'checking'].includes(state.phase)}
          onClick={() => void check()}
        >
          核对隔离取消状态
        </AhButton>
      ) : null}
    </>
  );
}
