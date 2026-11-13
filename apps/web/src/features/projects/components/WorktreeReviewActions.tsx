import { ApiError } from '../../../lib/api-error';
import { AhButton, AhErrorState, AhInput, AhTextarea } from '@agenthub/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createReviewOperation, type ReviewOperationProps } from './review-operation';
import {
  api,
  type TaskRecord,
  type WorktreeExecutionRecord,
  type WorktreeReviewRecord,
} from '../../../lib/api';

export function WorktreeReviewActions({
  execution,
  disabled,
  onPendingChange,
  onOperationChange,
  canAutoNavigate,
  captureNavigationGate,
}: {
  execution: WorktreeExecutionRecord;
  disabled: boolean;
  onPendingChange: (key: string, pending: boolean) => void;
} & ReviewOperationProps) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [review, setReview] = useState<{ identity: string; value: WorktreeReviewRecord }>();
  const [feedback, setFeedback] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [confirmation, setConfirmation] = useState(false);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resultHref, setResultHref] = useState('');
  const operation = useRef<ReturnType<typeof createReviewOperation> | null>(null);
  const [unknown, setUnknown] = useState(false);
  const busy = useRef(false);
  const settled = useRef(false);
  const live = useRef(true);
  const latest = useRef(execution);
  latest.current = execution;
  const identity = JSON.stringify([
    execution.id,
    execution.runId,
    execution.baseSha,
    execution.taskBranch,
    execution.sessionId,
    execution.baseBranch,
    execution.worktreePath,
  ]);
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const current = () =>
    live.current &&
    latest.current.id === execution.id &&
    latest.current.projectId === execution.projectId &&
    latest.current.taskId === execution.taskId;
  const ready =
    execution.status === 'REVIEW' &&
    !disabled &&
    !pending &&
    !loading &&
    !unknown &&
    !settled.current;
  const shown = review?.identity === identity ? review.value : undefined;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['worktrees', execution.projectId] });
    void client.invalidateQueries({ queryKey: ['tasks', execution.projectId] });
    void client.invalidateQueries({ queryKey: ['sessions'] });
  };
  const load = async () => {
    if (!ready || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError('');
    setConfirmation(false);
    setReview(undefined);
    try {
      const result = await api.get<WorktreeReviewRecord>(
        `/worktree-executions/${encodeURIComponent(execution.id)}/review`,
      );
      if (
        !result ||
        result.worktreePath !== execution.worktreePath ||
        result.baseSha !== execution.baseSha ||
        result.taskBranch !== execution.taskBranch ||
        !Array.isArray(result.entries) ||
        typeof result.patch !== 'string' ||
        typeof result.diffStat !== 'string' ||
        typeof result.truncated !== 'boolean' ||
        typeof result.headSha !== 'string' ||
        !result.headSha ||
        typeof result.clean !== 'boolean' ||
        !Number.isFinite(result.aheadBy) ||
        result.aheadBy < 0 ||
        !result.entries.every(
          (entry) =>
            entry &&
            typeof entry.path === 'string' &&
            typeof entry.index === 'string' &&
            typeof entry.worktree === 'string' &&
            (entry.originalPath === undefined || typeof entry.originalPath === 'string'),
        )
      )
        throw new Error('隔离工作区审阅归属无法确认，请刷新原执行。');
      if (current() && latestIdentity.current === identity) setReview({ identity, value: result });
    } catch (failure) {
      if (current() && latestIdentity.current === identity)
        setError(failure instanceof Error ? failure.message : '无法读取隔离工作区审阅。');
    } finally {
      busy.current = false;
      if (current()) setLoading(false);
    }
  };
  const submit = async (action: 'rework' | 'merge') => {
    if (!ready || busy.current || !shown || latestIdentity.current !== identity) return;
    const trimmed = feedback.trim();
    if (action === 'rework' && (!execution.sessionId || !trimmed || trimmed.length > 1_000_000))
      return;
    if (
      action === 'merge' &&
      (!confirmation || shown.truncated || commitMessage.trim().length > 240)
    )
      return;
    busy.current = true;
    setPending(true);
    setError('');
    setNotice('');
    const key = `${execution.projectId}:${execution.taskId}`;
    const report = createReviewOperation(
      { projectId: execution.projectId, taskId: execution.taskId, executionId: execution.id },
      onOperationChange,
    );
    operation.current = report;
    const navigationGate = captureNavigationGate?.() ?? canAutoNavigate;
    report('pending', '正在提交审阅操作。');
    onPendingChange(key, true);
    let verifiedResultHref: string | undefined;
    try {
      if (action === 'rework') {
        const result = await api.post<WorktreeExecutionRecord>(
          `/worktree-executions/${encodeURIComponent(execution.id)}/rework`,
          { feedback: trimmed },
        );
        if (
          !result ||
          result.id !== execution.id ||
          result.taskId !== execution.taskId ||
          result.projectId !== execution.projectId ||
          result.sessionId !== execution.sessionId ||
          !result.runId ||
          result.runId === execution.runId
        )
          throw new Error('返工结果无法确认，请核对原隔离执行。');
        verifiedResultHref = `/workspace/${encodeURIComponent(result.sessionId!)}`;
        if (
          current() &&
          (latest.current.runId === execution.runId || latest.current.runId === result.runId)
        ) {
          settled.current = true;
          const href = verifiedResultHref;
          if (!navigationGate || navigationGate()) navigate(href);
          else {
            setResultHref(href);
            setNotice('继续修改已提交，可打开工作区查看结果。');
          }
        }
      } else {
        const result = await api.post<{ execution: WorktreeExecutionRecord; task: TaskRecord }>(
          `/worktree-executions/${encodeURIComponent(execution.id)}/merge`,
          commitMessage.trim() ? { commitMessage: commitMessage.trim() } : {},
        );
        if (
          !result?.execution ||
          result.execution.id !== execution.id ||
          result.execution.taskId !== execution.taskId ||
          result.execution.projectId !== execution.projectId ||
          result.execution.status !== 'DONE' ||
          !result.execution.mergeCommitSha ||
          result.task?.id !== execution.taskId ||
          result.task.projectId !== execution.projectId ||
          result.task.status !== 'DONE'
        )
          throw new Error('合并结果无法确认，请核对原隔离执行。');
        if (current()) {
          settled.current = true;
          setNotice(`合并完成：${result.execution.mergeCommitSha}`);
        }
      }
      report('resolved', '隔离审阅操作已确认完成。', verifiedResultHref);
    } catch (failure) {
      const preClaimRejection =
        action === 'merge' &&
        failure instanceof ApiError &&
        failure.status === 409 &&
        failure.code === 'WORKTREE_EXECUTION_CHANGED';
      const confirmedRejection =
        preClaimRejection ||
        (failure instanceof ApiError &&
          ((failure.status === 400 && failure.code === 'VALIDATION_FAILED') ||
            (failure.status === 409 &&
              [
                'PRIMARY_WORKTREE_DIRTY',
                'PRIMARY_BRANCH_CHANGED',
                'WORKTREE_BASE_DIVERGED',
                'WORKTREE_MERGE_CONFLICT',
                'WORKTREE_EXECUTION_NOT_IN_REVIEW',
              ].includes(failure.code))));
      report(
        confirmedRejection ? 'retryable' : 'unknown',
        failure instanceof Error ? failure.message : '操作结果无法确认。',
      );
      if (current()) {
        setUnknown(!confirmedRejection);
        setReview(undefined);
        if (confirmedRejection && action === 'merge')
          setNotice(
            preClaimRejection
              ? '原审阅执行已变化，本次请求未执行合并或 Git 提交。请重新读取差异并明确确认。'
              : '合并未完成；隔离分支可能已生成受管提交。请重新读取差异后再明确确认。',
          );
        setError(failure instanceof Error ? failure.message : '操作结果无法确认。');
      }
    } finally {
      busy.current = false;
      onPendingChange(key, false);
      if (current()) {
        setPending(false);
        setConfirmation(false);
      }
      refresh();
    }
  };
  const check = async () => {
    if (!current() || busy.current) return;
    busy.current = true;
    setLoading(true);
    const report = operation.current;
    report?.('checking', '正在核对原隔离执行。');
    try {
      const result = await api.get<WorktreeExecutionRecord>(
        `/worktree-executions/${encodeURIComponent(execution.id)}`,
      );
      if (
        !result ||
        result.id !== execution.id ||
        result.taskId !== execution.taskId ||
        result.projectId !== execution.projectId
      )
        throw new Error('原隔离执行归属无法确认。');
      if (current()) setNotice(`原隔离执行状态：${result.status}。请核对实际结果，未自动重试。`);
      refresh();
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : '无法核对原隔离执行。');
    } finally {
      report?.('unknown', '核对结束；原请求结果仍未确认，勿重复提交。');
      busy.current = false;
      if (current()) setLoading(false);
    }
  };
  return (
    <>
      <p>
        隔离分支 {execution.taskBranch} → 基础分支 {execution.baseBranch}
      </p>
      <AhButton
        size="xs"
        variant="light"
        disabled={!ready}
        loading={loading}
        onClick={() => void load()}
      >
        读取隔离工作区审阅
      </AhButton>
      {shown ? (
        <>
          <p>
            基础 SHA：{shown.baseSha}；HEAD：{shown.headSha}；领先提交：{shown.aheadBy}
          </p>
          <p>
            {shown.clean
              ? '工作区没有未提交改动；仍需检查分支提交差异。'
              : '工作区包含未提交改动。'}
          </p>
          {shown.entries.length ? (
            <ul>
              {shown.entries.map((entry, i) => (
                <li className="break-all" key={`${entry.path}:${i}`}>
                  {entry.originalPath ? `${entry.originalPath} → ` : ''}
                  {entry.path}
                </li>
              ))}
            </ul>
          ) : null}
          {shown.diffStat ? (
            <pre className="max-w-full overflow-auto whitespace-pre-wrap break-words">
              {shown.diffStat}
            </pre>
          ) : null}
          {shown.truncated ? (
            <p role="alert">
              差异已截断，不能把当前预览视为全部改动；此入口暂不允许合并，仍可反馈返工。
            </p>
          ) : null}
          <details>
            <summary>查看隔离工作区差异</summary>
            <pre className="max-h-96 max-w-full overflow-auto whitespace-pre-wrap break-words">
              {shown.patch || '没有可显示的文本差异。'}
            </pre>
          </details>
        </>
      ) : null}
      <AhTextarea
        label="隔离工作区修改说明"
        value={feedback}
        minRows={3}
        disabled={!ready}
        onChange={(event) => setFeedback(event.currentTarget.value)}
      />
      <AhButton
        size="xs"
        variant="light"
        disabled={
          !ready ||
          !shown ||
          !execution.sessionId ||
          !feedback.trim() ||
          feedback.trim().length > 1_000_000
        }
        loading={pending}
        onClick={() => void submit('rework')}
      >
        提交隔离工作区返工
      </AhButton>
      <p>返工复用原 Session，在隔离工作区继续修改，不创建普通 Task 审阅。</p>
      <AhInput
        label="合并提交说明"
        value={commitMessage}
        disabled={!ready}
        placeholder="留空使用任务默认提交说明"
        onChange={(event) => setCommitMessage(event.currentTarget.value)}
      />
      {commitMessage.trim().length > 240 ? <p role="alert">提交说明不能超过 240 个字符。</p> : null}
      <p>
        合并会自动提交全部改动，并将 {execution.taskBranch} 合并到 {execution.baseBranch}
        ；不推送远端，不自动删除分支或工作区。预览不是不可变快照，合并时仍由服务器执行 Git
        安全检查。
      </p>
      <label>
        <input
          type="checkbox"
          checked={confirmation && Boolean(shown)}
          disabled={!ready || !shown || shown.truncated}
          onChange={(event) => setConfirmation(event.currentTarget.checked)}
        />
        我已审阅改动，确认提交并合并到基础分支
      </label>
      <AhButton
        size="xs"
        variant="light"
        disabled={
          !ready || !shown || shown.truncated || !confirmation || commitMessage.trim().length > 240
        }
        loading={pending}
        onClick={() => void submit('merge')}
      >
        提交并合并隔离工作区
      </AhButton>
      {error ? <AhErrorState title="隔离工作区操作未完成" description={error} /> : null}
      {unknown ? (
        <>
          <p role="alert">请先核对原隔离执行和实际 Git 结果，勿重复提交。</p>
          <AhButton
            size="xs"
            variant="light"
            disabled={loading || pending}
            onClick={() => void check()}
          >
            核对原隔离执行
          </AhButton>
        </>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {resultHref ? <Link to={resultHref}>打开已提交的工作区</Link> : null}
    </>
  );
}
