interface ListRepository<T> {
  list(): Promise<T[]>;
}

interface RecentRunRepository<T> {
  listRecent(limit?: number): Promise<T[]>;
}

interface AttentionApprovalRepository<T> {
  listAttention(): Promise<T[]>;
}

interface SessionSummary {
  id: string;
  status: string;
}

interface TaskSummary {
  id: string;
  status: string;
}

interface RunSummary {
  id: string;
  status: string;
  gitBeforeSha: string | null;
  gitAfterSha: string | null;
}

interface AgentSummary {
  id: string;
  status: string;
}

export interface DashboardSnapshotProvider {
  snapshot(): Promise<unknown>;
}

export class DashboardService<
  TSession extends SessionSummary,
  TTask extends TaskSummary,
  TRun extends RunSummary,
  TApproval,
  TAgent extends AgentSummary,
> implements DashboardSnapshotProvider {
  constructor(
    private readonly sessions: ListRepository<TSession>,
    private readonly tasks: ListRepository<TTask>,
    private readonly runs: RecentRunRepository<TRun>,
    private readonly approvals: AttentionApprovalRepository<TApproval>,
    private readonly agents: ListRepository<TAgent>,
  ) {}

  async snapshot() {
    const [sessions, tasks, recentRuns, pendingApprovals, agents] = await Promise.all([
      this.sessions.list(),
      this.tasks.list(),
      this.runs.listRecent(12),
      this.approvals.listAttention(),
      this.agents.list(),
    ]);
    return {
      runningSessions: sessions.filter((item) =>
        ['STARTING', 'RUNNING', 'WAITING_APPROVAL'].includes(item.status),
      ),
      attentionTasks: tasks.filter((item) => ['WAITING_REVIEW', 'BLOCKED'].includes(item.status)),
      pendingApprovals,
      recentResults: recentRuns
        .filter((item) => ['COMPLETED', 'FAILED', 'CANCELED', 'DISCONNECTED'].includes(item.status))
        .map((run) => ({
          ...run,
          gitOutcome:
            run.gitBeforeSha && run.gitAfterSha
              ? run.gitBeforeSha === run.gitAfterSha
                ? ('UNCHANGED' as const)
                : ('CHANGED' as const)
              : ('UNAVAILABLE' as const),
        })),
      agentHealth: agents,
    };
  }
}
