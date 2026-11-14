import {
  AhButton,
  AhDialog,
  AhStatusPill,
  AlertTriangle,
  ArrowRight,
  Bot,
  CircleStop,
} from '@agenthub/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

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
  const navigate = useNavigate();
  const [choosingProject, setChoosingProject] = useState(false);
  const bootstrapWindow =
    typeof window !== 'undefined'
      ? (window as Window & {
          __agenthubHomeDataPromise?: Promise<HomeData | undefined>;
          __agenthubHomeDataValue?: HomeData;
        })
      : undefined;
  const preloadedHomeDataRef = useRef(
    typeof window !== 'undefined' ? bootstrapWindow?.__agenthubHomeDataPromise : undefined,
  );
  const preloadedHomeDataValueRef = useRef(bootstrapWindow?.__agenthubHomeDataValue);
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
    initialData: preloadedHomeDataValueRef.current?.dashboard,
    staleTime: 30_000,
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => queryWithPreload('projects', () => api.get<ProjectRecord[]>('/projects')),
    initialData: preloadedHomeDataValueRef.current?.projects,
    staleTime: 30_000,
  });
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => queryWithPreload('sessions', () => api.get<SessionRecord[]>('/sessions')),
    initialData: preloadedHomeDataValueRef.current?.sessions,
    staleTime: 30_000,
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => queryWithPreload('agents', () => api.get<AgentRecord[]>('/agents')),
    initialData: preloadedHomeDataValueRef.current?.agents,
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
  const activeProjects = standardProjects.filter((project) => project.status === 'ACTIVE');
  const activeProject = activeProjects.length === 1 ? activeProjects[0] : undefined;
  const chooseProject = (id: string) => {
    // Read current cache, not the item captured before a background refresh.
    const current = queryClient
      .getQueryData<ProjectRecord[]>(['projects'])
      ?.find(
        (project) =>
          project.id === id &&
          project.status === 'ACTIVE' &&
          (project.kind ?? 'STANDARD') === 'STANDARD',
      );
    if (!current || projects.isFetching || projects.error) return;
    setChoosingProject(false);
    navigate(`/projects/${encodeURIComponent(current.id)}/work/new`);
  };
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
  const [showAllAttention, setShowAllAttention] = useState(false);
  const attentionItems = attention.map((item) => {
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
  // Keep the route shell interactive while the summary sections wait for their
  // first post-data frame. This also prevents a cached Home remount from
  // competing with the next client-side navigation.
  const [detailsReady, setDetailsReady] = useState(false);
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
    // Warm the primary Project route in the first task after Home's complete
    // frame. A fixed delay lets the first click pay the lazy chunk cost on
    // slower ARM hosts; scheduling after paint keeps the Home LCP path clear
    // while making the normal Home → Projects transition cache-hot.
    const timer = window.setTimeout(() => {
      void import('../../projects/pages/ProjectsPage');
      void queryClient.prefetchQuery({
        queryKey: ['tasks'],
        queryFn: () => api.get<TaskRecord[]>('/tasks'),
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [detailsReady, queryClient]);
  return (
    <div
      className={`${homeStyles.homePage} ${!loading && !error && !hasProjects ? homeStyles.emptyHome : ''} page-content page-shell workspace-page`}
    >
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
      {loading ? <h1>正在加载工作台</h1> : null}
      {!loading && !error ? (
        <>
          <header className={homeStyles.header}>
            <div>
              {hasProjects ? <span className={homeStyles.eyebrow}>工作台</span> : null}
              <h1>{hasProjects ? '继续工作' : '从你的项目，开始第一项工作'}</h1>
              <p>
                {hasProjects
                  ? '回到最近的上下文，或把一个新目标交给 Agent。'
                  : '连接工作目录，让 Agent 在清晰的项目上下文中协作。'}
              </p>
            </div>
            <div className={homeStyles.newWorkTarget}>
              {activeProjects.length > 1 ? (
                <button
                  type="button"
                  className={homeStyles.primaryAction}
                  onClick={() => setChoosingProject(true)}
                >
                  新建工作 <ArrowRight size={16} aria-hidden="true" />
                </button>
              ) : (
                <Link
                  className={homeStyles.primaryAction}
                  to={activeProject ? `/projects/${activeProject.id}/work/new` : '/projects/new'}
                >
                  {activeProject ? '新建工作' : '创建项目'}{' '}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              )}
              {activeProject ? <span>目标项目：{activeProject.name}</span> : null}
            </div>
          </header>
          {detailsReady ? (
            <>
              {attentionItems.length ? (
                <section className={homeStyles.panel} aria-labelledby="home-attention-title">
                  <div className={homeStyles.sectionHeading}>
                    <h2 id="home-attention-title">
                      需要你处理 <span>{attention.length}</span>
                    </h2>
                    <p>批准请求、受阻任务与待审阅结果</p>
                  </div>
                  {(showAllAttention ? attentionItems : attentionItems.slice(0, 5)).map((item) => (
                    <AttentionItemRow key={item.id} item={item} />
                  ))}
                  {attentionItems.length > 5 ? (
                    <button
                      type="button"
                      className={homeStyles.expandAttention}
                      aria-expanded={showAllAttention}
                      onClick={() => setShowAllAttention((value) => !value)}
                    >
                      {showAllAttention
                        ? '收起待处理事项'
                        : `查看全部 ${attentionItems.length} 项待处理事项`}
                    </button>
                  ) : null}
                </section>
              ) : null}
              {!hasProjects ? (
                <section className={homeStyles.onboarding} aria-labelledby="home-start-title">
                  <div className={homeStyles.intro}>
                    <h2 id="home-start-title">准备第一个普通项目</h2>
                    <p>连接已有目录，不搬动代码；开始工作前仍会核验权限与执行环境。</p>
                  </div>
                  <ol className={homeStyles.steps}>
                    <li>
                      <span>01</span>
                      <div>
                        <h3>连接项目目录</h3>
                        <p>选择允许访问的仓库或文件夹，保留已有文件。</p>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <h3>检查 Agent 接入</h3>
                        <p>确认执行位置与认证，再选择 Agent。</p>
                        <Link to="/agents">
                          查看 Agent 中心 <ArrowRight size={14} aria-hidden="true" />
                        </Link>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <h3>描述要完成的目标</h3>
                        <p>在会话中跟进进度、批准操作和审阅结果。</p>
                      </div>
                    </li>
                  </ol>
                </section>
              ) : null}
              {recentSessions.length ? (
                <section className={homeStyles.panel} aria-labelledby="home-recent-title">
                  <div className={homeStyles.sectionHeading}>
                    <h2 id="home-recent-title">继续最近工作</h2>
                    <p>保留上次的对话与上下文</p>
                  </div>
                  {recentSessions.map((session) => (
                    <Link
                      className={homeStyles.row}
                      key={session.id}
                      to={`/workspace/${session.id}`}
                    >
                      <span className={homeStyles.copy}>
                        <strong>{session.title}</strong>
                        <small>
                          {projectName(session.projectId) ?? '项目'} ·{' '}
                          {agentById.get(session.agentId)?.name ?? 'Agent'} ·{' '}
                          {displayDate(session.lastActiveAt)}
                        </small>
                      </span>
                      <AhStatusPill status={session.status} />
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  ))}
                </section>
              ) : null}
              {hasProjects ? (
                <section aria-labelledby="recent-projects-title">
                  <div className={homeStyles.sectionHeading}>
                    <h2 id="recent-projects-title">你的项目</h2>
                    <Link to="/projects">
                      查看全部 <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </div>
                  <div className={homeStyles.projectGrid}>
                    {standardProjects.slice(0, 6).map((project) => (
                      <Link
                        className={homeStyles.project}
                        key={project.id}
                        to={`/projects/${project.id}/overview`}
                      >
                        <span className={homeStyles.projectHeading}>
                          <strong>{project.name}</strong>
                          <ArrowRight size={16} aria-hidden="true" />
                        </span>
                        <p>
                          {project.description ||
                            (project.repoKind === 'GIT' ? 'Git 项目' : '目录项目')}
                        </p>
                        <AhStatusPill status={project.status} />
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
              <footer className={homeStyles.statusLine} aria-label="工作台状态">
                <span>
                  {activeProjectCount} 个活跃项目 · {running.length} 个运行中会话
                </span>
                <span>{readyAgentCount ?? 0} 个 Agent 全局就绪，项目可用性需单独检查。</span>
                {!readyAgentCount ? <Link to="/agents">检查 Agent 接入</Link> : null}
                {!attention.length ? <span>暂无待批准或待审阅事项</span> : null}
              </footer>
              {testProjects.length ? (
                <details className={homeStyles.testProjects}>
                  <summary>测试项目（{testProjects.length}）</summary>
                  <p>测试项目不计入日常工作概览。</p>
                  {testProjects.map((project) => (
                    <Link
                      className={homeStyles.row}
                      key={project.id}
                      to={`/projects/${project.id}/overview`}
                    >
                      <span className={homeStyles.copy}>
                        <strong>{project.name}</strong>
                        <small>{project.description ?? '测试数据'}</small>
                      </span>
                      <AhStatusPill status={project.status} />
                    </Link>
                  ))}
                </details>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      <AhDialog
        open={choosingProject}
        title="选择工作所属项目"
        description="先确认目录，再填写工作内容。这里只显示活跃的正式项目。"
        onClose={() => setChoosingProject(false)}
        actions={
          <AhButton variant="default" onClick={() => setChoosingProject(false)}>
            取消
          </AhButton>
        }
      >
        <div className={homeStyles.projectChoices}>
          {activeProjects.map((project) => (
            <button
              type="button"
              key={project.id}
              className={homeStyles.projectChoice}
              disabled={projects.isFetching || Boolean(projects.error)}
              onClick={() => chooseProject(project.id)}
            >
              <strong>{project.name}</strong>
              <code>{project.rootPath}</code>
            </button>
          ))}
          {activeProjects.length === 0 ? (
            <p role="status">暂无活跃正式项目，请返回创建项目。</p>
          ) : null}
          {projects.isFetching ? <p role="status">正在更新项目，请稍候。</p> : null}
          {projects.error ? <p role="alert">项目列表无法确认，请关闭后重试。</p> : null}
        </div>
      </AhDialog>
    </div>
  );
}

type AttentionItem = {
  title: string;
  description: string | null | undefined;
  meta: string | undefined;
  action: string;
  href: string;
  tone: 'warning' | 'danger' | 'info';
};

function AttentionItemRow({ item }: { item: AttentionItem }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const textRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const text = textRef.current;
    if (!text || expanded) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      setTruncated(
        Array.from(text.children).some((child) => child.scrollHeight > child.clientHeight + 1),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const child of text.children) observer.observe(child);
    // Font substitution can change scrollHeight without resizing the clamped box.
    const fonts = document.fonts;
    void fonts?.ready.then(measure, () => undefined);
    fonts?.addEventListener('loadingdone', measure);
    return () => {
      active = false;
      observer.disconnect();
      fonts?.removeEventListener('loadingdone', measure);
    };
  }, [expanded, item.title, item.description, item.meta]);
  const toneClass = {
    warning: homeStyles.attentionWarning,
    danger: homeStyles.attentionDanger,
    info: homeStyles.attentionInfo,
  }[item.tone];
  return (
    <div
      className={homeStyles.attentionItem}
      data-expanded={expanded}
      data-has-details={truncated || expanded}
    >
      <div className={homeStyles.attentionBody}>
        <span className={`${homeStyles.icon} ${toneClass}`} aria-hidden="true">
          {item.tone === 'warning' ? (
            <AlertTriangle size={18} />
          ) : item.tone === 'danger' ? (
            <CircleStop size={18} />
          ) : (
            <Bot size={18} />
          )}
        </span>
        <span
          className={`${homeStyles.copy} ${homeStyles.attentionText}`}
          id={detailsId}
          ref={textRef}
        >
          <strong>{item.title}</strong>
          <small>
            {item.meta}
            {item.description ? ` · ${item.description}` : ''}
          </small>
        </span>
      </div>
      <div className={homeStyles.attentionActions}>
        <Link
          className={homeStyles.rowAction}
          to={item.href}
          aria-label={`${item.action}：${item.title}`}
        >
          {item.action} <ArrowRight size={14} aria-hidden="true" />
        </Link>
        {truncated || expanded ? (
          <button
            type="button"
            className={homeStyles.attentionDetailsToggle}
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={`${expanded ? '收起' : '展开'}详情：${item.title}`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '收起详情' : '展开详情'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
