import { useWorkViewport } from '../hooks/useWorkViewport';
import { useProjectEligibility } from '../hooks/useProjectEligibility';
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
  useLocation,
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
  projectLanguage,
  projectTimestamp,
  domainStatusLabel,
  taskStateClass,
  sessionGroupKey,
} from '../../shared/page-primitives';
import projectsStyles from '../projects.module.css';

export function ProjectContextLayout() {
  const { projectId } = useParams();
  const { phone: compact, singlePane } = useWorkViewport();
  const location = useLocation();
  const compactWorkDetail =
    singlePane &&
    /\/work$/.test(location.pathname) &&
    new URLSearchParams(location.search).get('view') !== 'board' &&
    Boolean(new URLSearchParams(location.search).get('task'));
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
  const eligibility = useProjectEligibility(projectId);
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
  // Task lifecycle is not evidence of an active Run.
  const unfinishedWorkCount =
    tasks.isSuccess && !tasks.isFetching
      ? tasks.data.filter((task) => !['DONE', 'CANCELED'].includes(task.status)).length
      : undefined;
  const recordedSessionBranch = latestSession?.branch?.trim();
  // A Session branch is historical context, never proof of the repository's current HEAD.
  const branchLabel = sessions.isError
    ? '会话分支读取失败'
    : !sessions.isSuccess || sessions.isFetching
      ? '会话分支确认中'
      : recordedSessionBranch
        ? `最近会话分支：${recordedSessionBranch}`
        : project.data.repoKind === 'GIT'
          ? '当前分支未核验'
          : '未登记 Git 仓库';
  const eligibleAgentCount =
    eligibility.isSuccess && !eligibility.isFetching
      ? eligibility.data.filter((entry) => entry.eligible).length
      : undefined;
  const branchNeedsAttention =
    sessions.isError ||
    !sessions.isSuccess ||
    sessions.isFetching ||
    (project.data.repoKind === 'GIT' && !recordedSessionBranch);
  const hasHeaderWarning =
    branchNeedsAttention ||
    eligibleAgentCount === undefined ||
    eligibleAgentCount === 0 ||
    unfinishedWorkCount === undefined;
  const headerFailure =
    sessions.isError || eligibility.isError || tasks.isError || eligibleAgentCount === 0;
  const renderFacts = (mode: 'all' | 'warnings' | 'secondary') => {
    const show = (attention: boolean) =>
      mode === 'all' || (mode === 'warnings' ? attention : !attention);
    return (
      <div className={projectsStyles.identityFacts}>
        {show(branchNeedsAttention) ? (
          <span title={branchLabel}>
            <GitBranch size={13} aria-hidden="true" />
            {branchLabel}
          </span>
        ) : null}
        {projectType && mode !== 'warnings' ? (
          <span title={project.data.rootPath}>{projectType}</span>
        ) : null}
        {show(eligibleAgentCount === undefined || eligibleAgentCount === 0) ? (
          <span title="仅登记状态下的项目资格，运行前仍需预检。">
            {eligibleAgentCount !== undefined
              ? `${eligibleAgentCount} 个登记可用 Agent`
              : eligibility.isError
                ? 'Agent 资格读取失败'
                : 'Agent 资格确认中'}
          </span>
        ) : null}
        {show(unfinishedWorkCount === undefined) ? (
          <span title="按任务状态统计未结束工作，不代表正在执行的 Run 数量。">
            {unfinishedWorkCount !== undefined
              ? `${unfinishedWorkCount} 项未结束工作`
              : tasks.isError
                ? '工作数量读取失败'
                : '工作数量确认中'}
          </span>
        ) : null}
      </div>
    );
  };
  const tabs = [
    { to: `${base}/overview`, label: '概览' },
    { to: `${base}/work`, label: '工作' },
    { to: `${base}/sessions`, label: '会话' },
  ];
  return (
    <div className={projectsStyles.projectPage}>
      <header
        className={projectsStyles.projectContext}
        hidden={compactWorkDetail && !hasHeaderWarning}
      >
        <div className={projectsStyles.breadcrumbs} hidden={compactWorkDetail}>
          <Link to="/projects">项目</Link>
          <span aria-hidden="true">/</span>
          <strong>{project.data.name}</strong>
        </div>
        <div className={projectsStyles.identityRow} hidden={compactWorkDetail}>
          <span className={projectsStyles.entityLogo} aria-hidden="true">
            {project.data.name.slice(0, 1).toUpperCase() || 'P'}
          </span>
          <div className={projectsStyles.identityCopy}>
            <div className={projectsStyles.identityTitle}>
              <h1>{project.data.name}</h1>
              <AhStatusPill status={project.data.status} />
              {!compact ? (
                <span className={projectsStyles.projectKindBadge}>
                  {project.data.kind === 'TEST' ? '测试 Project' : '正式 Project'}
                </span>
              ) : null}
            </div>
            {!compact && project.data.description ? (
              <p className={projectsStyles.identityDescription}>{project.data.description}</p>
            ) : null}
            {!compact && !compactWorkDetail ? renderFacts('all') : null}
          </div>
          <div className={projectsStyles.identityActions}>
            {!compact ? (
              <Link to={`${base}/overview?edit=kind`}>
                <AhButton variant="default">编辑类型</AhButton>
              </Link>
            ) : null}
            {!compact || latestSession ? (
              <Link to={latestSession ? `/workspace/${latestSession.id}` : `${base}/work`}>
                <AhButton variant="default">{latestSession ? '继续会话' : '进入 Work'}</AhButton>
              </Link>
            ) : null}
            <Link to={`${base}/work/new`}>
              <AhButton leftSection={<Plus size={16} />}>新建工作</AhButton>
            </Link>
          </div>
        </div>
        {(compact || compactWorkDetail) && hasHeaderWarning ? (
          <div
            className={projectsStyles.headerWarnings}
            role="status"
            data-severity={headerFailure ? 'warning' : 'pending'}
          >
            {headerFailure ? <AlertTriangle size={14} aria-hidden="true" /> : null}
            {renderFacts('warnings')}
          </div>
        ) : null}
        <div className={projectsStyles.contextNavigation} hidden={compactWorkDetail}>
          {compact ? (
            <>
              <details className={projectsStyles.projectDetails} hidden={compactWorkDetail}>
                <summary>项目详情</summary>
                <p>{project.data.kind === 'TEST' ? '测试 Project' : '正式 Project'}</p>
                {project.data.description ? <p>{project.data.description}</p> : null}
                {renderFacts('secondary')}
                <Link to={`${base}/overview?edit=kind`}>
                  <AhButton variant="default">编辑类型</AhButton>
                </Link>
              </details>
            </>
          ) : null}
          <nav
            className={projectsStyles.contextTabs}
            aria-label="项目上下文"
            hidden={compactWorkDetail}
          >
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
        </div>
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
