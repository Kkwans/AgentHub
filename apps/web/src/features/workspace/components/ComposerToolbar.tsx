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
    <div className="composer-context" aria-label="发送配置">
      <div className="composer-context-tools">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={`composer-context-action${contextOpen ? ' active' : ''}`}
          onClick={onToggleContext}
          aria-expanded={contextOpen}
          aria-label={`PromptOS ${contextStatus.label}`}
        >
          <Plus size={15} />
          <span>上下文</span>
          <small>{contextStatus.label}</small>
        </Button>
        <span className="composer-permission">
          <ShieldCheck size={15} />
          <strong>按需审批</strong>
        </span>
        <span className="composer-run-state" data-running={activeRun || undefined}>
          <span className="composer-run-state-dot" aria-hidden="true" />
          {activeRun ? '运行中' : '就绪'}
        </span>
      </div>
      <div className="composer-context-actions">
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
        <div className="composer-keyboard-hints" aria-label="快捷键提示">
          <kbd>⌘↵</kbd>
          <span>发送</span>
        </div>
        <div className="composer-send-slot">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={`composer-send-button composer-send-button-stop${activeRun ? ' is-visible' : ''}`}
            onClick={onStop}
            disabled={!activeRun || stopPending}
            aria-label={stopPending ? '正在停止 Run' : '停止 Run'}
            aria-hidden={!activeRun}
            tabIndex={activeRun ? 0 : -1}
          >
            {stopPending ? <LoaderCircle size={16} /> : <CircleStop size={17} />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={`composer-send-button composer-send-button-send${!activeRun ? ' is-visible' : ''}`}
            onClick={onSend}
            disabled={activeRun || sendingBlocked || sendPending}
            aria-label={sendPending ? '正在发送消息' : '发送'}
            aria-busy={sendPending}
            aria-hidden={activeRun}
            tabIndex={activeRun ? -1 : 0}
          >
            {sendPending ? <LoaderCircle size={16} /> : <Send size={17} />}
          </Button>
        </div>
      </div>
    </div>
  );
}
