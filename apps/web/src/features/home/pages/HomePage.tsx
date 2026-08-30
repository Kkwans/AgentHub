import {
  AhButton,
  AhEmptyState,
  AhMetric,
  AhReveal,
  AhStatusPill,
  AhSurface,
  AlertTriangle,
  ArrowRight,
  Bot,
  CircleStop,
  FolderKanban,
  GitBranch,
  Play,
  Plus,
  Tag,
} from '@agenthub/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import type {
  AgentRecord,
  DashboardSnapshot,
  ProjectRecord,
  SessionRecord,
} from '../../../lib/api';
import { api } from '../../../lib/api';
import {
  QueryMessage,
  displayDate,
} from '../../shared/page-primitives';
import homeStyles from '../home.module.css';

export function HomePage() {
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
      {!loading && !error ? (
        <>
          <AhReveal>
            <section className={homeStyles.hero} aria-labelledby="home-hero-title">
              <div className={homeStyles.heroCopy}>
                <p className={homeStyles.eyebrow}>AI ENGINEERING WORKBENCH</p>
                <h1 id="home-hero-title">把注意力放在工作本身。</h1>
                <p className={homeStyles.heroSubtitle}>
                  从最近项目继续，处理需要审阅的结果，或直接交给 Agent 一项新工作。
                </p>
                <div className={homeStyles.heroActions}>
                  <Link to={activeProject ? `/projects/${activeProject.id}/work/new` : '/projects'}>
                    <AhButton className={homeStyles.heroCta} leftSection={<Plus size={16} />}>
                      新建工作
                    </AhButton>
                  </Link>
                  <Link to={recentSessions[0] ? `/workspace/${recentSessions[0].id}` : '/projects'}>
                    <AhButton variant="default">继续最近会话</AhButton>
                  </Link>
                </div>
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
                    label="需要处理"
                    value={attention.length}
                    hint="Approval 与 Review"
                    tone={attention.length ? 'warning' : 'neutral'}
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
              {standardProjects.length ? (
                <div className={homeStyles.projectGrid}>
                  {standardProjects.slice(0, 4).map((project, index) => (
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
                          <small>{project.description ?? project.rootPath}</small>
                        </span>
                        <AhStatusPill status={project.status} />
                      </Link>
                    ))}
                  </div>
                </details>
              ) : null}
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
