import type { ReactNode } from 'react';
import { AlertTriangle, AhStatusPill, Inbox, RefreshCw } from '@agenthub/ui';
import { ApiError } from '../lib/api';
import styles from './Feedback.module.css';

const statusLabels: Record<string, string> = {
  READY: '就绪',
  PENDING: '待处理',
  RUNNING: '运行中',
  STARTING: '正在启动',
  WAITING_APPROVAL: '等待批准',
  WAITING_REVIEW: '待审阅',
  STOPPED: '已停止',
  ARCHIVED: '已归档',
  DISABLED: '已停用',
  MISSING: '未安装',
  MISSING_DEPENDENCY: '缺少依赖',
  INSTALLED: '已发现',
  UNSUPPORTED: '暂不支持',
  UNAVAILABLE: '不可用',
  BROKEN: '异常',
  AUTH_REQUIRED: '需要授权',
  WORKSPACE_UNMAPPED: '工作区未映射',
  UNHEALTHY: '健康检查失败',
  CANCELING: '正在停止',
  DISCONNECTED: '已断开',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELED: '已取消',
  REJECTED: '已拒绝',
  EXPIRED: '已过期',
  ACTIVE: '使用中',
  UNVERIFIED: '未验证',
  CLOSED: '已关闭',
  IDLE: '未运行',
  UNKNOWN: '状态未确认',
  DEAD: '已终止',
  DRAFT: '草稿',
  ACHIEVED: '已达成',
  BACKLOG: '待规划',
  IN_PROGRESS: '进行中',
  DONE: '完成',
  BLOCKED: '受阻',
  QUEUED: '排队中',
  SETTING_UP: '创建工作区',
  AWAITING_INPUT: '等待输入',
  REVIEW: '待合并审阅',
  MERGING: '合并中',
  ONLINE: '在线',
  OFFLINE: '离线',
  REVOKED: '已撤销',
  AVAILABLE: '可用',
};

export function StatusBadge({ status }: { status: string }) {
  return <AhStatusPill status={status} label={statusLabels[status] ?? '状态待确认'} />;
}

export function PageIntro({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.pageIntro}>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

export function LoadingState({ label = '正在加载真实状态' }: { label?: string }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <div className={styles.loadingCopy}>
        <strong>{label}…</strong>
        <span>正在读取最新状态</span>
      </div>
      <div className={styles.loadingLines} aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  const authorizationError = error instanceof ApiError && error.code === 'AUTH_REQUIRED';
  const message = error instanceof ApiError ? error.message : '服务暂时不可用，请检查连接后重试。';
  return (
    <div className={styles.error} role="alert">
      <span className={styles.errorIcon} aria-hidden>
        <AlertTriangle size={18} />
      </span>
      <div className={styles.errorCopy}>
        <strong>{authorizationError ? '登录已失效' : '暂时无法加载'}</strong>
        <span>{message}</span>
      </div>
      {retry ? (
        <button type="button" className={styles.errorAction} onClick={retry}>
          <RefreshCw aria-hidden size={15} /> 重新加载
        </button>
      ) : null}
    </div>
  );
}

/**
 * A compact, announced error for mutations that should keep the current page
 * and form state intact. Query failures use ErrorState; this is for actions
 * such as adopt/start/stop/save where a retry button would be unsafe or
 * ambiguous without the user's next choice.
 */
export function InlineError({ error, title = '操作未完成' }: { error: unknown; title?: string }) {
  const message = error instanceof ApiError ? error.message : '请检查当前状态后重试。';
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}
    >
      <AlertTriangle aria-hidden size={15} />
      <span>
        <strong>{title}</strong> {message}
      </span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  compact = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`${styles.empty} ${compact ? styles.compact : ''}`}>
      <span className={styles.emptyIcon}>{icon ?? <Inbox size={22} />}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function formatTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
