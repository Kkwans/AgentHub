import type { SessionRecord } from '../../../lib/api';

export type ProjectSessionFilters = {
  query: string;
  agentId: string;
  status: string;
};

/**
 * Keep the Project Sessions filter deterministic and independently measurable.
 * The page owns the controls; this helper owns the 500-row data transform.
 */
export function filterProjectSessions(
  sessions: SessionRecord[],
  { query, agentId, status }: ProjectSessionFilters,
): SessionRecord[] {
  const value = query.trim().toLowerCase();
  return sessions
    .filter((session) => {
      return (
        (!value ||
          `${session.title} ${session.model ?? ''} ${session.branch ?? ''} ${session.cwd}`
            .toLowerCase()
            .includes(value)) &&
        (agentId === 'all' || session.agentId === agentId) &&
        (status === 'all' || session.status === status)
      );
    })
    .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt));
}
