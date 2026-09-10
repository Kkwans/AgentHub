import { AtSign, ArrowUp, Button, LoaderCircle, ShieldCheck, Square } from '@agenthub/ui';

import type { SessionConfigurationRecord } from '../../../lib/api';
import { SessionConfigurationControl } from './SessionConfigurationControl';

export type ComposerContextStatus = {
  label: string;
  kind: 'loading' | 'error' | 'missing' | 'empty' | 'ready';
};

export function ComposerToolbar({
  contextOpen,
  contextStatus,
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
}: {
  contextOpen: boolean;
  contextStatus: ComposerContextStatus;
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
  return (
    <div
      className="flex min-h-11 items-center justify-between gap-2 border-t border-[hsl(var(--border))]/60 bg-[hsl(var(--surface-muted))]/35 px-2 py-1 sm:px-3 sm:py-1.5"
      aria-label="发送配置"
    >
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={`h-11 min-w-0 gap-1.5 rounded-lg px-2 text-xs text-[hsl(var(--foreground-subtle))] transition-colors sm:h-auto sm:rounded-[var(--radius)] sm:px-2 sm:py-1.5 hover:bg-[hsl(var(--surface-hover))] hover:text-[hsl(var(--foreground))] ${contextOpen ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]' : ''}`}
          onClick={onToggleContext}
          aria-expanded={contextOpen}
          aria-label={`PromptOS ${contextStatus.label}`}
        >
          <AtSign aria-hidden size={16} />
          <span className="hidden sm:inline">上下文</span>
          <small className="max-w-24 truncate text-[11px] text-[hsl(var(--foreground-faint))]">
            {contextStatus.label}
          </small>
        </Button>
        <span className="composer-permission hidden items-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] px-2 text-xs text-[hsl(var(--foreground-muted))] sm:inline-flex">
          <ShieldCheck aria-hidden size={15} />
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
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-1 sm:gap-2">
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
              <LoaderCircle size={16} aria-hidden />
            ) : (
              <Square size={15} weight="fill" aria-hidden />
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
              <LoaderCircle size={16} aria-hidden />
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
