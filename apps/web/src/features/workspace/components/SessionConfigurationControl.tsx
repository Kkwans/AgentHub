import { Button, ChevronDown, Select, cn } from '@agenthub/ui';
import { useState } from 'react';

import { labelReasoningEffort, labelSessionMode } from '../../../presentation/domain-labels';
import type { SessionConfigurationRecord } from '../../../lib/api';

type ConfigurationPatch = {
  model?: string;
  mode?: string;
  reasoningEffort?: string;
};

export function SessionConfigurationControl({
  configuration,
  loading,
  model,
  mode,
  reasoningEffort,
  updatingModel,
  updatingMode,
  updatingReasoningEffort,
  onChange,
}: {
  configuration: SessionConfigurationRecord | undefined;
  loading: boolean;
  model: string;
  mode: string;
  reasoningEffort: string;
  updatingModel: boolean;
  updatingMode: boolean;
  updatingReasoningEffort: boolean;
  onChange: (patch: ConfigurationPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const modelOptions = configuration?.options?.models ?? [];
  const modeOptions = configuration?.options?.modes ?? [];
  const reasoningEffortOptions = configuration?.options?.reasoningEfforts ?? [];
  const summary = [
    model || '默认模型',
    mode ? labelSessionMode(mode) : '默认模式',
    reasoningEffort ? labelReasoningEffort(reasoningEffort) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="relative min-w-0 max-w-[min(300px,42vw)]">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn(
          'min-h-8 max-w-full gap-1.5 rounded-[var(--radius)] px-2 text-xs text-[hsl(var(--foreground-subtle))] transition-[background-color,color] duration-[var(--motion-fast)] hover:bg-[hsl(var(--surface-hover))] hover:text-[hsl(var(--foreground))]',
          open && 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]',
        )}
        aria-expanded={open}
        aria-label={loading ? 'Session 配置读取中' : 'Session 配置'}
        onClick={() => setOpen((value) => !value)}
      >
        <span>配置</span>
        <strong className="min-w-0 max-w-48 truncate font-medium">
          {loading ? '读取中…' : summary}
        </strong>
        <ChevronDown size={11} aria-hidden="true" />
      </Button>
      {open && (
        <div
          className="absolute bottom-[calc(100%+0.5rem)] right-0 z-30 grid w-[min(320px,calc(100vw-32px))] gap-2.5 rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] p-3 text-[hsl(var(--foreground))] shadow-[var(--shadow-lg)] animate-[hci-fade-in_140ms_ease-out_both] motion-reduce:animate-none"
          role="dialog"
          aria-label="Session 配置"
        >
          <div className="flex items-baseline justify-between gap-2 border-b border-[hsl(var(--border))]/60 pb-1.5">
            <strong className="text-xs">Session 配置</strong>
            <span className="text-[11px] text-[hsl(var(--foreground-faint))]">仅影响后续 Run</span>
          </div>
          {configuration?.supported && modelOptions.length ? (
            <CompactChoiceSelect
              label="模型"
              value={model}
              options={modelOptions.map((option) => ({ value: option.id, label: option.label }))}
              disabled={updatingModel}
              onValueChange={(value) => onChange({ model: value })}
            />
          ) : (
            <div className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-xs text-[hsl(var(--foreground-muted))]">
              <span>模型</span>
              <strong className="truncate font-medium text-[hsl(var(--foreground))]">
                {model || 'Agent 默认'}
              </strong>
            </div>
          )}
          {configuration?.supported && modeOptions.length ? (
            <CompactChoiceSelect
              label="运行模式"
              value={mode}
              options={modeOptions.map((option) => ({
                value: option.id,
                label: labelSessionMode(option.id, option.label),
              }))}
              disabled={updatingMode}
              onValueChange={(value) => onChange({ mode: value })}
            />
          ) : (
            <div className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-xs text-[hsl(var(--foreground-muted))]">
              <span>运行模式</span>
              <strong className="truncate font-medium text-[hsl(var(--foreground))]">
                {mode ? labelSessionMode(mode) : 'Agent 默认'}
              </strong>
            </div>
          )}
          {configuration?.supported && reasoningEffortOptions.length ? (
            <CompactChoiceSelect
              label="推理强度"
              value={reasoningEffort}
              options={reasoningEffortOptions.map((option) => ({
                value: option.id,
                label: labelReasoningEffort(option.id, option.label),
              }))}
              disabled={updatingReasoningEffort}
              onValueChange={(value) => onChange({ reasoningEffort: value })}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function CompactChoiceSelect({
  label,
  value,
  options,
  disabled,
  onValueChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <label className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-xs text-[hsl(var(--foreground-muted))]">
      <span>{label}</span>
      <Select
        value={value}
        options={options}
        disabled={disabled}
        ariaLabel={label}
        className="input-base min-h-8 min-w-0 w-full truncate px-2 py-1 text-xs"
        onValueChange={onValueChange}
      />
    </label>
  );
}
