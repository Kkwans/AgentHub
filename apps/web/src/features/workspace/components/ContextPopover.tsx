import { Button, GitBranch, cn } from '@agenthub/ui';

import { ErrorState, LoadingState } from '../../../components/Feedback';
import type { ProjectRecord, ResolvedPromptContextRecord, SessionRecord } from '../../../lib/api';
import {
  labelPromptBindingSlot,
  labelPromptBindingTarget,
} from '../../../presentation/domain-labels';
import type { ComposerContextStatus } from './ComposerToolbar';

export function ContextPopover({
  project,
  session,
  promptContext,
  promptContextLoading,
  promptContextError,
  promptContextRetry,
  variablesDraft,
  variablesError,
  contextStatus,
  onVariablesDraftChange,
  onApplyVariables,
}: {
  project: ProjectRecord | undefined;
  session: SessionRecord;
  promptContext: ResolvedPromptContextRecord | undefined;
  promptContextLoading: boolean;
  promptContextError: Error | null;
  promptContextRetry: () => unknown;
  variablesDraft: string;
  variablesError: string | undefined;
  contextStatus: ComposerContextStatus;
  onVariablesDraftChange: (value: string) => void;
  onApplyVariables: () => void;
}) {
  return (
    <div
      className="absolute inset-x-3 bottom-[calc(100%+0.5rem)] z-30 grid max-h-[min(420px,52dvh)] gap-3 overflow-auto rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] p-3 text-[hsl(var(--foreground))] shadow-[var(--shadow-lg)] animate-[hci-fade-in_140ms_ease-out_both] motion-reduce:animate-none sm:inset-x-4"
      role="dialog"
      aria-label="PromptOS 上下文预览"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="grid min-w-0 gap-1">
          <strong className="text-xs">PromptOS 上下文预览</strong>
          <span className="text-[11px] leading-relaxed text-[hsl(var(--foreground-muted))]">
            发送 Run 前解析，版本、标签与 content hash 会写入来源记录。
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-[hsl(var(--primary-soft))] px-2 py-0.5 text-[11px] font-semibold text-[hsl(var(--primary))]">
          {contextStatus.label}
        </span>
      </div>
      {promptContextLoading ? (
        <LoadingState label="正在解析 PromptOS 上下文" />
      ) : promptContextError ? (
        <div className="prompt-context-error">
          <ErrorState error={promptContextError} />
          <Button size="xs" variant="destructive" onClick={() => promptContextRetry()}>
            重新解析
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="会话上下文事实">
            <div className="grid min-w-0 gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))]/60 bg-[hsl(var(--surface-muted))]/60 p-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--foreground-faint))]">
                Project
              </span>
              <strong className="truncate text-xs font-medium">{project?.name ?? '未知'}</strong>
            </div>
            <div className="grid min-w-0 gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))]/60 bg-[hsl(var(--surface-muted))]/60 p-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--foreground-faint))]">
                cwd
              </span>
              <code className="truncate font-mono text-xs font-medium text-[hsl(var(--foreground-subtle))]">
                {session.cwd}
              </code>
            </div>
            <div className="grid min-w-0 gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))]/60 bg-[hsl(var(--surface-muted))]/60 p-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--foreground-faint))]">
                branch
              </span>
              <strong className="flex min-w-0 items-center gap-1 truncate text-xs font-medium">
                <GitBranch aria-hidden size={13} /> {session.branch || '无 Git'}
              </strong>
            </div>
            <div className="grid min-w-0 gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))]/60 bg-[hsl(var(--surface-muted))]/60 p-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--foreground-faint))]">
                Tools
              </span>
              <strong className="text-xs font-medium">自动</strong>
            </div>
            <div className="grid min-w-0 gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))]/60 bg-[hsl(var(--surface-muted))]/60 p-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--foreground-faint))]">
                Skill
              </span>
              <strong className="text-xs font-medium">自动</strong>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.75fr)]">
            <div className="grid content-start gap-1.5">
              {!promptContext?.items.length ? (
                <p className="m-0 text-xs text-[hsl(var(--foreground-muted))]">
                  当前 Project、Agent、Task 没有生效的绑定。
                </p>
              ) : (
                promptContext.items.map((item) => (
                  <div
                    key={item.bindingId}
                    className="grid gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))]/60 bg-[hsl(var(--surface-muted))]/50 p-2"
                  >
                    <span className="text-[11px] font-semibold text-[hsl(var(--primary))]">
                      {labelPromptBindingSlot(item.slot)}
                    </span>
                    <code className="truncate font-mono text-xs">
                      {item.promptKey}@{item.label ?? `v${item.version}`}
                    </code>
                    <small className="text-[11px] text-[hsl(var(--foreground-faint))]">
                      {labelPromptBindingTarget(item.targetType)}，v{item.version}，hash{' '}
                      {item.contentHash.slice(0, 10)}
                    </small>
                  </div>
                ))
              )}
            </div>
            <details className="rounded-[var(--radius)] border border-[hsl(var(--border))]/60 bg-[hsl(var(--surface-muted))]/40 p-2 text-xs">
              <summary className="cursor-pointer font-semibold text-[hsl(var(--foreground-subtle))]">
                高级变量
              </summary>
              <label>
                <span className="mt-2 block text-[11px] text-[hsl(var(--foreground-muted))]">
                  变量 JSON
                </span>
                <textarea
                  className={cn(
                    'mt-1 min-h-24 w-full resize-y rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-2 font-mono text-[11px] leading-relaxed outline-none focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary))]/15',
                  )}
                  value={variablesDraft}
                  onChange={(event) => onVariablesDraftChange(event.target.value)}
                  rows={4}
                  aria-label="变量 JSON"
                />
                <Button size="xs" variant="outline" onClick={onApplyVariables}>
                  应用并重新解析
                </Button>
                {variablesError ? (
                  <small
                    className="mt-1 block text-[11px] text-[hsl(var(--destructive))]"
                    role="alert"
                  >
                    {variablesError}
                  </small>
                ) : null}
                {promptContext?.ready === false && !variablesError ? (
                  <small className="mt-1 block text-[11px] text-[hsl(var(--warning-fg))]">
                    缺少：{promptContext.missingVariables.join('、')}
                  </small>
                ) : null}
              </label>
            </details>
          </div>
        </>
      )}
    </div>
  );
}
