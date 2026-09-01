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
import { useEffect, useMemo, useState } from 'react';
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
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchParams, setSearchParams] = useSearchParams();
  const newOpen = searchParams.get('new') === '1';
  const [title, setTitle] = useState('新 Session');
  const [agentId, setAgentId] = useState('');
  useEffect(() => {
    if (!agentId && agents.data?.find((agent) => agent.status === 'READY'))
      setAgentId(agents.data.find((agent) => agent.status === 'READY')?.id ?? '');
  }, [agentId, agents.data]);
  const create = useMutation({
    mutationFn: () =>
      api.post<SessionRecord>('/sessions', {
        projectId: project.id,
        agentId,
        title: title.trim(),
        cwd: project.rootPath,
      }),
    onSuccess: (session) => {
      void client.invalidateQueries({ queryKey: ['sessions', project.id] });
      navigate(`/workspace/${session.id}`);
    },
  });
  const setNewOpen = (open: boolean) => {
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
                {displayDate(session.lastActiveAt)}
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
            <span className={projectsStyles.toolbarSpacer} />
            <span className={projectsStyles.toolbarCount}>{filteredSessions.length} 个会话</span>
            <AhButton size="sm" leftSection={<Plus size={15} />} onClick={() => setNewOpen(true)}>
              新建会话
            </AhButton>
          </div>
          {filteredSessions.length ? (
            <AhSurface className={projectsStyles.sessionLibrary}>
              {groupLabels.map(renderSessionGroup)}
            </AhSurface>
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
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <AhSelect
          label="Agent"
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
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!agentId || !title.trim()}
          >
            创建并进入 Workspace
          </AhButton>
        </div>
        {create.error ? <AhErrorState description={create.error.message} /> : null}
      </AhDialog>
    </div>
  );
}
