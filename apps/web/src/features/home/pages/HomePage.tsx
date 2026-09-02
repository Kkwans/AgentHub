import {
  AhButton,
  AhEmptyState,
  AhStatusPill,
  AhSurface,
  AlertTriangle,
  ArrowRight,
  Bot,
  CircleStop,
  FolderKanban,
  Plus,
  Tag,
} from '@agenthub/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import type {
  AgentRecord,
  DashboardSnapshot,
  ProjectRecord,
  SessionRecord,
  TaskRecord,
} from '../../../lib/api';
import { api } from '../../../lib/api';
import { QueryMessage, displayDate } from '../../shared/page-primitives';
import homeStyles from '../home.module.css';

type HomeData = {
  dashboard: DashboardSnapshot;
  projects: ProjectRecord[];
  sessions: SessionRecord[];
  agents: AgentRecord[];
};

export function HomePage() {
  const queryClient = useQueryClient();
  const preloadedHomeDataRef = useRef(
    typeof window !== 'undefined'
      ? (window as Window & { __agenthubHomeDataPromise?: Promise<HomeData | undefined> })
          .__agenthubHomeDataPromise
      : undefined,
  );
  const consumedPreloadKeysRef = useRef(new Set<keyof HomeData>());
  const queryWithPreload = <K extends keyof HomeData>(
    key: K,
    fallback: () => Promise<HomeData[K]>,
  ) => {
    const preload = preloadedHomeDataRef.current;
    if (!preload || consumedPreloadKeysRef.current.has(key)) return fallback();
    consumedPreloadKeysRef.current.add(key);
    return preload
      .then((data) => (data?.[key] === undefined ? fallback() : data[key]))
      .catch(fallback);
  };
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => queryWithPreload('dashboard', () => api.get<DashboardSnapshot>('/dashboard')),
    staleTime: 30_000,
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => queryWithPreload('projects', () => api.get<ProjectRecord[]>('/projects')),
    staleTime: 30_000,
  });
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => queryWithPreload('sessions', () => api.get<SessionRecord[]>('/sessions')),
    staleTime: 30_000,
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => queryWithPreload('agents', () => api.get<AgentRecord[]>('/agents')),
    staleTime: 30_000,
  });
  const error = dashboard.error ?? projects.error ?? sessions.error ?? agents.error;
  const loading =
    dashboard.isLoading || projects.isLoading || sessions.isLoading || agents.isLoading;
  const standardProjects = useMemo(
    () => (projects.data ?? []).filter((project) => (project.kind ?? 'STANDARD') === 'STANDARD'),
    [projects.data],
  );
  const testProjects = useMemo(
    () => (projects.data ?? []).filter((project) => project.kind === 'TEST'),
    [projects.data],
  );
  const activeProject =
    standardProjects.find((project) => project.status === 'ACTIVE') ?? standardProjects[0];
  const dashboardRunning = dashboard.data?.runningSessions ?? [];
  const dashboardApprovals = dashboard.data?.pendingApprovals ?? [];
  const dashboardTasks = dashboard.data?.attentionTasks ?? [];
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
  const isMainProject = (projectId: string | null | undefined) =>
    !projectId || projectById.get(projectId)?.kind !== 'TEST';
  const running = useMemo(
    () => dashboardRunning.filter((session) => isMainProject(session.projectId)),
    [dashboardRunning, projectById],
  );
  const attention = useMemo(
    () => [
      ...dashboardApprovals.filter((approval) =>
        isMainProject(sessionById.get(approval.sessionId)?.projectId),
      ),
      ...dashboardTasks.filter((task) => isMainProject(task.projectId)),
    ],
    [dashboardApprovals, dashboardTasks, projectById, sessionById],
  );
  const recentSessions = useMemo(
    () =>
      [...(sessions.data ?? [])]
        .filter((session) => projectById.get(session.projectId)?.kind !== 'TEST')
        .sort((left, right) => {
          const rightTime = Date.parse(right.lastActiveAt);
          const leftTime = Date.parse(left.lastActiveAt);
          return (
            (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime)
          );
        })
        .slice(0, 4),
    [projectById, sessions.data],
  );
  const activeProjectCount = standardProjects.filter(
    (project) => project.status === 'ACTIVE',
  ).length;
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
  const hasProjects = standardProjects.length > 0;
  const [detailsReady, setDetailsReady] = useState(!loading && !error);
  useEffect(() => {
    if (loading || error) {
      setDetailsReady(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setDetailsReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [error, loading]);
  useEffect(() => {
    if (!detailsReady) return;
    // Wait until the hero and first summary frame have painted before warming
    // the primary Project route. This keeps route navigation fast without
    // competing with the Home LCP resource burst.
    const timer = window.setTimeout(() => {
      void import('../../projects/pages/ProjectsPage');
      void queryClient.prefetchQuery({
        queryKey: ['tasks'],
        queryFn: () => api.get<TaskRecord[]>('/tasks'),
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [detailsReady, queryClient]);
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
        }}
        label="正在汇总工作台状态"
      />
      {loading ? (
        <section
          className={`${homeStyles.continueStrip} ${homeStyles.continueEmpty}`}
          aria-labelledby="home-loading-title"
        >
          <div>
            <span className={homeStyles.eyebrow}>WORKSPACE</span>
            <h1 id="home-loading-title">正在加载工作台</h1>
            <p>正在汇总 Project、Session 与 Agent 状态。</p>
          </div>
        </section>
      ) : null}
      {!loading && !error ? (
        <>
          <section
            className={`${homeStyles.continueStrip} ${!hasProjects ? homeStyles.continueEmpty : ''}`}
            aria-labelledby="home-continue-title"
          >
            <div>
              <span className={homeStyles.eyebrow}>WORKSPACE</span>
              <h1 id="home-continue-title">{hasProjects ? '继续工作' : '从一个 Project 开始'}</h1>
              <p>
                {hasProjects
                  ? '从最近项目继续，处理需要审阅的结果，或直接交给 Agent 一项新工作。'
                  : '从允许访问的目录创建 Project，随后选择 Agent 开始第一项工作。'}
              </p>
            </div>
            <div className={homeStyles.heroActions}>
              <Link to={activeProject ? `/projects/${activeProject.id}/work/new` : '/projects/new'}>
                <AhButton className={homeStyles.heroCta} leftSection={<Plus size={15} />}>
                  {hasProjects ? '新建工作' : '创建 Project'}
                </AhButton>
              </Link>
              {recentSessions[0] ? (
                <Link to={`/workspace/${recentSessions[0].id}`}>
                  <AhButton variant="default">继续最近会话</AhButton>
                </Link>
              ) : null}
            </div>
          </section>

          {detailsReady ? (
            <>
              <section className={homeStyles.metricStrip} aria-label="工作台摘要">
                {[
                  {
                    label: '活跃项目',
                    value: activeProjectCount,
                    hint: '当前可用 Project',
                    Icon: FolderKanban,
                    tone: 'metricViolet',
                  },
                  {
                    label: '运行中的工作',
                    value: running.length,
                    hint: '当前活跃 Session',
                    Icon: CircleStop,
                    tone: 'metricBlue',
                  },
                  {
                    label: '可用 Agent',
                    value: readyAgentCount ?? '—',
                    hint: '已接入并就绪',
                    Icon: Bot,
                    tone: 'metricGreen',
                  },
                  {
                    label: '需要处理',
                    value: attention.length,
                    hint: 'Approval 与 Review',
                    Icon: Tag,
                    tone: 'metricPurple',
                  },
                ].map(({ label, value, hint, Icon, tone }) => (
                  <div className={homeStyles.metricCard} key={label}>
                    <span className={`${homeStyles.metricIcon} ${homeStyles[tone]}`}>
                      <Icon size={16} />
                    </span>
                    <span className={homeStyles.metricCopy}>
                      <small>{label}</small>
                      <strong>{value}</strong>
                      <span>{hint}</span>
                    </span>
                  </div>
                ))}
              </section>

              <section className={homeStyles.contentGrid} aria-label="最近项目与工作">
                <section
                  className={homeStyles.recentSection}
                  aria-labelledby="recent-projects-title"
                >
                  <div className={homeStyles.sectionHeading}>
                    <div>
                      <h2 id="recent-projects-title">最近项目</h2>
                      <p>继续最近工作，或打开项目上下文。</p>
                    </div>
                    <Link className={homeStyles.sectionLink} to="/projects">
                      查看全部 <ArrowRight size={14} />
                    </Link>
                  </div>
                  {standardProjects.length ? (
                    <div className={homeStyles.projectList}>
                      {standardProjects.slice(0, 6).map((project, index) => {
                        const latestSession = (sessions.data ?? [])
                          .filter((session) => session.projectId === project.id)
                          .sort(
                            (left, right) =>
                              Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt),
                          )[0];
                        const workCount = dashboardTasks.filter(
                          (task) =>
                            task.projectId === project.id &&
                            !['DONE', 'CANCELED'].includes(task.status),
                        ).length;
                        return (
                          <Link
                            className={homeStyles.projectRow}
                            key={project.id}
                            to={`/projects/${project.id}/overview`}
                          >
                            <span
                              className={`${homeStyles.entityLogo} ${homeStyles[`entityColor${index % 4}`]}`}
                            >
                              {project.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className={homeStyles.projectRowCopy}>
                              <strong>{project.name}</strong>
                              <small>
                                {project.description ??
                                  (project.repoKind === 'GIT' ? 'Git 项目' : '目录项目')}
                              </small>
                            </span>
                            <span className={homeStyles.projectRowMeta}>
                              <AhStatusPill status={project.status} />
                              <small>
                                {workCount
                                  ? `${workCount} 项进行中`
                                  : latestSession
                                    ? displayDate(latestSession.lastActiveAt)
                                    : '暂无活动'}
                              </small>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={homeStyles.emptyProjectPanel}>
                      <AhEmptyState
                        title="还没有项目"
                        description="从允许访问的目录创建第一个 Project。"
                        action={
                          <Link to="/projects/new">
                            <AhButton size="sm">创建项目</AhButton>
                          </Link>
                        }
                      />
                    </div>
                  )}
                  {testProjects.length ? (
                    <details className={homeStyles.testProjects}>
                      <summary>测试 Project（{testProjects.length}）</summary>
                      <div className={homeStyles.testProjectList}>
                        {testProjects.map((project) => (
                          <Link
                            key={project.id}
                            className={homeStyles.testProjectRow}
                            to={`/projects/${project.id}/overview`}
                          >
                            <span>
                              <strong>{project.name}</strong>
                              <small>{project.description ?? '测试数据'}</small>
                            </span>
                            <AhStatusPill status={project.status} />
                          </Link>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </section>

                <aside className={homeStyles.sideColumn}>
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
                                activeProject
                                  ? `/projects/${activeProject.id}/work/new`
                                  : '/projects'
                              }
                            >
                              新建工作 <ArrowRight size={14} />
                            </Link>
                          }
                        />
                      )}
                    </div>
                  </AhSurface>
                </aside>
              </section>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
