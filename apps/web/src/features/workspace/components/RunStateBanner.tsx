import { Link } from 'react-router-dom';
import {
  resolveWorkspaceRunState,
  WORKSPACE_RUN_STATE_COPY,
} from '../../../presentation/domain-labels';

export function RunStateBanner({
  sessionStatus,
  activeRunStatus,
  latestRunStatus,
  continuePending,
  continueError,
  onContinue,
}: {
  sessionStatus: string | null | undefined;
  activeRunStatus?: string | null | undefined;
  latestRunStatus?: string | null | undefined;
  continuePending?: boolean;
  continueError?: Error | null;
  onContinue?: () => void;
}) {
  const state = resolveWorkspaceRunState(sessionStatus, activeRunStatus, latestRunStatus);
  const copy = WORKSPACE_RUN_STATE_COPY[state];
  const showSessionLink = state === 'DISCONNECTED';
  if (state === 'IDLE') return null;
  return (
    <section
      className={`run-state-banner run-state-${state.toLowerCase()}`}
      aria-label={`当前运行状态：${copy.title}`}
      aria-live="polite"
    >
      <span className="run-state-marker" aria-hidden="true" />
      <div>
        <strong>{copy.title}</strong>
        <span>{copy.description}</span>
      </div>
      {state === 'CLOSED' && onContinue ? (
        <div className="run-state-action">
          <button type="button" onClick={onContinue} disabled={continuePending}>
            {continuePending ? '正在准备' : '基于此上下文继续'}
          </button>
          {continueError && <small role="alert">{continueError.message}</small>}
        </div>
      ) : null}
      {showSessionLink && (
        <Link className="run-state-link" to="/sessions">
          返回 Session 列表
        </Link>
      )}
    </section>
  );
}
