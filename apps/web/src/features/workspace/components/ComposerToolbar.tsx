import { Button } from '@agenthub/ui';
import { AtSign, ArrowUp, ListChecks, Loader2, ShieldCheck, Square } from 'lucide-react';
import type { RefObject } from 'react';

import type { SessionConfigurationRecord } from '../../../lib/api';
import type { ComposerPlanSummary } from './ChatCommandBar';
import { SessionConfigurationControl } from './SessionConfigurationControl';

export type ComposerContextStatus = {
  label: string;
  kind: 'loading' | 'error' | 'missing' | 'empty' | 'ready';
};

export function ComposerToolbar({
  contextOpen,
  contextStatus,
  planSummary,
  onToggleContext,
  configuration,
  configurationLoading,
  model,
  mode,
  reasoningEffort,
  updatingModel,
  updatingMode,
  updatingReasoningEffort,
  onChangeConfiguration,
  activeRun,
  sessionStatus,
  sendPending,
  stopPending,
  sendingBlocked,
  onSend,
  onStop,
  terminalLauncherSlotRef,
}: {
  contextOpen: boolean;
  contextStatus: ComposerContextStatus;
  planSummary?: ComposerPlanSummary;
  onToggleContext: () => void;
  configuration: SessionConfigurationRecord | undefined;
  configurationLoading: boolean;
  model: string;
  mode: string;
  reasoningEffort: string;
  updatingModel: boolean;
  updatingMode: boolean;
  updatingReasoningEffort: boolean;
  onChangeConfiguration: (patch: {
    model?: string;
    mode?: string;
    reasoningEffort?: string;
  }) => void;
  activeRun: boolean;
  sessionStatus: string;
  sendPending: boolean;
  stopPending: boolean;
  sendingBlocked: boolean;
  onSend: () => void;
  onStop: () => void;
  terminalLauncherSlotRef?: RefObject<HTMLElement | null>;
}) {
  const sessionLocked = sessionStatus !== 'READY';
  const lockedStateLabel = resolveLockedSessionState(sessionStatus);
  const runStateLabel = activeRun ? '运行中' : lockedStateLabel;
  const runStateTone = activeRun
    ? 'text-[hsl(var(--warning))]'
    : sessionLocked
      ? 'text-[hsl(var(--foreground-faint))]'
      : 'text-[hsl(var(--foreground-faint))]';
  const runStateDot = activeRun
    ? 'bg-[hsl(var(--warning))] shadow-[0_0_0_3px_hsl(var(--warning-soft))]'
    : sessionLocked
      ? 'bg-[hsl(var(--foreground-faint))]'
      : 'bg-[hsl(var(--success))]';
  const planProgress = planSummary
    ? Math.min(1, Math.max(0, planSummary.completed / Math.max(planSummary.total, 1)))
    : 0;
  return (
    <div
      className="composer-toolbar flex min-h-11 items-center justify-between gap-2 border-t border-[hsl(var(--border))]/60 bg-[hsl(var(--surface-muted))]/15 px-2 py-1 sm:px-3 sm:py-2"
      aria-label="发送配置"
      data-running={activeRun || undefined}
      data-locked={sessionLocked || undefined}
    >
      <div className="composer-toolbar-start flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={`composer-context-control h-11 min-w-0 gap-1.5 rounded-lg px-2 text-xs text-[hsl(var(--foreground-subtle))] transition-[background-color,color,transform] duration-[var(--motion-fast)] active:scale-[0.97] sm:h-auto sm:rounded-[var(--radius)] sm:px-2 sm:py-1.5 hover:bg-[hsl(var(--surface-hover))] hover:text-[hsl(var(--foreground))] ${contextOpen ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]' : ''}`}
          onClick={onToggleContext}
          aria-expanded={contextOpen}
          aria-label={`PromptOS ${contextStatus.label}`}
          data-open={contextOpen || undefined}
        >
          <AtSign aria-hidden size={15} strokeWidth={1.8} />
          <span className="hidden sm:inline">上下文</span>
          <small className="max-w-24 truncate text-[11px] text-[hsl(var(--foreground-faint))]">
            {contextStatus.label}
          </small>
        </Button>
        {planSummary ? (
          <span
            className="composer-plan-status inline-flex min-h-8 min-w-20 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] border border-[hsl(var(--border))]/60 bg-[hsl(var(--surface-muted))]/45 px-2 text-[11px] text-[hsl(var(--foreground-muted))]"
            data-complete={planSummary.completed === planSummary.total || undefined}
            aria-label={`执行计划 ${planSummary.completed}/${planSummary.total} 完成`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={planSummary.total}
            aria-valuenow={planSummary.completed}
          >
            <ListChecks size={14} aria-hidden="true" strokeWidth={1.8} />
            <span className="min-w-0 flex-1">
              <span className="block tabular-nums">
                {planSummary.completed}/{planSummary.total}
              </span>
              <span className="composer-plan-track" aria-hidden="true">
                <span
                  className="composer-plan-track-fill"
                  style={{ transform: `scaleX(${planProgress})` }}
                />
              </span>
            </span>
          </span>
        ) : null}
        <span className="composer-permission hidden items-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] px-2 text-xs text-[hsl(var(--foreground-muted))] sm:inline-flex">
          <ShieldCheck aria-hidden size={15} strokeWidth={1.8} />
          <strong className="font-medium">按需审批</strong>
        </span>
        <span
          className={`composer-run-state hidden items-center gap-1.5 whitespace-nowrap px-2 text-[11px] sm:inline-flex ${runStateTone}`}
          data-running={activeRun || undefined}
          data-session-locked={sessionLocked || undefined}
          data-session-status={sessionStatus}
        >
          <span className={`size-1.5 rounded-full ${runStateDot}`} aria-hidden="true" />
          {runStateLabel}
        </span>
        {terminalLauncherSlotRef ? (
          <span
            ref={terminalLauncherSlotRef}
            className="composer-terminal-launcher-slot inline-flex min-w-0 shrink-0 items-center rounded-lg"
            aria-label="Terminal 操作"
          />
        ) : null}
      </div>
      <div className="composer-toolbar-end flex min-w-0 shrink-0 items-center gap-1 sm:gap-2">
        <SessionConfigurationControl
          configuration={configuration}
          loading={configurationLoading}
          model={model}
          mode={mode}
          reasoningEffort={reasoningEffort}
          updatingModel={updatingModel}
          updatingMode={updatingMode}
          updatingReasoningEffort={updatingReasoningEffort}
          onChange={onChangeConfiguration}
        />
        <div
          className="hidden items-center gap-2 text-[9.5px] text-[hsl(var(--foreground-faint))] md:flex"
          aria-label="Return 发送，Shift Return 换行"
        >
          <span className="inline-flex items-center gap-1">
            <kbd className="inline-flex min-w-5 items-center justify-center rounded-[5px] border border-[hsl(var(--border))]/80 bg-[hsl(var(--surface))] px-1 py-0.5 font-sans text-[10px] leading-none text-[hsl(var(--foreground-subtle))] shadow-[0_1px_0_hsl(var(--border))]">
              ↩
            </kbd>
            <span>发送</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="inline-flex items-center justify-center rounded-[5px] border border-[hsl(var(--border))]/80 bg-[hsl(var(--surface))] px-1 py-0.5 font-sans text-[10px] leading-none text-[hsl(var(--foreground-subtle))] shadow-[0_1px_0_hsl(var(--border))]">
              ⇧ ↩
            </kbd>
            <span>换行</span>
          </span>
        </div>
        <div className="relative flex size-9 items-center justify-center sm:size-8">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={`absolute inset-0 size-9 rounded-full p-1.5 text-[hsl(var(--destructive))] transition-[opacity,transform,background-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[hsl(var(--destructive))]/10 active:scale-90 sm:size-8 ${activeRun ? 'scale-100 opacity-100' : 'pointer-events-none scale-75 opacity-0'}`}
            onClick={onStop}
            disabled={!activeRun || stopPending}
            aria-label={stopPending ? '正在停止 Run' : '停止 Run'}
            aria-hidden={!activeRun}
            tabIndex={activeRun ? 0 : -1}
          >
            {stopPending ? (
              <Loader2 size={16} aria-hidden className="animate-spin" />
            ) : (
              <Square size={15} fill="currentColor" aria-hidden />
            )}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={`absolute inset-0 size-9 rounded-full p-1.5 transition-[opacity,transform,background-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-90 sm:size-8 ${activeRun ? 'pointer-events-none scale-75 opacity-0' : 'scale-100 opacity-100'} ${!activeRun && !sendingBlocked && !sendPending ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[var(--shadow-sm)] hover:bg-[hsl(var(--primary-hover))]' : 'cursor-not-allowed text-[hsl(var(--foreground-faint))]'}`}
            onClick={onSend}
            disabled={activeRun || sendingBlocked || sendPending}
            aria-label={sendPending ? '正在发送消息' : '发送'}
            aria-busy={sendPending}
            aria-hidden={activeRun}
            tabIndex={activeRun ? -1 : 0}
          >
            {sendPending ? (
              <Loader2 size={16} aria-hidden className="animate-spin" />
            ) : (
              <ArrowUp size={17} aria-hidden />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function resolveLockedSessionState(status: string): string {
  switch (status) {
    case 'READY':
      return '就绪';
    case 'CREATED':
    case 'STARTING':
      return '准备中';
    case 'RUNNING':
      return '运行中';
    case 'WAITING_APPROVAL':
      return '等待审批';
    case 'DISCONNECTED':
      return '已断开';
    case 'FAILED':
      return '已失败';
    case 'CLOSED':
      return '已关闭';
    default:
      return '不可发送';
  }
}
