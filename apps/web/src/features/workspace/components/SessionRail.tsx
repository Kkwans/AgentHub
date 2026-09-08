import { ChevronDown, Plus, Search } from '@agenthub/ui';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadingState, ErrorState } from '../../../components/Feedback';
import type { SessionRecord } from '../../../lib/api';
import { resolveWorkspaceRunState } from '../../../presentation/domain-labels';
import type { QueryState } from '../workspace-types';
import { sessionGroupKey } from '../../shared/page-primitives';
import sessionRailStyles from '../sessionRail.module.css';

export const SESSION_VIRTUALIZATION_THRESHOLD = 120;
export const SESSION_WINDOW_SIZE = 80;
export const SESSION_WINDOW_STEP = 80;

export type SessionWindow<T> = {
  items: T[];
  hiddenCount: number;
  hasEarlier: boolean;
};

/**
 * Keep the session rail bounded for long-lived workspaces while preserving
 * the current session in the first rendered window.
 */
export function getSessionWindow<T extends { id: string }>(
  items: T[],
  visibleCount: number,
  anchorId?: string,
): SessionWindow<T> {
  if (items.length <= SESSION_VIRTUALIZATION_THRESHOLD || visibleCount >= items.length) {
    return { items, hiddenCount: 0, hasEarlier: false };
  }
  const size = Math.max(1, visibleCount);
  const anchorIndex = anchorId ? items.findIndex((item) => item.id === anchorId) : -1;
  const start =
    anchorIndex >= size ? Math.min(anchorIndex - Math.floor(size / 2), items.length - size) : 0;
  const end = Math.min(items.length, start + size);
  return {
    items: items.slice(start, end),
    hiddenCount: items.length - end,
    hasEarlier: end < items.length,
  };
}

export function SessionRail({
  sessions,
  currentId,
  onSelect,
  projectId,
}: {
  sessions: QueryState<SessionRecord[]>;
  currentId: string;
  onSelect?: () => void;
  projectId?: string | undefined;
}) {
  const [query, setQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<SessionGroup, boolean>>({
    today: false,
    yesterday: false,
    // A long-lived workspace can contain dozens of closed sessions. Keep the
    // historical tail quiet until the user asks for it; search always opens it.
    earlier: true,
  });
  const [visibleSessionCount, setVisibleSessionCount] = useState(SESSION_WINDOW_SIZE);
  const filteredSessions = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    const result = value
      ? (sessions.data ?? []).filter((session) =>
          `${session.title} ${session.model ?? ''} ${session.mode ?? ''} ${session.branch ?? ''} ${session.cwd}`
            .toLocaleLowerCase()
            .includes(value),
        )
      : [...(sessions.data ?? [])];
    return result.sort((left, right) => {
      const rightTime = Date.parse(right.lastActiveAt);
      const leftTime = Date.parse(left.lastActiveAt);
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    });
  }, [query, sessions.data]);
  const grouped = {
    today: filteredSessions.filter((session) => sessionGroupKey(session.lastActiveAt) === 'today'),
    yesterday: filteredSessions.filter(
      (session) => sessionGroupKey(session.lastActiveAt) === 'yesterday',
    ),
    earlier: filteredSessions.filter(
      (session) => sessionGroupKey(session.lastActiveAt) === 'earlier',
    ),
  };
  const groupLabels = { today: '今天', yesterday: '昨天', earlier: '更早' } as const;
  const groupOrder = ['today', 'yesterday', 'earlier'] as const;
  const toggleGroup = (group: SessionGroup) =>
    setCollapsedGroups((current) => ({ ...current, [group]: !current[group] }));
  useEffect(() => {
    setVisibleSessionCount(SESSION_WINDOW_SIZE);
  }, [query]);
  const sessionLink = (session: SessionRecord) => (
    <Link
      className={`group/session flex min-h-14 min-w-0 items-center gap-2 rounded-[var(--radius)] border border-transparent px-2.5 py-2 text-[hsl(var(--foreground-muted))] transition-[background-color,border-color,color] duration-[var(--motion-fast)] hover:bg-[hsl(var(--surface-hover))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/45 ${session.id === currentId ? 'current bg-[hsl(var(--primary-soft))] text-[hsl(var(--foreground))]' : ''}`}
      to={`/workspace/${session.id}`}
      key={session.id}
      onClick={onSelect}
    >
      <span
        className={`session-state-dot session-state-${resolveWorkspaceRunState(session.status).toLowerCase()}`}
        aria-hidden="true"
      />
      <div>
        <strong>{session.title}</strong>
        <code>
          {session.branch || '无 Git'} · {session.cwd.split('/').at(-1)}
          {session.continuedFromSessionId ? '（续接）' : ''}
        </code>
      </div>
    </Link>
  );
  return (
    <div
      className={`${sessionRailStyles.owner} session-rail flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[hsl(var(--surface))]`}
      style={{ width: '100%', minWidth: 0, flex: '1 1 auto' }}
    >
      <div className="panel-title flex min-h-12 items-center justify-between gap-2 border-b border-[hsl(var(--border))]/70 px-4">
        <span>AgentHub</span>
        <small>{sessions.data?.length ?? 0} 个会话</small>
      </div>
      <div className="session-rail-toolbar">
        <label className="session-rail-search flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius)] border border-[hsl(var(--border))]/70 bg-[hsl(var(--surface-muted))]/55 px-2.5">
          <Search size={14} aria-hidden="true" />
          <input
            aria-label="搜索会话"
            placeholder="搜索会话…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <Link
          className="session-rail-new inline-flex min-h-9 items-center gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 text-[12px] font-semibold text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--surface-hover))]"
          to={projectId ? `/projects/${projectId}/sessions?new=1` : '/projects'}
          aria-label="新建会话"
          onClick={onSelect}
        >
          <Plus size={14} aria-hidden="true" />
          <span>新建</span>
        </Link>
      </div>
      <div className="session-list flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 pb-5 pt-1">
        {sessions.isLoading ? (
          <LoadingState label="正在读取会话" />
        ) : sessions.error ? (
          <ErrorState error={sessions.error} retry={() => sessions.refetch()} />
        ) : filteredSessions.length ? (
          groupOrder.map((group) => {
            if (!grouped[group].length) return null;
            const containsCurrent = grouped[group].some((session) => session.id === currentId);
            const collapsed = query.trim() ? false : collapsedGroups[group] && !containsCurrent;
            const groupId = `session-group-${group}`;
            const window = getSessionWindow(grouped[group], visibleSessionCount, currentId);
            return (
              <section className="session-group" key={group} aria-label={groupLabels[group]}>
                <button
                  type="button"
                  className="session-group-toggle grid min-h-8 grid-cols-[minmax(0,1fr)_auto_14px] items-center gap-1.5 rounded-md px-1 text-left text-[12px] font-semibold text-[hsl(var(--foreground-faint))] transition-colors hover:bg-[hsl(var(--surface-hover))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/45"
                  aria-expanded={!collapsed}
                  aria-controls={groupId}
                  onClick={() => toggleGroup(group)}
                >
                  <span>{groupLabels[group]}</span>
                  <small>{grouped[group].length}</small>
                  <ChevronDown
                    size={13}
                    aria-hidden="true"
                    className={collapsed ? 'collapsed' : undefined}
                  />
                </button>
                {!collapsed && (
                  <>
                    {window.hasEarlier ? (
                      <button
                        type="button"
                        className="session-list-load-more"
                        onClick={() =>
                          setVisibleSessionCount((count) => count + SESSION_WINDOW_STEP)
                        }
                      >
                        {`加载更早会话（还有 ${window.hiddenCount} 个）`}
                      </button>
                    ) : null}
                    <div id={groupId} className="session-group-items">
                      {window.items.map(sessionLink)}
                    </div>
                  </>
                )}
              </section>
            );
          })
        ) : (
          <p className="session-list-empty">{query.trim() ? '没有匹配的会话' : '还没有会话'}</p>
        )}
      </div>
    </div>
  );
}

type SessionGroup = 'today' | 'yesterday' | 'earlier';
