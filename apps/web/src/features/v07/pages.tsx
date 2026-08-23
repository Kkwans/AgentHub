import {
  AhButton,
  AhDialog,
  AhEmptyState,
  AhErrorState,
  AhInput,
  AhLoadingState,
  AhMetric,
  AhProjectContext,
  AhReveal,
  AhSelect,
  AhStatusPill,
  AhSurface,
  AhTextarea,
  AhThemeSelect,
  ArrowRight,
  Bot,
  CircleStop,
  Copy,
  Eye,
  FolderKanban,
  GitBranch,
  Link2,
  MessageSquare,
  Network,
  Play,
  Plus,
  RefreshCw,
  Search,
  ScanSearch,
  Server,
  ShieldCheck,
  SquareTerminal,
  Tag,
  Wrench,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';

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
import { Composer, Conversation, Inspector, SessionRail } from '../workspace/components/WorkspaceSections';
import { TerminalDock } from '../workspace/components/TerminalDock';
import { labelPromptBindingTarget, labelPromptKind, labelPromptSelector, labelPromptType, labelPromptVersionSource } from '../../presentation/domain-labels';
import styles from '../surface.module.css';
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

function QueryMessage({ loading, error, retry, label }: { loading: boolean; error: Error | null; retry?: () => void; label: string }) {
  if (loading) return <AhLoadingState label={label} />;
  if (error) return <AhErrorState description={error.message} {...(retry ? { retry } : {})} />;
  return null;
}

function displayDate(value?: string | null): string {
  if (!value) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '暂无记录' : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
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

export function HomePageV07() {
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardSnapshot>('/dashboard') });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectRecord[]>('/projects') });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionRecord[]>('/sessions') });
  const targets = useQuery({ queryKey: ['targets'], queryFn: () => api.get<ExecutionTargetRecord[]>('/execution-targets') });
  const error = dashboard.error ?? projects.error ?? sessions.error ?? targets.error;
  const loading = dashboard.isLoading || projects.isLoading || sessions.isLoading || targets.isLoading;
  const activeProject = projects.data?.find((project) => project.status === 'ACTIVE') ?? projects.data?.[0];
  const running = dashboard.data?.runningSessions ?? [];
  const attention = [...(dashboard.data?.pendingApprovals ?? []), ...(dashboard.data?.attentionTasks ?? [])];
  return (
    <Screen eyebrow="Workbench" title="今天需要处理什么" description="从 Project 出发，描述工作、观察 Agent 执行，并在同一个工作台完成 Review。" actions={<Link to={activeProject ? `/projects/${activeProject.id}/work/new` : '/projects'}><AhButton leftSection={<Plus size={16} />}>新建工作</AhButton></Link>}>
      <QueryMessage loading={loading} error={error} retry={() => { void dashboard.refetch(); void projects.refetch(); void sessions.refetch(); void targets.refetch(); }} label="正在汇总运行与待处理状态" />
      {!loading && !error ? <>
        <section className={styles.metrics} aria-label="工作台摘要">
          <div className={styles.metric}><AhMetric label="待处理" value={attention.length} hint="Approval 与待审阅 Task" tone={attention.length ? 'warning' : 'neutral'} /></div>
          <div className={styles.metric}><AhMetric label="运行中" value={running.length} hint="当前活跃 Session" tone={running.length ? 'accent' : 'neutral'} /></div>
          <div className={styles.metric}><AhMetric label="可用 Project" value={projects.data?.filter((item) => item.status === 'ACTIVE').length ?? 0} hint="已通过基础预检" /></div>
          <div className={styles.metric}><AhMetric label="在线执行环境" value={targets.data?.filter((item) => item.status === 'READY').length ?? 0} hint="Local / Docker / Remote" tone="success" /></div>
        </section>
        <div className={`${styles.grid} ${styles.grid2}`}>
          <AhSurface className={styles.attention}>
            <div className={styles.surfaceHeader}><div><h3>下一步</h3><p>需要你决定的事情</p></div><AhStatusPill status={attention.length ? 'PENDING' : 'DONE'} /></div>
            <div className={styles.surfaceBody}>
              {!attention.length ? <AhEmptyState compact title="没有待处理项" description="新的 Approval 与 Review 会在这里出现。" action={<Link className={styles.link} to="/projects">查看项目 <ArrowRight size={14} /></Link>} /> : attention.slice(0, 5).map((item) => <Link className={styles.row} key={item.id} to={'sessionId' in item ? `/workspace/${item.sessionId}` : activeProject ? `/projects/${activeProject.id}/work` : '/projects'}><div className={styles.rowMain}><span className={styles.rowTitle}>{item.title}</span><span className={styles.rowMeta}>{'sessionId' in item ? '等待 Approval' : '等待 Task 审阅'}</span></div><AhStatusPill status={'status' in item ? item.status : 'PENDING'} /><ArrowRight size={16} /></Link>)}</div>
          </AhSurface>
          <AhSurface>
            <div className={styles.surfaceHeader}><div><h3>正在执行</h3><p>实时 Session 状态</p></div><Link className={styles.link} to={activeProject ? `/projects/${activeProject.id}/sessions` : '/projects'}>全部 <ArrowRight size={14} /></Link></div>
            <div className={styles.surfaceBody}>{!running.length ? <AhEmptyState compact title="当前没有运行中的 Session" description="从 Project Work 创建一项工作。" /> : running.map((session) => <Link className={styles.row} key={session.id} to={`/workspace/${session.id}`}><div className={styles.rowMain}><span className={styles.rowTitle}>{session.title}</span><span className={styles.rowMeta}>{session.cwd}</span></div><AhStatusPill status={session.status} /><ArrowRight size={16} /></Link>)}</div>
          </AhSurface>
        </div>
        <AhSurface>
          <div className={styles.surfaceHeader}><div><h3>最近 Project</h3><p>Project 是所有 Work、Session 和 Prompt 的上下文锚点。</p></div><Link className={styles.link} to="/projects">管理项目 <ArrowRight size={14} /></Link></div>
          <div className={styles.surfaceBody}>{(projects.data ?? []).slice(0, 5).map((project) => <Link className={styles.row} key={project.id} to={`/projects/${project.id}/overview`}><div className={styles.rowMain}><span className={styles.rowTitle}>{project.name}</span><span className={`${styles.rowMeta} ${styles.mono}`}>{project.rootPath}</span></div><AhStatusPill status={project.status} /><span className={styles.rowAction}>打开</span></Link>)}{!projects.data?.length ? <AhEmptyState compact title="还没有项目" action={<Link to="/projects/new"><AhButton size="sm">创建项目</AhButton></Link>} /> : null}</div>
        </AhSurface>
      </> : null}
    </Screen>
  );
}

export function ProjectsPageV07() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectRecord[]>('/projects') });
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return (projects.data ?? []).filter((project) => !value || `${project.name} ${project.rootPath}`.toLowerCase().includes(value));
  }, [projects.data, query]);
  return <Screen eyebrow="Projects" title="项目" description="选择一个工程作为上下文，进入 Overview、Work、Sessions 与 Prompt。" actions={<Link to="/projects/new"><AhButton leftSection={<Plus size={16} />}>创建项目</AhButton></Link>}>
    <QueryMessage loading={projects.isLoading} error={projects.error} retry={() => void projects.refetch()} label="正在加载项目" />
    {!projects.isLoading && !projects.error ? <AhSurface><div className={styles.toolbar}><AhInput label="" aria-label="搜索项目" placeholder="搜索项目名称或路径" value={query} onChange={(event) => setQuery(event.currentTarget.value)} leftSection={<Search size={16} />} /><span className={styles.subtle}>{filtered.length} 个项目</span></div><div className={styles.surfaceBody}>{filtered.map((project) => <div className={styles.row} key={project.id}><FolderKanban size={19} /><div className={styles.rowMain}><Link className={styles.rowTitle} to={`/projects/${project.id}/overview`}>{project.name}</Link><span className={`${styles.rowMeta} ${styles.mono}`} title={project.realRootPath}>{project.realRootPath}</span></div><AhStatusPill status={project.status} /><Link className={styles.rowAction} to={`/projects/${project.id}/work`}>进入工作台 <ArrowRight size={14} /></Link></div>)}{!filtered.length ? <AhEmptyState title={query ? '没有匹配的项目' : '还没有项目'} description={query ? '尝试其他关键词。' : '从允许访问的目录创建第一个 Project。'} action={!query ? <Link to="/projects/new"><AhButton>创建项目</AhButton></Link> : undefined} /> : null}</div></AhSurface> : null}
  </Screen>;
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
  const targets = useQuery({ queryKey: ['targets'], queryFn: () => api.get<ExecutionTargetRecord[]>('/execution-targets') });
  const roots = useQuery({ queryKey: ['filesystem-roots', targetId], queryFn: () => api.get<Array<{ rootId: string; label: string; path: string }>>(`/execution-targets/${targetId}/filesystem/roots`), enabled: Boolean(targetId) });
  useEffect(() => { if (!targetId && targets.data?.[0]) setTargetId(targets.data[0].id); }, [targetId, targets.data]);
  useEffect(() => { if (roots.data?.[0] && !rootPath) setRootPath(roots.data[0].path); }, [rootPath, roots.data]);
  const preflight = useQuery({ queryKey: ['project-preflight', targetId, rootPath], queryFn: () => api.post<{ status: 'READY' | 'BROKEN'; checks: Array<{ id: string; status: string; message: string }> }>('/projects/preflight', { targetId, rootPath }), enabled: Boolean(targetId && rootPath), staleTime: 2_000 });
  const create = useMutation({ mutationFn: () => api.post<ProjectRecord>('/projects', { name: name.trim(), description: description.trim() || undefined, targetId, rootPath }), onSuccess: (project) => { void client.invalidateQueries({ queryKey: ['projects'] }); navigate(`/projects/${project.id}/overview`); } });
  const close = () => navigate('/projects');
  return <>
    <ProjectsPageV07 />
    <AhDialog
      open
      onClose={close}
      title="创建项目"
      description="从 AgentHub 已授权的目录中选择工程。路径来自运行环境，不接受越权手工输入。"
      size={820}
      fullScreen={compact}
      actions={<><AhButton variant="default" onClick={close}>取消</AhButton><AhButton onClick={() => create.mutate()} loading={create.isPending} disabled={!name.trim() || !targetId || !rootPath || preflight.data?.status !== 'READY'}>预检并创建</AhButton></>}
    >
      <div className={styles.dialogBody} data-testid="create-project-dialog">
        <div className={styles.dialogIntro}><span className={styles.dialogStep}>1</span><div><strong>选择 Project 目录</strong><p>先确认运行环境和可访问根目录，AgentHub 会自动识别 Git 与工作区信息。</p></div></div>
        <div className={styles.fieldGrid}>
          <AhSelect label="运行环境" value={targetId} onChange={(value) => { setTargetId(value ?? ''); setRootPath(''); }} data={(targets.data ?? []).map((target) => ({ value: target.id, label: `${target.name} · ${target.os}/${target.arch}` }))} placeholder="选择运行环境" />
          <AhSelect label="允许目录" value={rootPath} onChange={(value) => { setRootPath(value ?? ''); if (!name && value) setName(value.split('/').filter(Boolean).at(-1) ?? ''); }} data={(roots.data ?? []).map((root) => ({ value: root.path, label: `${root.label} · ${root.path}` }))} placeholder={roots.isLoading ? '正在读取目录' : '选择目录'} disabled={!targetId || roots.isLoading} />
        </div>
        <div className={styles.dialogSection}>
          <div className={styles.dialogIntro}><span className={styles.dialogStep}>2</span><div><strong>确认 Project 身份</strong><p>名称默认取目录名，可按团队习惯调整。</p></div></div>
          <div className={styles.fieldGrid}>
            <AhInput label="项目名称" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="例如 AgentHub" required />
            <AhTextarea label="项目说明（可选）" value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder="描述这个工程的用途" minRows={3} />
          </div>
        </div>
        <div className={styles.mutedBox}>
          <strong>{preflight.isFetching ? '正在运行 Project preflight…' : preflight.data?.status === 'READY' ? '目录可以使用' : preflight.data ? '目录需要处理' : '选择目录后会自动运行 Project preflight'}</strong>
          {preflight.data ? <div className={styles.checkList}>{preflight.data.checks.map((check) => <div key={check.id}><span aria-hidden="true">{check.status === 'PASS' ? '✓' : '·'}</span>{check.message}</div>)}</div> : null}
          {preflight.error ? <div className={styles.dialogError}>{preflight.error.message}</div> : null}
        </div>
        <details open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)} className={styles.dialogDetails}>
          <summary>高级设置</summary>
          <p>Runtime、mount、worktree 和 Git 行为沿用当前执行环境的安全默认值。需要修改时请先完成 Project 创建，再从项目设置进入。</p>
        </details>
        {create.error ? <AhErrorState description={create.error.message} /> : null}
      </div>
    </AhDialog>
  </>;
}

export function ProjectContextLayoutV07() {
  const { projectId } = useParams();
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api.get<ProjectRecord>(`/projects/${projectId}`), enabled: Boolean(projectId) });
  if (project.isLoading) return <AhLoadingState label="正在加载项目上下文" />;
  if (project.error || !project.data) return <AhErrorState description={project.error?.message ?? '项目不存在'} />;
  const base = `/projects/${project.data.id}`;
  return <div className={styles.stack}><AhProjectContext project={project.data} tabs={[{ to: `${base}/overview`, label: '概览' }, { to: `${base}/work`, label: 'Work' }, { to: `${base}/sessions`, label: 'Sessions' }, { to: `${base}/prompts`, label: 'Prompts' }, { to: `${base}/settings`, label: '设置' }]} /><Outlet context={project.data} /></div>;
}

function useProjectContext(): ProjectRecord { return useOutletContext<ProjectRecord>(); }

export function ProjectOverviewPageV07() {
  const project = useProjectContext();
  const tasks = useQuery({ queryKey: ['tasks', project.id], queryFn: () => api.get<TaskRecord[]>(`/tasks?projectId=${project.id}`) });
  const sessions = useQuery({ queryKey: ['sessions', project.id], queryFn: () => api.get<SessionRecord[]>(`/sessions?projectId=${project.id}`) });
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<AgentRecord[]>('/agents') });
  return <Screen eyebrow="Project Overview" title={project.name} description={project.description ?? '从这里开始描述工作，选择 Agent 并进入执行。'} actions={<Link to={`/projects/${project.id}/work/new`}><AhButton leftSection={<Plus size={16} />}>新建工作</AhButton></Link>}><section className={styles.metrics}><div className={styles.metric}><AhMetric label="待办 Work" value={tasks.data?.filter((task) => task.status !== 'DONE' && task.status !== 'CANCELED').length ?? '—'} /></div><div className={styles.metric}><AhMetric label="Sessions" value={sessions.data?.length ?? '—'} /></div><div className={styles.metric}><AhMetric label="可用 Agent" value={agents.data?.filter((agent) => agent.status === 'READY').length ?? '—'} tone="success" /></div><div className={styles.metric}><AhMetric label="仓库" value={project.repoKind === 'GIT' ? 'Git' : '目录'} /></div></section><div className={`${styles.grid} ${styles.grid2}`}><AhSurface><div className={styles.surfaceHeader}><div><h3>最近 Work</h3><p>Goal 和 Task 的执行入口</p></div><Link className={styles.link} to={`/projects/${project.id}/work`}>查看全部</Link></div><div className={styles.surfaceBody}>{(tasks.data ?? []).slice(0, 4).map((task) => <Link className={styles.row} key={task.id} to={`/projects/${project.id}/work?task=${task.id}`}><div className={styles.rowMain}><span className={styles.rowTitle}>{task.title}</span><span className={styles.rowMeta}>{task.description ?? '暂无说明'}</span></div><AhStatusPill status={task.status} /><ArrowRight size={16} /></Link>)}{!tasks.data?.length ? <AhEmptyState compact title="还没有 Work" action={<Link to={`/projects/${project.id}/work/new`}><AhButton size="sm">描述一项工作</AhButton></Link>} /> : null}</div></AhSurface><AhSurface><div className={styles.surfaceHeader}><div><h3>最近 Sessions</h3><p>继续上次的执行上下文</p></div><Link className={styles.link} to={`/projects/${project.id}/sessions`}>查看全部</Link></div><div className={styles.surfaceBody}>{(sessions.data ?? []).slice(0, 4).map((session) => <Link className={styles.row} key={session.id} to={`/workspace/${session.id}`}><div className={styles.rowMain}><span className={styles.rowTitle}>{session.title}</span><span className={styles.rowMeta}>{displayDate(session.lastActiveAt)} · {session.branch ?? '默认分支'}</span></div><AhStatusPill status={session.status} /><ArrowRight size={16} /></Link>)}{!sessions.data?.length ? <AhEmptyState compact title="还没有 Session" /> : null}</div></AhSurface></div></Screen>;
}

export function ProjectWorkPageV07() {
  const project = useProjectContext();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { search } = useLocation();
  const workParams = new URLSearchParams(search);
  const selectedFromQuery = workParams.get('task');
  const selectedAgentId = workParams.get('agentId');
  const selectedPromptId = workParams.get('promptId');
  const tasks = useQuery({ queryKey: ['tasks', project.id], queryFn: () => api.get<TaskRecord[]>(`/tasks?projectId=${project.id}`) });
  const goals = useQuery({ queryKey: ['goals', project.id], queryFn: () => api.get<GoalRecord[]>(`/goals?projectId=${project.id}`) });
  const worktrees = useQuery({ queryKey: ['worktrees', project.id], queryFn: () => api.get<WorktreeExecutionRecord[]>(`/worktree-executions?projectId=${project.id}`) });
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<AgentRecord[]>('/agents') });
  const prompts = useQuery({ queryKey: ['prompts', project.id], queryFn: () => api.get<PromptRecord[]>(`/prompts?projectId=${project.id}`) });
  const [selectedId, setSelectedId] = useState(selectedFromQuery ?? '');
  useEffect(() => { if (!selectedId && tasks.data?.[0]) setSelectedId(tasks.data[0].id); }, [selectedId, tasks.data]);
  const selected = tasks.data?.find((task) => task.id === selectedId) ?? tasks.data?.[0];
  const transition = useMutation({ mutationFn: ({ id, status }: { id: string; status: TaskRecord['status'] }) => api.post(`/tasks/${id}/transition`, { status }), onSuccess: () => void client.invalidateQueries({ queryKey: ['tasks', project.id] }) });
  const start = useMutation({ mutationFn: async ({ id, agentId }: { id: string; agentId: string }) => { if (selected?.status === 'BACKLOG') await api.post(`/tasks/${id}/transition`, { status: 'READY' }); return api.post<{ session: { id: string } }>(`/tasks/${id}/start`, { agentId }); }, onSuccess: (result) => { void client.invalidateQueries({ queryKey: ['tasks', project.id] }); void client.invalidateQueries({ queryKey: ['sessions', project.id] }); navigate(`/workspace/${result.session.id}`); } });
  const selectedAgent = agents.data?.find((agent) => agent.id === selectedAgentId);
  const selectedPrompt = prompts.data?.find((prompt) => prompt.id === selectedPromptId);
  return <Screen eyebrow="Project Work" title="Work" description="List-first 的目标与任务视图；选择一项 Work，在 Inspector 中查看执行与 Review。" actions={<Link to={`/projects/${project.id}/work/new`}><AhButton leftSection={<Plus size={16} />}>新建 Work</AhButton></Link>}><QueryMessage loading={tasks.isLoading || goals.isLoading || worktrees.isLoading} error={tasks.error ?? goals.error ?? worktrees.error} retry={() => { void tasks.refetch(); void goals.refetch(); void worktrees.refetch(); }} label="正在加载 Work" />{!tasks.isLoading && !tasks.error ? <div className={styles.detailGrid}><AhSurface><div className={styles.toolbar}><span className={styles.subtle}>{goals.data?.length ?? 0} 个 Goal · {tasks.data?.length ?? 0} 个 Task</span><Link className={styles.link} to={`/projects/${project.id}/work?view=board`}>切换 Board</Link></div><div className={styles.surfaceBody}>{(tasks.data ?? []).map((task) => <button type="button" className={`${styles.row} ${task.id === selected?.id ? styles.masterRowActive : ''}`} key={task.id} onClick={() => setSelectedId(task.id)}><div className={styles.rowMain}><span className={styles.rowTitle}>{task.title}</span><span className={styles.rowMeta}>{task.description ?? '暂无说明'}</span></div><AhStatusPill status={task.status} /><span className={styles.subtle}>{task.priority ? `P${task.priority}` : ''}</span></button>)}{!tasks.data?.length ? <AhEmptyState title="还没有 Task" description="先描述一项工作，系统会建立 Goal/Task 上下文。" action={<Link to={`/projects/${project.id}/work/new`}><AhButton>新建 Work</AhButton></Link>} /> : null}</div></AhSurface><AhSurface className={styles.inspector}><div className={styles.surfaceHeader}><div><h3>{selected?.title ?? '选择一项 Work'}</h3><p>Inspector</p></div>{selected ? <AhStatusPill status={selected.status} /> : null}</div><div className={styles.surfaceBody}>{selected ? <><p>{selected.description ?? '暂无描述。'}</p><div className={styles.statusLine}><AhButton size="xs" variant="light" onClick={() => selectedAgentId ? start.mutate({ id: selected.id, agentId: selectedAgentId }) : transition.mutate({ id: selected.id, status: 'IN_PROGRESS' })} loading={transition.isPending || start.isPending} disabled={selected.status === 'IN_PROGRESS' || (!selectedAgentId && selected.status !== 'BACKLOG')}><Play size={14} /> {selectedAgentId ? '启动 Session' : '开始'}</AhButton><AhButton size="xs" variant="default" color="gray" onClick={() => transition.mutate({ id: selected.id, status: 'CANCELED' })} loading={transition.isPending} disabled={selected.status === 'DONE' || selected.status === 'CANCELED'}><CircleStop size={14} /> 取消</AhButton></div>{selectedAgent ? <div className={styles.subtle}>Agent：{selectedAgent.name}</div> : null}{selectedPrompt ? <div className={styles.subtle}>PromptOS：{selectedPrompt.name} · {labelPromptType(selectedPrompt.type)}</div> : null}<div className={styles.mutedBox}><strong>执行信息</strong><div>分支：{selected.branch ?? '尚未创建'}</div><div>Session：{selected.sessionId ? <Link className={styles.link} to={`/workspace/${selected.sessionId}`}>打开 Workspace</Link> : '尚未开始'}</div><div>Worktree：{worktrees.data?.find((item) => item.taskId === selected.id)?.status ?? '未创建'}</div></div></> : <AhEmptyState compact title="从列表选择 Work" />}</div></AhSurface></div> : null}</Screen>;
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
  const goals = useQuery({ queryKey: ['goals', project.id], queryFn: () => api.get<GoalRecord[]>(`/goals?projectId=${project.id}`) });
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<AgentRecord[]>('/agents') });
  const prompts = useQuery({ queryKey: ['prompts', project.id], queryFn: () => api.get<PromptRecord[]>(`/prompts?projectId=${project.id}`) });
  useEffect(() => { if (!agentId) setAgentId(agents.data?.find((agent) => agent.status === 'READY')?.id ?? ''); }, [agentId, agents.data]);
  const selectedAgent = agents.data?.find((agent) => agent.id === agentId);
  const selectedPrompt = prompts.data?.find((prompt) => prompt.id === promptId);
  const contextQuery = () => new URLSearchParams({ ...(agentId ? { agentId } : {}), ...(promptId ? { promptId } : {}) }).toString();
  const createGoal = useMutation({ mutationFn: () => api.post<GoalRecord>('/goals', { projectId: project.id, title: title.trim(), description: description.trim() || undefined }), onSuccess: (goal) => { const query = contextQuery(); navigate(`/projects/${project.id}/work?goal=${goal.id}${query ? `&${query}` : ''}`); } });
  const createTask = useMutation({
    mutationFn: async () => {
      const task = await api.post<TaskRecord>('/tasks', { projectId: project.id, goalId: goalId || undefined, title: title.trim(), description: description.trim() || undefined, priority: 2 });
      if (!agentId) return { task, sessionId: undefined };
      if (task.status === 'BACKLOG') await api.post(`/tasks/${task.id}/transition`, { status: 'READY' });
      const started = await api.post<{ session: { id: string } }>(`/tasks/${task.id}/start`, { agentId });
      return { task, sessionId: started.session.id };
    },
    onSuccess: ({ task, sessionId }) => {
      const query = contextQuery();
      navigate(sessionId ? `/workspace/${sessionId}` : `/projects/${project.id}/work?task=${task.id}${query ? `&${query}` : ''}`);
    },
  });
  const workError = createGoal.error ?? createTask.error;
  const close = () => navigate(`/projects/${project.id}/work`);
  const quickIntents = ['Bug', 'Feature', 'Refactor', 'Research'];
  return <>
    <ProjectWorkPageV07 />
    <AhDialog
      open
      onClose={close}
      title="描述一项工作"
      description="先表达结果，再选择推荐 Agent。创建并开始后会直接进入 Workspace。"
      size={720}
      fullScreen={compact}
      actions={<><AhButton variant="default" onClick={close}>取消</AhButton><AhButton onClick={() => kind === 'goal' ? createGoal.mutate() : createTask.mutate()} loading={createGoal.isPending || createTask.isPending} disabled={!title.trim()}>{kind === 'goal' ? '创建 Goal' : '创建并开始'}</AhButton></>}
    >
      <div className={styles.dialogBody} data-testid="new-work-dialog">
        <div className={styles.dialogContext}><span>当前 Project</span><strong>{project.name}</strong><code title={project.rootPath}>{project.rootPath}</code></div>
        <AhTextarea label="你想完成什么？" value={title} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="例如：修复登录流程并补齐回归测试" required minRows={5} />
        <div className={styles.quickIntents} aria-label="快速意图">
          <span className={styles.subtle}>快速意图（可选）</span>
          {quickIntents.map((value) => <AhButton key={value} size="xs" variant={intent === value ? 'light' : 'default'} aria-pressed={intent === value} onClick={() => { setIntent(value); if (!title.trim()) setTitle(`${value}：`); }}>{value}</AhButton>)}
        </div>
        <AhTextarea label="补充上下文（可选）" value={description} onChange={(event) => setDescription(event.currentTarget.value)} placeholder="验收标准、约束或参考资料" minRows={3} />
        <AhSelect label="推荐 Agent" value={agentId} onChange={(value) => setAgentId(value ?? '')} data={(agents.data ?? []).filter((agent) => agent.status === 'READY').map((agent) => ({ value: agent.id, label: `${agent.name} · ${agent.detectedVersion ?? '版本待检测'}` }))} placeholder="稍后在 Work Inspector 中选择" />
        <div className={styles.mutedBox}>{selectedAgent ? <><strong>{selectedAgent.name} 可用</strong><div>创建后会用这个 Agent 启动 Session，并把实时事件带入 Workspace。</div></> : '还没有选择 Agent；创建后仍可在 Work Inspector 中选择并开始。'}</div>
        <details open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)} className={styles.dialogDetails}>
          <summary>高级设置</summary>
          <div className={styles.dialogSection}>
            <div className={styles.actions}><AhButton size="xs" variant={kind === 'task' ? 'light' : 'default'} onClick={() => setKind('task')}>Task</AhButton><AhButton size="xs" variant={kind === 'goal' ? 'light' : 'default'} onClick={() => setKind('goal')}>Goal</AhButton></div>
            {kind === 'task' ? <AhSelect label="所属 Goal（可选）" value={goalId} onChange={(value) => setGoalId(value ?? '')} data={(goals.data ?? []).map((goal) => ({ value: goal.id, label: goal.title }))} placeholder="选择已有 Goal" mt="md" /> : null}
            <AhSelect label="PromptOS 资产（可选）" value={promptId} onChange={(value) => setPromptId(value ?? '')} data={(prompts.data ?? []).map((prompt) => ({ value: prompt.id, label: `${prompt.name} · ${labelPromptKind(prompt.kind)}` }))} placeholder="使用 Project Binding" mt="md" />
            <p className={styles.subtle}>{selectedPrompt ? `已选择 ${selectedPrompt.name}（${labelPromptType(selectedPrompt.type)}）。` : '未选择时按当前 Project / Task Binding 解析 Prompt。'}</p>
          </div>
        </details>
        {workError ? <AhErrorState title="创建或启动失败" description={workError.message} /> : null}
      </div>
    </AhDialog>
  </>;
}

export function ProjectSessionsPageV07() {
  const project = useProjectContext();
  const client = useQueryClient();
  const navigate = useNavigate();
  const sessions = useQuery({ queryKey: ['sessions', project.id], queryFn: () => api.get<SessionRecord[]>(`/sessions?projectId=${project.id}`) });
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<AgentRecord[]>('/agents') });
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState('新 Session');
  const [agentId, setAgentId] = useState('');
  useEffect(() => { if (!agentId && agents.data?.find((agent) => agent.status === 'READY')) setAgentId(agents.data.find((agent) => agent.status === 'READY')?.id ?? ''); }, [agentId, agents.data]);
  const create = useMutation({ mutationFn: () => api.post<SessionRecord>('/sessions', { projectId: project.id, agentId, title: title.trim(), cwd: project.rootPath }), onSuccess: (session) => { void client.invalidateQueries({ queryKey: ['sessions', project.id] }); setNewOpen(false); navigate(`/workspace/${session.id}`); } });
  return <Screen eyebrow="Project Sessions" title="Sessions" description="按 Project 查看会话历史，恢复上下文或进入沉浸式 Workspace。" actions={<AhButton leftSection={<Plus size={16} />} onClick={() => setNewOpen(true)}>新建 Session</AhButton>}><QueryMessage loading={sessions.isLoading || agents.isLoading} error={sessions.error ?? agents.error} retry={() => { void sessions.refetch(); void agents.refetch(); }} label="正在加载 Sessions" />{!sessions.isLoading && !sessions.error ? <AhSurface><div className={styles.surfaceBody}>{(sessions.data ?? []).map((session) => <div className={styles.row} key={session.id}><MessageSquare size={19} /><div className={styles.rowMain}><Link className={styles.rowTitle} to={`/workspace/${session.id}`}>{session.title}</Link><span className={styles.rowMeta}>{displayDate(session.lastActiveAt)} · {session.branch ?? '默认分支'} · {session.cwd}</span></div><AhStatusPill status={session.status} /><Link className={styles.rowAction} to={`/workspace/${session.id}`}>打开</Link></div>)}{!sessions.data?.length ? <AhEmptyState title="还没有 Session" description="从 New Work 创建第一项工作，再选择 Agent 运行。" action={<AhButton onClick={() => setNewOpen(true)}>创建 Session</AhButton>} /> : null}</div></AhSurface> : null}<AhDialog open={newOpen} onClose={() => setNewOpen(false)} title="新建 Session" description="使用当前 Project 作为工作目录。"><AhInput label="Session 名称" value={title} onChange={(event) => setTitle(event.currentTarget.value)} /><AhSelect label="Agent" value={agentId} onChange={(value) => setAgentId(value ?? '')} data={(agents.data ?? []).filter((agent) => agent.status === 'READY').map((agent) => ({ value: agent.id, label: agent.name }))} placeholder="选择 Agent" mt="md" /><div className={styles.actions} style={{ marginTop: 20 }}><AhButton onClick={() => create.mutate()} loading={create.isPending} disabled={!agentId || !title.trim()}>创建并进入 Workspace</AhButton></div>{create.error ? <AhErrorState description={create.error.message} /> : null}</AhDialog></Screen>;
}

export function AgentCenterPageV07() {
  const client = useQueryClient();
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<AgentRecord[]>('/agents') });
  const candidates = useQuery({ queryKey: ['discovery-agents'], queryFn: () => api.get<AgentCandidateRecord[]>('/discovery/agents') });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const adopt = useMutation({ mutationFn: (candidateId: string) => api.post(`/discovery/agents/${encodeURIComponent(candidateId)}/adopt`), onSuccess: () => { void client.invalidateQueries({ queryKey: ['agents'] }); void client.invalidateQueries({ queryKey: ['discovery-agents'] }); } });
  const filteredAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (agents.data ?? []).filter((agent) => {
      const matchesQuery = !normalized || `${agent.name} ${agent.agentKind} ${agent.detectedVersion ?? ''}`.toLowerCase().includes(normalized);
      const matchesFilter = filter === 'all' || (filter === 'ready' && agent.status === 'READY') || (filter === 'attention' && agent.status !== 'READY');
      return matchesQuery && matchesFilter;
    });
  }, [agents.data, filter, query]);
  const capabilitiesFor = (agent: AgentRecord) => {
    const labels: Record<string, string> = { session: 'Session', sessions: 'Sessions', run: 'Run', runs: 'Runs', approval: 'Approval', approvals: 'Approval', files: '文件', terminal: 'Terminal', git: 'Git' };
    const keys = Object.keys(agent.capabilitiesJson ?? {}).filter((key) => Boolean(agent.capabilitiesJson[key])).map((key) => labels[key.toLowerCase()] ?? '').filter(Boolean);
    return Array.from(new Set(['Session', 'Run', ...keys])).slice(0, 4);
  };
  const agentKindLabel = (kind: string) => ({ CODEX: 'Codex', CLAUDE_CODE: 'Claude Code', OPENCLAW: 'OpenClaw' }[kind] ?? 'Agent');
  return <Screen eyebrow="Agent Center" title="Agent" description="以可用性和健康为中心管理 Agent。底层 adapter、executable 和 container identity 只在 Diagnostics 中展开。" actions={<><Link to="/agents/runtimes"><AhButton variant="default" leftSection={<Server size={16} />}>Runtime</AhButton></Link><Link to="/agents/agents/discover"><AhButton leftSection={<RefreshCw size={16} />}>发现 Agent</AhButton></Link></>}><div className={styles.metrics}><div className={styles.metric}><AhMetric label="已就绪" value={agents.data?.filter((agent) => agent.status === 'READY').length ?? '—'} tone="success" /></div><div className={styles.metric}><AhMetric label="需要处理" value={(candidates.data ?? []).filter((candidate) => candidate.state !== 'READY').length} tone="warning" /></div><div className={styles.metric}><AhMetric label="能力" value="Session / Run" hint="按 Agent capability 呈现" /></div><div className={styles.metric}><AhMetric label="诊断" value={<Link className={styles.link} to="/agents/diagnostics">查看</Link>} /></div></div><AhSurface><div className={styles.toolbar}><AhInput label="" aria-label="搜索 Agent" placeholder="搜索名称或版本" value={query} onChange={(event) => setQuery(event.currentTarget.value)} leftSection={<Search size={15} />} /><AhSelect aria-label="Agent 筛选" label="" value={filter} onChange={(value) => setFilter(value ?? 'all')} data={[{ value: 'all', label: '全部' }, { value: 'ready', label: '已接入' }, { value: 'attention', label: '需要处理' }]} /></div><div className={styles.surfaceHeader}><div><h3>已接入 Agent</h3><p>每个身份都可以被 Project Work 选择。</p></div><Link className={styles.link} to="/agents/diagnostics">健康诊断</Link></div><div className={styles.agentCards}>{filteredAgents.map((agent) => <article className={styles.agentCard} key={agent.id}><div className={styles.agentCardHeader}><span className={styles.agentMark}><Bot size={22} /></span><div className={styles.rowMain}><h3>{agent.name}</h3><p>{agentKindLabel(agent.agentKind)} · {agent.detectedVersion ?? '版本待检测'}</p></div><AhStatusPill status={agent.status} /></div><p className={styles.agentDescription}>可用于 Project Work 与 Coding Workspace 的真实执行身份。</p><div className={styles.chipList}>{capabilitiesFor(agent).map((capability) => <span className={styles.chip} key={capability}>{capability}</span>)}</div><div className={styles.agentCardFooter}><span>{agent.enabled ? '已启用' : '已停用'}</span><span>{agent.defaultModel ?? 'Session 中选择模型'}</span></div></article>)}{!agents.isLoading && !filteredAgents.length ? <AhEmptyState title={query || filter !== 'all' ? '没有匹配的 Agent' : '还没有接入 Agent'} description="扫描本机或运行环境以发现可用 Agent。" action={<Link to="/agents/agents/discover"><AhButton>开始发现</AhButton></Link>} /> : null}</div></AhSurface><AhSurface><div className={styles.surfaceHeader}><div><h3>候选 Agent</h3><p>扫描结果会保留部分失败原因，支持逐个接入。</p></div></div><div className={styles.surfaceBody}>{(candidates.data ?? []).filter((candidate) => candidate.agentKind !== 'UNKNOWN').map((candidate) => <div className={styles.row} key={candidate.candidateId}><Bot size={19} /><div className={styles.rowMain}><span className={styles.rowTitle}>{candidate.displayName}</span><span className={styles.rowMeta}>{candidate.detectedVersion ?? '版本待检测'}</span></div><AhStatusPill status={candidate.state} /><AhButton size="xs" onClick={() => adopt.mutate(candidate.candidateId)} loading={adopt.isPending} disabled={!candidate.adoptable}>接入</AhButton></div>)}</div></AhSurface></Screen>;
}

export function DiscoverAgentsPageV07() {
  const client = useQueryClient();
  const compact = useCompactViewport();
  const candidates = useQuery({ queryKey: ['discovery-agents'], queryFn: () => api.get<AgentCandidateRecord[]>('/discovery/agents') });
  const rescan = useMutation({ mutationFn: () => api.post('/discovery/agents/rescan'), onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-agents'] }) });
  const adopt = useMutation({ mutationFn: (id: string) => api.post(`/discovery/agents/${encodeURIComponent(id)}/adopt`), onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-agents'] }) });
  const visibleCandidates = (candidates.data ?? []).filter((candidate) => candidate.agentKind !== 'UNKNOWN');
  const sourceCount = (prefix: string) => visibleCandidates.filter((candidate) => (candidate.targetCandidateId ?? '').toLowerCase().startsWith(prefix)).length;
  const sources = [{ label: 'Local Host', hint: '本机已授权目录', count: sourceCount('host') + sourceCount('local') }, { label: 'Remote Nodes', hint: '已连接的远程设备', count: sourceCount('remote') }, { label: 'NAS Docker', hint: '已发现的容器运行环境', count: sourceCount('docker') }];
  const candidateAction = (candidate: AgentCandidateRecord) => {
    if (candidate.adoptable) return <AhButton size="xs" onClick={() => adopt.mutate(candidate.candidateId)} loading={adopt.isPending}>{candidate.state === 'AUTH_REQUIRED' ? '去授权' : '添加'}</AhButton>;
    if (candidate.state === 'STOPPED') return <Link className={styles.rowAction} to="/agents/runtimes">查看 Runtime</Link>;
    if (candidate.state === 'MISSING_DEPENDENCY') return <Link className={styles.rowAction} to="/agents/diagnostics">查看诊断</Link>;
    return null;
  };
  return <>
    <AgentCenterPageV07 />
    <AhDialog
      open
      onClose={() => window.history.back()}
      title="发现 Agent"
      description="扫描 → 候选 → 接入 → preflight → Ready，每一步都保留可恢复的状态。"
      size={960}
      fullScreen={compact}
      actions={<><AhButton variant="default" onClick={() => window.history.back()}>完成</AhButton><AhButton onClick={() => rescan.mutate()} loading={rescan.isPending} leftSection={<RefreshCw size={16} />}>重新扫描</AhButton></>}
    >
      <div className={styles.discoveryDialog} data-testid="discover-agents-dialog">
        <section className={styles.discoveryScanner} aria-label="扫描进度">
          <div className={styles.scannerOrb}><ScanSearch size={32} /></div>
          <span className={styles.eyebrow}>Agent Discovery</span>
          <h3>{rescan.isPending || candidates.isFetching ? '正在扫描可用 Agent' : '扫描已完成'}</h3>
          <p>只读取已授权的本机、Remote Node 和 NAS Docker 来源，不会静默修改认证或配置。</p>
          <div className={styles.discoveryStats}><div><strong>{visibleCandidates.length}</strong><span>发现</span></div><div><strong>{visibleCandidates.filter((candidate) => candidate.state === 'READY').length}</strong><span>可添加</span></div><div><strong>{visibleCandidates.filter((candidate) => candidate.state === 'AUTH_REQUIRED').length}</strong><span>需授权</span></div></div>
          <div className={styles.mutedBox}>隐私提示：扫描只返回 AgentHub 支持的 Profile；原始 executable、adapter 和 container identity 仅在 Diagnostics 展开。</div>
        </section>
        <section className={styles.discoveryResults} aria-label="来源与候选 Agent">
          <div className={styles.sourceList}>{sources.map((source) => <div className={styles.sourceRow} key={source.label}><span className={styles.sourceIcon}><Server size={16} /></span><div><strong>{source.label}</strong><span>{source.hint}</span></div><AhStatusPill status={source.count ? 'READY' : 'UNAVAILABLE'} /><span className={styles.subtle}>{source.count}</span></div>)}</div>
          <div className={styles.dialogSection}><div className={styles.surfaceHeader}><div><h3>候选 Agent</h3><p>选择要接入的身份，部分失败不会阻塞其它候选。</p></div><span className={styles.subtle}>{visibleCandidates.length} 个</span></div><QueryMessage loading={candidates.isLoading} error={candidates.error} retry={() => void candidates.refetch()} label="正在扫描 Agent" />{!candidates.isLoading && !candidates.error ? <div className={styles.discoveryCandidates}>{visibleCandidates.map((candidate) => <div className={styles.candidateRow} key={candidate.candidateId}><span className={styles.candidateMark}><Bot size={18} /></span><div className={styles.rowMain}><strong className={styles.rowTitle}>{candidate.displayName}</strong><span className={styles.rowMeta}>{candidate.detectedVersion ?? '版本待检测'} · {candidate.reasonCode ? '需要处理' : '已识别'}</span></div><AhStatusPill status={candidate.state} />{candidateAction(candidate)}</div>)}{!visibleCandidates.length ? <AhEmptyState compact title="暂时没有候选 Agent" description="重新扫描会重新读取授权来源。" /> : null}</div> : null}</div>
        </section>
      </div>
    </AhDialog>
  </>;
}

export function InfrastructurePageV07({ kind }: { kind: 'runtimes' | 'nodes' | 'diagnostics' }) {
  const client = useQueryClient();
  const runtimes = useQuery({ queryKey: ['discovery-runtimes'], queryFn: () => api.get<RuntimeCandidateRecord[]>('/discovery/runtimes'), enabled: kind === 'runtimes' });
  const nodes = useQuery({ queryKey: ['remote-nodes'], queryFn: () => api.get<RemoteNodeRecord[]>('/remote-nodes'), enabled: kind === 'nodes' });
  const host = useQuery({ queryKey: ['host-diagnostics'], queryFn: () => api.get<Record<string, unknown>>('/agents/diagnostics/host'), enabled: kind === 'diagnostics' });
  const rescan = useMutation({ mutationFn: () => api.post('/discovery/runtimes/rescan'), onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-runtimes'] }) });
  const adopt = useMutation({ mutationFn: (id: string) => api.post(`/discovery/runtimes/${encodeURIComponent(id)}/adopt`), onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-runtimes'] }) });
  const lifecycle = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'start' | 'stop' }) => api.post(`/execution-targets/${id}/${action}`), onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-runtimes'] }) });
  const title = kind === 'runtimes' ? 'Runtime' : kind === 'nodes' ? 'Remote Nodes' : 'Diagnostics';
  const description = kind === 'runtimes' ? '管理本机与 Docker 执行环境，状态反馈与 Agent 可用性保持一致。' : kind === 'nodes' ? '管理已授权的 Remote Node，注册码只展示一次，撤销需要明确确认。' : '先给出面向用户的结论，再按需展开原始诊断信息。';
  return <Screen eyebrow="Agent Infrastructure" title={title} description={description} actions={kind === 'runtimes' ? <AhButton variant="default" onClick={() => rescan.mutate()} loading={rescan.isPending} leftSection={<RefreshCw size={16} />}>重新扫描</AhButton> : kind === 'nodes' ? <Link to="/agents/nodes/register"><AhButton leftSection={<Link2 size={16} />}>授权 Node</AhButton></Link> : undefined}>{kind === 'runtimes' ? <AhSurface><div className={styles.surfaceBody}><QueryMessage loading={runtimes.isLoading} error={runtimes.error} retry={() => void runtimes.refetch()} label="正在扫描运行环境" />{(runtimes.data ?? []).map((runtime) => <div className={styles.row} key={runtime.candidateId}><Server size={19} /><div className={styles.rowMain}><span className={styles.rowTitle}>{runtime.displayName}</span><span className={styles.rowMeta}>{runtime.image ?? 'Local Host'} · {runtime.statusText ?? '状态待确认'}</span></div><AhStatusPill status={runtime.state} />{!runtime.targetId && runtime.adoptable ? <AhButton size="xs" onClick={() => adopt.mutate(runtime.candidateId)} loading={adopt.isPending}>接入</AhButton> : runtime.targetId && runtime.state === 'STOPPED' ? <AhButton size="xs" onClick={() => lifecycle.mutate({ id: runtime.targetId!, action: 'start' })} loading={lifecycle.isPending}><Play size={14} /> 启动</AhButton> : runtime.targetId && runtime.state === 'READY' && runtime.kind === 'DOCKER_CONTAINER' ? <AhButton size="xs" variant="default" onClick={() => lifecycle.mutate({ id: runtime.targetId!, action: 'stop' })} loading={lifecycle.isPending}><CircleStop size={14} /> 停止</AhButton> : null}</div>)}{!runtimes.isLoading && !runtimes.error && !runtimes.data?.length ? <AhEmptyState title="暂时没有可管理的 Runtime" description="重新扫描后会显示本机或支持的 Docker 环境。" /> : null}</div></AhSurface> : kind === 'nodes' ? <AhSurface><div className={styles.surfaceBody}><QueryMessage loading={nodes.isLoading} error={nodes.error} retry={() => void nodes.refetch()} label="正在加载 Remote Nodes" />{(nodes.data ?? []).map((node) => <div className={styles.row} key={node.id}><Network size={19} /><div className={styles.rowMain}><span className={styles.rowTitle}>{node.name}</span><span className={styles.rowMeta}>{node.hostname} · {node.allowedRootsJson.length} 个授权目录 · 最近 {displayDate(node.lastSeenAt)}</span></div><AhStatusPill status={node.status} /><Link className={styles.rowAction} to={`/agents/nodes/${node.id}`}>查看</Link></div>)}{!nodes.isLoading && !nodes.error && !nodes.data?.length ? <AhEmptyState title="还没有 Remote Node" description="生成一次性注册码并在目标设备运行 Node daemon。" action={<Link to="/agents/nodes/register"><AhButton>授权 Node</AhButton></Link>} /> : null}</div></AhSurface> : <AhSurface><div className={styles.surfaceHeader}><div><h3>主机诊断</h3><p>高级供应商细节保持在 progressive disclosure 内。</p></div><AhButton variant="default" size="xs" onClick={() => void host.refetch()} leftSection={<RefreshCw size={14} />}>刷新</AhButton></div><div className={styles.surfaceBody}><QueryMessage loading={host.isLoading} error={host.error} retry={() => void host.refetch()} label="正在读取诊断" />{host.data ? <><div className={styles.mutedBox}><strong>结论</strong><p>{typeof host.data.message === 'string' ? host.data.message : '服务诊断已返回，请展开详细信息。'}</p></div><details><summary>查看详细诊断</summary><pre className={styles.codeBlock}>{JSON.stringify(host.data, null, 2)}</pre></details></> : null}</div></AhSurface>}</Screen>;
}

export function RemoteNodeRegistrationPageV07() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [expiresInMinutes, setExpiresInMinutes] = useState('15');
  const [rootDraft, setRootDraft] = useState('');
  const [roots, setRoots] = useState<string[]>([]);
  const [registration, setRegistration] = useState<RemoteNodeRegistration>();
  const create = useMutation({
    mutationFn: () => api.post<RemoteNodeRegistration>('/remote-nodes/registration-tokens', {
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
  return <Screen eyebrow="Remote Nodes" title="授权 Remote Node" description="只授权 Agent 实际需要访问的目录。注册码为一次性凭据，生成后只展示一次。" actions={<AhButton variant="default" onClick={() => navigate('/agents/nodes')}>返回 Nodes</AhButton>}><AhSurface><div className={styles.surfaceBody}>{registration ? <div className={styles.stack}><div className={styles.mutedBox}><strong>注册码已生成</strong><p>请在目标设备完成 Node daemon 配置。关闭页面后 token 不会再次显示。</p><pre className={styles.codeBlock}>{registration.token}</pre><AhButton size="sm" leftSection={<Copy size={14} />} onClick={() => void navigator.clipboard?.writeText(registration.token)}>复制注册码</AhButton></div><div className={styles.mutedBox}><strong>允许目录</strong>{registration.allowedRoots.map((root) => <div className={styles.mono} key={root}>{root}</div>)}</div><div className={styles.actions}><AhButton onClick={() => navigate('/agents/nodes')}>完成</AhButton></div></div> : <div className={styles.stack}><AhInput label="Node 名称" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="例如：开发节点" /><AhSelect label="有效期" value={expiresInMinutes} onChange={(value) => setExpiresInMinutes(value ?? '15')} data={[{ value: '5', label: '5 分钟' }, { value: '15', label: '15 分钟' }, { value: '60', label: '1 小时' }]} /><div><AhInput label="授权目录" value={rootDraft} onChange={(event) => setRootDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addRoot(); } }} placeholder="/srv/projects/AgentHub" description="目标设备上的绝对路径。按 Enter 加入授权清单。" /><div className={styles.actions} style={{ marginTop: 8 }}>{roots.map((root) => <AhButton key={root} size="xs" variant="default" onClick={() => setRoots((current) => current.filter((item) => item !== root))}>{root} ×</AhButton>)}</div></div>{create.error ? <AhErrorState description={create.error.message} /> : null}<AhButton onClick={() => create.mutate()} loading={create.isPending} disabled={!name.trim() || roots.length === 0}>生成一次性注册码</AhButton></div>}</div></AhSurface></Screen>;
}

export function RemoteNodeDetailPageV07() {
  const { nodeId } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const node = useQuery({ queryKey: ['remote-node-diagnostics', nodeId], queryFn: () => api.get<RemoteNodeDiagnostics>(`/remote-nodes/${nodeId}/diagnostics`), enabled: Boolean(nodeId) });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const revoke = useMutation({ mutationFn: () => api.post(`/remote-nodes/${nodeId}/revoke`), onSuccess: () => { void client.invalidateQueries({ queryKey: ['remote-nodes'] }); navigate('/agents/nodes'); } });
  if (node.isLoading) return <AhLoadingState label="正在读取 Node 诊断" />;
  if (node.error || !node.data) return <AhErrorState description={node.error?.message ?? 'Remote Node 不存在'} retry={() => void node.refetch()} />;
  return <Screen eyebrow="Remote Node" title={node.data.id ? 'Node 详情' : 'Remote Node'} description="身份、授权 roots、inventory 与连接状态。原始指纹只在诊断上下文内展示。" actions={<AhButton variant="default" onClick={() => setConfirmOpen(true)} loading={revoke.isPending}>撤销授权</AhButton>}><div className={styles.grid + ' ' + styles.grid2}><AhSurface><div className={styles.surfaceHeader}><div><h3>连接状态</h3><p>{node.data.lastSeenAt ? displayDate(node.data.lastSeenAt) : '暂无心跳'}</p></div><AhStatusPill status={node.data.status} /></div><div className={styles.surfaceBody}><div className={styles.row}><Network size={17} /><div className={styles.rowMain}><span className={styles.rowTitle}>协议</span><span className={styles.rowMeta}>{node.data.protocolVersion} · daemon {node.data.daemonVersion}</span></div></div><div className={styles.row}><Server size={17} /><div className={styles.rowMain}><span className={styles.rowTitle}>授权目录</span><span className={styles.rowMeta}>{node.data.allowedRoots.length} 个 root</span></div></div><details><summary>查看设备指纹</summary><pre className={styles.codeBlock}>{node.data.fingerprint}</pre></details></div></AhSurface><AhSurface><div className={styles.surfaceHeader}><div><h3>Agent inventory</h3><p>只有固定 Profile 会进入普通流程。</p></div></div><div className={styles.surfaceBody}>{node.data.inventory.map((agent) => <div className={styles.row} key={agent.key}><Bot size={17} /><div className={styles.rowMain}><span className={styles.rowTitle}>{agent.name}</span><span className={styles.rowMeta}>{agent.detectedVersion ?? '版本待检测'}</span></div><AhStatusPill status={agent.status} /></div>)}</div></AhSurface></div><AhDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="撤销 Remote Node？" description="撤销后该设备不能再访问授权目录；历史记录会保留。"><div className={styles.actions}><AhButton variant="default" onClick={() => setConfirmOpen(false)}>取消</AhButton><AhButton color="red" onClick={() => revoke.mutate()} loading={revoke.isPending}>确认撤销</AhButton></div></AhDialog></Screen>;
}

export function PromptLibraryPageV07() {
  const client = useQueryClient();
  const { projectId, promptId } = useParams();
  const prompts = useQuery({ queryKey: ['prompts', projectId ?? 'all'], queryFn: () => api.get<PromptRecord[]>(projectId ? `/prompts?projectId=${projectId}` : '/prompts') });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectRecord[]>('/projects') });
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<AgentRecord[]>('/agents') });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.get<TaskRecord[]>('/tasks') });
  const [selectedId, setSelectedId] = useState(promptId ?? '');
  const [tab, setTab] = useState<'content' | 'variables' | 'versions' | 'labels' | 'bindings' | 'playground'>('content');
  const [search, setSearch] = useState('');
  const selected = prompts.data?.find((prompt) => prompt.id === selectedId) ?? prompts.data?.[0];
  const filteredPrompts = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return (prompts.data ?? []).filter((prompt) => !normalized || `${prompt.name} ${prompt.key} ${prompt.description ?? ''}`.toLowerCase().includes(normalized));
  }, [prompts.data, search]);
  useEffect(() => { if (promptId) setSelectedId(promptId); }, [promptId]);
  useEffect(() => { if (!selectedId && selected) setSelectedId(selected.id); }, [selected, selectedId]);
  const versions = useQuery({ queryKey: ['prompt-versions', selected?.id], queryFn: () => api.get<PromptVersionRecord[]>(`/prompts/${selected?.id}/versions`), enabled: Boolean(selected) });
  const labels = useQuery({ queryKey: ['prompt-labels', selected?.id], queryFn: () => api.get<PromptLabelRecord[]>(`/prompts/${selected?.id}/labels`), enabled: Boolean(selected) });
  const bindings = useQuery({ queryKey: ['prompt-bindings', selected?.id], queryFn: () => api.get<PromptBindingRecord[]>(`/prompt-bindings?promptId=${selected?.id}`), enabled: Boolean(selected) });
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const create = useMutation({ mutationFn: () => api.post<PromptRecord>('/prompts', { projectId, key: key.trim(), name: name.trim(), kind: 'TASK', type: 'TEXT' }), onSuccess: (prompt) => { void client.invalidateQueries({ queryKey: ['prompts'] }); setSelectedId(prompt.id); setNewOpen(false); } });
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionContent, setVersionContent] = useState('');
  const [versionVariables, setVersionVariables] = useState('{}');
  const [versionChangelog, setVersionChangelog] = useState('');
  const versionCreate = useMutation({ mutationFn: () => {
    if (!selected) throw new Error('请先选择 Prompt');
    let variables: Record<string, unknown>;
    try { variables = JSON.parse(versionVariables || '{}') as Record<string, unknown>; } catch { throw new Error('Variables 必须是有效 JSON'); }
    const content = selected.type === 'CHAT' ? JSON.parse(versionContent || '{"messages":[]}') : { text: versionContent };
    return api.post(`/prompts/${selected.id}/versions`, { content, variables, changelog: versionChangelog.trim() || undefined });
  }, onSuccess: () => { setVersionOpen(false); setVersionContent(''); setVersionVariables('{}'); setVersionChangelog(''); void client.invalidateQueries({ queryKey: ['prompt-versions', selected?.id] }); void client.invalidateQueries({ queryKey: ['prompt-labels', selected?.id] }); } });
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelName, setLabelName] = useState('production');
  const [labelVersionId, setLabelVersionId] = useState('');
  const moveLabel = useMutation({ mutationFn: () => { if (!selected || !labelName.trim() || !labelVersionId) throw new Error('标签和版本不能为空'); return api.put(`/prompts/${selected.id}/labels/${encodeURIComponent(labelName.trim())}`, { versionId: labelVersionId }); }, onSuccess: () => { setLabelOpen(false); void client.invalidateQueries({ queryKey: ['prompt-labels', selected?.id] }); } });
  const [bindingOpen, setBindingOpen] = useState(false);
  const [bindingTargetType, setBindingTargetType] = useState<'PROJECT' | 'AGENT' | 'TASK'>('PROJECT');
  const [bindingTargetId, setBindingTargetId] = useState('');
  const [bindingSlot, setBindingSlot] = useState('SYSTEM');
  const [bindingSelector, setBindingSelector] = useState<'LABEL' | 'VERSION'>('LABEL');
  const [bindingSelectorValue, setBindingSelectorValue] = useState('');
  const bindingTargets = bindingTargetType === 'PROJECT' ? (projects.data ?? []).map((item) => ({ value: item.id, label: item.name })) : bindingTargetType === 'AGENT' ? (agents.data ?? []).map((item) => ({ value: item.id, label: item.name })) : (tasks.data ?? []).map((item) => ({ value: item.id, label: item.title }));
  const bindingSelectors = bindingSelector === 'LABEL' ? (labels.data ?? []).map((item) => ({ value: item.label, label: `${item.label} · v${item.version}` })) : (versions.data ?? []).map((item) => ({ value: item.id, label: `v${item.version} · ${item.changelog ?? '无变更说明'}` }));
  useEffect(() => { if (!bindingTargets.some((item) => item.value === bindingTargetId)) setBindingTargetId(bindingTargets[0]?.value ?? ''); }, [bindingTargetId, bindingTargets]);
  useEffect(() => { if (!bindingSelectors.some((item) => item.value === bindingSelectorValue)) setBindingSelectorValue(bindingSelectors[0]?.value ?? ''); }, [bindingSelectorValue, bindingSelectors]);
  const createBinding = useMutation({ mutationFn: () => { if (!selected || !bindingTargetId || !bindingSelectorValue) throw new Error('绑定目标和版本来源不能为空'); return api.post('/prompt-bindings', { targetType: bindingTargetType, targetId: bindingTargetId, slot: bindingSlot, promptId: selected.id, selectorType: bindingSelector, ...(bindingSelector === 'LABEL' ? { label: bindingSelectorValue } : { versionId: bindingSelectorValue }), priority: 0 }); }, onSuccess: () => { setBindingOpen(false); void client.invalidateQueries({ queryKey: ['prompt-bindings', selected?.id] }); } });
  const toggleBinding = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.patch(`/prompt-bindings/${id}`, { enabled }), onSuccess: () => void client.invalidateQueries({ queryKey: ['prompt-bindings', selected?.id] }) });
  const [playground, setPlayground] = useState('{}');
  const render = useMutation({ mutationFn: () => { if (!selected) throw new Error('请先选择 Prompt'); let variables: Record<string, unknown>; try { variables = JSON.parse(playground || '{}') as Record<string, unknown>; } catch { throw new Error('变量 JSON 格式不正确'); } return api.post<{ text: string }>(`/prompts/${selected.id}/render`, { variables }); } });
  const tabLabels = { content: 'Content', variables: 'Variables', versions: 'Versions', labels: 'Labels', bindings: 'Bindings', playground: 'Playground' };
  const refreshPrompt = () => { void client.invalidateQueries({ queryKey: ['prompt-versions', selected?.id] }); void client.invalidateQueries({ queryKey: ['prompt-labels', selected?.id] }); void client.invalidateQueries({ queryKey: ['prompt-bindings', selected?.id] }); };
  const targetName = (binding: PromptBindingRecord) => binding.targetType === 'PROJECT' ? projects.data?.find((item) => item.id === binding.targetId)?.name ?? '当前 Project' : binding.targetType === 'AGENT' ? agents.data?.find((item) => item.id === binding.targetId)?.name ?? 'Agent' : tasks.data?.find((item) => item.id === binding.targetId)?.title ?? 'Task';
  return <Screen eyebrow="Prompt Library" title="Prompt 资产" description="以 Master–Detail 方式管理内容、变量、版本、标签、绑定和 Playground。" actions={<AhButton leftSection={<Plus size={16} />} onClick={() => setNewOpen(true)}>新建 Prompt</AhButton>}><QueryMessage loading={prompts.isLoading} error={prompts.error} retry={() => void prompts.refetch()} label="正在加载 Prompt 资产" />{!prompts.isLoading && !prompts.error ? <div className={styles.twoPane}><div className={styles.master}><div className={styles.toolbar}><AhInput label="" aria-label="搜索 Prompt" placeholder="搜索资产" value={search} onChange={(event) => setSearch(event.currentTarget.value)} leftSection={<Search size={15} />} /></div>{filteredPrompts.map((prompt) => <button type="button" className={`${styles.masterRow} ${prompt.id === selected?.id ? styles.masterRowActive : ''}`} key={prompt.id} onClick={() => { setSelectedId(prompt.id); setTab('content'); }}><span className={styles.rowTitle}>{prompt.name}</span><span className={styles.rowMeta}>{prompt.key} · {labelPromptType(prompt.type)}</span></button>)}{!filteredPrompts.length ? <AhEmptyState compact title={search ? '没有匹配的 Prompt' : '还没有 Prompt'} action={!search ? <AhButton size="sm" onClick={() => setNewOpen(true)}>创建资产</AhButton> : undefined} /> : null}</div><div className={styles.detail}>{selected ? <><div className={styles.surfaceHeader} style={{ padding: '0 0 16px' }}><div><h3>{selected.name}</h3><p>{selected.key} · {labelPromptKind(selected.kind)}</p></div><AhStatusPill status="ACTIVE" /></div><div className={styles.tabs}>{(Object.keys(tabLabels) as Array<keyof typeof tabLabels>).map((item) => <button type="button" key={item} className={`${styles.tab} ${tab === item ? styles.tabActive : ''}`} onClick={() => setTab(item)}>{tabLabels[item]}</button>)}</div><div className={styles.detailToolbar}>{tab === 'content' || tab === 'variables' || tab === 'versions' ? <AhButton size="xs" onClick={() => { setVersionContent(String((versions.data?.[0]?.contentJson?.text as string | undefined) ?? '')); setVersionVariables(JSON.stringify(versions.data?.[0]?.variablesJson ?? {}, null, 2)); setVersionOpen(true); }}>创建新版本</AhButton> : null}{tab === 'labels' ? <AhButton size="xs" onClick={() => { setLabelVersionId(versions.data?.[0]?.id ?? ''); setLabelOpen(true); }}>移动标签</AhButton> : null}{tab === 'bindings' ? <AhButton size="xs" onClick={() => { refreshPrompt(); setBindingOpen(true); }}>新建绑定</AhButton> : null}</div><div style={{ paddingTop: 12 }}>{tab === 'content' ? <div className={styles.stack}><p>{selected.description ?? '暂无说明。'}</p><pre className={styles.codeBlock}>{JSON.stringify(versions.data?.[0]?.contentJson ?? { text: '尚未创建版本' }, null, 2)}</pre></div> : tab === 'variables' ? <pre className={styles.codeBlock}>{JSON.stringify(versions.data?.[0]?.variablesJson ?? {}, null, 2)}</pre> : tab === 'versions' ? <div className={styles.list}>{(versions.data ?? []).map((version) => <div className={styles.row} key={version.id}><div className={styles.rowMain}><span className={styles.rowTitle}>v{version.version}</span><span className={styles.rowMeta}>{version.changelog ?? '无变更说明'} · {labelPromptVersionSource(version.source)} · {displayDate(version.createdAt)}</span></div><span className={styles.mono}>{version.contentHash.slice(0, 10)}</span></div>)}{!versions.data?.length ? <AhEmptyState compact title="还没有版本" /> : null}</div> : tab === 'labels' ? <div className={styles.list}>{(labels.data ?? []).map((label) => <div className={styles.row} key={label.label}><Tag size={17} /><div className={styles.rowMain}><span className={styles.rowTitle}>{label.label}</span><span className={styles.rowMeta}>指向 v{label.version}</span></div></div>)}{!labels.data?.length ? <AhEmptyState compact title="还没有 Label" /> : null}</div> : tab === 'bindings' ? <div className={styles.list}>{(bindings.data ?? []).map((binding) => <div className={styles.row} key={binding.id}><Link2 size={17} /><div className={styles.rowMain}><span className={styles.rowTitle}>{targetName(binding)} · {labelPromptBindingTarget(binding.targetType)} · {labelPromptSelector(binding.selectorType)}</span><span className={styles.rowMeta}>{labelPromptBindingTarget(binding.targetType)} · {binding.slot} · {binding.label ?? (binding.versionId ? '固定版本' : '当前版本')} · 优先级 {binding.priority}</span></div><AhStatusPill status={binding.enabled ? 'ACTIVE' : 'CANCELED'} /><AhButton size="xs" variant="default" onClick={() => toggleBinding.mutate({ id: binding.id, enabled: !binding.enabled })}>{binding.enabled ? '停用' : '启用'}</AhButton></div>)}{!bindings.data?.length ? <AhEmptyState compact title="还没有 Binding" description="将 Prompt 绑定到 Project、Agent 或 Task。" /> : null}</div> : <div className={styles.stack}><AhTextarea label="变量 JSON" value={playground} onChange={(event) => setPlayground(event.currentTarget.value)} placeholder="{}" minRows={6} /><AhButton onClick={() => render.mutate()} loading={render.isPending} leftSection={<Eye size={15} />}>Render</AhButton>{render.error ? <AhErrorState description={render.error.message} /> : null}<pre className={styles.codeBlock}>{render.data?.text ?? '输入变量并 Render 查看最终内容。'}</pre></div>}</div></> : <AhEmptyState title="选择一个 Prompt" />}</div></div> : null}<AhDialog open={newOpen} onClose={() => setNewOpen(false)} title="新建 Prompt" description="先建立资产，再逐步添加版本和绑定。" actions={<><AhButton variant="default" onClick={() => setNewOpen(false)}>取消</AhButton><AhButton onClick={() => create.mutate()} loading={create.isPending} disabled={!name.trim() || !key.trim()}>创建</AhButton></>}>{create.error ? <AhErrorState description={create.error.message} /> : null}<AhInput label="名称" value={name} onChange={(event) => setName(event.currentTarget.value)} /><AhInput label="Key" value={key} onChange={(event) => setKey(event.currentTarget.value)} placeholder="project/task-primer" /></AhDialog><AhDialog open={versionOpen} onClose={() => setVersionOpen(false)} title="创建新版本" description="版本创建后不可覆盖或删除，latest 会自动指向这次创建的版本。" size={760} actions={<><AhButton variant="default" onClick={() => setVersionOpen(false)}>取消</AhButton><AhButton onClick={() => versionCreate.mutate()} loading={versionCreate.isPending} disabled={!versionContent.trim()}>创建版本</AhButton></>}>{versionCreate.error ? <AhErrorState description={versionCreate.error.message} /> : null}<AhTextarea label={selected?.type === 'CHAT' ? 'CHAT 内容 JSON' : 'Prompt 内容'} value={versionContent} onChange={(event) => setVersionContent(event.currentTarget.value)} minRows={selected?.type === 'CHAT' ? 10 : 8} placeholder={selected?.type === 'CHAT' ? '{"messages":[]}' : '输入 {{ variable }} 模板内容'} /><AhTextarea label="Variables JSON" value={versionVariables} onChange={(event) => setVersionVariables(event.currentTarget.value)} minRows={6} /><AhInput label="变更说明" value={versionChangelog} onChange={(event) => setVersionChangelog(event.currentTarget.value)} placeholder="说明本次变化" /></AhDialog><AhDialog open={labelOpen} onClose={() => setLabelOpen(false)} title="移动 Prompt 标签" description="标签是可移动指针；latest 由系统维护。" actions={<><AhButton variant="default" onClick={() => setLabelOpen(false)}>取消</AhButton><AhButton onClick={() => moveLabel.mutate()} loading={moveLabel.isPending} disabled={!labelName.trim() || !labelVersionId}>移动标签</AhButton></>}>{moveLabel.error ? <AhErrorState description={moveLabel.error.message} /> : null}<AhInput label="标签名称" value={labelName} onChange={(event) => setLabelName(event.currentTarget.value)} /><AhSelect label="目标版本" value={labelVersionId} onChange={(value) => setLabelVersionId(value ?? '')} data={(versions.data ?? []).map((version) => ({ value: version.id, label: `v${version.version} · ${version.changelog ?? '无变更说明'}` }))} placeholder="选择版本" /></AhDialog><AhDialog open={bindingOpen} onClose={() => setBindingOpen(false)} title="新建 Prompt 绑定" description="选择绑定目标和版本来源；保存后会参与后续上下文解析。" size={680} actions={<><AhButton variant="default" onClick={() => setBindingOpen(false)}>取消</AhButton><AhButton onClick={() => createBinding.mutate()} loading={createBinding.isPending} disabled={!bindingTargetId || !bindingSelectorValue}>创建绑定</AhButton></>}>{createBinding.error ? <AhErrorState description={createBinding.error.message} /> : null}<AhSelect label="绑定目标类型" value={bindingTargetType} onChange={(value) => { setBindingTargetType((value as typeof bindingTargetType) ?? 'PROJECT'); setBindingTargetId(''); }} data={[{ value: 'PROJECT', label: 'Project' }, { value: 'AGENT', label: 'Agent' }, { value: 'TASK', label: 'Task' }]} /><AhSelect label={labelPromptBindingTarget(bindingTargetType)} value={bindingTargetId} onChange={(value) => setBindingTargetId(value ?? '')} data={bindingTargets} placeholder="选择目标" /><AhSelect label="提示位" value={bindingSlot} onChange={(value) => setBindingSlot(value ?? 'SYSTEM')} data={[{ value: 'SYSTEM', label: '系统' }, { value: 'TASK_PRIMER', label: '任务前置' }, { value: 'REVIEW', label: 'Review' }, { value: 'COMMIT', label: 'Commit' }, { value: 'RULES', label: '规则' }]} /><AhSelect label="选择方式" value={bindingSelector} onChange={(value) => { setBindingSelector((value as typeof bindingSelector) ?? 'LABEL'); setBindingSelectorValue(''); }} data={[{ value: 'LABEL', label: '标签' }, { value: 'VERSION', label: '固定版本' }]} /><AhSelect label={bindingSelector === 'LABEL' ? '标签' : '固定版本'} value={bindingSelectorValue} onChange={(value) => setBindingSelectorValue(value ?? '')} data={bindingSelectors} placeholder="选择来源" /></AhDialog></Screen>;
}

export function SettingsPageV07() {
  const { preference } = useAgentHubTheme();
  const auth = useQuery({ queryKey: ['auth-status'], queryFn: () => api.get<{ localTrusted: boolean; authenticated: boolean; user?: { username: string } }>('/auth/status') });
  const capability = useQuery({ queryKey: ['capabilities'], queryFn: () => api.get<{ terminal: { available: boolean; message: string; platform: string; arch: string }; remoteNode: { available: boolean } }>('/settings/capabilities') });
  const tokens = useQuery({ queryKey: ['api-tokens'], queryFn: () => api.get<ApiTokenRecord[]>('/auth/tokens'), enabled: Boolean(auth.data?.localTrusted || auth.data?.authenticated) });
  const { pathname } = useLocation();
  const segment = pathname.split('/').at(-1) ?? 'appearance';
  const nav = [['appearance', 'Appearance'], ['account', 'Account'], ['security', 'Security'], ['integrations', 'Integrations'], ['system', 'System']] as const;
  return <Screen eyebrow="Settings" title="设置" description="外观、账号、安全、Integration 和 System 分区独立呈现，避免把诊断细节混进日常设置。"><div className={styles.settingsLayout}><nav className={styles.settingsNav} aria-label="设置分区">{nav.map(([value, label]) => <NavLink key={value} to={`/settings/${value}`} className={({ isActive }) => isActive || segment === value ? styles.settingsNavActive : undefined}>{label}</NavLink>)}</nav><div className={styles.stack}>{segment === 'appearance' ? <AhSurface><div className={styles.surfaceHeader}><div><h3>Appearance</h3><p>默认浅色；支持深色与跟随系统。</p></div><Wrench size={18} /></div><div className={styles.surfaceBody}><AhThemeSelect /><div className={styles.mutedBox} style={{ marginTop: 16 }}>当前解析主题：{preference === 'system' ? '跟随系统' : preference === 'dark' ? '深色' : '浅色'}。Monaco、Terminal 与 Workspace 会同步。</div></div></AhSurface> : segment === 'account' ? <AhSurface><div className={styles.surfaceHeader}><div><h3>Account</h3><p>当前身份与本地信任模式。</p></div></div><div className={styles.surfaceBody}><div className={styles.statusLine}><AhStatusPill status={auth.data?.authenticated ? 'ONLINE' : 'READY'} /><strong>{auth.data?.user?.username ?? '本机管理员'}</strong></div><p className={styles.subtle}>{auth.data?.localTrusted ? '本机可信模式，不要求账号登录。' : '已启用管理员认证。'}</p></div></AhSurface> : segment === 'security' ? <AhSurface><div className={styles.surfaceHeader}><div><h3>Security</h3><p>API token 只在创建时显示一次。</p></div><ShieldCheck size={18} /></div><div className={styles.surfaceBody}>{tokens.isLoading ? <AhLoadingState label="正在读取 token" /> : (tokens.data ?? []).map((token) => <div className={styles.row} key={token.id}><div className={styles.rowMain}><span className={styles.rowTitle}>{token.name}</span><span className={styles.rowMeta}>创建于 {displayDate(token.createdAt)} · {token.revokedAt ? '已撤销' : '有效'}</span></div><AhStatusPill status={token.revokedAt ? 'REVOKED' : 'READY'} /></div>)}{!tokens.data?.length && !tokens.isLoading ? <AhEmptyState compact title="还没有 API token" description="需要自动化访问时，再创建最小权限 token。" /> : null}</div></AhSurface> : segment === 'integrations' ? <AhSurface><div className={styles.surfaceHeader}><div><h3>Integrations</h3><p>只展示已存在的真实能力，不制造虚假开关。</p></div><Network size={18} /></div><div className={styles.surfaceBody}><div className={styles.row}><div className={styles.rowMain}><span className={styles.rowTitle}>Remote Node</span><span className={styles.rowMeta}>远程设备主动连接 AgentHub</span></div><AhStatusPill status={capability.data?.remoteNode.available ? 'READY' : 'UNAVAILABLE'} /></div><div className={styles.row}><div className={styles.rowMain}><span className={styles.rowTitle}>Agent runtime</span><span className={styles.rowMeta}>Local / Docker discovery 与 lifecycle</span></div><Link className={styles.rowAction} to="/agents/runtimes">管理</Link></div></div></AhSurface> : <AhSurface><div className={styles.surfaceHeader}><div><h3>System</h3><p>服务端能力与运行诊断。</p></div><SquareTerminal size={18} /></div><div className={styles.surfaceBody}>{capability.isLoading ? <AhLoadingState label="正在读取系统能力" /> : capability.error ? <AhErrorState description={capability.error.message} /> : <><div className={styles.row}><div className={styles.rowMain}><span className={styles.rowTitle}>Terminal</span><span className={styles.rowMeta}>{capability.data?.terminal.message} · {capability.data?.terminal.platform}/{capability.data?.terminal.arch}</span></div><AhStatusPill status={capability.data?.terminal.available ? 'READY' : 'UNAVAILABLE'} /></div><Link className={styles.rowAction} to="/agents/diagnostics">查看 Diagnostics <ArrowRight size={14} /></Link></>}</div></AhSurface>}</div></div></Screen>;
}

export function WorkspacePageV07() {
  const { sessionId = '' } = useParams();
  const client = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const tab = ['files', 'diff', 'git', 'run'].includes(viewParam ?? '')
    ? (viewParam as 'files' | 'diff' | 'git' | 'run')
    : 'files';
  const mobileInspectorOpen = ['files', 'diff', 'git', 'run'].includes(viewParam ?? '');
  const selectedFile = searchParams.get('file') || undefined;
  const [promptVariables, setPromptVariables] = useState<Record<string, unknown>>({});
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionRecord[]>('/sessions') });
  const session = useQuery({ queryKey: ['session', sessionId], queryFn: () => api.get<SessionRecord>(`/sessions/${sessionId}`), enabled: Boolean(sessionId) });
  const configuration = useQuery({ queryKey: ['session-configuration', sessionId], queryFn: () => api.get<SessionConfigurationRecord>(`/sessions/${sessionId}/configuration`), enabled: Boolean(sessionId) });
  const messages = useQuery({ queryKey: ['messages', sessionId], queryFn: () => api.get<MessageRecord[]>(`/sessions/${sessionId}/messages`), enabled: Boolean(sessionId), refetchInterval: 3_000 });
  const runs = useQuery({ queryKey: ['runs', sessionId], queryFn: () => api.get<RunRecord[]>(`/sessions/${sessionId}/runs`), enabled: Boolean(sessionId), refetchInterval: 3_000 });
  const approvals = useQuery({ queryKey: ['approvals', sessionId], queryFn: () => api.get<ApprovalRecord[]>(`/approvals?sessionId=${sessionId}`), enabled: Boolean(sessionId), refetchInterval: 3_000 });
  const events = useQuery({ queryKey: ['events', sessionId], queryFn: () => api.get<EventRecord[]>(`/sessions/${sessionId}/events?afterSeq=0&limit=500`), enabled: Boolean(sessionId), refetchInterval: 3_000 });
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api.get<AgentRecord[]>('/agents') });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectRecord[]>('/projects') });
  const capability = useQuery({ queryKey: ['capabilities'], queryFn: () => api.get<{ terminal: { available: boolean; code?: string; message?: string } }>('/settings/capabilities') });
  const promptContext = useQuery({
    queryKey: ['prompt-context', session.data?.projectId, session.data?.agentId, session.data?.taskId, promptVariables],
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
    : [...(runs.data ?? [])].reverse().find((run) => ['STARTING', 'RUNNING', 'WAITING_APPROVAL', 'CANCELING'].includes(run.status));
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

  const setTab = (nextTab: 'files' | 'diff' | 'git' | 'run') => {
    const next = new URLSearchParams(searchParams);
    next.set('view', nextTab);
    setSearchParams(next);
  };
  const setSelectedFile = (path: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('view', 'files');
    next.set('file', path);
    setSearchParams(next);
  };

  if (session.isLoading) return <AhLoadingState label="正在打开 Coding Workspace" />;
  if (session.error) return <AhErrorState description={session.error.message} retry={() => void session.refetch()} />;
  if (!session.data) return <AhEmptyState title="Session 不存在" description="返回 Sessions 选择一个可用会话。" />;

  return <div className={workspaceStyles.workspace} data-testid="v07-workspace">
    <header className={workspaceStyles.contextbar}>
      <div className={workspaceStyles.contextTitle}>
        <Link to={`/projects/${session.data.projectId}/sessions`}>Sessions</Link>
        <span aria-hidden="true">/</span>
        <strong>{session.data.title}</strong>
        <AhStatusPill status={session.data.status} />
      </div>
      <div className={workspaceStyles.contextFacts}>
        <span>{agent?.name ?? 'Agent 未知'}</span>
        <span>{project?.name ?? 'Project 未知'}</span>
        <code title={session.data.cwd}>{session.data.cwd}</code>
      </div>
    </header>
    <div className={workspaceStyles.mobileTabs} role="tablist" aria-label="Workspace 视图">
      <button type="button" role="tab" aria-selected={viewParam === null} onClick={() => setSearchParams({})}>对话</button>
      {(['files', 'diff', 'git', 'run'] as const).map((item) => <button type="button" role="tab" key={item} aria-selected={viewParam === item} onClick={() => setTab(item)}>{item === 'files' ? '文件' : item === 'diff' ? 'Diff' : item === 'git' ? 'Git' : '运行'}</button>)}
    </div>
    <Group orientation="horizontal" className={workspaceStyles.panels}>
      <Panel id="sessions" defaultSize="18%" minSize="210px" maxSize="320px" className={`${workspaceStyles.panel} ${workspaceStyles.sessionRail}`}>
        <SessionRail sessions={sessions} currentId={sessionId} />
      </Panel>
      <Separator className={workspaceStyles.separator} />
      <Panel id="conversation" defaultSize="49%" minSize="360px" className={`${workspaceStyles.panel} ${workspaceStyles.conversationPanel}`}>
        <Conversation session={session.data} messages={messages} events={events} approvals={approvals} activeRun={activeRun} latestRunStatus={latestRunStatus} />
      </Panel>
      <Separator className={workspaceStyles.separator} />
      <Panel id="inspector" defaultSize="33%" minSize="300px" className={`${workspaceStyles.panel} ${workspaceStyles.inspectorPanel} ${mobileInspectorOpen ? workspaceStyles.inspectorOpen : ''}`}>
        <Inspector project={project} projects={projects} session={session.data} tab={tab} setTab={setTab} selectedFile={selectedFile} setSelectedFile={setSelectedFile} agent={agent} runs={runs} />
      </Panel>
    </Group>
    <TerminalDock capability={capability.data?.terminal} capabilityError={capability.error} projectId={project?.id} projectRoot={project?.realRootPath} cwd={session.data.cwd} />
    <Composer session={session.data} agent={agent} events={events} project={project} activeRun={activeRun} promptContext={promptContext.data} promptContextLoading={promptContext.isLoading} promptContextError={promptContext.error} promptContextRetry={() => promptContext.refetch()} promptVariables={promptVariables} setPromptVariables={setPromptVariables} configuration={configuration.data} configurationLoading={configuration.isLoading} configurationError={configuration.error} />
  </div>;
}

export function LegacyWorkspacePageV07() {
  const { sessionId } = useParams();
  const client = useQueryClient();
  const session = useQuery({ queryKey: ['session', sessionId], queryFn: () => api.get<SessionRecord>(`/sessions/${sessionId}`), enabled: Boolean(sessionId) });
  const messages = useQuery({ queryKey: ['messages', sessionId], queryFn: () => api.get<MessageRecord[]>(`/sessions/${sessionId}/messages`), enabled: Boolean(sessionId) });
  const runs = useQuery({ queryKey: ['runs', sessionId], queryFn: () => api.get<Array<{ id: string; status: string; startedAt: string; finishedAt: string | null }>>(`/sessions/${sessionId}/runs`), enabled: Boolean(sessionId) });
  const [text, setText] = useState('');
  const send = useMutation({ mutationFn: () => api.post(`/sessions/${sessionId}/runs`, { text: text.trim() }), onSuccess: () => { setText(''); void client.invalidateQueries({ queryKey: ['messages', sessionId] }); void client.invalidateQueries({ queryKey: ['runs', sessionId] }); } });
  useEffect(() => { if (!sessionId) return; return realtimeSubscribe(sessionId, () => { void client.invalidateQueries({ queryKey: ['messages', sessionId] }); void client.invalidateQueries({ queryKey: ['runs', sessionId] }); }); }, [client, sessionId]);
  if (session.isLoading) return <AhLoadingState label="正在打开 Workspace" />;
  if (session.error || !session.data) return <AhErrorState description={session.error?.message ?? 'Session 不存在'} />;
  return <div className={styles.stack}><div className={styles.pageHeader}><div><span className={styles.eyebrow}>Coding Workspace</span><h2>{session.data.title}</h2><p>{session.data.cwd} · {session.data.branch ?? '默认分支'}</p></div><div className={styles.actions}><AhStatusPill status={session.data.status} /><Link to={`/projects/${session.data.projectId}/sessions`}><AhButton variant="default">返回 Sessions</AhButton></Link></div></div><div className={styles.twoPane}><aside className={styles.master}><div className={styles.surfaceHeader}><div><h3>Thread</h3><p>{messages.data?.length ?? 0} 条消息</p></div></div><div className={styles.surfaceBody}>{(messages.data ?? []).map((message) => <div className={styles.row} key={message.id}><div className={styles.rowMain}><span className={styles.rowTitle}>{message.role === 'USER' ? '你' : message.role === 'ASSISTANT' ? 'Agent' : message.role}</span><span className={styles.rowMeta}>{message.text?.slice(0, 80) ?? '无文本内容'}</span></div></div>)}{!messages.data?.length ? <AhEmptyState compact title="开始一段对话" /> : null}</div></aside><section className={styles.detail}><div className={styles.surfaceHeader} style={{ padding: '0 0 16px' }}><div><h3>Conversation</h3><p>Composer 始终可见，运行状态实时刷新。</p></div><AhStatusPill status={runs.data?.some((run) => run.status === 'RUNNING') ? 'RUNNING' : 'READY'} /></div><div className={styles.stack} style={{ minHeight: 360, paddingTop: 20 }}>{(messages.data ?? []).map((message) => <div className={styles.mutedBox} key={message.id}><strong>{message.role === 'USER' ? '你' : message.role === 'ASSISTANT' ? 'Agent' : message.role}</strong><p style={{ whiteSpace: 'pre-wrap' }}>{message.text ?? ''}</p></div>)}{!messages.data?.length ? <AhEmptyState title="还没有消息" description="在下方 Composer 描述你希望 Agent 完成的工作。" /> : null}</div><form onSubmit={(event) => { event.preventDefault(); if (text.trim()) send.mutate(); }} style={{ marginTop: 20 }}><AhInput label="Composer" value={text} onChange={(event) => setText(event.currentTarget.value)} placeholder="描述下一步工作…" rightSection={<AhButton type="submit" size="xs" loading={send.isPending} disabled={!text.trim()}>发送</AhButton>} /><div className={styles.subtle} style={{ marginTop: 8 }}>Model、Mode、Reasoning 在 Session 配置中管理；Approval、Diff、Terminal 从右侧 Inspector 逐步展开。</div></form></section><aside className={styles.inspector}><AhSurface><div className={styles.surfaceHeader}><div><h3>Inspector</h3><p>Changes · Files · Tool Calls</p></div><Wrench size={17} /></div><div className={styles.surfaceBody}><div className={styles.row}><GitBranch size={16} /><div className={styles.rowMain}><span className={styles.rowTitle}>Changes</span><span className={styles.rowMeta}>运行后查看 Git Diff</span></div><ArrowRight size={14} /></div><div className={styles.row}><FolderKanban size={16} /><div className={styles.rowMain}><span className={styles.rowTitle}>Files</span><span className={styles.rowMeta}>Project 文件树按需加载</span></div><ArrowRight size={14} /></div><div className={styles.row}><SquareTerminal size={16} /><div className={styles.rowMain}><span className={styles.rowTitle}>Tool Calls</span><span className={styles.rowMeta}>Approval 与事件记录</span></div><ArrowRight size={14} /></div></div></AhSurface></aside></div></div>;
}

function realtimeSubscribe(sessionId: string, listener: () => void): () => void {
  return realtime.subscribe(`session:${sessionId}`, listener);
}
