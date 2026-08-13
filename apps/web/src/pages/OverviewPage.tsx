import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FolderGit2,
  GitBranch,
  ShieldAlert,
  SquareTerminal,
} from '@agenthub/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { EmptyState, ErrorState, LoadingState, PageIntro, StatusBadge } from '../components/Common';
import {
  api,
  type DashboardSnapshot,
  type ExecutionTargetRecord,
  type ProjectRecord,
  type SessionRecord,
} from '../lib/api';

export function OverviewPage() {
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardSnapshot>('/dashboard'),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const targets = useQuery({
    queryKey: ['targets'],
    queryFn: () => api.get<ExecutionTargetRecord[]>('/execution-targets'),
  });
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionRecord[]>('/sessions'),
  });
  const loading =
    dashboard.isLoading || projects.isLoading || targets.isLoading || sessions.isLoading;
  const error = dashboard.error || projects.error || targets.error || sessions.error;
  if (loading) return <LoadingState label="正在汇总运行与待处理状态" />;
  if (error)
    return (
      <ErrorState
        error={error}
        retry={() => {
          void dashboard.refetch();
          void projects.refetch();
          void targets.refetch();
          void sessions.refetch();
        }}
      />
    );
  const approvals = dashboard.data?.pendingApprovals ?? [];
  const attentionTasks = dashboard.data?.attentionTasks ?? [];
  const running = dashboard.data?.runningSessions ?? [];
  const agents = dashboard.data?.agentHealth ?? [];
  const unhealthy = agents.filter((item) => item.status !== 'READY');
  const readyTarget = targets.data?.find((target) => target.status === 'READY');
  const activeProject = projects.data?.find((project) => project.status === 'ACTIVE');
  const readyAgent = agents.find((agent) => agent.status === 'READY');
  const firstSession = sessions.data?.[0];
  const setupComplete = Boolean(readyTarget && activeProject && readyAgent && firstSession);
  const sessionStartPath = activeProject
    ? `/sessions?projectId=${activeProject.id}&new=1`
    : '/sessions?new=1';
  const setupSteps = [
    {
      title: '准备 Execution Target',
      description: readyTarget ? readyTarget.name : '确认 Agent 将在哪里运行',
      complete: Boolean(readyTarget),
      href: '/agents',
      icon: <SquareTerminal size={18} />,
    },
    {
      title: '添加 Project',
      description: activeProject ? activeProject.name : '选择要交给 Agent 的工程目录',
      complete: Boolean(activeProject),
      href: '/projects',
      icon: <FolderGit2 size={18} />,
    },
    {
      title: '接入 Agent',
      description: readyAgent ? readyAgent.name : '注册并完成一次 preflight',
      complete: Boolean(readyAgent),
      href: '/agents',
      icon: <Bot size={18} />,
    },
    {
      title: '开始第一个 Session',
      description: firstSession ? firstSession.title : '选择 Project 与 Agent 进入 Workspace',
      complete: Boolean(firstSession),
      href: sessionStartPath,
      icon: <Activity size={18} />,
    },
  ];
  const nextStepIndex = setupSteps.findIndex((step) => !step.complete);

  return (
    <div className="page-stack">
      <PageIntro
        title="今天需要处理什么"
        description="待处理事项、实时执行与最近工程结果，都集中在一个清晰的工作视图中。"
      />
      {!setupComplete && (
        <section className="setup-guide" aria-labelledby="setup-guide-title">
          <div className="setup-guide-heading">
            <div>
              <span className="section-kicker">开始使用</span>
              <h3 id="setup-guide-title">完成运行准备</h3>
              <p>按依赖顺序完成一次配置，之后即可直接从 Project 开始 Session。</p>
            </div>
            <span className="setup-progress" role="status">
              {setupSteps.filter((step) => step.complete).length} / {setupSteps.length} 已完成
            </span>
          </div>
          <nav className="setup-steps" aria-label="首次使用进度">
            {setupSteps.map((step, index) => {
              const current = index === nextStepIndex;
              const unavailable = index > nextStepIndex;
              const content = (
                <>
                  <span className="setup-step-icon" aria-hidden>
                    {step.complete ? <CheckCircle2 size={18} /> : step.icon}
                  </span>
                  <span>
                    <strong>{step.title}</strong>
                    <small>{step.description}</small>
                  </span>
                  <span className="setup-step-state">
                    {step.complete ? '已完成' : current ? '下一步' : '待完成'}
                  </span>
                </>
              );
              const className = `setup-step${current ? ' current' : ''}${step.complete ? ' complete' : ''}`;
              return unavailable ? (
                <div className={className} key={step.title} aria-disabled="true">
                  {content}
                </div>
              ) : (
                <Link
                  className={className}
                  key={step.title}
                  to={step.href}
                  aria-current={current ? 'step' : undefined}
                >
                  {content}
                </Link>
              );
            })}
          </nav>
        </section>
      )}
      <div className="dashboard-grid">
        <section className="control-section dashboard-panel dashboard-attention">
          <div className="section-heading">
            <div>
              <span className="section-kicker">需要处理</span>
              <h3>等待你的决定</h3>
            </div>
            <span className="count-token">{approvals.length + attentionTasks.length}</span>
          </div>
          {!approvals.length && !attentionTasks.length ? (
            <EmptyState
              compact
              icon={<ClipboardCheck size={21} />}
              title="没有待处理项"
              description="Agent Approval 与 Task 审阅会集中出现在这里。"
              action={
                <Link className="empty-state-link" to="/tasks">
                  查看任务 <ArrowRight size={14} />
                </Link>
              }
            />
          ) : (
            <>
              {approvals.map((approval) => (
                <Link
                  className="action-row"
                  key={approval.id}
                  to={`/sessions/${approval.sessionId}`}
                >
                  <ShieldAlert size={18} />
                  <div>
                    <strong>{approval.title}</strong>
                    <span>等待批准 · Session {approval.sessionId.slice(0, 8)}</span>
                  </div>
                  <ArrowRight size={16} />
                </Link>
              ))}
              {attentionTasks.map((task) => (
                <Link className="action-row" key={task.id} to="/tasks">
                  <ClipboardCheck size={18} />
                  <div>
                    <strong>{task.title}</strong>
                    <span>
                      {task.status === 'WAITING_REVIEW' ? '等待用户审阅' : 'Task 受阻，需要处理'}
                    </span>
                  </div>
                  <ArrowRight size={16} />
                </Link>
              ))}
            </>
          )}
        </section>
        <section className="control-section dashboard-panel dashboard-running">
          <div className="section-heading">
            <div>
              <span className="section-kicker">运行态</span>
              <h3>正在执行</h3>
            </div>
            <Activity size={18} />
          </div>
          {!running.length ? (
            <EmptyState
              compact
              icon={<Activity size={21} />}
              title="当前没有运行中的 Session"
              description="从任务或会话页选择 Agent 开始。"
              action={
                <Link className="empty-state-link" to="/sessions">
                  打开会话 <ArrowRight size={14} />
                </Link>
              }
            />
          ) : (
            running.map((session) => (
              <Link className="action-row" key={session.id} to={`/sessions/${session.id}`}>
                <span className="pulse-marker" />
                <div>
                  <strong>{session.title}</strong>
                  <span>{session.cwd}</span>
                </div>
                <StatusBadge status={session.status} />
              </Link>
            ))
          )}
        </section>
        <section className="control-section dashboard-panel dashboard-results">
          <div className="section-heading">
            <div>
              <span className="section-kicker">最近结果</span>
              <h3>最近 Run 与 Git 结果</h3>
            </div>
            <GitBranch size={18} />
          </div>
          {!dashboard.data?.recentResults.length ? (
            <EmptyState
              compact
              icon={<GitBranch size={21} />}
              title="还没有运行结果"
              description="完成或失败的 Run 会显示在这里。"
              action={
                <Link className="empty-state-link" to="/sessions">
                  查看会话 <ArrowRight size={14} />
                </Link>
              }
            />
          ) : (
            dashboard.data.recentResults.slice(0, 6).map((run) => (
              <Link className="action-row" key={run.id} to={`/sessions/${run.sessionId}`}>
                <CheckCircle2 size={17} />
                <div>
                  <strong>Run {run.id.slice(0, 8)}</strong>
                  <span>
                    Git{' '}
                    {run.gitOutcome === 'CHANGED'
                      ? '有变更'
                      : run.gitOutcome === 'UNCHANGED'
                        ? '无变更'
                        : '不可用'}
                  </span>
                </div>
                <StatusBadge status={run.status} />
              </Link>
            ))
          )}
        </section>
        <section className="control-section dashboard-panel dashboard-foundation">
          <div className="section-heading">
            <div>
              <span className="section-kicker">运行基础</span>
              <h3>Agent 健康与 Project</h3>
            </div>
          </div>
          <div className="health-layout">
            <div className="health-list">
              {agents.map((agent) => (
                <div className="health-row" key={agent.id}>
                  <span className="agent-glyph">
                    <Bot size={16} />
                  </span>
                  <div>
                    <strong>{agent.name}</strong>
                    <span>
                      {agent.agentKind} · {agent.detectedVersion ?? '未检测版本'}
                    </span>
                  </div>
                  <StatusBadge status={agent.status} />
                </div>
              ))}
              {!agents.length && (
                <EmptyState
                  compact
                  icon={<Bot size={21} />}
                  title="尚未注册 Agent"
                  description="先在 Agent 页面注册并完成 preflight。"
                  action={
                    <Link className="empty-state-link" to="/agents">
                      管理 Agent <ArrowRight size={14} />
                    </Link>
                  }
                />
              )}
            </div>
            <div className="project-strip">
              {(projects.data ?? []).slice(0, 4).map((project) => (
                <Link key={project.id} to="/projects">
                  <FolderGit2 size={17} />
                  <div>
                    <strong>{project.name}</strong>
                    <code>{project.realRootPath}</code>
                  </div>
                  <span>{project.repoKind}</span>
                </Link>
              ))}
              {!!unhealthy.length && (
                <p className="inline-warning">{unhealthy.length} 个 Agent 需要修复或授权。</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
