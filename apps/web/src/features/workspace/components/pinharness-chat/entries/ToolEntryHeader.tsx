import { cn } from '@agenthub/ui';
import { Check, ChevronRight, CircleAlert, Link2 } from 'lucide-react';
import type { ToolTheme } from '../toolThemes';

interface ToolEntryHeaderProps {
  hasOutput: boolean;
  showDetail: boolean;
  isActive: boolean;
  isFailed: boolean;
  theme: ToolTheme;
  badgeTheme: string;
  toolName: string;
  summary: string;
  resultSummary: string;
  sleepRemainingMs: number | null;
  toolDurationMs?: number | null | undefined;
  filePathForOpen: string | null;
  onToggle: () => void;
  onOpenFile: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function ToolStatusIcon({ isActive, isFailed }: { isActive: boolean; isFailed: boolean }) {
  if (isActive) {
    return (
      <span
        className="tool-running-dot h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]"
        title="工具执行中"
      />
    );
  }
  if (isFailed) {
    return (
      <CircleAlert
        className="tool-status-settle h-3 w-3 text-[hsl(var(--destructive))]"
        aria-label="执行失败"
      />
    );
  }
  return (
    <Check
      className="tool-status-settle h-3 w-3 text-[hsl(var(--success))]"
      aria-label="执行完成"
    />
  );
}

function ToolEntryStatus({
  isActive,
  isFailed,
  sleepRemainingMs,
  toolDurationMs,
  hasOutput,
  showDetail,
}: Pick<
  ToolEntryHeaderProps,
  'isActive' | 'isFailed' | 'sleepRemainingMs' | 'toolDurationMs' | 'hasOutput' | 'showDetail'
>) {
  return (
    <span className="shrink-0 inline-flex items-center gap-1.5 text-[hsl(var(--foreground-subtle))]">
      {isActive && sleepRemainingMs != null && (
        <span
          className="font-mono tabular-nums text-xs text-[hsl(var(--warning-fg))]"
          title={sleepRemainingMs > 0 ? 'sleep 等待剩余时间' : 'sleep 已结束，正在执行后续命令'}
        >
          {sleepRemainingMs > 0 ? `等待 ${formatCountdown(sleepRemainingMs)}` : '等待结束'}
        </span>
      )}
      <ToolStatusIcon isActive={isActive} isFailed={isFailed} />
      {toolDurationMs != null && !isActive && (
        <span className="font-mono tabular-nums text-xs text-[hsl(var(--foreground-subtle))]">
          {formatDuration(toolDurationMs)}
        </span>
      )}
      {hasOutput && (
        <span
          className={cn(
            'tool-entry-chevron inline-flex rounded-full p-0.5',
            showDetail
              ? 'rotate-90 bg-[hsl(var(--surface-muted))] opacity-100'
              : 'rotate-0 opacity-35 group-hover/tool:opacity-80',
          )}
        >
          <ChevronRight className="h-3 w-3" />
        </span>
      )}
    </span>
  );
}

export function ToolEntryHeader({
  hasOutput,
  showDetail,
  isActive,
  isFailed,
  theme,
  badgeTheme,
  toolName,
  summary,
  resultSummary,
  sleepRemainingMs,
  toolDurationMs,
  filePathForOpen,
  onToggle,
  onOpenFile,
}: ToolEntryHeaderProps) {
  const { Icon } = theme;
  return (
    <div
      className={cn(
        'tool-entry-trigger',
        hasOutput ? 'tool-entry-trigger--interactive' : 'cursor-default',
        isActive && 'tool-entry-trigger--active',
        isFailed && 'tool-entry-trigger--failed',
        showDetail && 'tool-entry-trigger--expanded',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasOutput}
        aria-expanded={hasOutput ? showDetail : undefined}
        aria-label={`${toolName}，${isActive ? '工具执行中' : isFailed ? '工具调用失败' : '工具调用完成'}${hasOutput ? '，展开详情' : ''}`}
        className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/35"
      >
        <span className="tool-entry-icon">
          <Icon
            className={cn(
              'h-3.5 w-3.5',
              isFailed ? 'text-[hsl(var(--destructive))]' : theme.iconColor,
            )}
          />
        </span>
        <span className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
          <span className={cn('tool-entry-badge', badgeTheme)}>{toolName}</span>
          {summary && <span className="tool-entry-separator" aria-hidden="true" />}
          {summary && (
            <span className="min-w-0 truncate font-mono text-xs text-[hsl(var(--foreground-muted))]">
              {summary}
            </span>
          )}
          {resultSummary && (
            <span className="shrink-0 text-xs text-[hsl(var(--foreground-faint))]">
              {resultSummary}
            </span>
          )}
        </span>
        <ToolEntryStatus
          isActive={isActive}
          isFailed={isFailed}
          sleepRemainingMs={sleepRemainingMs}
          toolDurationMs={toolDurationMs}
          hasOutput={hasOutput}
          showDetail={showDetail}
        />
      </button>
      {summary && filePathForOpen && (
        <button
          type="button"
          title={`在文件面板中打开：${filePathForOpen}`}
          aria-label={`在文件面板中打开：${filePathForOpen}`}
          onClick={onOpenFile}
          className="shrink-0 rounded-md p-1.5 text-[hsl(var(--primary))] transition-colors hover:bg-[hsl(var(--primary-soft))]"
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
