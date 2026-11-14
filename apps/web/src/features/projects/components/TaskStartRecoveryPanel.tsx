import styles from './TaskStartRecoveryPanel.module.css';
import { AhButton } from '@agenthub/ui';
import { Link } from 'react-router-dom';
import type { ExistingStartState } from '../lib/existing-task-start-state';
export function TaskStartRecoveryPanel({
  state,
  checking,
  onCheck,
}: {
  state: ExistingStartState | undefined;
  checking: boolean;
  onCheck: () => void;
}) {
  if (!state) return null;
  const linkedSession = state.observedSessionId ?? state.sessionId;
  return (
    <section className={styles.panel} aria-label="原任务启动核对">
      <div className={styles.header}>
        <h4>任务启动</h4>
        <span>
          {state.phase === 'pending'
            ? '正在处理'
            : state.phase === 'unknown'
              ? '待核对'
              : state.phase === 'retryable'
                ? '尚未启动'
                : '已确认启动'}
        </span>
      </div>
      <p role="status">{state.message}</p>
      <div className={styles.actions}>
        <AhButton
          variant="default"
          disabled={checking || state.phase === 'pending'}
          onClick={onCheck}
        >
          {checking ? '正在核对…' : '核对原任务启动'}
        </AhButton>
        {linkedSession ? (
          <Link to={`/workspace/${encodeURIComponent(linkedSession)}`}>打开已核对的关联会话</Link>
        ) : null}
      </div>
      <p className={styles.hint}>
        关闭或离开不会撤销原请求。历史记录和当前状态不等于本次启动成功。
      </p>
    </section>
  );
}
