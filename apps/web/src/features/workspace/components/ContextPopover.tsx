import { AhButton, GitBranch } from '@agenthub/ui';

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
    <div className="composer-context-preview" role="dialog" aria-label="PromptOS 上下文预览">
      <div className="context-preview-heading">
        <div>
          <strong>PromptOS 上下文预览</strong>
          <span>发送 Run 前解析，版本、标签与 content hash 会写入来源记录。</span>
        </div>
        <span className={contextStatus.kind}>{contextStatus.label}</span>
      </div>
      {promptContextLoading ? (
        <LoadingState label="正在解析 PromptOS 上下文" />
      ) : promptContextError ? (
        <div className="prompt-context-error">
          <ErrorState error={promptContextError} />
          <AhButton color="red" size="xs" variant="light" onClick={() => promptContextRetry()}>
            重新解析
          </AhButton>
        </div>
      ) : (
        <>
          <div className="composer-session-facts" aria-label="会话上下文事实">
            <div>
              <span>Project</span>
              <strong>{project?.name ?? '未知'}</strong>
            </div>
            <div className="cwd-chip">
              <span>cwd</span>
              <code>{session.cwd}</code>
            </div>
            <div>
              <span>branch</span>
              <strong>
                <GitBranch size={13} /> {session.branch || '无 Git'}
              </strong>
            </div>
            <div>
              <span>Tools</span>
              <strong>自动</strong>
            </div>
            <div>
              <span>Skill</span>
              <strong>自动</strong>
            </div>
          </div>
          <div className="composer-context-grid">
            <div className="composer-provenance">
              {!promptContext?.items.length ? (
                <p>当前 Project、Agent、Task 没有生效的绑定。</p>
              ) : (
                promptContext.items.map((item) => (
                  <div key={item.bindingId}>
                    <span>{labelPromptBindingSlot(item.slot)}</span>
                    <code>
                      {item.promptKey}@{item.label ?? `v${item.version}`}
                    </code>
                    <small>
                      {labelPromptBindingTarget(item.targetType)}，v{item.version}，hash{' '}
                      {item.contentHash.slice(0, 10)}
                    </small>
                  </div>
                ))
              )}
            </div>
            <details className="composer-advanced-variables">
              <summary>高级变量</summary>
              <label>
                变量 JSON
                <textarea
                  className="mono"
                  value={variablesDraft}
                  onChange={(event) => onVariablesDraftChange(event.target.value)}
                  rows={4}
                  aria-label="变量 JSON"
                />
                <AhButton color="gray" size="xs" variant="light" onClick={onApplyVariables}>
                  应用并重新解析
                </AhButton>
                {variablesError ? (
                  <small className="context-variable-error" role="alert">
                    {variablesError}
                  </small>
                ) : null}
                {promptContext?.ready === false && !variablesError ? (
                  <small className="context-variable-error">
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
