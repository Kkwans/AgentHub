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
  HandWaving,
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
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
} from '../../lib/api';
import { api } from '../../lib/api';
import { realtime } from '../../lib/realtime';
import { useAgentHubTheme } from '@agenthub/ui';
import {
  Composer,
  Conversation,
  Inspector,
  SessionRail,
  type InspectorTab,
} from '../workspace/components/WorkspaceSections';
import {
  readWorkspaceLayout,
  WORKSPACE_PANEL_LIMITS,
  writeWorkspacePanel,
} from '../workspace/layoutPreferences';
import { TerminalDock } from '../workspace/components/TerminalDock';
import {
  labelPromptBindingTarget,
  labelPromptKind,
  labelPromptSelector,
  labelPromptType,
  labelPromptVersionSource,
} from '../../presentation/domain-labels';
import styles from '../surface.module.css';
import homeStyles from './homeV07.module.css';
import projectsStyles from './projectsV07.module.css';
import promptSettingsStyles from './promptSettingsV07.module.css';
import workspaceStyles from './workspaceV07.module.css';

function Screen({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.stack}>
      <AhReveal>
        <header className={styles.pageHeader}>
          <div>
            <span className={styles.eyebrow}>{eyebrow}</span>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </header>
      </AhReveal>
      {children}
    </div>
  );
}

function QueryMessage({
  loading,
  error,
  retry,
  label,
}: {
  loading: boolean;
  error: Error | null;
  retry?: () => void;
  label: string;
}) {
  if (loading) return <AhLoadingState label={label} />;
  if (error) return <AhErrorState description={error.message} {...(retry ? { retry } : {})} />;
  return null;
}

function displayDate(value?: string | null): string {
  if (!value) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '暂无记录'
    : new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
}

function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return compact;
}

type ProjectViewRecord = ProjectRecord & {
  createdAt?: string;
  updatedAt?: string;
  language?: string | null;
  languageName?: string | null;
  technology?: string | null;
};

function projectViewRecord(project: ProjectRecord): ProjectViewRecord {
  return project as ProjectViewRecord;
}

function projectLanguage(project: ProjectRecord): string | undefined {
  const record = projectViewRecord(project);
  return record.language ?? record.languageName ?? record.technology ?? undefined;
}

function projectTimestamp(project: ProjectRecord): string | undefined {
  const record = projectViewRecord(project);
  return record.updatedAt ?? record.createdAt;
}

function domainStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    ACTIVE: '运行中',
    ARCHIVED: '已归档',
    READY: '就绪',
    BACKLOG: '待排期',
    IN_PROGRESS: '进行中',
    WAITING_REVIEW: '待审阅',
    BLOCKED: '已阻塞',
    DONE: '已完成',
    CANCELED: '已取消',
    FAILED: '失败',
    RUNNING: '运行中',
    CLOSED: '已关闭',
    DISCONNECTED: '已断开',
    REVIEW: '待审阅',
    QUEUED: '排队中',
  };
  return labels[status] ?? '其他';
}

function taskStateClass(status: TaskRecord['status']): string {
  if (status === 'IN_PROGRESS') return projectsStyles.workStateDotRunning ?? '';
  if (status === 'WAITING_REVIEW' || status === 'BLOCKED')
    return projectsStyles.workStateDotReview ?? '';
  if (status === 'DONE') return projectsStyles.workStateDotDone ?? '';
  if (status === 'CANCELED') return projectsStyles.workStateDotFailed ?? '';
  return projectsStyles.workStateDotSmall ?? '';
}

function sessionGroupKey(value: string): 'today' | 'yesterday' | 'earlier' {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return 'earlier';
  const current = new Date();
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  const day = new Date(
    new Date(time).getFullYear(),
    new Date(time).getMonth(),
    new Date(time).getDate(),
  ).getTime();
  if (day === today) return 'today';
  if (day === today - 86_400_000) return 'yesterday';
  return 'earlier';
}

export function HomePageV07() {
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardSnapshot>('/dashboard'),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionRecord[]>('/sessions'),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const prompts = useQuery({
    queryKey: ['prompts'],
    queryFn: () => api.get<PromptRecord[]>('/prompts'),
  });
  const error =
    dashboard.error ?? projects.error ?? sessions.error ?? agents.error ?? prompts.error;
  const loading =
    dashboard.isLoading ||
    projects.isLoading ||
    sessions.isLoading ||
    agents.isLoading ||
    prompts.isLoading;
  const activeProject =
    projects.data?.find((project) => project.status === 'ACTIVE') ?? projects.data?.[0];
  const running = dashboard.data?.runningSessions ?? [];
  const attention = [
    ...(dashboard.data?.pendingApprovals ?? []),
    ...(dashboard.data?.attentionTasks ?? []),
  ];
  const projectById = useMemo(
    () => new Map((projects.data ?? []).map((project) => [project.id, project])),
    [projects.data],
  );
  const sessionById = useMemo(
    () => new Map((sessions.data ?? []).map((session) => [session.id, session])),
    [sessions.data],
  );
  const agentById = useMemo(
    () => new Map((agents.data ?? []).map((agent) => [agent.id, agent])),
    [agents.data],
  );
  const recentSessions = useMemo(
    () =>
      [...(sessions.data ?? [])]
        .sort((left, right) => {
          const rightTime = Date.parse(right.lastActiveAt);
          const leftTime = Date.parse(left.lastActiveAt);
          return (
            (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime)
          );
        })
        .slice(0, 4),
    [sessions.data],
  );
  const activeProjectCount = projects.data?.filter((project) => project.status === 'ACTIVE').length;
  const readyAgentCount = agents.data?.filter(
    (agent) => agent.status === 'READY' && agent.enabled,
  ).length;
  const projectName = (projectId: string | null | undefined) =>
    projectId ? projectById.get(projectId)?.name : undefined;
  const attentionToneClasses = {
    warning: homeStyles.attentionWarning,
    danger: homeStyles.attentionDanger,
    info: homeStyles.attentionInfo,
  } as const;
  const attentionItems = attention.slice(0, 5).map((item) => {
    if ('optionsJson' in item) {
      const session = sessionById.get(item.sessionId);
      return {
        id: item.id,
        title: item.title || '权限请求',
        description: item.description ?? session?.title,
        meta: projectName(session?.projectId),
        action: '处理',
        href: `/workspace/${item.sessionId}`,
        tone: 'warning' as const,
      };
    }
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      meta: projectName(item.projectId),
      action: item.status === 'WAITING_REVIEW' ? '审阅' : '查看',
      href: item.sessionId
        ? `/workspace/${item.sessionId}`
        : `/projects/${item.projectId}/work?task=${item.id}`,
      tone: item.status === 'BLOCKED' ? ('danger' as const) : ('info' as const),
    };
  });
  return (
    <div className={homeStyles.homePage}>
      <QueryMessage
        loading={loading}
        error={error}
        retry={() => {
          void dashboard.refetch();
          void projects.refetch();
          void sessions.refetch();
          void agents.refetch();
          void prompts.refetch();
        }}
        label="正在汇总工作台状态"
      />
      {!loading && !error ? (
        <>
          <AhReveal>
            <section className={homeStyles.hero} aria-labelledby="home-hero-title">
              <div className={homeStyles.heroCopy}>
                <p className={homeStyles.eyebrow}>AI ENGINEERING WORKBENCH</p>
                <h1 id="home-hero-title">
                  你好，Kwan{' '}
                  <HandWaving className={homeStyles.wave} aria-hidden size={28} weight="duotone" />
                </h1>
                <p className={homeStyles.heroSubtitle}>欢迎回来，继续与 AI Agent 一起创造。</p>
                <Link to={activeProject ? `/projects/${activeProject.id}/work/new` : '/projects'}>
                  <AhButton className={homeStyles.heroCta} leftSection={<Plus size={16} />}>
                    新建工作
                  </AhButton>
                </Link>
              </div>
              <div className={homeStyles.auroraScene} aria-hidden="true">
                <span className={`${homeStyles.cube} ${homeStyles.cubeA}`} />
                <span className={`${homeStyles.cube} ${homeStyles.cubeB}`} />
                <span className={`${homeStyles.cube} ${homeStyles.cubeC}`} />
                <span className={`${homeStyles.beam} ${homeStyles.beamA}`} />
                <span className={`${homeStyles.beam} ${homeStyles.beamB}`} />
              </div>
              <div className={homeStyles.metricStrip} aria-label="工作台摘要">
                <div className={homeStyles.metricCard}>
                  <span className={`${homeStyles.metricIcon} ${homeStyles.metricViolet}`}>
                    <FolderKanban size={17} />
                  </span>
                  <AhMetric
                    label="活跃项目"
                    value={activeProjectCount ?? '—'}
                    hint="当前可用 Project"
                    tone="neutral"
                  />
                </div>
                <div className={homeStyles.metricCard}>
                  <span className={`${homeStyles.metricIcon} ${homeStyles.metricBlue}`}>
                    <Play size={17} />
                  </span>
                  <AhMetric
                    label="运行中的工作"
                    value={running.length}
                    hint="当前活跃 Session"
                    tone="neutral"
                  />
                </div>
                <div className={homeStyles.metricCard}>
                  <span className={`${homeStyles.metricIcon} ${homeStyles.metricGreen}`}>
                    <Bot size={17} />
                  </span>
                  <AhMetric
                    label="可用 Agent"
                    value={readyAgentCount ?? '—'}
                    hint="已接入并就绪"
                    tone="neutral"
                  />
                </div>
                <div className={homeStyles.metricCard}>
                  <span className={`${homeStyles.metricIcon} ${homeStyles.metricPurple}`}>
                    <Tag size={17} />
                  </span>
                  <AhMetric
                    label="Prompt 模板"
                    value={prompts.data?.length ?? '—'}
                    hint="可复用模板"
                    tone="neutral"
                  />
                </div>
              </div>
            </section>
          </AhReveal>

          <AhReveal delay={70}>
            <section className={homeStyles.section} aria-labelledby="recent-projects-title">
              <div className={homeStyles.sectionHeading}>
                <div>
                  <h2 id="recent-projects-title">最近项目</h2>
                  <p>继续最近工作，或打开项目上下文。</p>
                </div>
                <Link className={homeStyles.sectionLink} to="/projects">
                  查看全部 <ArrowRight size={14} />
                </Link>
              </div>
              {projects.data?.length ? (
                <div className={homeStyles.projectGrid}>
                  {projects.data.slice(0, 4).map((project, index) => (
                    <Link
                      className={homeStyles.projectCard}
                      key={project.id}
                      to={`/projects/${project.id}/overview`}
                    >
                      <div className={homeStyles.entityHead}>
                        <span
                          className={`${homeStyles.entityLogo} ${homeStyles[`entityColor${index % 4}`]}`}
                        >
                          {project.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div className={homeStyles.entityCopy}>
                          <strong>{project.name}</strong>
                          <AhStatusPill status={project.status} />
                        </div>
                      </div>
                      {project.description ? (
                        <p className={homeStyles.projectDescription}>{project.description}</p>
                      ) : null}
                      <div className={homeStyles.projectTags}>
                        {project.repoKind ? (
                          <span className={homeStyles.techChip}>
                            {project.repoKind === 'GIT' ? 'Git' : '目录'}
                          </span>
                        ) : null}
                        {project.repoKind === 'GIT' ? (
                          <span className={homeStyles.metaItem}>
                            <GitBranch size={12} /> Git 项目
                          </span>
                        ) : null}
                      </div>
                      {project.rootPath ? (
                        <div className={homeStyles.cardFoot} title={project.rootPath}>
                          {project.rootPath}
                        </div>
                      ) : null}
                    </Link>
                  ))}
                </div>
              ) : (
                <AhEmptyState
                  title="还没有项目"
                  description="从允许访问的目录创建第一个 Project。"
                  action={
                    <Link to="/projects/new">
                      <AhButton size="sm">创建项目</AhButton>
                    </Link>
                  }
                />
              )}
            </section>
          </AhReveal>

          <AhReveal delay={120}>
            <section className={homeStyles.lowerGrid} aria-label="需要处理和最近工作">
              <AhSurface className={homeStyles.panel}>
                <div className={homeStyles.panelTitle}>
                  <div>
                    <h3>需要处理</h3>
                    <p>优先显示阻塞你工作的事件。</p>
                  </div>
                  {attentionItems.length ? (
                    <span className={homeStyles.countPill}>{attentionItems.length}</span>
                  ) : null}
                </div>
                <div className={homeStyles.attentionList}>
                  {attentionItems.length ? (
                    attentionItems.map((item) => (
                      <Link className={homeStyles.attentionRow} key={item.id} to={item.href}>
                        <span
                          className={`${homeStyles.attentionIcon} ${attentionToneClasses[item.tone]}`}
                        >
                          {item.tone === 'warning' ? (
                            <AlertTriangle size={15} />
                          ) : item.tone === 'danger' ? (
                            <CircleStop size={15} />
                          ) : (
                            <Bot size={15} />
                          )}
                        </span>
                        <span className={homeStyles.attentionCopy}>
                          <strong>{item.title}</strong>
                          {item.description || item.meta ? (
                            <small>
                              {item.description ?? item.meta}
                              {item.description && item.meta ? ` · ${item.meta}` : ''}
                            </small>
                          ) : null}
                        </span>
                        <span className={homeStyles.attentionAction}>
                          {item.action} <ArrowRight size={13} />
                        </span>
                      </Link>
                    ))
                  ) : (
                    <AhEmptyState
                      compact
                      title="没有待处理项"
                      description="新的 Approval 与 Review 会在这里出现。"
                      action={
                        <Link className={homeStyles.sectionLink} to="/projects">
                          查看项目 <ArrowRight size={14} />
                        </Link>
                      }
                    />
                  )}
                </div>
              </AhSurface>
              <AhSurface className={homeStyles.panel}>
                <div className={homeStyles.panelTitle}>
                  <div>
                    <h3>最近工作</h3>
                    <p>跨项目的最近活动。</p>
                  </div>
                </div>
                <div className={homeStyles.workList}>
                  {recentSessions.length ? (
                    recentSessions.map((session) => {
                      const agent = agentById.get(session.agentId);
                      return (
                        <Link
                          className={homeStyles.workRow}
                          key={session.id}
                          to={`/workspace/${session.id}`}
                        >
                          <span
                            className={`${homeStyles.miniStatus} ${session.status === 'RUNNING' || session.status === 'IN_PROGRESS' ? homeStyles.miniRunning : session.status === 'WAITING_REVIEW' || session.status === 'REVIEW' ? homeStyles.miniReview : session.status === 'DONE' || session.status === 'COMPLETED' ? homeStyles.miniDone : homeStyles.miniIdle}`}
                          />
                          <span className={homeStyles.workCopy}>
                            <strong>{session.title}</strong>
                            <small>
                              {projectName(session.projectId) ?? '项目'}
                              {agent?.name ? ` · ${agent.name}` : ''} ·{' '}
                              {displayDate(session.lastActiveAt)}
                            </small>
                          </span>
                        </Link>
                      );
                    })
                  ) : (
                    <AhEmptyState
                      compact
                      title="还没有最近工作"
                      description="从 Project Work 创建一项工作。"
                      action={
                        <Link
                          className={homeStyles.sectionLink}
                          to={
                            activeProject ? `/projects/${activeProject.id}/work/new` : '/projects'
                          }
                        >
                          新建工作 <ArrowRight size={14} />
                        </Link>
                      }
                    />
                  )}
                </div>
              </AhSurface>
            </section>
          </AhReveal>
        </>
      ) : null}
    </div>
  );
}

export function ProjectsPageV07() {
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.get<TaskRecord[]>('/tasks') });
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionRecord[]>('/sessions'),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [language, setLanguage] = useState('all');
  const [sort, setSort] = useState('updated');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const allProjects = projects.data ?? [];
  const statusOptions = useMemo(
    () => Array.from(new Set(allProjects.map((project) => project.status))).filter(Boolean),
    [allProjects],
  );
  const languageOptions = useMemo(
    () =>
      Array.from(
        new Set(
          allProjects.map(projectLanguage).filter((value): value is string => Boolean(value)),
        ),
      ),
    [allProjects],
  );
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    const result = allProjects.filter((project) => {
      const languageValue = projectLanguage(project);
      const searchable =
        `${project.name} ${project.description ?? ''} ${project.rootPath} ${project.realRootPath}`.toLowerCase();
      return (
        (!value || searchable.includes(value)) &&
        (status === 'all' || project.status === status) &&
        (language === 'all' || languageValue === language)
      );
    });
    return [...result].sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name, 'zh-CN');
      if (sort === 'status')
        return domainStatusLabel(left.status).localeCompare(
          domainStatusLabel(right.status),
          'zh-CN',
        );
      const leftTime = Date.parse(projectTimestamp(left) ?? '');
      const rightTime = Date.parse(projectTimestamp(right) ?? '');
      if (!Number.isNaN(leftTime) || !Number.isNaN(rightTime))
        return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
      return left.name.localeCompare(right.name, 'zh-CN');
    });
  }, [allProjects, language, query, sort, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    setPage(1);
  }, [language, pageSize, query, sort, status, view]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const visibleProjects = filtered.slice((page - 1) * pageSize, page * pageSize);
  const projectInitial = (project: ProjectRecord) =>
    project.name.trim().slice(0, 1).toUpperCase() || 'P';
  const readyAgentCount = agents.data
    ? agents.data.filter((agent) => agent.enabled && agent.status === 'READY').length
    : null;
  const projectRows = visibleProjects.map((project, index) => {
    const languageValue = projectLanguage(project);
    const timestamp = projectTimestamp(project);
    const repoLabel = project.repoKind === 'GIT' ? 'Git' : project.repoKind ? '目录' : undefined;
    const activeWorkCount = tasks.data
      ? tasks.data.filter(
          (task) => task.projectId === project.id && !['DONE', 'CANCELED'].includes(task.status),
        ).length
      : null;
    const latestSession = (sessions.data ?? [])
      .filter((session) => session.projectId === project.id)
      .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt))[0];
    return (
      <Link
        className={projectsStyles.projectRow}
        key={project.id}
        to={`/projects/${project.id}/overview`}
      >
        <span className={projectsStyles.projectIdentity}>
          <span
            className={`${projectsStyles.entityLogo} ${index % 3 === 1 ? projectsStyles.entityLogoAlt : index % 3 === 2 ? projectsStyles.entityLogoNeutral : ''}`}
            aria-hidden="true"
          >
            {projectInitial(project)}
          </span>
          <span className={projectsStyles.projectMain}>
            <strong className={projectsStyles.projectTitle}>{project.name}</strong>
            {project.description ? (
              <span className={projectsStyles.projectDescription}>{project.description}</span>
            ) : null}
            <span className={projectsStyles.projectMeta}>
              {repoLabel ? <span>{repoLabel}</span> : null}
              {languageValue ? <span>{languageValue}</span> : null}
              {project.rootPath ? <span title={project.rootPath}>{project.rootPath}</span> : null}
            </span>
          </span>
        </span>
        <span className={projectsStyles.projectBranch} title={latestSession?.branch ?? undefined}>
          {latestSession?.branch ?? (sessions.data && project.repoKind === 'GIT' ? 'main' : '—')}
        </span>
        <span className={projectsStyles.projectMetric}>
          <strong>{activeWorkCount ?? '—'}</strong>
          <small>进行中</small>
        </span>
        <span className={projectsStyles.projectMetric}>
          <strong>{readyAgentCount ?? '—'}</strong>
          <small>可用</small>
        </span>
        <span className={projectsStyles.projectActivity}>
          <strong>{displayDate(latestSession?.lastActiveAt ?? timestamp)}</strong>
          <small>最近活动</small>
        </span>
      </Link>
    );
  });
  const projectCards = visibleProjects.map((project, index) => {
    const languageValue = projectLanguage(project);
    const timestamp = projectTimestamp(project);
    return (
      <Link
        className={projectsStyles.projectCard}
        key={project.id}
        to={`/projects/${project.id}/overview`}
      >
        <span className={projectsStyles.projectCardHeader}>
          <span
            className={`${projectsStyles.entityLogo} ${index % 3 === 1 ? projectsStyles.entityLogoAlt : index % 3 === 2 ? projectsStyles.entityLogoNeutral : ''}`}
            aria-hidden="true"
          >
            {projectInitial(project)}
          </span>
          <span className={projectsStyles.rowMain}>
            <strong className={projectsStyles.projectTitle}>{project.name}</strong>
            <span className={projectsStyles.projectMeta}>
              {project.repoKind === 'GIT' ? 'Git' : project.repoKind ? '目录' : null}
              {languageValue ? ` · ${languageValue}` : ''}
            </span>
          </span>
          <AhStatusPill status={project.status} />
        </span>
        <span className={projectsStyles.projectDescription}>
          {project.description ?? '暂无项目说明。'}
        </span>
        <span className={projectsStyles.projectCardFooter}>
          <span title={project.rootPath}>{project.rootPath}</span>
          {timestamp ? <span>{displayDate(timestamp)}</span> : null}
        </span>
      </Link>
    );
  });
  return (
    <Screen
      eyebrow="Projects"
      title="项目"
      description="管理你的代码项目，在隔离的工作区中与 Agent 一起开发。"
      actions={
        <Link to="/projects/new">
          <AhButton leftSection={<Plus size={16} />}>新建项目</AhButton>
        </Link>
      }
    >
      <div className={projectsStyles.projectsPage}>
        <QueryMessage
          loading={projects.isLoading}
          error={projects.error}
          retry={() => void projects.refetch()}
          label="正在加载项目"
        />
        {!projects.isLoading && !projects.error ? (
          <>
            <div className={projectsStyles.projectsToolbar} aria-label="项目筛选">
              <div className={projectsStyles.toolbarSearch}>
                <AhInput
                  label=""
                  aria-label="搜索项目"
                  placeholder="搜索项目名称、说明或路径"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  leftSection={<Search size={16} />}
                />
              </div>
              <div className={projectsStyles.toolbarSelect}>
                <AhSelect
                  aria-label="项目状态"
                  label=""
                  value={status}
                  onChange={(value) => setStatus(value ?? 'all')}
                  data={[
                    { value: 'all', label: '全部状态' },
                    ...statusOptions.map((value) => ({ value, label: domainStatusLabel(value) })),
                  ]}
                />
              </div>
              {languageOptions.length ? (
                <div className={projectsStyles.toolbarSelect}>
                  <AhSelect
                    aria-label="项目语言"
                    label=""
                    value={language}
                    onChange={(value) => setLanguage(value ?? 'all')}
                    data={[
                      { value: 'all', label: '全部语言' },
                      ...languageOptions.map((value) => ({ value, label: value })),
                    ]}
                  />
                </div>
              ) : null}
              <div className={projectsStyles.toolbarSelect}>
                <AhSelect
                  aria-label="项目排序"
                  label=""
                  value={sort}
                  onChange={(value) => setSort(value ?? 'updated')}
                  data={[
                    { value: 'updated', label: '最新更新' },
                    { value: 'name', label: '名称 A-Z' },
                    { value: 'status', label: '状态' },
                  ]}
                />
              </div>
              <span className={projectsStyles.toolbarSpacer} />
              <div className={projectsStyles.segmented} role="group" aria-label="项目视图">
                <button
                  type="button"
                  className={`${projectsStyles.segmentedButton} ${view === 'grid' ? projectsStyles.segmentedButtonActive : ''}`}
                  aria-pressed={view === 'grid'}
                  onClick={() => setView('grid')}
                >
                  卡片
                </button>
                <button
                  type="button"
                  className={`${projectsStyles.segmentedButton} ${view === 'list' ? projectsStyles.segmentedButtonActive : ''}`}
                  aria-pressed={view === 'list'}
                  onClick={() => setView('list')}
                >
                  列表
                </button>
              </div>
              <span className={projectsStyles.toolbarCount}>{filtered.length} 个项目</span>
            </div>
            {filtered.length ? (
              view === 'list' ? (
                <section className={projectsStyles.projectList} aria-label="项目列表">
                  <div className={projectsStyles.projectListHeader} aria-hidden="true">
                    <span>项目</span>
                    <span>分支</span>
                    <span>工作</span>
                    <span>Agent</span>
                    <span>最近活动</span>
                  </div>
                  {projectRows}
                </section>
              ) : (
                <div className={projectsStyles.projectCardGrid}>{projectCards}</div>
              )
            ) : (
              <AhSurface className={projectsStyles.emptyPanel}>
                <AhEmptyState
                  title={
                    query || status !== 'all' || language !== 'all'
                      ? '没有匹配的项目'
                      : '还没有项目'
                  }
                  description={
                    query || status !== 'all' || language !== 'all'
                      ? '尝试调整筛选条件。'
                      : '从允许访问的目录创建第一个 Project。'
                  }
                  action={
                    !query && status === 'all' && language === 'all' ? (
                      <Link to="/projects/new">
                        <AhButton>创建项目</AhButton>
                      </Link>
                    ) : undefined
                  }
                />
              </AhSurface>
            )}
            {filtered.length && pageCount > 1 ? (
              <footer className={projectsStyles.listFooter}>
                <span>
                  第 {page} / {pageCount} 页 · 共 {filtered.length} 个项目
                </span>
                <span className={projectsStyles.pagination}>
                  <button
                    type="button"
                    className={projectsStyles.paginationButton}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page === 1}
                    aria-label="上一页"
                  >
                    ‹
                  </button>
                  {Array.from({ length: pageCount }, (_, index) => index + 1).map((value) => (
                    <button
                      type="button"
                      className={`${projectsStyles.paginationButton} ${value === page ? projectsStyles.paginationButtonActive : ''}`}
                      key={value}
                      onClick={() => setPage(value)}
                      aria-label={`第 ${value} 页`}
                      aria-current={value === page ? 'page' : undefined}
                    >
                      {value}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={projectsStyles.paginationButton}
                    onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                    disabled={page === pageCount}
                    aria-label="下一页"
                  >
                    ›
                  </button>
                  <AhSelect
                    aria-label="每页数量"
                    label=""
                    value={String(pageSize)}
                    onChange={(value) => setPageSize(Number(value ?? 10))}
                    data={[
                      { value: '10', label: '10 条/页' },
                      { value: '20', label: '20 条/页' },
                    ]}
                  />
                </span>
              </footer>
            ) : null}
          </>
        ) : null}
      </div>
    </Screen>
  );
}

export function CreateProjectPageV07() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const compact = useCompactViewport();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetId, setTargetId] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const targets = useQuery({
    queryKey: ['targets'],
    queryFn: () => api.get<ExecutionTargetRecord[]>('/execution-targets'),
  });
  const roots = useQuery({
    queryKey: ['filesystem-roots', targetId],
    queryFn: () =>
      api.get<Array<{ rootId: string; label: string; path: string }>>(
        `/execution-targets/${targetId}/filesystem/roots`,
      ),
    enabled: Boolean(targetId),
  });
  useEffect(() => {
    if (!targetId && targets.data?.[0]) setTargetId(targets.data[0].id);
  }, [targetId, targets.data]);
  useEffect(() => {
    if (roots.data?.[0] && !rootPath) setRootPath(roots.data[0].path);
  }, [rootPath, roots.data]);
  const preflight = useQuery({
    queryKey: ['project-preflight', targetId, rootPath],
    queryFn: () =>
      api.post<{
        status: 'READY' | 'BROKEN';
        checks: Array<{ id: string; status: string; message: string }>;
      }>('/projects/preflight', { targetId, rootPath }),
    enabled: Boolean(targetId && rootPath),
    staleTime: 2_000,
  });
  const create = useMutation({
    mutationFn: () =>
      api.post<ProjectRecord>('/projects', {
        name: name.trim(),
        description: description.trim() || undefined,
        targetId,
        rootPath,
      }),
    onSuccess: (project) => {
      void client.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/projects/${project.id}/overview`);
    },
  });
  const close = () => navigate('/projects');
  return (
    <>
      <ProjectsPageV07 />
      <AhDialog
        open
        onClose={close}
        title="创建项目"
        description="从 AgentHub 已授权的目录中选择工程。路径来自运行环境，不接受越权手工输入。"
        size={820}
        fullScreen={compact}
        actions={
          <>
            <AhButton variant="default" onClick={close}>
              取消
            </AhButton>
            <AhButton
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={
                !name.trim() || !targetId || !rootPath || preflight.data?.status !== 'READY'
              }
            >
              预检并创建
            </AhButton>
          </>
        }
      >
        <div className={styles.dialogBody} data-testid="create-project-dialog">
          <div className={styles.dialogIntro}>
            <span className={styles.dialogStep}>1</span>
            <div>
              <strong>选择 Project 目录</strong>
              <p>先确认运行环境和可访问根目录，AgentHub 会自动识别 Git 与工作区信息。</p>
            </div>
          </div>
          <div className={styles.fieldGrid}>
            <AhSelect
              label="运行环境"
              value={targetId}
              onChange={(value) => {
                setTargetId(value ?? '');
                setRootPath('');
              }}
              data={(targets.data ?? []).map((target) => ({
                value: target.id,
                label: `${target.name} · ${target.os}/${target.arch}`,
              }))}
              placeholder="选择运行环境"
            />
            <AhSelect
              label="允许目录"
              value={rootPath}
              onChange={(value) => {
                setRootPath(value ?? '');
                if (!name && value) setName(value.split('/').filter(Boolean).at(-1) ?? '');
              }}
              data={(roots.data ?? []).map((root) => ({
                value: root.path,
                label: `${root.label} · ${root.path}`,
              }))}
              placeholder={roots.isLoading ? '正在读取目录' : '选择目录'}
              disabled={!targetId || roots.isLoading}
            />
          </div>
          <div className={styles.dialogSection}>
            <div className={styles.dialogIntro}>
              <span className={styles.dialogStep}>2</span>
              <div>
                <strong>确认 Project 身份</strong>
                <p>名称默认取目录名，可按团队习惯调整。</p>
              </div>
            </div>
            <div className={styles.fieldGrid}>
              <AhInput
                label="项目名称"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="例如 AgentHub"
                required
              />
              <AhTextarea
                label="项目说明（可选）"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder="描述这个工程的用途"
                minRows={3}
              />
            </div>
          </div>
          <div className={styles.mutedBox}>
            <strong>
              {preflight.isFetching
                ? '正在运行 Project preflight…'
                : preflight.data?.status === 'READY'
                  ? '目录可以使用'
                  : preflight.data
                    ? '目录需要处理'
                    : '选择目录后会自动运行 Project preflight'}
            </strong>
            {preflight.data ? (
              <div className={styles.checkList}>
                {preflight.data.checks.map((check) => (
                  <div key={check.id}>
                    <span aria-hidden="true">{check.status === 'PASS' ? '✓' : '·'}</span>
                    {check.message}
                  </div>
                ))}
              </div>
            ) : null}
            {preflight.error ? (
              <div className={styles.dialogError}>{preflight.error.message}</div>
            ) : null}
          </div>
          <details
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            className={styles.dialogDetails}
          >
            <summary>高级设置</summary>
            <p>
              Runtime、mount、worktree 和 Git 行为沿用当前执行环境的安全默认值。需要修改时请先完成
              Project 创建，再从项目设置进入。
            </p>
          </details>
          {create.error ? <AhErrorState description={create.error.message} /> : null}
        </div>
      </AhDialog>
    </>
  );
}

export function ProjectContextLayoutV07() {
  const { projectId } = useParams();
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
    <div className={`${styles.stack} ${projectsStyles.projectPage}`}>
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
    </div>
  );
}

function useProjectContext(): ProjectRecord {
  return useOutletContext<ProjectRecord>();
}

export function ProjectOverviewPageV07() {
  const project = useProjectContext();
  const tasks = useQuery({
    queryKey: ['tasks', project.id],
    queryFn: () => api.get<TaskRecord[]>(`/tasks?projectId=${project.id}`),
  });
  const sessions = useQuery({
    queryKey: ['sessions', project.id],
    queryFn: () => api.get<SessionRecord[]>(`/sessions?projectId=${project.id}`),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const preflight = useQuery({
    queryKey: ['project-preflight', project.id],
    queryFn: () =>
      api.post<{
        status: string;
        git?: { detected?: boolean; branch?: string; dirty?: boolean };
        permissions?: { readable?: boolean; writable?: boolean };
        checks?: Array<{ status: string; message: string }>;
      }>(`/projects/${project.id}/preflight`),
  });
  const agentById = useMemo(
    () => new Map((agents.data ?? []).map((agent) => [agent.id, agent])),
    [agents.data],
  );
  const activeTasks = useMemo(
    () =>
      [...(tasks.data ?? [])]
        .filter(
          (task) =>
            task.status !== 'DONE' &&
            task.status !== 'CANCELED' &&
            task.status !== 'WAITING_REVIEW',
        )
        .sort((left, right) => {
          const rank: Record<TaskRecord['status'], number> = {
            IN_PROGRESS: 0,
            WAITING_REVIEW: 1,
            BLOCKED: 2,
            READY: 3,
            BACKLOG: 4,
            DONE: 5,
            CANCELED: 6,
          };
          return (
            rank[left.status] - rank[right.status] ||
            Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
          );
        })
        .slice(0, 5),
    [tasks.data],
  );
  const reviewTasks = useMemo(
    () =>
      [...(tasks.data ?? [])]
        .filter((task) => task.status === 'WAITING_REVIEW')
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, 4),
    [tasks.data],
  );
  const recentSessions = useMemo(
    () =>
      [...(sessions.data ?? [])]
        .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt))
        .slice(0, 4),
    [sessions.data],
  );
  const healthItems = [
    project.repoKind === 'GIT'
      ? {
          label: 'Git 仓库',
          detail: preflight.data?.git?.branch
            ? `${preflight.data.git.branch}${preflight.data.git.dirty ? ' · 有未提交变更' : ' · 工作区干净'}`
            : '已识别 Git 仓库',
          ok: preflight.data?.git?.detected !== false && !preflight.error,
        }
      : null,
    agents.data
      ? {
          label: 'Agent 可用',
          detail: `${agents.data.filter((agent) => agent.status === 'READY' && agent.enabled).length} 个已就绪`,
          ok: agents.data.some((agent) => agent.status === 'READY' && agent.enabled),
        }
      : null,
    preflight.data
      ? {
          label: '项目目录',
          detail: preflight.data.status === 'READY' ? '路径与权限检查通过' : '需要处理目录检查',
          ok: preflight.data.status === 'READY',
        }
      : null,
  ].filter((item): item is { label: string; detail: string; ok: boolean } => Boolean(item));
  return (
    <div className={projectsStyles.overviewGrid}>
      <AhSurface className={`${projectsStyles.overviewPanel} ${projectsStyles.overviewPanelWide}`}>
        <div className={projectsStyles.panelHeader}>
          <div>
            <h3>正在进行</h3>
            <p>当前项目中的活跃工作。</p>
          </div>
          <Link to={`/projects/${project.id}/work`}>查看工作 →</Link>
        </div>
        <div className={projectsStyles.overviewList}>
          {activeTasks.map((task) => {
            const agent = task.assignedAgentId ? agentById.get(task.assignedAgentId) : undefined;
            return (
              <Link
                className={projectsStyles.overviewWorkRow}
                key={task.id}
                to={`/projects/${project.id}/work?task=${task.id}`}
              >
                <span
                  className={`${projectsStyles.workStateDot} ${taskStateClass(task.status)}`}
                  aria-hidden="true"
                />
                <span className={projectsStyles.overviewCopy}>
                  <strong>{task.title}</strong>
                  <small>
                    {agent?.name ?? '尚未分配 Agent'}
                    {task.branch ? ` · ${task.branch}` : ''} · {displayDate(task.updatedAt)}
                  </small>
                </span>
                <AhStatusPill status={task.status} />
              </Link>
            );
          })}
          {!tasks.isLoading && !activeTasks.length ? (
            <AhEmptyState
              compact
              title="没有进行中的 Work"
              description="从 Work 创建并开始一项工作。"
              action={
                <Link to={`/projects/${project.id}/work/new`}>
                  <AhButton size="sm">新建工作</AhButton>
                </Link>
              }
            />
          ) : null}
        </div>
      </AhSurface>
      <AhSurface
        className={`${projectsStyles.overviewPanel} ${projectsStyles.overviewPanelNarrow}`}
      >
        <div className={projectsStyles.panelHeader}>
          <div>
            <h3>项目状态</h3>
            <p>当前环境与 Agent 可用性。</p>
          </div>
        </div>
        <div className={projectsStyles.healthStack}>
          {healthItems.map((item) => (
            <div className={projectsStyles.healthRow} key={item.label}>
              <span
                className={`${projectsStyles.healthMark} ${item.ok ? '' : projectsStyles.healthMarkWarning}`}
                aria-hidden="true"
              >
                {item.ok ? '✓' : '!'}
              </span>
              <span className={projectsStyles.healthCopy}>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </div>
          ))}
          {!healthItems.length ? (
            <AhEmptyState
              compact
              title="状态信息暂不可用"
              description="完成一次项目预检后会在这里显示。"
            />
          ) : null}
        </div>
      </AhSurface>
      <AhSurface
        className={`${projectsStyles.overviewPanel} ${projectsStyles.overviewPanelBottomNarrow}`}
      >
        <div className={projectsStyles.panelHeader}>
          <div>
            <h3>最近会话</h3>
            <p>继续上一次对话或代码审阅。</p>
          </div>
          <Link to={`/projects/${project.id}/sessions`}>全部会话 →</Link>
        </div>
        <div className={projectsStyles.overviewList}>
          {recentSessions.map((session) => {
            const agent = agentById.get(session.agentId);
            return (
              <Link
                className={projectsStyles.overviewSessionRow}
                key={session.id}
                to={`/workspace/${session.id}`}
              >
                <span className={projectsStyles.agentAvatar} aria-hidden="true">
                  {agent?.name?.slice(0, 1).toUpperCase() ?? 'A'}
                </span>
                <span className={projectsStyles.overviewCopy}>
                  <strong>{session.title}</strong>
                  <small>
                    {agent?.name ?? 'Agent'}
                    {session.model ? ` · ${session.model}` : ''} ·{' '}
                    {displayDate(session.lastActiveAt)}
                  </small>
                </span>
                <AhStatusPill status={session.status} />
              </Link>
            );
          })}
          {!sessions.isLoading && !recentSessions.length ? (
            <AhEmptyState
              compact
              title="还没有 Session"
              description="从 Work 创建第一项工作，再选择 Agent 运行。"
            />
          ) : null}
        </div>
      </AhSurface>
      <AhSurface
        className={`${projectsStyles.overviewPanel} ${projectsStyles.overviewPanelBottom}`}
      >
        <div className={projectsStyles.panelHeader}>
          <div>
            <h3>Review Queue</h3>
            <p>需要你做决策的工作结果。</p>
          </div>
          <Link to={`/projects/${project.id}/work?status=WAITING_REVIEW`}>全部审阅 →</Link>
        </div>
        <div className={projectsStyles.overviewList}>
          {reviewTasks.map((task) => (
            <Link
              className={projectsStyles.reviewQueueRow}
              key={task.id}
              to={`/projects/${project.id}/work?task=${task.id}`}
            >
              <span className={projectsStyles.reviewMark} aria-hidden="true">
                ✓
              </span>
              <span className={projectsStyles.overviewCopy}>
                <strong>{task.title}</strong>
                <small>
                  {task.branch ?? '尚未创建分支'} · {displayDate(task.updatedAt)}
                </small>
              </span>
              <span className={projectsStyles.reviewAction}>查看结果</span>
            </Link>
          ))}
          {!tasks.isLoading && !reviewTasks.length ? (
            <AhEmptyState
              compact
              title="没有待审阅结果"
              description="Agent 完成工作后，会在这里等待你的决策。"
            />
          ) : null}
        </div>
      </AhSurface>
    </div>
  );
}

export function ProjectWorkPageV07() {
  const project = useProjectContext();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedFromQuery = searchParams.get('task');
  const selectedAgentFromQuery = searchParams.get('agentId');
  const selectedPromptId = searchParams.get('promptId');
  const statusFromQuery = searchParams.get('status');
  const view = searchParams.get('view') === 'board' ? 'board' : 'list';
  const tasks = useQuery({
    queryKey: ['tasks', project.id],
    queryFn: () => api.get<TaskRecord[]>(`/tasks?projectId=${project.id}`),
  });
  const goals = useQuery({
    queryKey: ['goals', project.id],
    queryFn: () => api.get<GoalRecord[]>(`/goals?projectId=${project.id}`),
  });
  const worktrees = useQuery({
    queryKey: ['worktrees', project.id],
    queryFn: () =>
      api.get<WorktreeExecutionRecord[]>(`/worktree-executions?projectId=${project.id}`),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const prompts = useQuery({
    queryKey: ['prompts', project.id],
    queryFn: () => api.get<PromptRecord[]>(`/prompts?projectId=${project.id}`),
  });
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(statusFromQuery ?? 'all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(selectedFromQuery ?? '');
  const [runAgentId, setRunAgentId] = useState(selectedAgentFromQuery ?? '');
  useEffect(() => {
    if (selectedFromQuery && tasks.data?.some((task) => task.id === selectedFromQuery))
      setSelectedId(selectedFromQuery);
  }, [selectedFromQuery, tasks.data]);
  useEffect(() => {
    if (!selectedId && tasks.data?.[0]) setSelectedId(tasks.data[0].id);
  }, [selectedId, tasks.data]);
  useEffect(() => {
    if (selectedAgentFromQuery) setRunAgentId(selectedAgentFromQuery);
  }, [selectedAgentFromQuery]);
  useEffect(() => {
    if (statusFromQuery) setStatusFilter(statusFromQuery);
  }, [statusFromQuery]);
  const filteredTasks = useMemo(() => {
    const value = query.trim().toLowerCase();
    return (tasks.data ?? []).filter((task) => {
      const agent = task.assignedAgentId
        ? agents.data?.find((item) => item.id === task.assignedAgentId)
        : undefined;
      return (
        (!value || `${task.title} ${task.description ?? ''}`.toLowerCase().includes(value)) &&
        (statusFilter === 'all' || task.status === statusFilter) &&
        (agentFilter === 'all' ||
          task.assignedAgentId === agentFilter ||
          agent?.name === agentFilter)
      );
    });
  }, [agentFilter, agents.data, query, statusFilter, tasks.data]);
  const selected =
    filteredTasks.find((task) => task.id === selectedId) ??
    tasks.data?.find((task) => task.id === selectedId) ??
    filteredTasks[0] ??
    tasks.data?.[0];
  const selectedAgent = agents.data?.find(
    (agent) => agent.id === (runAgentId || selected?.assignedAgentId),
  );
  const selectedPrompt = prompts.data?.find((prompt) => prompt.id === selectedPromptId);
  const selectedWorktree = selected
    ? worktrees.data?.find((item) => item.taskId === selected.id)
    : undefined;
  const taskStatuses = useMemo(
    () => Array.from(new Set((tasks.data ?? []).map((task) => task.status))),
    [tasks.data],
  );
  const readyAgents = (agents.data ?? []).filter(
    (agent) => agent.status === 'READY' && agent.enabled,
  );
  const boardColumns: Array<{ status: TaskRecord['status']; label: string }> = [
    { status: 'BACKLOG', label: '待排期' },
    { status: 'READY', label: '待开始' },
    { status: 'IN_PROGRESS', label: '进行中' },
    { status: 'WAITING_REVIEW', label: '待审阅' },
    { status: 'BLOCKED', label: '已阻塞' },
    { status: 'DONE', label: '已完成' },
    { status: 'CANCELED', label: '已取消' },
  ];
  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskRecord['status'] }) =>
      api.post(`/tasks/${id}/transition`, { status }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['tasks', project.id] }),
  });
  const start = useMutation({
    mutationFn: async ({ id, agentId }: { id: string; agentId: string }) => {
      if (selected?.status === 'BACKLOG')
        await api.post(`/tasks/${id}/transition`, { status: 'READY' });
      return api.post<{ session: { id: string } }>(`/tasks/${id}/start`, { agentId });
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['tasks', project.id] });
      void client.invalidateQueries({ queryKey: ['sessions', project.id] });
      navigate(`/workspace/${result.session.id}`);
    },
  });
  const setWorkView = (nextView: 'list' | 'board') => {
    const next = new URLSearchParams(searchParams);
    if (nextView === 'board') next.set('view', 'board');
    else next.delete('view');
    setSearchParams(next);
  };
  const selectTask = (task: TaskRecord) => {
    setSelectedId(task.id);
    const next = new URLSearchParams(searchParams);
    next.set('task', task.id);
    setSearchParams(next, { replace: true });
  };
  const acceptanceCriteria =
    selected?.acceptanceCriteria
      ?.split(/\r?\n/)
      .map((item) => item.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean) ?? [];
  const workError = tasks.error ?? goals.error ?? worktrees.error;
  return (
    <div className={projectsStyles.workPage}>
      <QueryMessage
        loading={tasks.isLoading || goals.isLoading || worktrees.isLoading}
        error={workError}
        retry={() => {
          void tasks.refetch();
          void goals.refetch();
          void worktrees.refetch();
        }}
        label="正在加载 Work"
      />
      {!tasks.isLoading && !workError ? (
        <>
          <div className={projectsStyles.workToolbar} aria-label="工作筛选">
            <div
              className={`${projectsStyles.segmented} ${projectsStyles.viewSwitch}`}
              role="group"
              aria-label="工作视图"
            >
              <button
                type="button"
                className={`${projectsStyles.segmentedButton} ${view === 'list' ? projectsStyles.segmentedButtonActive : ''}`}
                aria-pressed={view === 'list'}
                onClick={() => setWorkView('list')}
              >
                列表
              </button>
              <button
                type="button"
                className={`${projectsStyles.segmentedButton} ${view === 'board' ? projectsStyles.segmentedButtonActive : ''}`}
                aria-pressed={view === 'board'}
                onClick={() => setWorkView('board')}
              >
                看板
              </button>
            </div>
            <div className={projectsStyles.toolbarSearch}>
              <AhInput
                label=""
                aria-label="搜索工作"
                placeholder="搜索工作…"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                leftSection={<Search size={15} />}
              />
            </div>
            <div className={projectsStyles.toolbarSelect}>
              <AhSelect
                aria-label="工作状态"
                label=""
                value={statusFilter}
                onChange={(value) => setStatusFilter(value ?? 'all')}
                data={[
                  { value: 'all', label: '全部状态' },
                  ...taskStatuses.map((value) => ({ value, label: domainStatusLabel(value) })),
                ]}
              />
            </div>
            <div className={projectsStyles.toolbarSelect}>
              <AhSelect
                aria-label="工作 Agent"
                label=""
                value={agentFilter}
                onChange={(value) => setAgentFilter(value ?? 'all')}
                data={[
                  { value: 'all', label: '全部 Agent' },
                  ...(agents.data ?? []).map((agent) => ({ value: agent.id, label: agent.name })),
                ]}
              />
            </div>
            <span className={projectsStyles.toolbarSpacer} />
            <span className={projectsStyles.toolbarCount}>
              {goals.data?.length ?? 0} 个 Goal · {filteredTasks.length} 个 Work
            </span>
          </div>
          {view === 'board' ? (
            <div className={projectsStyles.board} aria-label="工作看板">
              {boardColumns.map((column) => {
                const columnTasks = filteredTasks.filter((task) => task.status === column.status);
                return (
                  <section className={projectsStyles.boardColumn} key={column.status}>
                    <header className={projectsStyles.boardColumnHeader}>
                      <span>{column.label}</span>
                      <span>{columnTasks.length}</span>
                    </header>
                    <div className={projectsStyles.boardColumnBody}>
                      {columnTasks.map((task) => (
                        <button
                          type="button"
                          className={projectsStyles.boardCard}
                          key={task.id}
                          onClick={() => {
                            selectTask(task);
                            setWorkView('list');
                          }}
                        >
                          <strong>{task.title}</strong>
                          <small>
                            {task.priority ? `P${task.priority}` : ''}
                            {task.assignedAgentId
                              ? ` · ${(agents.data ?? []).find((agent) => agent.id === task.assignedAgentId)?.name ?? '已分配 Agent'}`
                              : ''}
                          </small>
                        </button>
                      ))}
                      {!columnTasks.length ? <span className={styles.subtle}>暂无工作</span> : null}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className={projectsStyles.workLayout}>
              <section className={projectsStyles.workListPanel} aria-label="工作列表">
                <div className={projectsStyles.workListHeader}>
                  <span aria-hidden="true" />
                  <span>工作</span>
                  <span>优先级</span>
                  <span>Agent</span>
                  <span>状态</span>
                  <span>更新</span>
                </div>
                {filteredTasks.map((task) => {
                  const agent = task.assignedAgentId
                    ? agents.data?.find((item) => item.id === task.assignedAgentId)
                    : undefined;
                  return (
                    <button
                      type="button"
                      className={`${projectsStyles.workRow} ${task.id === selected?.id ? projectsStyles.workRowSelected : ''}`}
                      key={task.id}
                      onClick={() => selectTask(task)}
                    >
                      <span
                        className={`${projectsStyles.workStateDotSmall} ${taskStateClass(task.status)}`}
                        aria-hidden="true"
                      />
                      <span className={projectsStyles.workRowMain}>
                        <strong>{task.title}</strong>
                        <small>{task.description ?? '暂无说明'}</small>
                      </span>
                      <span className={projectsStyles.priorityChip}>
                        {task.priority ? `P${task.priority}` : '—'}
                      </span>
                      <span className={projectsStyles.agentChip}>{agent?.name ?? '未分配'}</span>
                      <AhStatusPill status={task.status} />
                      <span className={projectsStyles.workUpdated}>
                        {displayDate(task.updatedAt)}
                      </span>
                    </button>
                  );
                })}
                {!filteredTasks.length ? (
                  <div className={projectsStyles.emptyPanel}>
                    <AhEmptyState
                      title={
                        query || statusFilter !== 'all' || agentFilter !== 'all'
                          ? '没有匹配的工作'
                          : '还没有 Work'
                      }
                      description={
                        query || statusFilter !== 'all' || agentFilter !== 'all'
                          ? '尝试调整筛选条件。'
                          : '先描述一项工作，系统会建立 Goal/Task 上下文。'
                      }
                      action={
                        !query && statusFilter === 'all' && agentFilter === 'all' ? (
                          <Link to={`/projects/${project.id}/work/new`}>
                            <AhButton>新建工作</AhButton>
                          </Link>
                        ) : undefined
                      }
                    />
                  </div>
                ) : null}
              </section>
              <aside className={projectsStyles.workInspector} aria-label="工作 Inspector">
                {selected ? (
                  <>
                    <header className={projectsStyles.inspectorHeader}>
                      <AhStatusPill status={selected.status} />
                      <h2>{selected.title}</h2>
                      {selected.description ? <p>{selected.description}</p> : null}
                    </header>
                    {acceptanceCriteria.length ? (
                      <section className={projectsStyles.inspectorSection}>
                        <h4>验收标准</h4>
                        <ul className={projectsStyles.criteriaList}>
                          {acceptanceCriteria.map((criterion) => (
                            <li key={criterion}>{criterion}</li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                    <section className={projectsStyles.inspectorSection}>
                      <h4>执行</h4>
                      <AhSelect
                        aria-label="运行 Agent"
                        label=""
                        value={runAgentId || selected.assignedAgentId || ''}
                        onChange={(value) => setRunAgentId(value ?? '')}
                        data={readyAgents.map((agent) => ({
                          value: agent.id,
                          label: agent.name,
                        }))}
                        placeholder="选择可用 Agent"
                      />
                      <div className={projectsStyles.runSummary}>
                        <span className={projectsStyles.agentAvatar} aria-hidden="true">
                          {selectedAgent?.name?.slice(0, 1).toUpperCase() ?? 'A'}
                        </span>
                        <span>
                          <strong>{selectedAgent?.name ?? '尚未选择 Agent'}</strong>
                          <small>
                            {selected.branch ?? selectedWorktree?.taskBranch ?? '尚未创建分支'}
                          </small>
                        </span>
                      </div>
                      {selectedWorktree ? <AhStatusPill status={selectedWorktree.status} /> : null}
                    </section>
                    {selectedWorktree?.errorMessage ? (
                      <section className={projectsStyles.inspectorSection}>
                        <h4>需要处理</h4>
                        <p>{selectedWorktree.errorMessage}</p>
                      </section>
                    ) : null}
                    <section className={projectsStyles.inspectorSection}>
                      <h4>执行信息</h4>
                      <p>分支：{selected.branch ?? selectedWorktree?.taskBranch ?? '尚未创建'}</p>
                      <p>
                        Session：
                        {selected.sessionId ? (
                          <Link className={styles.link} to={`/workspace/${selected.sessionId}`}>
                            打开 Workspace
                          </Link>
                        ) : (
                          '尚未开始'
                        )}
                      </p>
                      {selectedPrompt ? (
                        <p>
                          Prompt：{selectedPrompt.name} · {labelPromptType(selectedPrompt.type)}
                        </p>
                      ) : null}
                    </section>
                    <div className={projectsStyles.inspectorActions}>
                      <AhButton
                        size="xs"
                        variant="light"
                        onClick={() =>
                          runAgentId
                            ? start.mutate({ id: selected.id, agentId: runAgentId })
                            : transition.mutate({ id: selected.id, status: 'IN_PROGRESS' })
                        }
                        loading={transition.isPending || start.isPending}
                        disabled={
                          ['IN_PROGRESS', 'WAITING_REVIEW', 'DONE', 'CANCELED'].includes(
                            selected.status,
                          ) ||
                          (!runAgentId && selected.status !== 'BACKLOG')
                        }
                      >
                        <Play size={14} /> {runAgentId ? '启动 Session' : '开始'}
                      </AhButton>
                      <AhButton
                        size="xs"
                        variant="default"
                        onClick={() => transition.mutate({ id: selected.id, status: 'CANCELED' })}
                        loading={transition.isPending}
                        disabled={selected.status === 'DONE' || selected.status === 'CANCELED'}
                      >
                        <CircleStop size={14} /> 取消
                      </AhButton>
                    </div>
                  </>
                ) : (
                  <div className={projectsStyles.emptyPanel}>
                    <AhEmptyState
                      compact
                      title="从列表选择工作"
                      description="选择一项 Work 后查看执行与 Review。"
                    />
                  </div>
                )}
              </aside>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

export function NewWorkPageV07() {
  const project = useProjectContext();
  const navigate = useNavigate();
  const compact = useCompactViewport();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [intent, setIntent] = useState('');
  const [kind, setKind] = useState<'goal' | 'task'>('task');
  const [goalId, setGoalId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [promptId, setPromptId] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const goals = useQuery({
    queryKey: ['goals', project.id],
    queryFn: () => api.get<GoalRecord[]>(`/goals?projectId=${project.id}`),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const prompts = useQuery({
    queryKey: ['prompts', project.id],
    queryFn: () => api.get<PromptRecord[]>(`/prompts?projectId=${project.id}`),
  });
  useEffect(() => {
    if (!agentId) setAgentId(agents.data?.find((agent) => agent.status === 'READY')?.id ?? '');
  }, [agentId, agents.data]);
  const selectedAgent = agents.data?.find((agent) => agent.id === agentId);
  const selectedPrompt = prompts.data?.find((prompt) => prompt.id === promptId);
  const contextQuery = () =>
    new URLSearchParams({
      ...(agentId ? { agentId } : {}),
      ...(promptId ? { promptId } : {}),
    }).toString();
  const createGoal = useMutation({
    mutationFn: () =>
      api.post<GoalRecord>('/goals', {
        projectId: project.id,
        title: title.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: (goal) => {
      const query = contextQuery();
      navigate(`/projects/${project.id}/work?goal=${goal.id}${query ? `&${query}` : ''}`);
    },
  });
  const createTask = useMutation({
    mutationFn: async () => {
      const task = await api.post<TaskRecord>('/tasks', {
        projectId: project.id,
        goalId: goalId || undefined,
        title: title.trim(),
        description: description.trim() || undefined,
        priority: 2,
      });
      if (!agentId) return { task, sessionId: undefined };
      if (task.status === 'BACKLOG')
        await api.post(`/tasks/${task.id}/transition`, { status: 'READY' });
      const started = await api.post<{ session: { id: string } }>(`/tasks/${task.id}/start`, {
        agentId,
      });
      return { task, sessionId: started.session.id };
    },
    onSuccess: ({ task, sessionId }) => {
      const query = contextQuery();
      navigate(
        sessionId
          ? `/workspace/${sessionId}`
          : `/projects/${project.id}/work?task=${task.id}${query ? `&${query}` : ''}`,
      );
    },
  });
  const workError = createGoal.error ?? createTask.error;
  const close = () => navigate(`/projects/${project.id}/work`);
  const quickIntents = ['Bug', 'Feature', 'Refactor', 'Research'];
  return (
    <>
      <ProjectWorkPageV07 />
      <AhDialog
        open
        onClose={close}
        title="描述一项工作"
        description="先表达结果，再选择推荐 Agent。创建并开始后会直接进入 Workspace。"
        size={720}
        fullScreen={compact}
        actions={
          <>
            <AhButton variant="default" onClick={close}>
              取消
            </AhButton>
            <AhButton
              onClick={() => (kind === 'goal' ? createGoal.mutate() : createTask.mutate())}
              loading={createGoal.isPending || createTask.isPending}
              disabled={!title.trim()}
            >
              {kind === 'goal' ? '创建 Goal' : '创建并开始'}
            </AhButton>
          </>
        }
      >
        <div className={styles.dialogBody} data-testid="new-work-dialog">
          <div className={styles.dialogContext}>
            <span>当前 Project</span>
            <strong>{project.name}</strong>
            <code title={project.rootPath}>{project.rootPath}</code>
          </div>
          <AhTextarea
            label="你想完成什么？"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            placeholder="例如：修复登录流程并补齐回归测试"
            required
            minRows={5}
          />
          <div className={styles.quickIntents} aria-label="快速意图">
            <span className={styles.subtle}>快速意图（可选）</span>
            {quickIntents.map((value) => (
              <AhButton
                key={value}
                size="xs"
                variant={intent === value ? 'light' : 'default'}
                aria-pressed={intent === value}
                onClick={() => {
                  setIntent(value);
                  if (!title.trim()) setTitle(`${value}：`);
                }}
              >
                {value}
              </AhButton>
            ))}
          </div>
          <AhTextarea
            label="补充上下文（可选）"
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
            placeholder="验收标准、约束或参考资料"
            minRows={3}
          />
          <AhSelect
            label="推荐 Agent"
            value={agentId}
            onChange={(value) => setAgentId(value ?? '')}
            data={(agents.data ?? [])
              .filter((agent) => agent.status === 'READY')
              .map((agent) => ({
                value: agent.id,
                label: `${agent.name} · ${agent.detectedVersion ?? '版本待检测'}`,
              }))}
            placeholder="稍后在 Work Inspector 中选择"
          />
          <div className={styles.mutedBox}>
            {selectedAgent ? (
              <>
                <strong>{selectedAgent.name} 可用</strong>
                <div>创建后会用这个 Agent 启动 Session，并把实时事件带入 Workspace。</div>
              </>
            ) : (
              '还没有选择 Agent；创建后仍可在 Work Inspector 中选择并开始。'
            )}
          </div>
          <details
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            className={styles.dialogDetails}
          >
            <summary>高级设置</summary>
            <div className={styles.dialogSection}>
              <div className={styles.actions}>
                <AhButton
                  size="xs"
                  variant={kind === 'task' ? 'light' : 'default'}
                  onClick={() => setKind('task')}
                >
                  Task
                </AhButton>
                <AhButton
                  size="xs"
                  variant={kind === 'goal' ? 'light' : 'default'}
                  onClick={() => setKind('goal')}
                >
                  Goal
                </AhButton>
              </div>
              {kind === 'task' ? (
                <AhSelect
                  label="所属 Goal（可选）"
                  value={goalId}
                  onChange={(value) => setGoalId(value ?? '')}
                  data={(goals.data ?? []).map((goal) => ({ value: goal.id, label: goal.title }))}
                  placeholder="选择已有 Goal"
                  mt="md"
                />
              ) : null}
              <AhSelect
                label="PromptOS 资产（可选）"
                value={promptId}
                onChange={(value) => setPromptId(value ?? '')}
                data={(prompts.data ?? []).map((prompt) => ({
                  value: prompt.id,
                  label: `${prompt.name} · ${labelPromptKind(prompt.kind)}`,
                }))}
                placeholder="使用 Project Binding"
                mt="md"
              />
              <p className={styles.subtle}>
                {selectedPrompt
                  ? `已选择 ${selectedPrompt.name}（${labelPromptType(selectedPrompt.type)}）。`
                  : '未选择时按当前 Project / Task Binding 解析 Prompt。'}
              </p>
            </div>
          </details>
          {workError ? (
            <AhErrorState title="创建或启动失败" description={workError.message} />
          ) : null}
        </div>
      </AhDialog>
    </>
  );
}

export function ProjectSessionsPageV07() {
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
  const [newOpen, setNewOpen] = useState(false);
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
      setNewOpen(false);
      navigate(`/workspace/${session.id}`);
    },
  });
  const filteredSessions = useMemo(() => {
    const value = query.trim().toLowerCase();
    return (sessions.data ?? [])
      .filter((session) => {
        return (
          (!value ||
            `${session.title} ${session.model ?? ''} ${session.branch ?? ''} ${session.cwd}`
              .toLowerCase()
              .includes(value)) &&
          (agentFilter === 'all' || session.agentId === agentFilter) &&
          (statusFilter === 'all' || session.status === statusFilter)
        );
      })
      .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt));
  }, [agentFilter, agents.data, query, sessions.data, statusFilter]);
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
        <div className={styles.actions} style={{ marginTop: 20 }}>
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

export function AgentCenterPageV07() {
  const client = useQueryClient();
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const candidates = useQuery({
    queryKey: ['discovery-agents'],
    queryFn: () => api.get<AgentCandidateRecord[]>('/discovery/agents'),
  });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const adopt = useMutation({
    mutationFn: (candidateId: string) =>
      api.post(`/discovery/agents/${encodeURIComponent(candidateId)}/adopt`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['agents'] });
      void client.invalidateQueries({ queryKey: ['discovery-agents'] });
    },
  });
  const filteredAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (agents.data ?? []).filter((agent) => {
      const matchesQuery =
        !normalized ||
        `${agent.name} ${agent.agentKind} ${agent.detectedVersion ?? ''}`
          .toLowerCase()
          .includes(normalized);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'ready' && agent.status === 'READY') ||
        (filter === 'attention' && agent.status !== 'READY');
      return matchesQuery && matchesFilter;
    });
  }, [agents.data, filter, query]);
  const capabilitiesFor = (agent: AgentRecord) => {
    const labels: Record<string, string> = {
      session: 'Session',
      sessions: 'Sessions',
      run: 'Run',
      runs: 'Runs',
      approval: 'Approval',
      approvals: 'Approval',
      files: '文件',
      terminal: 'Terminal',
      git: 'Git',
    };
    const keys = Object.keys(agent.capabilitiesJson ?? {})
      .filter((key) => Boolean(agent.capabilitiesJson[key]))
      .map((key) => labels[key.toLowerCase()] ?? '')
      .filter(Boolean);
    return Array.from(new Set(['Session', 'Run', ...keys])).slice(0, 4);
  };
  const agentKindLabel = (kind: string) =>
    ({ CODEX: 'Codex', CLAUDE_CODE: 'Claude Code', OPENCLAW: 'OpenClaw' })[kind] ?? 'Agent';
  return (
    <Screen
      eyebrow="AGENTS"
      title="Agent 中心"
      description="发现、管理和配置 AI Agent，让多个 Agent 协同工作。底层实现细节只在 Diagnostics 中展开。"
      actions={
        <>
          <Link to="/agents/runtimes">
            <AhButton variant="default" leftSection={<Server size={16} />}>
              Runtime
            </AhButton>
          </Link>
          <Link to="/agents/agents/discover">
            <AhButton leftSection={<RefreshCw size={16} />}>发现 Agent</AhButton>
          </Link>
        </>
      }
    >
      <div className={styles.metrics}>
        <div className={styles.metric}>
          <AhMetric
            label="已就绪"
            value={agents.data?.filter((agent) => agent.status === 'READY').length ?? '—'}
            tone="success"
          />
        </div>
        <div className={styles.metric}>
          <AhMetric
            label="需要处理"
            value={
              (candidates.data ?? []).filter((candidate) => candidate.state !== 'READY').length
            }
            tone="warning"
          />
        </div>
        <div className={styles.metric}>
          <AhMetric label="能力" value="Session / Run" hint="按 Agent capability 呈现" />
        </div>
        <div className={styles.metric}>
          <AhMetric
            label="诊断"
            value={
              <Link className={styles.link} to="/agents/diagnostics">
                查看
              </Link>
            }
          />
        </div>
      </div>
      <AhSurface>
        <div className={styles.toolbar}>
          <AhInput
            label=""
            aria-label="搜索 Agent"
            placeholder="搜索名称或版本"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            leftSection={<Search size={15} />}
          />
          <AhSelect
            aria-label="Agent 筛选"
            label=""
            value={filter}
            onChange={(value) => setFilter(value ?? 'all')}
            data={[
              { value: 'all', label: '全部' },
              { value: 'ready', label: '已接入' },
              { value: 'attention', label: '需要处理' },
            ]}
          />
        </div>
        <div className={styles.surfaceHeader}>
          <div>
            <h3>已接入 Agent</h3>
            <p>每个身份都可以被 Project Work 选择。</p>
          </div>
          <Link className={styles.link} to="/agents/diagnostics">
            健康诊断
          </Link>
        </div>
        <div className={styles.agentCards}>
          {filteredAgents.map((agent) => (
            <article className={styles.agentCard} key={agent.id}>
              <div className={styles.agentCardHeader}>
                <span className={styles.agentMark}>
                  <Bot size={22} />
                </span>
                <div className={styles.rowMain}>
                  <h3>{agent.name}</h3>
                  <p>
                    {agentKindLabel(agent.agentKind)} · {agent.detectedVersion ?? '版本待检测'}
                  </p>
                </div>
                <AhStatusPill status={agent.status} />
              </div>
              <p className={styles.agentDescription}>
                可用于 Project Work 与 Coding Workspace 的真实执行身份。
              </p>
              <div className={styles.chipList}>
                {capabilitiesFor(agent).map((capability) => (
                  <span className={styles.chip} key={capability}>
                    {capability}
                  </span>
                ))}
              </div>
              <div className={styles.agentCardFooter}>
                <span>{agent.enabled ? '已启用' : '已停用'}</span>
                <span>{agent.defaultModel ?? 'Session 中选择模型'}</span>
              </div>
            </article>
          ))}
          {!agents.isLoading && !filteredAgents.length ? (
            <AhEmptyState
              title={query || filter !== 'all' ? '没有匹配的 Agent' : '还没有接入 Agent'}
              description="扫描本机或运行环境以发现可用 Agent。"
              action={
                <Link to="/agents/agents/discover">
                  <AhButton>开始发现</AhButton>
                </Link>
              }
            />
          ) : null}
        </div>
      </AhSurface>
      <AhSurface>
        <div className={styles.surfaceHeader}>
          <div>
            <h3>候选 Agent</h3>
            <p>扫描结果会保留部分失败原因，支持逐个接入。</p>
          </div>
        </div>
        <div className={styles.surfaceBody}>
          {(candidates.data ?? [])
            .filter((candidate) => candidate.agentKind !== 'UNKNOWN')
            .map((candidate) => (
              <div className={styles.row} key={candidate.candidateId}>
                <Bot size={19} />
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>{candidate.displayName}</span>
                  <span className={styles.rowMeta}>
                    {candidate.detectedVersion ?? '版本待检测'}
                  </span>
                </div>
                <AhStatusPill status={candidate.state} />
                <AhButton
                  size="xs"
                  onClick={() => adopt.mutate(candidate.candidateId)}
                  loading={adopt.isPending}
                  disabled={!candidate.adoptable}
                >
                  接入
                </AhButton>
              </div>
            ))}
        </div>
      </AhSurface>
    </Screen>
  );
}

export function DiscoverAgentsPageV07() {
  const client = useQueryClient();
  const compact = useCompactViewport();
  const candidates = useQuery({
    queryKey: ['discovery-agents'],
    queryFn: () => api.get<AgentCandidateRecord[]>('/discovery/agents'),
  });
  const rescan = useMutation({
    mutationFn: () => api.post('/discovery/agents/rescan'),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-agents'] }),
  });
  const adopt = useMutation({
    mutationFn: (id: string) => api.post(`/discovery/agents/${encodeURIComponent(id)}/adopt`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-agents'] }),
  });
  const visibleCandidates = (candidates.data ?? []).filter(
    (candidate) => candidate.agentKind !== 'UNKNOWN',
  );
  const sourceCount = (prefix: string) =>
    visibleCandidates.filter((candidate) =>
      (candidate.targetCandidateId ?? '').toLowerCase().startsWith(prefix),
    ).length;
  const sources = [
    {
      label: 'Local Host',
      hint: '本机已授权目录',
      count: sourceCount('host') + sourceCount('local'),
    },
    { label: 'Remote Nodes', hint: '已连接的远程设备', count: sourceCount('remote') },
    { label: 'NAS Docker', hint: '已发现的容器运行环境', count: sourceCount('docker') },
  ];
  const candidateAction = (candidate: AgentCandidateRecord) => {
    if (candidate.adoptable)
      return (
        <AhButton
          size="xs"
          onClick={() => adopt.mutate(candidate.candidateId)}
          loading={adopt.isPending}
        >
          {candidate.state === 'AUTH_REQUIRED' ? '去授权' : '添加'}
        </AhButton>
      );
    if (candidate.state === 'STOPPED')
      return (
        <Link className={styles.rowAction} to="/agents/runtimes">
          查看 Runtime
        </Link>
      );
    if (candidate.state === 'MISSING_DEPENDENCY')
      return (
        <Link className={styles.rowAction} to="/agents/diagnostics">
          查看诊断
        </Link>
      );
    return null;
  };
  return (
    <>
      <AgentCenterPageV07 />
      <AhDialog
        open
        onClose={() => window.history.back()}
        title="发现 Agent"
        description="扫描 → 候选 → 接入 → preflight → Ready，每一步都保留可恢复的状态。"
        size={960}
        fullScreen={compact}
        actions={
          <>
            <AhButton variant="default" onClick={() => window.history.back()}>
              完成
            </AhButton>
            <AhButton
              onClick={() => rescan.mutate()}
              loading={rescan.isPending}
              leftSection={<RefreshCw size={16} />}
            >
              重新扫描
            </AhButton>
          </>
        }
      >
        <div className={styles.discoveryDialog} data-testid="discover-agents-dialog">
          <section className={styles.discoveryScanner} aria-label="扫描进度">
            <div className={styles.scannerOrb}>
              <ScanSearch size={32} />
            </div>
            <span className={styles.eyebrow}>Agent Discovery</span>
            <h3>
              {rescan.isPending || candidates.isFetching ? '正在扫描可用 Agent' : '扫描已完成'}
            </h3>
            <p>只读取已授权的本机、Remote Node 和 NAS Docker 来源，不会静默修改认证或配置。</p>
            <div className={styles.discoveryStats}>
              <div>
                <strong>{visibleCandidates.length}</strong>
                <span>发现</span>
              </div>
              <div>
                <strong>
                  {visibleCandidates.filter((candidate) => candidate.state === 'READY').length}
                </strong>
                <span>可添加</span>
              </div>
              <div>
                <strong>
                  {
                    visibleCandidates.filter((candidate) => candidate.state === 'AUTH_REQUIRED')
                      .length
                  }
                </strong>
                <span>需授权</span>
              </div>
            </div>
            <div className={styles.mutedBox}>
              隐私提示：扫描只返回 AgentHub 支持的 Profile；原始 executable、adapter 和 container
              identity 仅在 Diagnostics 展开。
            </div>
          </section>
          <section className={styles.discoveryResults} aria-label="来源与候选 Agent">
            <div className={styles.sourceList}>
              {sources.map((source) => (
                <div className={styles.sourceRow} key={source.label}>
                  <span className={styles.sourceIcon}>
                    <Server size={16} />
                  </span>
                  <div>
                    <strong>{source.label}</strong>
                    <span>{source.hint}</span>
                  </div>
                  <AhStatusPill status={source.count ? 'READY' : 'UNAVAILABLE'} />
                  <span className={styles.subtle}>{source.count}</span>
                </div>
              ))}
            </div>
            <div className={styles.dialogSection}>
              <div className={styles.surfaceHeader}>
                <div>
                  <h3>候选 Agent</h3>
                  <p>选择要接入的身份，部分失败不会阻塞其它候选。</p>
                </div>
                <span className={styles.subtle}>{visibleCandidates.length} 个</span>
              </div>
              <QueryMessage
                loading={candidates.isLoading}
                error={candidates.error}
                retry={() => void candidates.refetch()}
                label="正在扫描 Agent"
              />
              {!candidates.isLoading && !candidates.error ? (
                <div className={styles.discoveryCandidates}>
                  {visibleCandidates.map((candidate) => (
                    <div className={styles.candidateRow} key={candidate.candidateId}>
                      <span className={styles.candidateMark}>
                        <Bot size={18} />
                      </span>
                      <div className={styles.rowMain}>
                        <strong className={styles.rowTitle}>{candidate.displayName}</strong>
                        <span className={styles.rowMeta}>
                          {candidate.detectedVersion ?? '版本待检测'} ·{' '}
                          {candidate.reasonCode ? '需要处理' : '已识别'}
                        </span>
                      </div>
                      <AhStatusPill status={candidate.state} />
                      {candidateAction(candidate)}
                    </div>
                  ))}
                  {!visibleCandidates.length ? (
                    <AhEmptyState
                      compact
                      title="暂时没有候选 Agent"
                      description="重新扫描会重新读取授权来源。"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </AhDialog>
    </>
  );
}

export function InfrastructurePageV07({ kind }: { kind: 'runtimes' | 'nodes' | 'diagnostics' }) {
  const client = useQueryClient();
  const runtimes = useQuery({
    queryKey: ['discovery-runtimes'],
    queryFn: () => api.get<RuntimeCandidateRecord[]>('/discovery/runtimes'),
    enabled: kind === 'runtimes',
  });
  const nodes = useQuery({
    queryKey: ['remote-nodes'],
    queryFn: () => api.get<RemoteNodeRecord[]>('/remote-nodes'),
    enabled: kind === 'nodes',
  });
  const host = useQuery({
    queryKey: ['host-diagnostics'],
    queryFn: () => api.get<Record<string, unknown>>('/agents/diagnostics/host'),
    enabled: kind === 'diagnostics',
  });
  const rescan = useMutation({
    mutationFn: () => api.post('/discovery/runtimes/rescan'),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-runtimes'] }),
  });
  const adopt = useMutation({
    mutationFn: (id: string) => api.post(`/discovery/runtimes/${encodeURIComponent(id)}/adopt`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-runtimes'] }),
  });
  const lifecycle = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'stop' }) =>
      api.post(`/execution-targets/${id}/${action}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-runtimes'] }),
  });
  const title = kind === 'runtimes' ? 'Runtime' : kind === 'nodes' ? 'Remote Nodes' : 'Diagnostics';
  const description =
    kind === 'runtimes'
      ? '管理本机与 Docker 执行环境，状态反馈与 Agent 可用性保持一致。'
      : kind === 'nodes'
        ? '管理已授权的 Remote Node，注册码只展示一次，撤销需要明确确认。'
        : '先给出面向用户的结论，再按需展开原始诊断信息。';
  return (
    <Screen
      eyebrow="Agent Infrastructure"
      title={title}
      description={description}
      actions={
        kind === 'runtimes' ? (
          <AhButton
            variant="default"
            onClick={() => rescan.mutate()}
            loading={rescan.isPending}
            leftSection={<RefreshCw size={16} />}
          >
            重新扫描
          </AhButton>
        ) : kind === 'nodes' ? (
          <Link to="/agents/nodes/register">
            <AhButton leftSection={<Link2 size={16} />}>授权 Node</AhButton>
          </Link>
        ) : undefined
      }
    >
      {kind === 'runtimes' ? (
        <AhSurface>
          <div className={styles.surfaceBody}>
            <QueryMessage
              loading={runtimes.isLoading}
              error={runtimes.error}
              retry={() => void runtimes.refetch()}
              label="正在扫描运行环境"
            />
            {(runtimes.data ?? []).map((runtime) => (
              <div className={styles.row} key={runtime.candidateId}>
                <Server size={19} />
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>{runtime.displayName}</span>
                  <span className={styles.rowMeta}>
                    {runtime.image ?? 'Local Host'} · {runtime.statusText ?? '状态待确认'}
                  </span>
                </div>
                <AhStatusPill status={runtime.state} />
                {!runtime.targetId && runtime.adoptable ? (
                  <AhButton
                    size="xs"
                    onClick={() => adopt.mutate(runtime.candidateId)}
                    loading={adopt.isPending}
                  >
                    接入
                  </AhButton>
                ) : runtime.targetId && runtime.state === 'STOPPED' ? (
                  <AhButton
                    size="xs"
                    onClick={() => lifecycle.mutate({ id: runtime.targetId!, action: 'start' })}
                    loading={lifecycle.isPending}
                  >
                    <Play size={14} /> 启动
                  </AhButton>
                ) : runtime.targetId &&
                  runtime.state === 'READY' &&
                  runtime.kind === 'DOCKER_CONTAINER' ? (
                  <AhButton
                    size="xs"
                    variant="default"
                    onClick={() => lifecycle.mutate({ id: runtime.targetId!, action: 'stop' })}
                    loading={lifecycle.isPending}
                  >
                    <CircleStop size={14} /> 停止
                  </AhButton>
                ) : null}
              </div>
            ))}
            {!runtimes.isLoading && !runtimes.error && !runtimes.data?.length ? (
              <AhEmptyState
                title="暂时没有可管理的 Runtime"
                description="重新扫描后会显示本机或支持的 Docker 环境。"
              />
            ) : null}
          </div>
        </AhSurface>
      ) : kind === 'nodes' ? (
        <AhSurface>
          <div className={styles.surfaceBody}>
            <QueryMessage
              loading={nodes.isLoading}
              error={nodes.error}
              retry={() => void nodes.refetch()}
              label="正在加载 Remote Nodes"
            />
            {(nodes.data ?? []).map((node) => (
              <div className={styles.row} key={node.id}>
                <Network size={19} />
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>{node.name}</span>
                  <span className={styles.rowMeta}>
                    {node.hostname} · {node.allowedRootsJson.length} 个授权目录 · 最近{' '}
                    {displayDate(node.lastSeenAt)}
                  </span>
                </div>
                <AhStatusPill status={node.status} />
                <Link className={styles.rowAction} to={`/agents/nodes/${node.id}`}>
                  查看
                </Link>
              </div>
            ))}
            {!nodes.isLoading && !nodes.error && !nodes.data?.length ? (
              <AhEmptyState
                title="还没有 Remote Node"
                description="生成一次性注册码并在目标设备运行 Node daemon。"
                action={
                  <Link to="/agents/nodes/register">
                    <AhButton>授权 Node</AhButton>
                  </Link>
                }
              />
            ) : null}
          </div>
        </AhSurface>
      ) : (
        <AhSurface>
          <div className={styles.surfaceHeader}>
            <div>
              <h3>主机诊断</h3>
              <p>高级供应商细节保持在 progressive disclosure 内。</p>
            </div>
            <AhButton
              variant="default"
              size="xs"
              onClick={() => void host.refetch()}
              leftSection={<RefreshCw size={14} />}
            >
              刷新
            </AhButton>
          </div>
          <div className={styles.surfaceBody}>
            <QueryMessage
              loading={host.isLoading}
              error={host.error}
              retry={() => void host.refetch()}
              label="正在读取诊断"
            />
            {host.data ? (
              <>
                <div className={styles.mutedBox}>
                  <strong>结论</strong>
                  <p>
                    {typeof host.data.message === 'string'
                      ? host.data.message
                      : '服务诊断已返回，请展开详细信息。'}
                  </p>
                </div>
                <details>
                  <summary>查看详细诊断</summary>
                  <pre className={styles.codeBlock}>{JSON.stringify(host.data, null, 2)}</pre>
                </details>
              </>
            ) : null}
          </div>
        </AhSurface>
      )}
    </Screen>
  );
}

export function RemoteNodeRegistrationPageV07() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [expiresInMinutes, setExpiresInMinutes] = useState('15');
  const [rootDraft, setRootDraft] = useState('');
  const [roots, setRoots] = useState<string[]>([]);
  const [registration, setRegistration] = useState<RemoteNodeRegistration>();
  const create = useMutation({
    mutationFn: () =>
      api.post<RemoteNodeRegistration>('/remote-nodes/registration-tokens', {
        name: name.trim(),
        allowedRoots: roots,
        expiresInMinutes: Number(expiresInMinutes),
      }),
    onSuccess: setRegistration,
  });
  const addRoot = () => {
    const value = rootDraft.trim();
    if (!value || roots.includes(value)) return;
    setRoots((current) => [...current, value]);
    setRootDraft('');
  };
  return (
    <Screen
      eyebrow="Remote Nodes"
      title="授权 Remote Node"
      description="只授权 Agent 实际需要访问的目录。注册码为一次性凭据，生成后只展示一次。"
      actions={
        <AhButton variant="default" onClick={() => navigate('/agents/nodes')}>
          返回 Nodes
        </AhButton>
      }
    >
      <AhSurface>
        <div className={styles.surfaceBody}>
          {registration ? (
            <div className={styles.stack}>
              <div className={styles.mutedBox}>
                <strong>注册码已生成</strong>
                <p>请在目标设备完成 Node daemon 配置。关闭页面后 token 不会再次显示。</p>
                <pre className={styles.codeBlock}>{registration.token}</pre>
                <AhButton
                  size="sm"
                  leftSection={<Copy size={14} />}
                  onClick={() => void navigator.clipboard?.writeText(registration.token)}
                >
                  复制注册码
                </AhButton>
              </div>
              <div className={styles.mutedBox}>
                <strong>允许目录</strong>
                {registration.allowedRoots.map((root) => (
                  <div className={styles.mono} key={root}>
                    {root}
                  </div>
                ))}
              </div>
              <div className={styles.actions}>
                <AhButton onClick={() => navigate('/agents/nodes')}>完成</AhButton>
              </div>
            </div>
          ) : (
            <div className={styles.stack}>
              <AhInput
                label="Node 名称"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="例如：开发节点"
              />
              <AhSelect
                label="有效期"
                value={expiresInMinutes}
                onChange={(value) => setExpiresInMinutes(value ?? '15')}
                data={[
                  { value: '5', label: '5 分钟' },
                  { value: '15', label: '15 分钟' },
                  { value: '60', label: '1 小时' },
                ]}
              />
              <div>
                <AhInput
                  label="授权目录"
                  value={rootDraft}
                  onChange={(event) => setRootDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addRoot();
                    }
                  }}
                  placeholder="/srv/projects/AgentHub"
                  description="目标设备上的绝对路径。按 Enter 加入授权清单。"
                />
                <div className={styles.actions} style={{ marginTop: 8 }}>
                  {roots.map((root) => (
                    <AhButton
                      key={root}
                      size="xs"
                      variant="default"
                      onClick={() => setRoots((current) => current.filter((item) => item !== root))}
                    >
                      {root} ×
                    </AhButton>
                  ))}
                </div>
              </div>
              {create.error ? <AhErrorState description={create.error.message} /> : null}
              <AhButton
                onClick={() => create.mutate()}
                loading={create.isPending}
                disabled={!name.trim() || roots.length === 0}
              >
                生成一次性注册码
              </AhButton>
            </div>
          )}
        </div>
      </AhSurface>
    </Screen>
  );
}

export function RemoteNodeDetailPageV07() {
  const { nodeId } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const node = useQuery({
    queryKey: ['remote-node-diagnostics', nodeId],
    queryFn: () => api.get<RemoteNodeDiagnostics>(`/remote-nodes/${nodeId}/diagnostics`),
    enabled: Boolean(nodeId),
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const revoke = useMutation({
    mutationFn: () => api.post(`/remote-nodes/${nodeId}/revoke`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['remote-nodes'] });
      navigate('/agents/nodes');
    },
  });
  if (node.isLoading) return <AhLoadingState label="正在读取 Node 诊断" />;
  if (node.error || !node.data)
    return (
      <AhErrorState
        description={node.error?.message ?? 'Remote Node 不存在'}
        retry={() => void node.refetch()}
      />
    );
  return (
    <Screen
      eyebrow="Remote Node"
      title={node.data.id ? 'Node 详情' : 'Remote Node'}
      description="身份、授权 roots、inventory 与连接状态。原始指纹只在诊断上下文内展示。"
      actions={
        <AhButton variant="default" onClick={() => setConfirmOpen(true)} loading={revoke.isPending}>
          撤销授权
        </AhButton>
      }
    >
      <div className={styles.grid + ' ' + styles.grid2}>
        <AhSurface>
          <div className={styles.surfaceHeader}>
            <div>
              <h3>连接状态</h3>
              <p>{node.data.lastSeenAt ? displayDate(node.data.lastSeenAt) : '暂无心跳'}</p>
            </div>
            <AhStatusPill status={node.data.status} />
          </div>
          <div className={styles.surfaceBody}>
            <div className={styles.row}>
              <Network size={17} />
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>协议</span>
                <span className={styles.rowMeta}>
                  {node.data.protocolVersion} · daemon {node.data.daemonVersion}
                </span>
              </div>
            </div>
            <div className={styles.row}>
              <Server size={17} />
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>授权目录</span>
                <span className={styles.rowMeta}>{node.data.allowedRoots.length} 个 root</span>
              </div>
            </div>
            <details>
              <summary>查看设备指纹</summary>
              <pre className={styles.codeBlock}>{node.data.fingerprint}</pre>
            </details>
          </div>
        </AhSurface>
        <AhSurface>
          <div className={styles.surfaceHeader}>
            <div>
              <h3>Agent inventory</h3>
              <p>只有固定 Profile 会进入普通流程。</p>
            </div>
          </div>
          <div className={styles.surfaceBody}>
            {node.data.inventory.map((agent) => (
              <div className={styles.row} key={agent.key}>
                <Bot size={17} />
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>{agent.name}</span>
                  <span className={styles.rowMeta}>{agent.detectedVersion ?? '版本待检测'}</span>
                </div>
                <AhStatusPill status={agent.status} />
              </div>
            ))}
          </div>
        </AhSurface>
      </div>
      <AhDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="撤销 Remote Node？"
        description="撤销后该设备不能再访问授权目录；历史记录会保留。"
      >
        <div className={styles.actions}>
          <AhButton variant="default" onClick={() => setConfirmOpen(false)}>
            取消
          </AhButton>
          <AhButton color="red" onClick={() => revoke.mutate()} loading={revoke.isPending}>
            确认撤销
          </AhButton>
        </div>
      </AhDialog>
    </Screen>
  );
}

export function PromptLibraryPageV07() {
  const client = useQueryClient();
  const routeParams = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = routeParams.projectId ?? searchParams.get('projectId') ?? undefined;
  const promptId = routeParams.promptId ?? searchParams.get('promptId') ?? '';
  type PromptMainTab = 'content' | 'variables' | 'bindings' | 'playground';
  const requestedTab = searchParams.get('tab');
  const initialTab: PromptMainTab =
    requestedTab === 'variables' || requestedTab === 'bindings' || requestedTab === 'playground'
      ? requestedTab
      : 'content';
  const prompts = useQuery({
    queryKey: ['prompts', projectId ?? 'all'],
    queryFn: () =>
      api.get<PromptRecord[]>(projectId ? `/prompts?projectId=${projectId}` : '/prompts'),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.get<TaskRecord[]>('/tasks') });
  const [selectedId, setSelectedId] = useState(promptId ?? '');
  const [tab, setTab] = useState<PromptMainTab>(initialTab);
  const [search, setSearch] = useState('');
  const [promptFilter, setPromptFilter] = useState<'all' | 'SYSTEM' | 'TASK' | 'REVIEW' | 'RULE'>(
    'all',
  );
  const selected = prompts.data?.find((prompt) => prompt.id === selectedId) ?? prompts.data?.[0];
  const filteredPrompts = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return (prompts.data ?? []).filter((prompt) => {
      const matchesText =
        !normalized ||
        `${prompt.name} ${prompt.key} ${prompt.description ?? ''}`
          .toLowerCase()
          .includes(normalized);
      const matchesKind = promptFilter === 'all' || prompt.kind === promptFilter;
      return matchesText && matchesKind;
    });
  }, [promptFilter, prompts.data, search]);
  useEffect(() => {
    if (promptId) setSelectedId(promptId);
  }, [promptId]);
  useEffect(() => {
    if (
      requestedTab === 'content' ||
      requestedTab === 'variables' ||
      requestedTab === 'bindings' ||
      requestedTab === 'playground'
    )
      setTab(requestedTab);
  }, [requestedTab]);
  useEffect(() => {
    if (!selectedId && selected) setSelectedId(selected.id);
  }, [selected, selectedId]);
  const versions = useQuery({
    queryKey: ['prompt-versions', selected?.id],
    queryFn: () => api.get<PromptVersionRecord[]>(`/prompts/${selected?.id}/versions`),
    enabled: Boolean(selected),
  });
  const labels = useQuery({
    queryKey: ['prompt-labels', selected?.id],
    queryFn: () => api.get<PromptLabelRecord[]>(`/prompts/${selected?.id}/labels`),
    enabled: Boolean(selected),
  });
  const bindings = useQuery({
    queryKey: ['prompt-bindings', selected?.id],
    queryFn: () => api.get<PromptBindingRecord[]>(`/prompt-bindings?promptId=${selected?.id}`),
    enabled: Boolean(selected),
  });
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.post<PromptRecord>('/prompts', {
        projectId,
        key: key.trim(),
        name: name.trim(),
        kind: 'TASK',
        type: 'TEXT',
      }),
    onSuccess: (prompt) => {
      void client.invalidateQueries({ queryKey: ['prompts'] });
      setSelectedId(prompt.id);
      setNewOpen(false);
    },
  });
  const [versionOpen, setVersionOpen] = useState(false);
  const [lifecycleOpen, setLifecycleOpen] = useState(false);
  const [diffFrom, setDiffFrom] = useState('');
  const [diffTo, setDiffTo] = useState('');
  const [versionContent, setVersionContent] = useState('');
  const [versionVariables, setVersionVariables] = useState('{}');
  const [versionChangelog, setVersionChangelog] = useState('');
  const versionCreate = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('请先选择 Prompt');
      let variables: Record<string, unknown>;
      try {
        variables = JSON.parse(versionVariables || '{}') as Record<string, unknown>;
      } catch {
        throw new Error('Variables 必须是有效 JSON');
      }
      const content =
        selected.type === 'CHAT'
          ? JSON.parse(versionContent || '{"messages":[]}')
          : { text: versionContent };
      return api.post(`/prompts/${selected.id}/versions`, {
        content,
        variables,
        changelog: versionChangelog.trim() || undefined,
      });
    },
    onSuccess: () => {
      setVersionOpen(false);
      setVersionContent('');
      setVersionVariables('{}');
      setVersionChangelog('');
      void client.invalidateQueries({ queryKey: ['prompt-versions', selected?.id] });
      void client.invalidateQueries({ queryKey: ['prompt-labels', selected?.id] });
    },
  });
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelName, setLabelName] = useState('production');
  const [labelVersionId, setLabelVersionId] = useState('');
  const moveLabel = useMutation({
    mutationFn: () => {
      if (!selected || !labelName.trim() || !labelVersionId) throw new Error('标签和版本不能为空');
      return api.put(`/prompts/${selected.id}/labels/${encodeURIComponent(labelName.trim())}`, {
        versionId: labelVersionId,
      });
    },
    onSuccess: () => {
      setLabelOpen(false);
      void client.invalidateQueries({ queryKey: ['prompt-labels', selected?.id] });
    },
  });
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindingTargetType, setBindingTargetType] = useState<'PROJECT' | 'AGENT' | 'TASK'>(
    'PROJECT',
  );
  const [bindingTargetId, setBindingTargetId] = useState('');
  const [bindingSlot, setBindingSlot] = useState('SYSTEM');
  const [bindingSelector, setBindingSelector] = useState<'LABEL' | 'VERSION'>('LABEL');
  const [bindingSelectorValue, setBindingSelectorValue] = useState('');
  const bindingTargets =
    bindingTargetType === 'PROJECT'
      ? (projects.data ?? []).map((item) => ({ value: item.id, label: item.name }))
      : bindingTargetType === 'AGENT'
        ? (agents.data ?? []).map((item) => ({ value: item.id, label: item.name }))
        : (tasks.data ?? []).map((item) => ({ value: item.id, label: item.title }));
  const bindingSelectors =
    bindingSelector === 'LABEL'
      ? (labels.data ?? []).map((item) => ({
          value: item.label,
          label: `${item.label} · v${item.version}`,
        }))
      : (versions.data ?? []).map((item) => ({
          value: item.id,
          label: `v${item.version} · ${item.changelog ?? '无变更说明'}`,
        }));
  useEffect(() => {
    if (!bindingTargets.some((item) => item.value === bindingTargetId))
      setBindingTargetId(bindingTargets[0]?.value ?? '');
  }, [bindingTargetId, bindingTargets]);
  useEffect(() => {
    if (!bindingSelectors.some((item) => item.value === bindingSelectorValue))
      setBindingSelectorValue(bindingSelectors[0]?.value ?? '');
  }, [bindingSelectorValue, bindingSelectors]);
  const createBinding = useMutation({
    mutationFn: () => {
      if (!selected || !bindingTargetId || !bindingSelectorValue)
        throw new Error('绑定目标和版本来源不能为空');
      return api.post('/prompt-bindings', {
        targetType: bindingTargetType,
        targetId: bindingTargetId,
        slot: bindingSlot,
        promptId: selected.id,
        selectorType: bindingSelector,
        ...(bindingSelector === 'LABEL'
          ? { label: bindingSelectorValue }
          : { versionId: bindingSelectorValue }),
        priority: 0,
      });
    },
    onSuccess: () => {
      setBindingOpen(false);
      void client.invalidateQueries({ queryKey: ['prompt-bindings', selected?.id] });
    },
  });
  const toggleBinding = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/prompt-bindings/${id}`, { enabled }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['prompt-bindings', selected?.id] }),
  });
  const [playground, setPlayground] = useState('{}');
  const render = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('请先选择 Prompt');
      let variables: Record<string, unknown>;
      try {
        variables = JSON.parse(playground || '{}') as Record<string, unknown>;
      } catch {
        throw new Error('变量 JSON 格式不正确');
      }
      return api.post<{ text: string }>(`/prompts/${selected.id}/render`, { variables });
    },
  });
  const tabLabels = {
    content: '内容',
    variables: '变量',
    playground: 'Playground',
    bindings: '绑定',
  };
  const selectMainTab = (nextTab: PromptMainTab) => {
    setTab(nextTab);
    const next = new URLSearchParams(searchParams);
    if (nextTab === 'content') next.delete('tab');
    else next.set('tab', nextTab);
    setSearchParams(next, { replace: true });
  };
  const promptFilters: Array<{ value: typeof promptFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'SYSTEM', label: '系统' },
    { value: 'TASK', label: '任务' },
    { value: 'REVIEW', label: '审阅' },
    { value: 'RULE', label: '规则' },
  ];
  const refreshPrompt = () => {
    void client.invalidateQueries({ queryKey: ['prompts'] });
    void client.invalidateQueries({ queryKey: ['prompt-versions', selected?.id] });
    void client.invalidateQueries({ queryKey: ['prompt-labels', selected?.id] });
    void client.invalidateQueries({ queryKey: ['prompt-bindings', selected?.id] });
  };
  const targetName = (binding: PromptBindingRecord) =>
    binding.targetType === 'PROJECT'
      ? (projects.data?.find((item) => item.id === binding.targetId)?.name ?? '当前 Project')
      : binding.targetType === 'AGENT'
        ? (agents.data?.find((item) => item.id === binding.targetId)?.name ?? 'Agent')
        : (tasks.data?.find((item) => item.id === binding.targetId)?.title ?? 'Task');
  const latestVersion = versions.data?.[0];
  useEffect(() => {
    const available = versions.data ?? [];
    const newest = available[0];
    if (!newest) {
      setDiffFrom('');
      setDiffTo('');
      return;
    }
    if (!available.some((version) => String(version.version) === diffFrom))
      setDiffFrom(String(available.at(-1)?.version ?? newest.version));
    if (!available.some((version) => String(version.version) === diffTo))
      setDiffTo(String(newest.version));
  }, [diffFrom, diffTo, versions.data]);
  const versionDiff = useQuery({
    queryKey: ['prompt-diff', selected?.id, diffFrom, diffTo],
    queryFn: () =>
      api.get<{ patch: string }>(`/prompts/${selected?.id}/diff?from=${diffFrom}&to=${diffTo}`),
    enabled: Boolean(selected && diffFrom && diffTo && diffFrom !== diffTo),
  });
  const contentValue =
    latestVersion?.contentJson &&
    typeof latestVersion.contentJson === 'object' &&
    'text' in latestVersion.contentJson &&
    typeof latestVersion.contentJson.text === 'string'
      ? latestVersion.contentJson.text
      : (selected?.description ?? '尚未创建版本内容。');
  const variableEntries = Object.entries(latestVersion?.variablesJson ?? {});
  return (
    <div className={promptSettingsStyles.promptPage}>
      <header className={promptSettingsStyles.pageHeader}>
        <div>
          <p className={promptSettingsStyles.eyebrow}>PROMPT ASSETS</p>
          <h1>Prompt 库</h1>
          <p>集中管理 Prompt 内容、版本、变量、标签与绑定；主工作区保持单一焦点。</p>
        </div>
        <div className={promptSettingsStyles.pageActions}>
          <AhButton leftSection={<Plus size={16} />} onClick={() => setNewOpen(true)}>
            新建 Prompt
          </AhButton>
        </div>
      </header>
      <QueryMessage
        loading={prompts.isLoading}
        error={prompts.error}
        retry={() => void prompts.refetch()}
        label="正在加载 Prompt 资产"
      />
      {!prompts.isLoading && !prompts.error ? (
        <div className={promptSettingsStyles.promptLayout}>
          <aside className={promptSettingsStyles.libraryPane} aria-label="Prompt 目录">
            <div className={promptSettingsStyles.libraryHeader}>
              <div>
                <strong>Prompt 目录</strong>
                <small>{prompts.data?.length ?? 0} 个资产</small>
              </div>
            </div>
            <label className={promptSettingsStyles.searchField}>
              <Search size={15} aria-hidden="true" />
              <input
                aria-label="搜索 Prompt"
                placeholder="搜索 Prompt、标签或项目…"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
              />
            </label>
            <div
              className={promptSettingsStyles.filterRow}
              role="group"
              aria-label="Prompt 类型筛选"
            >
              {promptFilters.map((filter) => (
                <button
                  type="button"
                  key={filter.value}
                  className={`${promptSettingsStyles.filterPill} ${promptFilter === filter.value ? promptSettingsStyles.filterPillActive : ''}`}
                  aria-pressed={promptFilter === filter.value}
                  onClick={() => setPromptFilter(filter.value)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className={promptSettingsStyles.promptList}>
              {filteredPrompts.map((prompt) => (
                <button
                  type="button"
                  className={`${promptSettingsStyles.promptListRow} ${prompt.id === selected?.id ? promptSettingsStyles.promptListRowActive : ''}`}
                  key={prompt.id}
                  onClick={() => {
                    setSelectedId(prompt.id);
                    setTab('content');
                    const next = new URLSearchParams(searchParams);
                    next.set('promptId', prompt.id);
                    next.delete('tab');
                    setSearchParams(next, { replace: true });
                  }}
                >
                  <span className={promptSettingsStyles.promptRowIcon}>
                    <Tag size={14} />
                  </span>
                  <div>
                    <strong>{prompt.name}</strong>
                    <small>{prompt.key}</small>
                  </div>
                  <span className={promptSettingsStyles.rowMeta}>
                    {labelPromptKind(prompt.kind)}
                  </span>
                </button>
              ))}
              {!filteredPrompts.length ? (
                <AhEmptyState
                  compact
                  title={search || promptFilter !== 'all' ? '没有匹配的 Prompt' : '还没有 Prompt'}
                  description={
                    search || promptFilter !== 'all'
                      ? '尝试调整筛选条件。'
                      : '从真实 PromptOS 资产开始建立模板。'
                  }
                  action={
                    !search && promptFilter === 'all' ? (
                      <AhButton size="sm" onClick={() => setNewOpen(true)}>
                        创建资产
                      </AhButton>
                    ) : undefined
                  }
                />
              ) : null}
            </div>
          </aside>
          <section className={promptSettingsStyles.mainPane} aria-label="Prompt 编辑器">
            {selected ? (
              <>
                <header className={promptSettingsStyles.mainHeader}>
                  <div>
                    <div className={promptSettingsStyles.titleLine}>
                      <h2>{selected.name}</h2>
                      <AhStatusPill status="ACTIVE" />
                      <AhStatusPill status={latestVersion ? 'READY' : 'PENDING'} />
                    </div>
                    <p>
                      {selected.key} · {labelPromptKind(selected.kind)}
                      {latestVersion
                        ? ` · v${latestVersion.version} · ${displayDate(latestVersion.createdAt)}`
                        : ' · 尚未创建版本'}
                    </p>
                  </div>
                  <div className={promptSettingsStyles.editorActions}>
                    <AhButton size="sm" variant="default" onClick={refreshPrompt}>
                      刷新
                    </AhButton>
                    <AhButton size="sm" variant="default" onClick={() => setLifecycleOpen(true)}>
                      版本与标签
                    </AhButton>
                    <AhButton
                      size="sm"
                      onClick={() => {
                        setVersionContent(contentValue);
                        setVersionVariables(
                          JSON.stringify(latestVersion?.variablesJson ?? {}, null, 2),
                        );
                        setVersionOpen(true);
                      }}
                    >
                      新建版本
                    </AhButton>
                  </div>
                </header>
                <nav
                  className={promptSettingsStyles.tabs}
                  aria-label="Prompt 资产分区"
                  role="tablist"
                >
                  {(Object.keys(tabLabels) as Array<keyof typeof tabLabels>).map((item) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === item}
                      key={item}
                      className={`${promptSettingsStyles.tab} ${tab === item ? promptSettingsStyles.tabActive : ''}`}
                      onClick={() => selectMainTab(item)}
                    >
                      {tabLabels[item]}
                    </button>
                  ))}
                </nav>
                <div className={promptSettingsStyles.tabContent}>
                  {tab === 'content' ? (
                    <div className={promptSettingsStyles.contentShell}>
                      <div className={promptSettingsStyles.contentToolbar}>
                        <strong>Prompt 内容</strong>
                        <div className={promptSettingsStyles.contentMeta}>
                          <span className={styles.chip}>
                            {selected.type === 'CHAT' ? 'CHAT' : '文本'}
                          </span>
                          <span className={styles.chip}>{contentValue.length} 字符</span>
                          <span className={styles.chip}>{variableEntries.length} 个变量</span>
                        </div>
                      </div>
                      <article className={promptSettingsStyles.prose}>
                        {contentValue.split(/\n{2,}/).map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                        {!contentValue.trim() ? (
                          <AhEmptyState compact title="尚未创建 Prompt 内容" />
                        ) : null}
                      </article>
                    </div>
                  ) : null}
                  {tab === 'variables' ? (
                    <>
                      <div className={promptSettingsStyles.sectionHeading}>
                        <div>
                          <h3>变量</h3>
                          <p>优先结构化查看；Raw JSON 仅在版本编辑中提供。</p>
                        </div>
                        <AhButton
                          size="sm"
                          onClick={() => {
                            setVersionContent(contentValue);
                            setVersionVariables(
                              JSON.stringify(latestVersion?.variablesJson ?? {}, null, 2),
                            );
                            setVersionOpen(true);
                          }}
                        >
                          编辑变量
                        </AhButton>
                      </div>
                      <div className={promptSettingsStyles.variableTable}>
                        <div className={promptSettingsStyles.tableHead}>
                          <span>变量</span>
                          <span>类型</span>
                          <span>必填</span>
                          <span>说明</span>
                        </div>
                        {variableEntries.map(([name, value]) => (
                          <div key={name}>
                            <code>{name}</code>
                            <span>{typeof value}</span>
                            <span>—</span>
                            <span>由当前版本定义</span>
                          </div>
                        ))}
                        {!variableEntries.length ? (
                          <AhEmptyState
                            compact
                            title="还没有变量"
                            description="在新版本中添加结构化变量。"
                          />
                        ) : null}
                      </div>
                    </>
                  ) : null}
                  {tab === 'playground' ? (
                    <>
                      <div className={promptSettingsStyles.sectionHeading}>
                        <div>
                          <h3>Playground</h3>
                          <p>输入变量并即时预览渲染结果，测试通过后再生成新版本。</p>
                        </div>
                        <AhButton
                          size="sm"
                          onClick={() => render.mutate()}
                          loading={render.isPending}
                          leftSection={<Eye size={15} />}
                        >
                          运行预览
                        </AhButton>
                      </div>
                      <div className={promptSettingsStyles.playground}>
                        <div className={promptSettingsStyles.playgroundForm}>
                          <AhTextarea
                            label="变量 JSON"
                            value={playground}
                            onChange={(event) => setPlayground(event.currentTarget.value)}
                            placeholder="{}"
                            minRows={9}
                          />
                          <AhButton onClick={() => render.mutate()} loading={render.isPending}>
                            Render
                          </AhButton>
                          {render.error ? (
                            <AhErrorState description={render.error.message} />
                          ) : null}
                        </div>
                        <div className={promptSettingsStyles.playgroundResult}>
                          <span className={styles.eyebrow}>渲染预览</span>
                          {render.data?.text ? (
                            <p style={{ whiteSpace: 'pre-wrap' }}>{render.data.text}</p>
                          ) : (
                            <AhEmptyState
                              compact
                              title="尚未运行预览"
                              description="输入变量后运行 Render 查看最终内容。"
                            />
                          )}
                        </div>
                      </div>
                    </>
                  ) : null}
                  {tab === 'bindings' ? (
                    <>
                      <div className={promptSettingsStyles.sectionHeading}>
                        <div>
                          <h3>绑定</h3>
                          <p>显示这个 Prompt 在哪些 Project / Agent / Task 中生效。</p>
                        </div>
                        <AhButton
                          size="sm"
                          onClick={() => {
                            refreshPrompt();
                            setBindingOpen(true);
                          }}
                        >
                          新增绑定
                        </AhButton>
                      </div>
                      <div className={promptSettingsStyles.bindingList}>
                        {(bindings.data ?? []).map((binding) => (
                          <div className={promptSettingsStyles.bindingRow} key={binding.id}>
                            <span className={promptSettingsStyles.bindingAvatar}>
                              {targetName(binding).slice(0, 1).toUpperCase()}
                            </span>
                            <div>
                              <strong>{targetName(binding)}</strong>
                              <small>
                                {labelPromptBindingTarget(binding.targetType)} · {binding.slot} ·{' '}
                                {labelPromptSelector(binding.selectorType)}
                              </small>
                            </div>
                            <AhStatusPill status={binding.enabled ? 'ACTIVE' : 'CANCELED'} />
                            <AhButton
                              size="xs"
                              variant="default"
                              onClick={() =>
                                toggleBinding.mutate({ id: binding.id, enabled: !binding.enabled })
                              }
                            >
                              {binding.enabled ? '停用' : '启用'}
                            </AhButton>
                          </div>
                        ))}
                        {!bindings.data?.length ? (
                          <AhEmptyState
                            compact
                            title="还没有 Binding"
                            description="将 Prompt 绑定到 Project、Agent 或 Task。"
                          />
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              </>
            ) : (
              <AhEmptyState
                title="选择一个 Prompt"
                description="从左侧目录选择一个资产，或创建新的 Prompt。"
                action={<AhButton onClick={() => setNewOpen(true)}>新建 Prompt</AhButton>}
              />
            )}
          </section>
        </div>
      ) : null}
      <AhDialog
        open={lifecycleOpen}
        onClose={() => setLifecycleOpen(false)}
        title="版本与标签"
        description="版本不可变；标签是指向已发布版本的可移动指针。"
        size={900}
      >
        <div className={promptSettingsStyles.lifecycleGrid}>
          <section>
            <div className={promptSettingsStyles.sectionHeading}>
              <div>
                <h3>版本历史</h3>
                <p>查看变更来源，并从任意历史版本创建新版本。</p>
              </div>
              <AhButton
                size="sm"
                onClick={() => {
                  setLifecycleOpen(false);
                  setVersionContent(contentValue);
                  setVersionVariables(JSON.stringify(latestVersion?.variablesJson ?? {}, null, 2));
                  setVersionOpen(true);
                }}
              >
                新建版本
              </AhButton>
            </div>
            <div className={promptSettingsStyles.versionList}>
              {(versions.data ?? []).map((version, index) => (
                <div
                  className={`${promptSettingsStyles.versionRow} ${index === 0 ? promptSettingsStyles.versionRowActive : ''}`}
                  key={version.id}
                >
                  <b>v{version.version}</b>
                  <span>
                    <strong>{version.changelog ?? (index === 0 ? '当前版本' : '历史版本')}</strong>
                    <small>
                      {labelPromptVersionSource(version.source)} · {displayDate(version.createdAt)}
                    </small>
                  </span>
                  {index === 0 ? (
                    <AhStatusPill status="READY" />
                  ) : (
                    <AhButton
                      size="xs"
                      variant="default"
                      onClick={() => {
                        setLifecycleOpen(false);
                        setVersionContent(
                          String((version.contentJson as { text?: unknown })?.text ?? ''),
                        );
                        setVersionVariables(JSON.stringify(version.variablesJson ?? {}, null, 2));
                        setVersionOpen(true);
                      }}
                    >
                      基于此版本
                    </AhButton>
                  )}
                </div>
              ))}
              {!versions.data?.length ? (
                <AhEmptyState compact title="还没有版本" description="创建第一个 Prompt 版本。" />
              ) : null}
            </div>
          </section>
          <section>
            <div className={promptSettingsStyles.sectionHeading}>
              <div>
                <h3>标签</h3>
                <p>控制 production、test 或实验环境使用的版本。</p>
              </div>
              <AhButton
                size="sm"
                variant="default"
                onClick={() => {
                  setLifecycleOpen(false);
                  setLabelVersionId(latestVersion?.id ?? '');
                  setLabelOpen(true);
                }}
              >
                移动标签
              </AhButton>
            </div>
            <div className={promptSettingsStyles.labelList}>
              {(labels.data ?? []).map((label) => (
                <div className={promptSettingsStyles.labelRow} key={label.label}>
                  <span>{label.label}</span>
                  <strong>v{label.version}</strong>
                  <AhButton
                    size="xs"
                    variant="default"
                    onClick={() => {
                      setLifecycleOpen(false);
                      setLabelName(label.label);
                      setLabelVersionId(latestVersion?.id ?? '');
                      setLabelOpen(true);
                    }}
                  >
                    编辑
                  </AhButton>
                </div>
              ))}
              {!labels.data?.length ? (
                <AhEmptyState
                  compact
                  title="还没有 Label"
                  description="在版本上移动 production 或 latest 标签。"
                />
              ) : null}
            </div>
          </section>
          <section className={promptSettingsStyles.diffPanel}>
            <div className={promptSettingsStyles.sectionHeading}>
              <div>
                <h3>版本比较</h3>
                <p>比较任意两个不可变版本，确认内容与变量的实际差异。</p>
              </div>
            </div>
            {(versions.data?.length ?? 0) < 2 ? (
              <AhEmptyState
                compact
                title="至少需要两个版本"
                description="创建新版本后才能比较差异。"
              />
            ) : (
              <>
                <div className={promptSettingsStyles.diffControls}>
                  <AhSelect
                    label="起始版本"
                    value={diffFrom}
                    onChange={(value) => setDiffFrom(value ?? '')}
                    data={(versions.data ?? []).map((version) => ({
                      value: String(version.version),
                      label: `v${version.version}`,
                    }))}
                  />
                  <ArrowRight size={16} aria-hidden="true" />
                  <AhSelect
                    label="目标版本"
                    value={diffTo}
                    onChange={(value) => setDiffTo(value ?? '')}
                    data={(versions.data ?? []).map((version) => ({
                      value: String(version.version),
                      label: `v${version.version}`,
                    }))}
                  />
                </div>
                {diffFrom === diffTo ? (
                  <AhEmptyState
                    compact
                    title="请选择不同版本"
                    description="起始版本和目标版本不能相同。"
                  />
                ) : versionDiff.isLoading ? (
                  <AhLoadingState label="正在比较版本" rows={1} />
                ) : versionDiff.error ? (
                  <AhErrorState description={versionDiff.error.message} />
                ) : (
                  <pre className={promptSettingsStyles.diffPatch}>{versionDiff.data?.patch}</pre>
                )}
              </>
            )}
          </section>
        </div>
      </AhDialog>
      <AhDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="新建 Prompt"
        description="先建立资产，再逐步添加版本和绑定。"
        actions={
          <>
            <AhButton variant="default" onClick={() => setNewOpen(false)}>
              取消
            </AhButton>
            <AhButton
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={!name.trim() || !key.trim()}
            >
              创建
            </AhButton>
          </>
        }
      >
        {create.error ? <AhErrorState description={create.error.message} /> : null}
        <AhInput
          label="名称"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <AhInput
          label="Key"
          value={key}
          onChange={(event) => setKey(event.currentTarget.value)}
          placeholder="project/task-primer"
        />
      </AhDialog>
      <AhDialog
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        title="创建新版本"
        description="版本创建后不可覆盖或删除，latest 会自动指向这次创建的版本。"
        size={760}
        actions={
          <>
            <AhButton variant="default" onClick={() => setVersionOpen(false)}>
              取消
            </AhButton>
            <AhButton
              onClick={() => versionCreate.mutate()}
              loading={versionCreate.isPending}
              disabled={!versionContent.trim()}
            >
              创建版本
            </AhButton>
          </>
        }
      >
        {versionCreate.error ? <AhErrorState description={versionCreate.error.message} /> : null}
        <AhTextarea
          label={selected?.type === 'CHAT' ? 'CHAT 内容 JSON' : 'Prompt 内容'}
          value={versionContent}
          onChange={(event) => setVersionContent(event.currentTarget.value)}
          minRows={selected?.type === 'CHAT' ? 10 : 8}
          placeholder={
            selected?.type === 'CHAT' ? '{"messages":[]}' : '输入 {{ variable }} 模板内容'
          }
        />
        <AhTextarea
          label="Variables JSON"
          value={versionVariables}
          onChange={(event) => setVersionVariables(event.currentTarget.value)}
          minRows={6}
        />
        <AhInput
          label="变更说明"
          value={versionChangelog}
          onChange={(event) => setVersionChangelog(event.currentTarget.value)}
          placeholder="说明本次变化"
        />
      </AhDialog>
      <AhDialog
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        title="移动 Prompt 标签"
        description="标签是可移动指针；latest 由系统维护。"
        actions={
          <>
            <AhButton variant="default" onClick={() => setLabelOpen(false)}>
              取消
            </AhButton>
            <AhButton
              onClick={() => moveLabel.mutate()}
              loading={moveLabel.isPending}
              disabled={!labelName.trim() || !labelVersionId}
            >
              移动标签
            </AhButton>
          </>
        }
      >
        {moveLabel.error ? <AhErrorState description={moveLabel.error.message} /> : null}
        <AhInput
          label="标签名称"
          value={labelName}
          onChange={(event) => setLabelName(event.currentTarget.value)}
        />
        <AhSelect
          label="目标版本"
          value={labelVersionId}
          onChange={(value) => setLabelVersionId(value ?? '')}
          data={(versions.data ?? []).map((version) => ({
            value: version.id,
            label: `v${version.version} · ${version.changelog ?? '无变更说明'}`,
          }))}
          placeholder="选择版本"
        />
      </AhDialog>
      <AhDialog
        open={bindingOpen}
        onClose={() => setBindingOpen(false)}
        title="新建 Prompt 绑定"
        description="选择绑定目标和版本来源；保存后会参与后续上下文解析。"
        size={680}
        actions={
          <>
            <AhButton variant="default" onClick={() => setBindingOpen(false)}>
              取消
            </AhButton>
            <AhButton
              onClick={() => createBinding.mutate()}
              loading={createBinding.isPending}
              disabled={!bindingTargetId || !bindingSelectorValue}
            >
              创建绑定
            </AhButton>
          </>
        }
      >
        {createBinding.error ? <AhErrorState description={createBinding.error.message} /> : null}
        <AhSelect
          label="绑定目标类型"
          value={bindingTargetType}
          onChange={(value) => {
            setBindingTargetType((value as typeof bindingTargetType) ?? 'PROJECT');
            setBindingTargetId('');
          }}
          data={[
            { value: 'PROJECT', label: 'Project' },
            { value: 'AGENT', label: 'Agent' },
            { value: 'TASK', label: 'Task' },
          ]}
        />
        <AhSelect
          label={labelPromptBindingTarget(bindingTargetType)}
          value={bindingTargetId}
          onChange={(value) => setBindingTargetId(value ?? '')}
          data={bindingTargets}
          placeholder="选择目标"
        />
        <AhSelect
          label="提示位"
          value={bindingSlot}
          onChange={(value) => setBindingSlot(value ?? 'SYSTEM')}
          data={[
            { value: 'SYSTEM', label: '系统' },
            { value: 'TASK_PRIMER', label: '任务前置' },
            { value: 'REVIEW', label: 'Review' },
            { value: 'COMMIT', label: 'Commit' },
            { value: 'RULES', label: '规则' },
          ]}
        />
        <AhSelect
          label="选择方式"
          value={bindingSelector}
          onChange={(value) => {
            setBindingSelector((value as typeof bindingSelector) ?? 'LABEL');
            setBindingSelectorValue('');
          }}
          data={[
            { value: 'LABEL', label: '标签' },
            { value: 'VERSION', label: '固定版本' },
          ]}
        />
        <AhSelect
          label={bindingSelector === 'LABEL' ? '标签' : '固定版本'}
          value={bindingSelectorValue}
          onChange={(value) => setBindingSelectorValue(value ?? '')}
          data={bindingSelectors}
          placeholder="选择来源"
        />
      </AhDialog>
    </div>
  );
}

export function SettingsPageV07() {
  const {
    density,
    preference,
    mode,
    reducedMotion,
    setDensity,
    setPreference,
    setReducedMotion,
    setSidebarPreference,
    sidebarPreference,
  } = useAgentHubTheme();
  const auth = useQuery({
    queryKey: ['auth-status'],
    queryFn: () =>
      api.get<{ localTrusted: boolean; authenticated: boolean; user?: { username: string } }>(
        '/auth/status',
      ),
  });
  const capability = useQuery({
    queryKey: ['capabilities'],
    queryFn: () =>
      api.get<{
        terminal: { available: boolean; message: string; platform: string; arch: string };
        remoteNode: { available: boolean };
      }>('/settings/capabilities'),
  });
  const tokens = useQuery({
    queryKey: ['api-tokens'],
    queryFn: () => api.get<ApiTokenRecord[]>('/auth/tokens'),
    enabled: Boolean(auth.data?.localTrusted || auth.data?.authenticated),
  });
  const { section = 'appearance' } = useParams();
  const nav = [
    ['appearance', '外观'],
    ['account', '账户'],
    ['security', '安全'],
    ['integrations', '集成'],
    ['system', '系统'],
  ] as const;
  const segment = nav.some(([value]) => value === section) ? section : 'appearance';
  const themeOptions: Array<{
    value: 'light' | 'dark' | 'system';
    label: string;
    hint: string;
    preview: string;
  }> = [
    {
      value: 'light',
      label: '浅色',
      hint: '默认',
      preview: promptSettingsStyles.themePreview ?? '',
    },
    {
      value: 'dark',
      label: '深色',
      hint: '低亮环境',
      preview: `${promptSettingsStyles.themePreview} ${promptSettingsStyles.themePreviewDark}`,
    },
    {
      value: 'system',
      label: '跟随系统',
      hint: '自动切换',
      preview: `${promptSettingsStyles.themePreview} ${promptSettingsStyles.themePreviewSystem}`,
    },
  ];
  const authStatus = auth.data?.authenticated
    ? 'ONLINE'
    : auth.data?.localTrusted
      ? 'READY'
      : 'UNAVAILABLE';
  return (
    <div className={promptSettingsStyles.settingsPage}>
      <header className={promptSettingsStyles.pageHeader}>
        <div>
          <p className={promptSettingsStyles.eyebrow}>PREFERENCES</p>
          <h1>设置</h1>
          <p>安静、稳定的单列设置流。局部导航只用于定位，不占据大块版面。</p>
        </div>
      </header>
      <div className={promptSettingsStyles.settingsLayout}>
        <nav className={promptSettingsStyles.settingsNav} aria-label="设置分区">
          {nav.map(([value, label]) => (
            <NavLink
              key={value}
              to={`/settings/${value}`}
              className={segment === value ? (promptSettingsStyles.settingsNavActive ?? '') : ''}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <section className={promptSettingsStyles.settingsContent}>
          <section
            className={promptSettingsStyles.settingsSection}
            id="appearance"
            hidden={segment !== 'appearance'}
          >
            <div>
              <h2>外观</h2>
              <p>主题与显示方式。</p>
            </div>
            <div className={promptSettingsStyles.settingsGroup}>
              <div className={promptSettingsStyles.settingRow}>
                <div>
                  <strong>主题模式</strong>
                  <p>默认浅色，深色与跟随系统保持同等级视觉质量。</p>
                </div>
              </div>
              <div className={promptSettingsStyles.settingRow}>
                <div className={promptSettingsStyles.themeCards}>
                  {themeOptions.map((theme) => (
                    <button
                      type="button"
                      key={theme.value}
                      className={`${promptSettingsStyles.themeCard} ${preference === theme.value ? promptSettingsStyles.themeCardActive : ''}`}
                      aria-pressed={preference === theme.value}
                      onClick={() => setPreference(theme.value)}
                    >
                      <span className={theme.preview} aria-hidden="true" />
                      <strong>{theme.label}</strong>
                      <small>{theme.hint}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className={promptSettingsStyles.settingRow}>
                <div>
                  <strong>当前解析主题</strong>
                  <p>{mode === 'dark' ? '深色' : '浅色'}；Monaco、Terminal 与 Workspace 会同步。</p>
                </div>
                <AhStatusPill status="READY" />
              </div>
              <div className={promptSettingsStyles.settingRow}>
                <div>
                  <strong>侧边栏</strong>
                  <p>支持展开 / 折叠，并记住上次状态。</p>
                </div>
                <AhSelect
                  aria-label="侧边栏行为"
                  className={promptSettingsStyles.settingControl}
                  value={sidebarPreference}
                  onChange={(value) =>
                    setSidebarPreference(
                      (value as 'remember' | 'expanded' | 'collapsed') ?? 'remember',
                    )
                  }
                  data={[
                    { value: 'remember', label: '记住状态' },
                    { value: 'expanded', label: '始终展开' },
                    { value: 'collapsed', label: '始终折叠' },
                  ]}
                />
              </div>
              <div className={promptSettingsStyles.settingRow}>
                <div>
                  <strong>界面密度</strong>
                  <p>默认舒适；需要高信息量时切换紧凑。</p>
                </div>
                <AhSelect
                  aria-label="界面密度"
                  className={promptSettingsStyles.settingControl}
                  value={density}
                  onChange={(value) =>
                    setDensity((value as 'comfortable' | 'compact') ?? 'comfortable')
                  }
                  data={[
                    { value: 'comfortable', label: '舒适' },
                    { value: 'compact', label: '紧凑' },
                  ]}
                />
              </div>
              <div className={promptSettingsStyles.settingRow}>
                <div>
                  <strong>减少动态效果</strong>
                  <p>遵循系统，也可独立关闭布局动画和状态呼吸。</p>
                </div>
                <AhSwitch
                  aria-label="减少动态效果"
                  className={promptSettingsStyles.settingSwitch}
                  checked={reducedMotion}
                  onChange={(event) => setReducedMotion(event.currentTarget.checked)}
                />
              </div>
            </div>
          </section>
          <section
            className={promptSettingsStyles.settingsSection}
            id="account"
            hidden={segment !== 'account'}
          >
            <div>
              <h2>账户</h2>
              <p>身份与会话。</p>
            </div>
            <div className={promptSettingsStyles.settingsGroup}>
              <div className={promptSettingsStyles.settingRow}>
                <div>
                  <strong>{auth.data?.user?.username ?? '本机管理员'}</strong>
                  <p>
                    {auth.data?.localTrusted
                      ? 'Administrator · 本地可信模式'
                      : 'Administrator · 管理员认证'}
                  </p>
                </div>
                <AhStatusPill status={authStatus} />
              </div>
              <div className={promptSettingsStyles.settingRow}>
                <div>
                  <strong>认证状态</strong>
                  <p>
                    {auth.isLoading
                      ? '正在读取认证状态…'
                      : auth.data?.authenticated
                        ? '当前浏览器已完成管理员认证。'
                        : auth.data?.localTrusted
                          ? '本机可信模式，不要求账号登录。'
                          : '需要管理员认证才能访问受保护能力。'}
                  </p>
                </div>
                {auth.error ? <AhErrorState description={auth.error.message} /> : null}
              </div>
            </div>
          </section>
          <section
            className={promptSettingsStyles.settingsSection}
            id="security"
            hidden={segment !== 'security'}
          >
            <div>
              <h2>安全</h2>
              <p>高权限能力和 API 访问。</p>
            </div>
            <div className={promptSettingsStyles.settingsGroup}>
              <div className={promptSettingsStyles.settingRow}>
                <div>
                  <strong>API Token</strong>
                  <p>凭据只在创建时展示一次；此处仅显示名称、时间与有效状态。</p>
                </div>
                <Link to="/settings/security" className={promptSettingsStyles.rowAction}>
                  刷新
                </Link>
              </div>
              {tokens.isLoading ? (
                <div className={promptSettingsStyles.settingRow}>
                  <AhLoadingState label="正在读取 token" />
                </div>
              ) : (
                (tokens.data ?? []).map((token) => (
                  <div className={promptSettingsStyles.settingRow} key={token.id}>
                    <div>
                      <strong>{token.name}</strong>
                      <p>
                        创建于 {displayDate(token.createdAt)} ·{' '}
                        {token.revokedAt ? '已撤销' : '有效'}
                      </p>
                    </div>
                    <AhStatusPill status={token.revokedAt ? 'REVOKED' : 'READY'} />
                  </div>
                ))
              )}
              {!tokens.data?.length && !tokens.isLoading ? (
                <div className={promptSettingsStyles.settingRow}>
                  <AhEmptyState
                    compact
                    title="还没有 API token"
                    description="需要自动化访问时，再创建最小权限 token。"
                  />
                </div>
              ) : null}
            </div>
          </section>
          <section
            className={promptSettingsStyles.settingsSection}
            id="integrations"
            hidden={segment !== 'integrations'}
          >
            <div>
              <h2>集成</h2>
              <p>模型与外部服务的真实连接能力。</p>
            </div>
            <div className={promptSettingsStyles.settingsGroup}>
              <div className={promptSettingsStyles.settingRow}>
                <div>
                  <strong>Remote Node</strong>
                  <p>远程设备主动连接 AgentHub。</p>
                </div>
                <AhStatusPill
                  status={capability.data?.remoteNode.available ? 'READY' : 'UNAVAILABLE'}
                />
              </div>
              <div className={promptSettingsStyles.settingRow}>
                <div>
                  <strong>Agent Runtime</strong>
                  <p>Local / Docker discovery 与 lifecycle。</p>
                </div>
                <Link to="/agents/runtime" className={promptSettingsStyles.rowAction}>
                  管理
                </Link>
              </div>
            </div>
          </section>
          <section
            className={promptSettingsStyles.settingsSection}
            id="system"
            hidden={segment !== 'system'}
          >
            <div>
              <h2>系统</h2>
              <p>实例级能力与维护入口。</p>
            </div>
            <div className={promptSettingsStyles.settingsGroup}>
              {capability.isLoading ? (
                <div className={promptSettingsStyles.settingRow}>
                  <AhLoadingState label="正在读取系统能力" />
                </div>
              ) : capability.error ? (
                <div className={promptSettingsStyles.settingRow}>
                  <AhErrorState description={capability.error.message} />
                </div>
              ) : (
                <>
                  <div className={promptSettingsStyles.settingRow}>
                    <div>
                      <strong>Terminal</strong>
                      <p>
                        {capability.data?.terminal.message} · {capability.data?.terminal.platform}/
                        {capability.data?.terminal.arch}
                      </p>
                    </div>
                    <AhStatusPill
                      status={capability.data?.terminal.available ? 'READY' : 'UNAVAILABLE'}
                    />
                  </div>
                  <div className={promptSettingsStyles.settingRow}>
                    <div>
                      <strong>诊断中心</strong>
                      <p>先给出面向用户的结论，再按需展开原始诊断信息。</p>
                    </div>
                    <Link to="/agents/diagnostics" className={promptSettingsStyles.rowAction}>
                      查看 Diagnostics <ArrowRight size={14} />
                    </Link>
                  </div>
                </>
              )}
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}

export function WorkspacePageV07() {
  const { sessionId = '' } = useParams();
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const tab: InspectorTab =
    viewParam === 'files'
      ? 'files'
      : viewParam === 'tools' || viewParam === 'activity'
        ? 'tools'
        : viewParam === 'run'
          ? 'run'
          : 'changes';
  const mobileInspectorOpen = [
    'changes',
    'files',
    'tools',
    'activity',
    'run',
    'diff',
    'git',
  ].includes(viewParam ?? '');
  const mobileSessionsOpen = viewParam === 'sessions';
  const selectedFile = searchParams.get('file') || undefined;
  const [layout, setLayout] = useState(readWorkspaceLayout);
  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  const [promptVariables, setPromptVariables] = useState<Record<string, unknown>>({});
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionRecord[]>('/sessions'),
  });
  const session = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.get<SessionRecord>(`/sessions/${sessionId}`),
    enabled: Boolean(sessionId),
  });
  const configuration = useQuery({
    queryKey: ['session-configuration', sessionId],
    queryFn: () => api.get<SessionConfigurationRecord>(`/sessions/${sessionId}/configuration`),
    enabled: Boolean(sessionId),
  });
  const messages = useQuery({
    queryKey: ['messages', sessionId],
    queryFn: () => api.get<MessageRecord[]>(`/sessions/${sessionId}/messages`),
    enabled: Boolean(sessionId),
    refetchInterval: 3_000,
  });
  const runs = useQuery({
    queryKey: ['runs', sessionId],
    queryFn: () => api.get<RunRecord[]>(`/sessions/${sessionId}/runs`),
    enabled: Boolean(sessionId),
    refetchInterval: 3_000,
  });
  const approvals = useQuery({
    queryKey: ['approvals', sessionId],
    queryFn: () => api.get<ApprovalRecord[]>(`/approvals?sessionId=${sessionId}`),
    enabled: Boolean(sessionId),
    refetchInterval: 3_000,
  });
  const events = useQuery({
    queryKey: ['events', sessionId],
    queryFn: () => api.get<EventRecord[]>(`/sessions/${sessionId}/events?afterSeq=0&limit=500`),
    enabled: Boolean(sessionId),
    refetchInterval: 3_000,
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const capability = useQuery({
    queryKey: ['capabilities'],
    queryFn: () =>
      api.get<{ terminal: { available: boolean; code?: string; message?: string } }>(
        '/settings/capabilities',
      ),
  });
  const promptContext = useQuery({
    queryKey: [
      'prompt-context',
      session.data?.projectId,
      session.data?.agentId,
      session.data?.taskId,
      promptVariables,
    ],
    queryFn: () => {
      if (!session.data) throw new Error('Session 尚未加载');
      return api.post<ResolvedPromptContextRecord>('/prompt-context/resolve', {
        projectId: session.data.projectId,
        agentId: session.data.agentId,
        ...(session.data.taskId ? { taskId: session.data.taskId } : {}),
        variables: promptVariables,
      });
    },
    enabled: Boolean(session.data),
  });
  const project = projects.data?.find((item) => item.id === session.data?.projectId);
  const agent = agents.data?.find((item) => item.id === session.data?.agentId);
  const activeRun = runs.error
    ? undefined
    : [...(runs.data ?? [])]
        .reverse()
        .find((run) =>
          ['STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELING'].includes(run.status),
        );
  const latestRunStatus = runs.data?.at(-1)?.status;

  useEffect(() => {
    if (!sessionId) return;
    return realtime.subscribe(`session:${sessionId}`, () => {
      void client.invalidateQueries({ queryKey: ['sessions'] });
      void client.invalidateQueries({ queryKey: ['session', sessionId] });
      void client.invalidateQueries({ queryKey: ['session-configuration', sessionId] });
      void client.invalidateQueries({ queryKey: ['messages', sessionId] });
      void client.invalidateQueries({ queryKey: ['runs', sessionId] });
      void client.invalidateQueries({ queryKey: ['approvals', sessionId] });
      void client.invalidateQueries({ queryKey: ['events', sessionId] });
    });
  }, [client, sessionId]);

  const setTab = (nextTab: InspectorTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('view', nextTab);
    setSearchParams(next);
  };
  const setMobileView = (view: 'sessions' | 'conversation' | 'changes' | 'files' | 'activity') => {
    const next = new URLSearchParams(searchParams);
    if (view === 'conversation') {
      next.delete('view');
      next.delete('file');
    } else next.set('view', view);
    setSearchParams(next);
  };
  const setSelectedFile = (path: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('view', 'files');
    next.set('file', path);
    setSearchParams(next);
  };

  if (session.isLoading) return <AhLoadingState label="正在打开 Coding Workspace" />;
  if (session.error)
    return (
      <AhErrorState description={session.error.message} retry={() => void session.refetch()} />
    );
  if (!session.data)
    return <AhEmptyState title="Session 不存在" description="返回 Sessions 选择一个可用会话。" />;

  return (
    <div className={workspaceStyles.workspace} data-testid="v07-workspace">
      <header className={workspaceStyles.contextbar}>
        <div className={workspaceStyles.contextTitle}>
          <Link to={`/projects/${session.data.projectId}/sessions`}>Sessions</Link>
          <span aria-hidden="true">/</span>
          <strong>{session.data.title}</strong>
          <AhStatusPill status={session.data.status} />
        </div>
        <div className={workspaceStyles.contextFacts}>
          <span>{project?.name ?? 'Project 未知'}</span>
          <span>{session.data.branch ?? '无 Git 分支'}</span>
          <code title={session.data.cwd}>{session.data.cwd}</code>
        </div>
        <div className={workspaceStyles.panelActions}>
          <button
            type="button"
            onClick={() => {
              const collapsed = !layout.leftCollapsed;
              if (collapsed) leftPanelRef.current?.collapse();
              else leftPanelRef.current?.resize(`${layout.leftWidth}px`);
              setLayout((current) => ({ ...current, leftCollapsed: collapsed }));
              writeWorkspacePanel('left', { collapsed });
            }}
            aria-label={layout.leftCollapsed ? '展开 Session 列表' : '折叠 Session 列表'}
            title={layout.leftCollapsed ? '展开 Session 列表' : '折叠 Session 列表'}
          >
            {layout.leftCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          <button
            type="button"
            onClick={() => {
              const collapsed = !layout.rightCollapsed;
              if (collapsed) rightPanelRef.current?.collapse();
              else rightPanelRef.current?.resize(`${layout.rightWidth}px`);
              setLayout((current) => ({ ...current, rightCollapsed: collapsed }));
              writeWorkspacePanel('right', { collapsed });
            }}
            aria-label={layout.rightCollapsed ? '展开检查器' : '折叠检查器'}
            title={layout.rightCollapsed ? '展开检查器' : '折叠检查器'}
          >
            {layout.rightCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
      </header>
      <div className={workspaceStyles.mobileTabs} role="tablist" aria-label="Workspace 视图">
        <button
          type="button"
          role="tab"
          aria-selected={mobileSessionsOpen}
          onClick={() => setMobileView('sessions')}
        >
          Session
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewParam === null}
          onClick={() => setMobileView('conversation')}
        >
          对话
        </button>
        {(['changes', 'files', 'activity'] as const).map((item) => (
          <button
            type="button"
            role="tab"
            key={item}
            aria-selected={viewParam === item}
            onClick={() => setMobileView(item)}
          >
            {item === 'files' ? '文件' : item === 'changes' ? '变更' : 'Activity'}
          </button>
        ))}
      </div>
      <Group
        id="workspace-panels"
        orientation="horizontal"
        className={workspaceStyles.panels}
        resizeTargetMinimumSize={{ fine: 12, coarse: 28 }}
        onLayoutChanged={(_nextLayout, meta) => {
          if (!meta.isUserInteraction) return;
          const leftSize = leftPanelRef.current?.getSize();
          const rightSize = rightPanelRef.current?.getSize();
          const nextPreference = {
            ...layout,
            ...(leftSize && leftSize.inPixels > 0
              ? { leftWidth: leftSize.inPixels, leftCollapsed: false }
              : { leftCollapsed: true }),
            ...(rightSize && rightSize.inPixels > 0
              ? { rightWidth: rightSize.inPixels, rightCollapsed: false }
              : { rightCollapsed: true }),
          };
          setLayout(nextPreference);
          writeWorkspacePanel('left', {
            width: nextPreference.leftWidth,
            collapsed: nextPreference.leftCollapsed,
          });
          writeWorkspacePanel('right', {
            width: nextPreference.rightWidth,
            collapsed: nextPreference.rightCollapsed,
          });
        }}
      >
        <Panel
          id="sessions"
          panelRef={leftPanelRef}
          defaultSize={layout.leftCollapsed ? '0px' : `${layout.leftWidth}px`}
          minSize={`${WORKSPACE_PANEL_LIMITS.left.min}px`}
          maxSize={`${WORKSPACE_PANEL_LIMITS.left.max}px`}
          collapsedSize="0px"
          collapsible
          groupResizeBehavior="preserve-pixel-size"
          className={`${workspaceStyles.panel} ${workspaceStyles.sessionRail} ${mobileSessionsOpen ? workspaceStyles.sessionOpen : ''}`}
        >
          <SessionRail sessions={sessions} currentId={sessionId} />
        </Panel>
        <Separator className={workspaceStyles.separator} aria-label="调整 Session 列表宽度" />
        <Panel
          id="conversation"
          defaultSize="50%"
          minSize="460px"
          className={`${workspaceStyles.panel} ${workspaceStyles.conversationPanel}`}
        >
          <div className={workspaceStyles.conversationShell}>
            <Conversation
              session={session.data}
              messages={messages}
              events={events}
              approvals={approvals}
              activeRun={activeRun}
              latestRunStatus={latestRunStatus}
            />
            <TerminalDock
              capability={capability.data?.terminal}
              capabilityError={capability.error}
              projectId={project?.id}
              projectRoot={project?.realRootPath}
              cwd={session.data.cwd}
            />
            <Composer
              session={session.data}
              agent={agent}
              events={events}
              project={project}
              activeRun={activeRun}
              promptContext={promptContext.data}
              promptContextLoading={promptContext.isLoading}
              promptContextError={promptContext.error}
              promptContextRetry={() => promptContext.refetch()}
              promptVariables={promptVariables}
              setPromptVariables={setPromptVariables}
              configuration={configuration.data}
              configurationLoading={configuration.isLoading}
              configurationError={configuration.error}
            />
          </div>
        </Panel>
        <Separator className={workspaceStyles.separator} aria-label="调整检查器宽度" />
        <Panel
          id="inspector"
          panelRef={rightPanelRef}
          defaultSize={layout.rightCollapsed ? '0px' : `${layout.rightWidth}px`}
          minSize={`${WORKSPACE_PANEL_LIMITS.right.min}px`}
          maxSize={`${WORKSPACE_PANEL_LIMITS.right.max}px`}
          collapsedSize="0px"
          collapsible
          groupResizeBehavior="preserve-pixel-size"
          className={`${workspaceStyles.panel} ${workspaceStyles.inspectorPanel} ${mobileInspectorOpen ? workspaceStyles.inspectorOpen : ''}`}
        >
          <Inspector
            project={project}
            projects={projects}
            session={session.data}
            tab={tab}
            setTab={setTab}
            selectedFile={selectedFile}
            setSelectedFile={setSelectedFile}
            agent={agent}
            runs={runs}
            events={events}
          />
        </Panel>
      </Group>
    </div>
  );
}

export function LegacyWorkspacePageV07() {
  const { sessionId } = useParams();
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.get<SessionRecord>(`/sessions/${sessionId}`),
    enabled: Boolean(sessionId),
  });
  const messages = useQuery({
    queryKey: ['messages', sessionId],
    queryFn: () => api.get<MessageRecord[]>(`/sessions/${sessionId}/messages`),
    enabled: Boolean(sessionId),
  });
  const runs = useQuery({
    queryKey: ['runs', sessionId],
    queryFn: () =>
      api.get<Array<{ id: string; status: string; startedAt: string; finishedAt: string | null }>>(
        `/sessions/${sessionId}/runs`,
      ),
    enabled: Boolean(sessionId),
  });
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: () => api.post(`/sessions/${sessionId}/runs`, { text: text.trim() }),
    onSuccess: () => {
      setText('');
      void client.invalidateQueries({ queryKey: ['messages', sessionId] });
      void client.invalidateQueries({ queryKey: ['runs', sessionId] });
    },
  });
  useEffect(() => {
    if (!sessionId) return;
    return realtimeSubscribe(sessionId, () => {
      void client.invalidateQueries({ queryKey: ['messages', sessionId] });
      void client.invalidateQueries({ queryKey: ['runs', sessionId] });
    });
  }, [client, sessionId]);
  if (session.isLoading) return <AhLoadingState label="正在打开 Workspace" />;
  if (session.error || !session.data)
    return <AhErrorState description={session.error?.message ?? 'Session 不存在'} />;
  return (
    <div className={styles.stack}>
      <div className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Coding Workspace</span>
          <h2>{session.data.title}</h2>
          <p>
            {session.data.cwd} · {session.data.branch ?? '默认分支'}
          </p>
        </div>
        <div className={styles.actions}>
          <AhStatusPill status={session.data.status} />
          <Link to={`/projects/${session.data.projectId}/sessions`}>
            <AhButton variant="default">返回 Sessions</AhButton>
          </Link>
        </div>
      </div>
      <div className={styles.twoPane}>
        <aside className={styles.master}>
          <div className={styles.surfaceHeader}>
            <div>
              <h3>Thread</h3>
              <p>{messages.data?.length ?? 0} 条消息</p>
            </div>
          </div>
          <div className={styles.surfaceBody}>
            {(messages.data ?? []).map((message) => (
              <div className={styles.row} key={message.id}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    {message.role === 'USER'
                      ? '你'
                      : message.role === 'ASSISTANT'
                        ? 'Agent'
                        : message.role}
                  </span>
                  <span className={styles.rowMeta}>
                    {message.text?.slice(0, 80) ?? '无文本内容'}
                  </span>
                </div>
              </div>
            ))}
            {!messages.data?.length ? <AhEmptyState compact title="开始一段对话" /> : null}
          </div>
        </aside>
        <section className={styles.detail}>
          <div className={styles.surfaceHeader} style={{ padding: '0 0 16px' }}>
            <div>
              <h3>Conversation</h3>
              <p>Composer 始终可见，运行状态实时刷新。</p>
            </div>
            <AhStatusPill
              status={runs.data?.some((run) => run.status === 'RUNNING') ? 'RUNNING' : 'READY'}
            />
          </div>
          <div className={styles.stack} style={{ minHeight: 360, paddingTop: 20 }}>
            {(messages.data ?? []).map((message) => (
              <div className={styles.mutedBox} key={message.id}>
                <strong>
                  {message.role === 'USER'
                    ? '你'
                    : message.role === 'ASSISTANT'
                      ? 'Agent'
                      : message.role}
                </strong>
                <p style={{ whiteSpace: 'pre-wrap' }}>{message.text ?? ''}</p>
              </div>
            ))}
            {!messages.data?.length ? (
              <AhEmptyState
                title="还没有消息"
                description="在下方 Composer 描述你希望 Agent 完成的工作。"
              />
            ) : null}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim()) send.mutate();
            }}
            style={{ marginTop: 20 }}
          >
            <AhInput
              label="Composer"
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
              placeholder="描述下一步工作…"
              rightSection={
                <AhButton type="submit" size="xs" loading={send.isPending} disabled={!text.trim()}>
                  发送
                </AhButton>
              }
            />
            <div className={styles.subtle} style={{ marginTop: 8 }}>
              Model、Mode、Reasoning 在 Session 配置中管理；Approval、Diff、Terminal 从右侧
              Inspector 逐步展开。
            </div>
          </form>
        </section>
        <aside className={styles.inspector}>
          <AhSurface>
            <div className={styles.surfaceHeader}>
              <div>
                <h3>Inspector</h3>
                <p>Changes · Files · Tool Calls</p>
              </div>
              <Wrench size={17} />
            </div>
            <div className={styles.surfaceBody}>
              <div className={styles.row}>
                <GitBranch size={16} />
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>Changes</span>
                  <span className={styles.rowMeta}>运行后查看 Git Diff</span>
                </div>
                <ArrowRight size={14} />
              </div>
              <div className={styles.row}>
                <FolderKanban size={16} />
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>Files</span>
                  <span className={styles.rowMeta}>Project 文件树按需加载</span>
                </div>
                <ArrowRight size={14} />
              </div>
              <div className={styles.row}>
                <SquareTerminal size={16} />
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>Tool Calls</span>
                  <span className={styles.rowMeta}>Approval 与事件记录</span>
                </div>
                <ArrowRight size={14} />
              </div>
            </div>
          </AhSurface>
        </aside>
      </div>
    </div>
  );
}

function realtimeSubscribe(sessionId: string, listener: () => void): () => void {
  return realtime.subscribe(`session:${sessionId}`, listener);
}
