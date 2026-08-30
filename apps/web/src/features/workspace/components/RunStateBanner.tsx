import { Link } from 'react-router-dom';
import {
  resolveWorkspaceRunState,
  WORKSPACE_RUN_STATE_COPY,
} from '../../../presentation/domain-labels';

export function RunStateBanner({
  sessionStatus,
  activeRunStatus,
  latestRunStatus,
}: {
  sessionStatus: string | null | undefined;
  activeRunStatus?: string | null | undefined;
  latestRunStatus?: string | null | undefined;
}) {
  const state = resolveWorkspaceRunState(sessionStatus, activeRunStatus, latestRunStatus);
  const copy = WORKSPACE_RUN_STATE_COPY[state];
  const showLink = state === 'DISCONNECTED' || state === 'CLOSED';
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
      {showLink && (
        <Link className="run-state-link" to="/sessions">
          返回 Session 列表
        </Link>
      )}
    </section>
  );
}
