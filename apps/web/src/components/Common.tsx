import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';

const statusLabels: Record<string, string> = {
  READY: '就绪',
  RUNNING: '运行中',
  WAITING_APPROVAL: '等待批准',
  WAITING_REVIEW: '待审阅',
  STOPPED: '已停止',
  MISSING: '未安装',
  BROKEN: '异常',
  AUTH_REQUIRED: '需要授权',
  WORKSPACE_UNMAPPED: '工作区未映射',
  DISCONNECTED: '已断开',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELED: '已取消',
  ACTIVE: '使用中',
  UNVERIFIED: '未验证',
  CLOSED: '已关闭',
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
  const tone = /READY|COMPLETED|ACTIVE|DONE|ACHIEVED|ONLINE|AVAILABLE/.test(status)
    ? 'positive'
    : /RUNNING|STARTING|SETTING_UP|MERGING/.test(status)
      ? 'active'
      : /WAITING|AWAITING|REVIEW|QUEUED|AUTH_REQUIRED|UNVERIFIED|UNMAPPED/.test(status)
        ? 'warning'
        : /FAILED|BROKEN|MISSING|DISCONNECTED|BLOCKED|OFFLINE|REVOKED/.test(status)
          ? 'danger'
          : 'neutral';
  return <span className={`status-badge ${tone}`}>{statusLabels[status] ?? status}</span>;
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
    <div className="page-intro">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

export function LoadingState({ label = '正在加载真实状态' }: { label?: string }) {
  return (
    <div className="state-panel compact">
      <LoaderCircle className="spin" size={20} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="state-panel error">
      <AlertTriangle size={20} />
      <div>
        <strong>数据加载失败</strong>
        <p>{error.message || '服务暂时不可用，请稍后重试。'}</p>
      </div>
      {retry && (
        <button className="button secondary" onClick={retry}>
          <RefreshCw size={15} /> 重试
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Inbox size={25} />
      <strong>{title}</strong>
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
