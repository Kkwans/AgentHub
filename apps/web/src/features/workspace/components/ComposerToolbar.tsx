import { Button, CircleStop, LoaderCircle, Plus, Send, ShieldCheck } from '@agenthub/ui';

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
  sendPending: boolean;
  stopPending: boolean;
  sendingBlocked: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
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
          className={`min-h-8 min-w-0 gap-1.5 rounded-[var(--radius)] px-2 text-xs text-[hsl(var(--foreground-subtle))] hover:bg-[hsl(var(--surface-hover))] hover:text-[hsl(var(--foreground))] ${contextOpen ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]' : ''}`}
          onClick={onToggleContext}
          aria-expanded={contextOpen}
          aria-label={`PromptOS ${contextStatus.label}`}
        >
          <Plus aria-hidden size={15} />
          <span className="hidden sm:inline">上下文</span>
          <small className="max-w-24 truncate text-[11px] text-[hsl(var(--foreground-faint))]">
            {contextStatus.label}
          </small>
        </Button>
        <span className="hidden items-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] px-2 text-xs text-[hsl(var(--foreground-muted))] sm:inline-flex">
          <ShieldCheck aria-hidden size={15} />
          <strong className="font-medium">按需审批</strong>
        </span>
        <span
          className={`hidden items-center gap-1.5 whitespace-nowrap px-2 text-[11px] text-[hsl(var(--foreground-faint))] sm:inline-flex ${activeRun ? 'text-[hsl(var(--warning))]' : ''}`}
          data-running={activeRun || undefined}
        >
          <span
            className={`size-1.5 rounded-full ${activeRun ? 'bg-[hsl(var(--warning))] shadow-[0_0_0_3px_hsl(var(--warning-soft))]' : 'bg-[hsl(var(--success))]'}`}
            aria-hidden="true"
          />
          {activeRun ? '运行中' : '就绪'}
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
          className="hidden items-center gap-1.5 text-[10px] text-[hsl(var(--foreground-faint))] md:flex"
          aria-label="快捷键提示"
        >
          <kbd className="rounded-[5px] border border-[hsl(var(--border))]/80 bg-[hsl(var(--surface))] px-1.5 py-0.5 font-mono text-[10px] text-[hsl(var(--foreground-subtle))] shadow-[0_1px_0_hsl(var(--border))]">
            ⌘↵
          </kbd>
          <span>发送</span>
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
              <CircleStop size={17} aria-hidden />
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
            {sendPending ? <LoaderCircle size={16} aria-hidden /> : <Send size={17} aria-hidden />}
          </Button>
        </div>
      </div>
    </div>
  );
}
