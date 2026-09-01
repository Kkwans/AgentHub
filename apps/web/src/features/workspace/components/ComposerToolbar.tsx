import { Plus, ShieldCheck } from '@agenthub/ui';

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
}) {
  return (
    <div className="composer-context" aria-label="发送配置">
      <button
        type="button"
        className={`composer-context-action${contextOpen ? ' active' : ''}`}
        onClick={onToggleContext}
        aria-expanded={contextOpen}
        aria-label={`PromptOS ${contextStatus.label}`}
      >
        <Plus size={15} />
        <span>上下文</span>
        <small>{contextStatus.label}</small>
      </button>
      <span className="composer-permission">
        <ShieldCheck size={15} />
        <strong>按需审批</strong>
      </span>
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
    </div>
  );
}
