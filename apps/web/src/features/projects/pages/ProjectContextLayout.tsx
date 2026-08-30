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

export function ProjectContextLayout() {
  const { projectId } = useParams();
  const queryClient = useQueryClient();
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectRecord>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
  });
  const sessions = useQuery({
    queryKey: ['sessions', projectId],
    queryFn: () => api.get<SessionRecord[]>(`/sessions?projectId=${projectId}`),
    enabled: Boolean(projectId),
  });
  const tasks = useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => api.get<TaskRecord[]>(`/tasks?projectId=${projectId}`),
    enabled: Boolean(projectId),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const [kind, setKind] = useState<'STANDARD' | 'TEST'>('STANDARD');
  useEffect(() => {
    if (project.data) setKind(project.data.kind ?? 'STANDARD');
  }, [project.data]);
  const updateKind = useMutation({
    mutationFn: () => api.patch<ProjectRecord>(`/projects/${projectId}`, { kind }),
    onSuccess: () => {
      void project.refetch();
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('edit');
        return next;
      });
    },
  });
  if (project.isLoading) return <AhLoadingState label="正在加载项目上下文" />;
  if (project.error || !project.data)
    return <AhErrorState description={project.error?.message ?? '项目不存在'} />;
  const base = `/projects/${project.data.id}`;
  const projectType =
    project.data.repoKind === 'GIT' ? 'Git 仓库' : project.data.repoKind ? '目录项目' : undefined;
  const latestSession = [...(sessions.data ?? [])].sort(
    (left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt),
  )[0];
  const activeWorkCount = (tasks.data ?? []).filter(
    (task) => !['DONE', 'CANCELED'].includes(task.status),
  ).length;
  const readyAgentCount = (agents.data ?? []).filter(
    (agent) => agent.enabled && agent.status === 'READY',
  ).length;
  const tabs = [
    { to: `${base}/overview`, label: '概览' },
    { to: `${base}/work`, label: '工作' },
    { to: `${base}/sessions`, label: '会话' },
  ];
  return (
    <div className={`${layout.stack} ${projectsStyles.projectPage}`}>
      <header className={projectsStyles.projectContext}>
        <div className={projectsStyles.breadcrumbs}>
          <Link to="/projects">项目</Link>
          <span aria-hidden="true">/</span>
          <strong>{project.data.name}</strong>
        </div>
        <div className={projectsStyles.identityRow}>
          <span className={projectsStyles.entityLogo} aria-hidden="true">
            {project.data.name.slice(0, 1).toUpperCase() || 'P'}
          </span>
          <div className={projectsStyles.identityCopy}>
            <div className={projectsStyles.identityTitle}>
              <h1>{project.data.name}</h1>
              <AhStatusPill status={project.data.status} />
              <span className={projectsStyles.projectKindBadge}>
                {project.data.kind === 'TEST' ? '测试 Project' : '正式 Project'}
              </span>
            </div>
            {project.data.description ? (
              <p className={projectsStyles.identityDescription}>{project.data.description}</p>
            ) : null}
            <div className={projectsStyles.identityFacts}>
              <span title={latestSession?.branch ?? undefined}>
                <GitBranch size={13} aria-hidden="true" />
                {latestSession?.branch ?? (project.data.repoKind === 'GIT' ? 'main' : '无 Git')}
              </span>
              {projectType ? <span title={project.data.rootPath}>{projectType}</span> : null}
              <span>{readyAgentCount} Agent</span>
              <span>{activeWorkCount} 个运行中</span>
            </div>
          </div>
          <div className={projectsStyles.identityActions}>
            <Link to={`${base}/overview?edit=kind`}>
              <AhButton variant="default">编辑类型</AhButton>
            </Link>
            <Link to={latestSession ? `/workspace/${latestSession.id}` : `${base}/work`}>
              <AhButton variant="default">{latestSession ? '继续会话' : '进入 Work'}</AhButton>
            </Link>
            <Link to={`${base}/work/new`}>
              <AhButton leftSection={<Plus size={16} />}>新建工作</AhButton>
            </Link>
          </div>
        </div>
        <nav className={projectsStyles.contextTabs} aria-label="项目上下文">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to.endsWith('/overview')}
              className={({ isActive }) =>
                `${projectsStyles.contextTab} ${isActive ? projectsStyles.contextTabActive : ''}`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet context={project.data} />
      <AhDialog
        open={searchParams.get('edit') === 'kind'}
        onClose={() => {
          setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.delete('edit');
            return next;
          });
        }}
        title="编辑 Project 类型"
        description="类型只影响 Home 与测试数据分组，不会修改源码仓库或运行权限。"
        actions={
          <>
            <AhButton
              variant="default"
              onClick={() => {
                setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.delete('edit');
                  return next;
                });
              }}
            >
              取消
            </AhButton>
            <AhButton onClick={() => updateKind.mutate()} loading={updateKind.isPending}>
              保存类型
            </AhButton>
          </>
        }
      >
        <div className={layout.dialogBody}>
          <AhSelect
            label="项目类型"
            value={kind}
            onChange={(value) => setKind((value ?? 'STANDARD') as 'STANDARD' | 'TEST')}
            data={[
              { value: 'STANDARD', label: '正式 Project' },
              { value: 'TEST', label: '测试 Project（折叠显示）' },
            ]}
          />
          {updateKind.error ? <AhErrorState description={updateKind.error.message} /> : null}
        </div>
      </AhDialog>
    </div>
  );
}

export function useProjectContext(): ProjectRecord {
  return useOutletContext<ProjectRecord>();
}
