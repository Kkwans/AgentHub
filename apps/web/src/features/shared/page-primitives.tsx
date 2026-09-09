import {
  AhErrorState,
  AhReveal,
  LayoutDashboard,
  NavigationPageHeader,
  Skeleton,
  SkeletonText,
  type IconProps,
} from '@agenthub/ui';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

import type { ProjectRecord, TaskRecord } from '../../lib/api';
import layout from './layout.module.css';

export { NavigationPageHeader } from '@agenthub/ui';

/** Shared page chrome used by domain-owned pages. */
export function Screen({
  eyebrow,
  title,
  description,
  actions,
  icon: Icon = LayoutDashboard,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: ComponentType<IconProps>;
  children: ReactNode;
}) {
  return (
    <div className="min-h-full">
      <AhReveal>
        <NavigationPageHeader
          icon={Icon}
          title={title}
          description={description ?? ''}
          badge={
            <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-muted))] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--foreground-faint))]">
              {eyebrow}
            </span>
          }
          {...(actions ? { actions } : {})}
        />
      </AhReveal>
      <div className="page-content page-shell min-h-full">{children}</div>
    </div>
  );
}

export function QueryMessage({
  loading,
  error,
  retry,
  label,
}: {
  loading: boolean;
  error: Error | null;
  retry?: () => void;
  label: string;
}) {
  if (loading)
    return (
      <div
        className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-xl)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 shadow-[var(--shadow-sm)]"
        role="status"
        aria-busy="true"
        aria-label={label}
      >
        <div className="flex items-center gap-2 text-[12px] font-medium text-[hsl(var(--foreground-muted))]">
          <Skeleton className="h-2 w-2 rounded-full" />
          {label}
        </div>
        <SkeletonText lines={3} />
      </div>
    );
  if (error) return <AhErrorState description={error.message} {...(retry ? { retry } : {})} />;
  return null;
}

export function displayDate(value?: string | null): string {
  if (!value) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '暂无记录'
    : new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
}

export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return compact;
}

export type ProjectViewRecord = ProjectRecord & {
  createdAt?: string;
  updatedAt?: string;
  language?: string | null;
  languageName?: string | null;
  technology?: string | null;
};

export function projectViewRecord(project: ProjectRecord): ProjectViewRecord {
  return project as ProjectViewRecord;
}

export function projectLanguage(project: ProjectRecord): string | undefined {
  const record = projectViewRecord(project);
  return record.language ?? record.languageName ?? record.technology ?? undefined;
}

export function projectTimestamp(project: ProjectRecord): string | undefined {
  const record = projectViewRecord(project);
  return record.updatedAt ?? record.createdAt;
}

export function domainStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    ACTIVE: '运行中',
    ARCHIVED: '已归档',
    READY: '就绪',
    BACKLOG: '待排期',
    IN_PROGRESS: '进行中',
    WAITING_REVIEW: '待审阅',
    BLOCKED: '已阻塞',
    DONE: '已完成',
    CANCELED: '已取消',
    FAILED: '失败',
    RUNNING: '运行中',
    CLOSED: '已关闭',
    DISCONNECTED: '已断开',
    REVIEW: '待审阅',
    QUEUED: '排队中',
  };
  return labels[status] ?? '其他';
}

export function taskStateClass(status: TaskRecord['status']): string {
  if (status === 'IN_PROGRESS') return layout.workStateDotRunning ?? '';
  if (status === 'WAITING_REVIEW' || status === 'BLOCKED') return layout.workStateDotReview ?? '';
  if (status === 'DONE') return layout.workStateDotDone ?? '';
  if (status === 'CANCELED') return layout.workStateDotFailed ?? '';
  return layout.workStateDotSmall ?? '';
}

export function sessionGroupKey(value: string): 'today' | 'yesterday' | 'earlier' {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return 'earlier';
  const current = new Date();
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  const day = new Date(
    new Date(time).getFullYear(),
    new Date(time).getMonth(),
    new Date(time).getDate(),
  ).getTime();
  if (day === today) return 'today';
  if (day === today - 86_400_000) return 'yesterday';
  return 'earlier';
}
