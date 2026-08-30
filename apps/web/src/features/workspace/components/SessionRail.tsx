import { Plus, Search } from '@agenthub/ui';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadingState, ErrorState } from '../../../components/Common';
import type { SessionRecord } from '../../../lib/api';
import { resolveWorkspaceRunState } from '../../../presentation/domain-labels';
import type { QueryState } from '../workspace-types';
import { sessionGroupKey } from '../../shared/page-primitives';

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
      return (
        (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime)
      );
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
  const sessionLink = (session: SessionRecord) => (
    <Link
      className={session.id === currentId ? 'current' : ''}
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
          {session.continuedFromSessionId ? ' · 继续' : ''}
        </code>
      </div>
    </Link>
  );
  return (
    <div className="session-rail">
      <div className="panel-title">
        <span>Session</span>
        <small>{sessions.data?.length ?? 0} 个</small>
      </div>
      <div className="session-rail-toolbar">
        <label className="session-rail-search">
          <Search size={14} aria-hidden="true" />
          <input
            aria-label="搜索 Session"
            placeholder="搜索 Session…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <Link
          className="session-rail-new"
          to={projectId ? `/projects/${projectId}/sessions?new=1` : '/projects'}
          aria-label="新建 Session"
          onClick={onSelect}
        >
          <Plus size={14} aria-hidden="true" />
          <span>新建</span>
        </Link>
      </div>
      <div className="session-list">
        {sessions.isLoading ? (
          <LoadingState label="正在读取 Session" />
        ) : sessions.error ? (
          <ErrorState error={sessions.error} retry={() => sessions.refetch()} />
        ) : (
          filteredSessions.length ? (
            (Object.keys(grouped) as Array<keyof typeof grouped>).map((group) =>
              grouped[group].length ? (
                <section className="session-group" key={group} aria-label={groupLabels[group]}>
                  <h3>{groupLabels[group]}</h3>
                  {grouped[group].map(sessionLink)}
                </section>
              ) : null,
            )
          ) : (
            <p className="session-list-empty">
              {query.trim() ? '没有匹配的 Session' : '还没有 Session'}
            </p>
          )
        )}
      </div>
    </div>
  );
}
