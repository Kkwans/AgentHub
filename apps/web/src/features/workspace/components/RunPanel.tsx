import { LoadingState, ErrorState, StatusBadge } from '../../../components/Feedback';
import type { AgentRecord, RunRecord, SessionRecord } from '../../../lib/api';
import type { QueryState } from '../workspace-types';

export function RunPanel({
  agent,
  session,
  runs,
}: {
  agent: AgentRecord | undefined;
  session: SessionRecord;
  runs: QueryState<RunRecord[]>;
}) {
  const recentRuns = [...(runs.data ?? [])].reverse();
  return (
    <div className="run-inspector">
      <div className="run-context">
        <span>Agent</span>
        <strong>{agent?.name ?? '当前 Agent'}</strong>
        <span>模型</span>
        <strong>{session.model || 'Agent 默认'}</strong>
        <span>模式</span>
        <strong>{session.mode || 'Agent 默认'}</strong>
        <span>cwd</span>
        <code>{session.cwd}</code>
      </div>
      <div className="run-history">
        {runs.isLoading ? (
          <LoadingState label="正在读取 Run" />
        ) : runs.error ? (
          <ErrorState error={runs.error} retry={() => runs.refetch()} />
        ) : (
          recentRuns.map((run, index) => (
            <div key={run.id}>
              <span className="run-dot" />
              <div>
                <strong>第 {recentRuns.length - index} 次 Run</strong>
                <code>
                  {run.gitBeforeSha?.slice(0, 8) ?? '无记录'} →{' '}
                  {run.gitAfterSha?.slice(0, 8) ?? '无记录'}
                </code>
              </div>
              <StatusBadge status={run.status} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export const RunInspector = RunPanel;
