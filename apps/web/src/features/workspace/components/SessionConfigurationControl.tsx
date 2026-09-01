import { ChevronDown } from '@agenthub/ui';
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
    <div className="composer-session-config">
      <button
        type="button"
        className={`composer-session-config-trigger${open ? ' active' : ''}`}
        aria-expanded={open}
        aria-label={loading ? 'Session 配置读取中' : 'Session 配置'}
        onClick={() => setOpen((value) => !value)}
      >
        <span>配置</span>
        <strong>{loading ? '读取中…' : summary}</strong>
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open && (
        <div className="composer-session-config-popover" role="dialog" aria-label="Session 配置">
          <div className="composer-session-config-heading">
            <strong>Session 配置</strong>
            <span>仅影响后续 Run</span>
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
            <div className="composer-session-config-fallback">
              <span>模型</span>
              <strong>{model || 'Agent 默认'}</strong>
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
            <div className="composer-session-config-fallback">
              <span>运行模式</span>
              <strong>{mode ? labelSessionMode(mode) : 'Agent 默认'}</strong>
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
    <label className="composer-config-choice">
      <span>{label}</span>
      <div>
        <select
          aria-label={label}
          title={label}
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={11} aria-hidden="true" />
      </div>
    </label>
  );
}
