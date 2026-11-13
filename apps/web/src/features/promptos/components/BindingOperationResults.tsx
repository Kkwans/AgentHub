import { useLayoutEffect, useRef } from 'react';
import { AhButton } from '@agenthub/ui';
import { labelPromptBindingTarget } from '../../../presentation/domain-labels';
import type { BindingOperation } from '../lib/binding-operation-owner';
import styles from './BindingOperationResults.module.css';

export function BindingOperationResults({
  operations,
  dismiss,
  onEmptyFocus,
}: {
  operations: readonly BindingOperation[];
  dismiss: (id: number) => void;
  onEmptyFocus: () => void;
}) {
  const region = useRef<HTMLElement>(null);
  const focusAfterDismiss = useRef<number | 'heading' | null>(null);
  useLayoutEffect(() => {
    const target = focusAfterDismiss.current;
    if (target === null) return;
    focusAfterDismiss.current = null;
    if (!operations.length) {
      onEmptyFocus();
      return;
    }
    const summary =
      typeof target === 'number'
        ? region.current?.querySelector<HTMLElement>(`[data-operation-summary="${target}"]`)
        : null;
    (summary ?? region.current?.querySelector<HTMLElement>('h2'))?.focus();
  }, [operations, onEmptyFocus]);
  if (!operations.length) return null;
  return (
    <section ref={region} className={styles.results} aria-label="绑定操作记录">
      <h2 tabIndex={-1} className={styles.heading}>
        绑定操作 <span>（{operations.length}）</span>
      </h2>
      {operations.map((operation, index) => {
        const active = operation.phase === 'pending' || operation.phase === 'unknown';
        const phaseLabel =
          operation.phase === 'saved'
            ? '已保存原绑定'
            : operation.phase === 'rejected'
              ? '未保存'
              : operation.phase === 'pending'
                ? '正在保存'
                : '结果未确认';
        return (
          <section
            key={operation.id}
            role={
              operation.phase === 'unknown' || operation.phase === 'rejected' ? 'alert' : 'status'
            }
            aria-label="绑定操作结果"
            className={styles.record}
          >
            <div className={styles.row}>
              <details className={styles.details}>
                <summary data-operation-summary={operation.id} className={styles.summary}>
                  <span className={styles.names}>
                    {operation.promptName} →{' '}
                    {labelPromptBindingTarget(operation.payload.targetType)} ·{' '}
                    {operation.targetName}
                  </span>
                  <span className={styles.phase}>{phaseLabel} · 核对详情</span>
                </summary>
                <dl className={styles.identifiers}>
                  <dt>Prompt ID</dt>
                  <dd>{operation.payload.promptId}</dd>
                  <dt>目标 ID</dt>
                  <dd>{operation.payload.targetId}</dd>
                  <dt>提示位</dt>
                  <dd>{operation.payload.slot}</dd>
                  <dt>
                    {operation.payload.selectorType === 'VERSION' ? '固定版本 ID' : '版本标签'}
                  </dt>
                  <dd>{operation.payload.versionId ?? operation.payload.label}</dd>
                  {operation.bindingId ? (
                    <>
                      <dt>绑定编号</dt>
                      <dd>{operation.bindingId}</dd>
                    </>
                  ) : null}
                </dl>
              </details>
              <AhButton
                hidden={active}
                className={styles.dismiss}
                variant="subtle"
                aria-label="关闭此结果提示"
                onClick={() => {
                  if (active) return;
                  focusAfterDismiss.current =
                    operations[index + 1]?.id ?? operations[index - 1]?.id ?? 'heading';
                  dismiss(operation.id);
                }}
              >
                关闭
              </AhButton>
            </div>
            <p className={styles.message} hidden={operation.phase === 'saved'}>
              {operation.message}
            </p>
          </section>
        );
      })}
    </section>
  );
}
