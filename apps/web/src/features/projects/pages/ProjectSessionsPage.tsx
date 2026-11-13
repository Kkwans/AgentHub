/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  AhButton,
  AhDialog,
  AhEmptyState,
  AhErrorState,
  AhInput,
  AhLoadingState,
  AhMetric,
  AhReveal,
  AhSelect,
  AhStatusPill,
  AhSurface,
  AhSwitch,
  AhTextarea,
  AlertTriangle,
  ArrowRight,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Copy,
  Eye,
  FolderKanban,
  GitBranch,
  Link2,
  Network,
  Play,
  Plus,
  RefreshCw,
  Search,
  ScanSearch,
  Server,
  SquareTerminal,
  Tag,
  Wrench,
  useAgentHubTheme,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Link,
  NavLink,
  Outlet,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import type {
  AgentCandidateRecord,
  AgentRecord,
  ApiTokenRecord,
  ApprovalRecord,
  DashboardSnapshot,
  EventRecord,
  ExecutionTargetRecord,
  GoalRecord,
  MessageRecord,
  PromptBindingRecord,
  PromptLabelRecord,
  PromptRecord,
  PromptVersionRecord,
  ProjectRecord,
  ResolvedPromptContextRecord,
  RemoteNodeDiagnostics,
  RemoteNodeRecord,
  RemoteNodeRegistration,
  RuntimeCandidateRecord,
  RunRecord,
  SessionConfigurationRecord,
  SessionRecord,
  TaskRecord,
  WorktreeExecutionRecord,
} from '../../../lib/api';
import { api } from '../../../lib/api';
import { realtime } from '../../../lib/realtime';
import {
  labelPromptBindingTarget,
  labelPromptKind,
  labelPromptSelector,
  labelPromptType,
  labelPromptVersionSource,
} from '../../../presentation/domain-labels';
import layout from '../../shared/layout.module.css';
import {
  Screen,
  QueryMessage,
  displayDate,
  useCompactViewport,
  projectLanguage,
  projectTimestamp,
  domainStatusLabel,
  taskStateClass,
  sessionGroupKey,
} from '../../shared/page-primitives';
import projectsStyles from '../projects.module.css';
import { useProjectContext } from './ProjectContextLayout';
import { filterProjectSessions } from './project-session-utils';
import { useSessionCreation } from '../hooks/useSessionCreation';

export function ProjectSessionsPage() {
  const project = useProjectContext();
  const client = useQueryClient();
  const navigate = useNavigate();
  const sessions = useQuery({
    queryKey: ['sessions', project.id],
    queryFn: () => api.get<SessionRecord[]>(`/sessions?projectId=${project.id}`),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const compact = useCompactViewport();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterOptionsId = useId();
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const filterOptionsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (compact && !filtersOpen && filterOptionsRef.current?.contains(document.activeElement)) {
      filterToggleRef.current?.focus();
    }
  }, [compact, filtersOpen]);
  const clearFilters = () => {
    setQuery('');
    setAgentFilter('all');
    setStatusFilter('all');
    filterToggleRef.current?.focus();
  };
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const activeFilterCount = [query.trim(), agentFilter !== 'all', statusFilter !== 'all'].filter(
    Boolean,
  ).length;
  const [searchParams, setSearchParams] = useSearchParams();
  const newOpen = searchParams.get('new') === '1';
  const creation = useSessionCreation(project, newOpen, agents.data);
  const { title, setTitle, agentId, setAgentId } = creation;
  const setNewOpen = (open: boolean) => {
    if (!open) creation.abandon();
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (open) next.set('new', '1');
      else next.delete('new');
      return next;
    });
  };
  const filteredSessions = useMemo(() => {
    return filterProjectSessions(sessions.data ?? [], {
      query,
      agentId: agentFilter,
      status: statusFilter,
    });
  }, [agentFilter, query, sessions.data, statusFilter]);
  const sessionStatuses = useMemo(
    () => Array.from(new Set((sessions.data ?? []).map((session) => session.status))),
    [sessions.data],
  );
  const groupedSessions = useMemo(() => {
    const groups: Record<'today' | 'yesterday' | 'earlier', SessionRecord[]> = {
      today: [],
      yesterday: [],
      earlier: [],
    };
    filteredSessions.forEach((session) =>
      groups[sessionGroupKey(session.lastActiveAt)].push(session),
    );
    return groups;
  }, [filteredSessions]);
  const groupLabels: Array<{ key: 'today' | 'yesterday' | 'earlier'; label: string }> = [
    { key: 'today', label: '今天' },
    { key: 'yesterday', label: '昨天' },
    { key: 'earlier', label: '更早' },
  ];
  const renderSessionGroup = (group: { key: 'today' | 'yesterday' | 'earlier'; label: string }) => {
    const rows = groupedSessions[group.key];
    if (!rows.length) return null;
    return (
      <div className={projectsStyles.sessionGroup} key={group.key}>
        <div className={projectsStyles.sessionGroupTitle}>
          <span>{group.label}</span>
          <small>{rows.length}</small>
        </div>
        {rows.map((session) => {
          const agent = agents.data?.find((item) => item.id === session.agentId);
          const context = [agent?.name, session.model, session.branch, session.cwd]
            .filter(Boolean)
            .join(' · ');
          return (
            <Link
              className={projectsStyles.sessionRow}
              key={session.id}
              to={`/workspace/${session.id}`}
            >
              <span className={projectsStyles.sessionAgent} aria-hidden="true">
                {agent?.name?.slice(0, 1).toUpperCase() ?? 'A'}
              </span>
              <span className={projectsStyles.rowMain}>
                <strong className={projectsStyles.sessionTitle}>{session.title}</strong>
                <span className={projectsStyles.sessionDescription}>
                  {context || '暂无上下文说明'}
                </span>
              </span>
              <AhStatusPill status={session.status} />
              <span className={projectsStyles.sessionUpdated}>
                {session.lastActiveAt && !Number.isNaN(Date.parse(session.lastActiveAt)) ? (
                  <time dateTime={session.lastActiveAt}>
                    最近活动 {displayDate(session.lastActiveAt)}
                  </time>
                ) : (
                  '暂无活动时间'
                )}
              </span>
              <ArrowRight className={projectsStyles.sessionArrow} size={14} />
            </Link>
          );
        })}
      </div>
    );
  };
  return (
    <div className={projectsStyles.sessionsPage}>
      <QueryMessage
        loading={sessions.isLoading || agents.isLoading}
        error={sessions.error ?? agents.error}
        retry={() => {
          void sessions.refetch();
          void agents.refetch();
        }}
        label="正在加载 Sessions"
      />
      {!sessions.isLoading && !sessions.error ? (
        <>
          <div className={projectsStyles.sessionsToolbar} aria-label="会话筛选">
            <div className={projectsStyles.toolbarSearch}>
              <AhInput
                label=""
                aria-label="搜索会话"
                placeholder="搜索会话…"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                leftSection={<Search size={15} />}
              />
            </div>
            {compact ? (
              <button
                type="button"
                ref={filterToggleRef}
                className={projectsStyles.toolbarMore}
                aria-expanded={filtersOpen}
                aria-controls={filterOptionsId}
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <ScanSearch size={14} aria-hidden="true" />
                筛选{activeFilterCount ? `（${activeFilterCount}）` : ''}
              </button>
            ) : null}
            {compact && activeFilterCount ? (
              <button type="button" className={projectsStyles.toolbarMore} onClick={clearFilters}>
                清除条件
              </button>
            ) : null}
            <div
              id={filterOptionsId}
              ref={filterOptionsRef}
              className={projectsStyles.sessionFilterOptions}
              hidden={compact && !filtersOpen}
            >
              <div className={projectsStyles.toolbarSelect}>
                <AhSelect
                  aria-label="会话 Agent"
                  label=""
                  value={agentFilter}
                  onChange={(value) => setAgentFilter(value ?? 'all')}
                  data={[
                    { value: 'all', label: '全部 Agent' },
                    ...(agents.data ?? []).map((agent) => ({ value: agent.id, label: agent.name })),
                  ]}
                />
              </div>
              <div className={projectsStyles.toolbarSelect}>
                <AhSelect
                  aria-label="会话状态"
                  label=""
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value ?? 'all')}
                  data={[
                    { value: 'all', label: '全部状态' },
                    ...sessionStatuses.map((value) => ({ value, label: domainStatusLabel(value) })),
                  ]}
                />
              </div>
            </div>
            <span className={projectsStyles.toolbarSpacer} />
            <span className={projectsStyles.toolbarCount}>{filteredSessions.length} 个会话</span>
            <AhButton size="sm" leftSection={<Plus size={15} />} onClick={() => setNewOpen(true)}>
              新建会话
            </AhButton>
          </div>
          {filteredSessions.length ? (
            <section className={projectsStyles.sessionLibrary} aria-label="项目会话">
              {groupLabels.map(renderSessionGroup)}
            </section>
          ) : (
            <AhSurface className={projectsStyles.emptyPanel}>
              <AhEmptyState
                title={
                  query || agentFilter !== 'all' || statusFilter !== 'all'
                    ? '没有匹配的会话'
                    : '还没有 Session'
                }
                description={
                  query || agentFilter !== 'all' || statusFilter !== 'all'
                    ? '尝试调整筛选条件。'
                    : '从 New Work 创建第一项工作，再选择 Agent 运行。'
                }
                action={
                  !query && agentFilter === 'all' && statusFilter === 'all' ? (
                    <AhButton onClick={() => setNewOpen(true)}>创建会话</AhButton>
                  ) : undefined
                }
              />
            </AhSurface>
          )}
        </>
      ) : null}
      <AhDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="新建会话"
        description="使用当前 Project 作为工作目录。"
      >
        <AhInput
          label="会话名称"
          disabled={!creation.ready || Boolean(creation.operation)}
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <AhSelect
          label="Agent"
          disabled={!creation.ready || Boolean(creation.operation)}
          value={agentId}
          onChange={(value) => setAgentId(value ?? '')}
          data={(agents.data ?? [])
            .filter((agent) => agent.status === 'READY')
            .map((agent) => ({ value: agent.id, label: agent.name }))}
          placeholder="选择 Agent"
          mt="md"
        />
        <div className={layout.actions} style={{ marginTop: 20 }}>
          <AhButton
            onClick={() => void creation.create()}
            loading={creation.operation?.phase === 'pending'}
            disabled={!creation.ready || Boolean(creation.operation) || !agentId || !title.trim()}
          >
            创建并进入 Workspace
          </AhButton>
        </div>
        {creation.operation ? (
          <div role="status">
            <p>本次请求 Agent ID：{creation.operation.agentId}</p>
            {creation.operation.failure ? <p>原请求说明：{creation.operation.failure}</p> : null}
            <p>
              {creation.operation.phase === 'saved'
                ? '会话已创建。打开已创建的会话，或明确选择创建另一会话。'
                : creation.operation.phase === 'pending'
                  ? '创建请求已发出，正在等待确认。'
                  : '创建结果尚未确认，可能已创建会话。请先核对原项目会话，不要直接重复创建。'}
            </p>
            <p>
              关闭窗口不会撤回已发出的请求。会话列表暂时没有结果，也不能证明旧请求不会完成。离开此页面或刷新后无法保留此核对状态。会话列表只确认记录，不代表
              Agent 进程或资源已清理。
            </p>
            {creation.operation.phase === 'saved' && creation.operation.session ? (
              <>
                <Link to={`/workspace/${creation.operation.session.id}`}>
                  打开已创建的会话：{creation.operation.title}
                </Link>
                <AhButton variant="subtle" onClick={creation.createAnother}>
                  创建另一会话
                </AhButton>
              </>
            ) : (
              <AhButton
                variant="subtle"
                loading={creation.checking}
                onClick={() => void creation.check()}
              >
                读取原项目会话
              </AhButton>
            )}
            {creation.operation.phase !== 'saved' && creation.operation.checked ? (
              <>
                <p>
                  已读取 {creation.operation.checked.length} 个会话，请核对名称及
                  Agent；不要重复创建已有会话。
                </p>
                <ul>
                  {creation.operation.checked.map((session) => (
                    <li key={session.id}>
                      <Link to={`/workspace/${session.id}`}>{session.title}</Link> · Agent{' '}
                      {session.agentId}
                    </li>
                  ))}
                </ul>
                <AhButton
                  variant="subtle"
                  disabled={creation.operation.phase === 'pending' || creation.checking}
                  onClick={creation.resume}
                >
                  已核对，重新编辑
                </AhButton>
              </>
            ) : null}
          </div>
        ) : null}
        {creation.error ? <AhErrorState description={creation.error} /> : null}
      </AhDialog>
    </div>
  );
}
