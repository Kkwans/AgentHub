import { AhButton, humanizeStatus } from '@agenthub/ui';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type TaskRecord, type WorktreeExecutionRecord } from '../../../lib/api';
import { useReviewOperationOwner } from '../hooks/useReviewOperationOwner';
import type { OwnedReviewOperation } from '../lib/review-operation-owner';
import { useReviewOperations } from './ReviewOperationProvider';
import styles from './reviewOperationStatus.module.css';

/** Survives route-owned Review unmounts. Checking is read-only, never retries or unlocks. */
export function ReviewOperationStatus() {
  const context = useReviewOperations();
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
    try {
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
      if (live.current)
        setChecks((current) => ({
          ...current,
          [record.operationId]: {
            message: `当前状态：${humanizeStatus(value.status)}。这是状态核对，不是原请求成功确认；未自动重试。`,
            ...(typeof value.sessionId === 'string' && value.sessionId
              ? { href: `/workspace/${encodeURIComponent(value.sessionId)}` }
              : {}),
          },
        }));
    } catch (error) {
      if (live.current)
        setChecks((current) => ({
          ...current,
          [record.operationId]: {
            message: error instanceof Error ? error.message : '核对失败，保护仍保留。',
          },
        }));
    } finally {
      busy.current.delete(record.operationId);
      report({ ...record, phase: 'unknown', message: '原请求结果仍需核对，已阻止重复提交。' });
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
