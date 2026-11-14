import { useQueryClient } from '@tanstack/react-query';
import { AhButton, humanizeStatus } from '@agenthub/ui';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type TaskRecord,
  type WorktreeExecutionRecord,
  type WorktreeReviewRecord,
} from '../../../lib/api';
import { useReviewOperationOwner } from '../hooks/useReviewOperationOwner';
import type { OwnedReviewOperation } from '../lib/review-operation-owner';
import { useReviewOperations } from './ReviewOperationProvider';
import styles from './reviewOperationStatus.module.css';

/** Survives route unmounts. Only exact durable PREWRITE evidence can release a merge lock. */
export function ReviewOperationStatus() {
  const context = useReviewOperations();
  // Shell previews without a review owner have nothing to render and must not
  // acquire query-context dependencies for an absent recovery surface.
  return context ? <OwnedReviewOperationStatus context={context} /> : null;
}
function OwnedReviewOperationStatus({
  context,
}: {
  context: NonNullable<ReturnType<typeof useReviewOperations>>;
}) {
  const client = useQueryClient();
  const activeOwner = useRef(context?.owner);
  activeOwner.current = context?.owner;
  const records = useReviewOperationOwner(context?.owner ?? null);
  const [checks, setChecks] = useState<Record<string, { message: string; href?: string }>>({});
  const busy = useRef(new Set<string>());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const check = async (record: OwnedReviewOperation) => {
    if (!context || busy.current.has(record.operationId)) return;
    busy.current.add(record.operationId);
    const report = context.owner.bind(record).onOperationChange;
    report({ ...record, phase: 'checking', message: '正在核对原操作状态。' });
    const checkingRecord = context.owner
      .getSnapshot()
      .find(
        (item) =>
          item.operationId === record.operationId &&
          item.projectId === record.projectId &&
          item.taskId === record.taskId &&
          item.executionId === record.executionId &&
          item.phase === 'checking',
      );
    const current = () =>
      live.current &&
      activeOwner.current === context.owner &&
      Boolean(checkingRecord && context.owner.getSnapshot().includes(checkingRecord));
    let safeRetry = false;
    try {
      if (!current()) return;
      const path = record.executionId
        ? `/worktree-executions/${encodeURIComponent(record.executionId)}`
        : `/tasks/${encodeURIComponent(record.taskId)}`;
      const value = await api.get<TaskRecord | WorktreeExecutionRecord>(path);
      if (
        !value ||
        value.projectId !== record.projectId ||
        (record.executionId
          ? value.id !== record.executionId ||
            !('taskId' in value) ||
            value.taskId !== record.taskId
          : value.id !== record.taskId)
      )
        throw new Error('原操作归属无法确认，未解除保护。');
      if (!current()) return;
      const attempted = record.gitMergeAttempt;
      if (
        record.executionId &&
        attempted &&
        value.status === 'REVIEW' &&
        'runId' in value &&
        value.runId === attempted.runId
      ) {
        const review = await api.get<WorktreeReviewRecord>(
          `/worktree-executions/${encodeURIComponent(record.executionId)}/review`,
        );
        const admission = review?.mergeAdmission;
        safeRetry = Boolean(
          current() &&
          admission?.retryEligible === true &&
          admission.mergeAllowed === true &&
          typeof admission.dispatchOperationId === 'string' &&
          Boolean(admission.dispatchOperationId) &&
          admission.expectedRunId === attempted.runId &&
          admission.expectedOperationId === attempted.operationId &&
          typeof review.worktreePath === 'string' &&
          review.worktreePath &&
          review.worktreePath === value.worktreePath &&
          typeof review.baseSha === 'string' &&
          review.baseSha &&
          review.baseSha === value.baseSha &&
          typeof review.taskBranch === 'string' &&
          review.taskBranch &&
          review.taskBranch === value.taskBranch,
        );
      }
      if (current())
        setChecks((current) => ({
          ...current,
          [record.operationId]: {
            message: safeRetry
              ? '原合并已确认未写入。请回到原工作，重新读取差异并再次确认；没有自动重试。'
              : `当前状态：${humanizeStatus(value.status)}。这是状态核对，不是原请求成功确认；未自动重试。`,
            ...(typeof value.sessionId === 'string' && value.sessionId
              ? { href: `/workspace/${encodeURIComponent(value.sessionId)}` }
              : {}),
          },
        }));
    } catch (error) {
      if (current())
        setChecks((current) => ({
          ...current,
          [record.operationId]: {
            message: error instanceof Error ? error.message : '核对失败，保护仍保留。',
          },
        }));
    } finally {
      busy.current.delete(record.operationId);
      if (current())
        report({
          ...record,
          phase: safeRetry ? 'retryable' : 'unknown',
          message: safeRetry
            ? '原合并已确认前置拒绝，请重新读取差异并再次确认。'
            : '原请求结果仍需核对，已阻止重复提交。',
        });
      if (safeRetry && activeOwner.current === context.owner && live.current) {
        void client.invalidateQueries({ queryKey: ['worktrees', record.projectId] });
        void client.invalidateQueries({ queryKey: ['tasks', record.projectId] });
      }
    }
  };
  const visibleRecords = records.filter((record) => record.phase !== 'retryable');
  if (!context || !visibleRecords.length) return null;
  return (
    <section className={styles.status} aria-label="工作操作记录">
      {visibleRecords.map((record) => (
        <div className={styles.row} key={record.operationId}>
          <div className={styles.copy}>
            <strong>
              {record.phase === 'resolved'
                ? '操作结果已确认'
                : record.phase === 'pending'
                  ? '工作操作正在提交'
                  : record.phase === 'checking'
                    ? '正在核对原工作'
                    : '工作操作结果待核对'}
            </strong>
            <p>{record.message}</p>
            {checks[record.operationId] ? (
              <p role="status">{checks[record.operationId]!.message}</p>
            ) : null}
          </div>
          <Link
            to={`/projects/${encodeURIComponent(record.projectId)}/work?task=${encodeURIComponent(record.taskId)}`}
          >
            查看原工作
          </Link>
          {record.phase === 'resolved' ? (
            <AhButton
              variant="subtle"
              size="xs"
              onClick={() => context.owner.dismiss(record, record.operationId)}
            >
              关闭已确认结果
            </AhButton>
          ) : null}
          {record.resultHref ? <Link to={record.resultHref}>打开已确认结果</Link> : null}
          {checks[record.operationId]?.href ? (
            <Link to={checks[record.operationId]!.href!}>查看当前工作区</Link>
          ) : null}
          {record.phase === 'unknown' || record.phase === 'checking' ? (
            <AhButton
              variant="default"
              size="xs"
              disabled={record.phase === 'checking'}
              onClick={() => void check(record)}
            >
              核对原操作
            </AhButton>
          ) : null}
        </div>
      ))}
    </section>
  );
}
