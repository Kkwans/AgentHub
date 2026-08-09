import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Bot,
  Box,
  CheckCircle2,
  ClipboardCheck,
  FolderGit2,
  GitBranch,
  Plus,
  Play,
  RefreshCw,
  ShieldAlert,
  SquareTerminal,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import {
  api,
  authTokenStore,
  type AgentCatalogEntry,
  type AgentRecord,
  type ApiTokenRecord,
  type DashboardSnapshot,
  type ExecutionTargetRecord,
  type GoalRecord,
  type ProjectRecord,
  type SessionRecord,
  type TaskRecord,
} from '../lib/api';
import {
  EmptyState,
  ErrorState,
  formatTime,
  LoadingState,
  PageIntro,
  StatusBadge,
} from '../components/Common';
import { realtime } from '../lib/realtime';

export function OverviewPage() {
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardSnapshot>('/dashboard'),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const loading = dashboard.isLoading || projects.isLoading;
  const error = dashboard.error || projects.error;
  if (loading) return <LoadingState label="正在汇总运行与待处理状态" />;
  if (error) return <ErrorState error={error} />;
  const approvals = dashboard.data?.pendingApprovals ?? [];
  const attentionTasks = dashboard.data?.attentionTasks ?? [];
  const running = dashboard.data?.runningSessions ?? [];
  const agents = dashboard.data?.agentHealth ?? [];
  const unhealthy = agents.filter((item) => item.status !== 'READY');

  return (
    <div className="page-stack">
      <PageIntro
        title="今天需要处理什么"
        description="只展示正在运行、需要处理和最近工程结果，不堆叠无行动价值的指标。"
      />
      <div className="dashboard-grid">
        <section className="control-section priority-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">需要处理</span>
              <h3>等待你的决定</h3>
            </div>
            <span className="count-token">{approvals.length + attentionTasks.length}</span>
          </div>
          {!approvals.length && !attentionTasks.length ? (
            <EmptyState
              title="没有待处理项"
              description="Agent Approval 与 Task 审阅会集中出现在这里。"
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
        <section className="control-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">运行态</span>
              <h3>正在执行</h3>
            </div>
            <Activity size={18} />
          </div>
          {!running.length ? (
            <EmptyState
              title="当前没有运行中的 Session"
              description="从任务或会话页选择 Agent 开始。"
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
        <section className="control-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">最近结果</span>
              <h3>Run 与 Git outcome</h3>
            </div>
            <GitBranch size={18} />
          </div>
          {!dashboard.data?.recentResults.length ? (
            <EmptyState title="还没有运行结果" description="完成或失败的 Run 会显示在这里。" />
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
        <section className="control-section wide">
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
                  title="尚未注册 Agent"
                  description="先在 Agent 页面注册并完成 preflight。"
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

export function ProjectsPage() {
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const targets = useQuery({
    queryKey: ['targets'],
    queryFn: () => api.get<ExecutionTargetRecord[]>('/execution-targets'),
  });
  const add = useMutation({
    mutationFn: (body: Record<string, string>) => api.post('/projects', body),
    onSuccess: () => {
      setAdding(false);
      void client.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  return (
    <div className="page-stack">
      <PageIntro
        title="Project 工作区"
        description="添加真实目录并探测 Git、分支、规则文件与 package manager。文件浏览保持只读。"
        action={
          <button className="button primary" onClick={() => setAdding(!adding)}>
            <Plus size={15} /> 添加 Project
          </button>
        }
      />
      {adding && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            add.mutate(Object.fromEntries(data) as Record<string, string>);
          }}
        >
          <label>
            名称
            <input required name="name" placeholder="例如 AgentHub" />
          </label>
          <label>
            Project root
            <input
              required
              name="rootPath"
              className="mono"
              placeholder="/volume2/Project/AgentHub"
            />
          </label>
          <label>
            Execution Target
            <select required name="targetId">
              <option value="">请选择</option>
              {targets.data?.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name} · {target.kind}
                </option>
              ))}
            </select>
          </label>
          <button className="button primary" disabled={add.isPending}>
            {add.isPending ? '正在预检' : '预检并添加'}
          </button>
          {add.error && <span className="form-error">{add.error.message}</span>}
        </form>
      )}
      {projects.isLoading ? (
        <LoadingState />
      ) : projects.error ? (
        <ErrorState error={projects.error} />
      ) : !projects.data?.length ? (
        <EmptyState
          title="尚未添加 Project"
          description="添加 NAS 上的真实工程目录后，才能建立 Session 和 Git 闭环。"
        />
      ) : (
        <div className="data-table project-table">
          <div className="data-row header">
            <span>Project</span>
            <span>路径</span>
            <span>Git</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          {projects.data.map((project) => (
            <div className="data-row" key={project.id}>
              <span>
                <strong>{project.name}</strong>
                <small>{project.description || '暂无说明'}</small>
              </span>
              <code title={project.realRootPath}>{project.realRootPath}</code>
              <span>
                <GitBranch size={14} /> {project.repoKind}
              </span>
              <StatusBadge status={project.status} />
              <Link className="text-link" to={`/sessions?projectId=${project.id}`}>
                打开工作区 <ArrowRight size={14} />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentsPage() {
  const client = useQueryClient();
  const [targetFormOpen, setTargetFormOpen] = useState(false);
  const [agentFormOpen, setAgentFormOpen] = useState(false);
  const [targetKind, setTargetKind] = useState<'LOCAL_HOST' | 'DOCKER_CONTAINER'>(
    'DOCKER_CONTAINER',
  );
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const targets = useQuery({
    queryKey: ['targets'],
    queryFn: () => api.get<ExecutionTargetRecord[]>('/execution-targets'),
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const catalog = useQuery({
    queryKey: ['agent-catalog'],
    queryFn: () => api.get<AgentCatalogEntry[]>('/agents/catalog'),
  });
  const registerTarget = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/execution-targets', body),
    onSuccess: () => {
      setTargetFormOpen(false);
      void client.invalidateQueries({ queryKey: ['targets'] });
    },
  });
  const registerAgent = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/agents', body),
    onSuccess: () => {
      setAgentFormOpen(false);
      void client.invalidateQueries({ queryKey: ['agents'] });
    },
  });
  const preflight = useMutation({
    mutationFn: ({ id, cwd }: { id: string; cwd: string }) =>
      api.post(`/agents/${id}/preflight`, { cwd, smokeSession: false }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['agents'] }),
  });
  const lifecycle = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api.post(`/execution-targets/${id}/${action}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['targets'] }),
  });
  const targetPreflight = useMutation({
    mutationFn: ({ id, cwd }: { id: string; cwd?: string }) =>
      api.post(`/execution-targets/${id}/preflight`, cwd ? { cwd } : {}),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['targets'] }),
  });
  const cwd = projects.data?.[0]?.realRootPath ?? '/tmp';
  return (
    <div className="page-stack">
      <PageIntro
        title="Agent 与执行目标"
        description="真实展示 Agent capability、认证和 Docker 状态；不会自动安装、重建或停止容器。"
        action={
          <div className="page-actions">
            <button className="button secondary" onClick={() => setTargetFormOpen(!targetFormOpen)}>
              <Box size={15} /> 注册 Execution Target
            </button>
            <button className="button primary" onClick={() => setAgentFormOpen(!agentFormOpen)}>
              <Plus size={15} /> 添加 Agent
            </button>
          </div>
        }
      />
      {targetFormOpen && (
        <form
          className="management-form"
          onSubmit={(event) => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(event.currentTarget));
            const common = {
              name: String(values.name),
              kind: targetKind,
              hostname: String(values.hostname),
              os: String(values.os),
              arch: String(values.arch),
            };
            registerTarget.mutate(
              targetKind === 'LOCAL_HOST'
                ? common
                : {
                    ...common,
                    containerName: String(values.containerName),
                    expectedContainerId: String(values.expectedContainerId),
                    startPolicy: String(values.startPolicy),
                    workspaceMappings:
                      values.hostRoot && values.containerRoot
                        ? [
                            {
                              hostRoot: String(values.hostRoot),
                              containerRoot: String(values.containerRoot),
                            },
                          ]
                        : [],
                  },
            );
          }}
        >
          <div className="form-heading">
            <div>
              <span className="section-kicker">显式接管</span>
              <h3>注册 Execution Target</h3>
            </div>
            <p>Docker target 注册时会核验完整 container ID；不会创建或修改容器。</p>
          </div>
          <div className="form-grid">
            <label>
              类型
              <select
                value={targetKind}
                onChange={(event) => setTargetKind(event.target.value as typeof targetKind)}
              >
                <option value="DOCKER_CONTAINER">Docker 容器</option>
                <option value="LOCAL_HOST">宿主机</option>
              </select>
            </label>
            <label>
              名称
              <input required name="name" placeholder="例如 OpenClaw Runtime" />
            </label>
            <label>
              hostname
              <input
                required
                name="hostname"
                defaultValue={targetKind === 'LOCAL_HOST' ? window.location.hostname : 'docker'}
              />
            </label>
            <label>
              os
              <input required name="os" defaultValue="linux" />
            </label>
            <label>
              arch
              <input required name="arch" defaultValue="arm64" />
            </label>
            {targetKind === 'DOCKER_CONTAINER' && (
              <>
                <label>
                  container name
                  <input
                    required
                    name="containerName"
                    className="mono"
                    placeholder="openclaw-official"
                  />
                </label>
                <label className="span-two">
                  完整 container ID
                  <input
                    required
                    name="expectedContainerId"
                    className="mono"
                    minLength={64}
                    maxLength={64}
                    pattern="[a-f0-9]{64}"
                    placeholder="64 位十六进制 ID"
                  />
                </label>
                <label>
                  启动策略
                  <select required name="startPolicy">
                    <option value="MANUAL">手动启动</option>
                    <option value="ON_DEMAND">按需启动</option>
                  </select>
                </label>
                <label>
                  host root
                  <input name="hostRoot" className="mono" placeholder="/volume2/Project" />
                </label>
                <label>
                  container root
                  <input name="containerRoot" className="mono" placeholder="/workspace" />
                </label>
              </>
            )}
          </div>
          <div className="form-footer">
            <button
              type="button"
              className="button secondary"
              onClick={() => setTargetFormOpen(false)}
            >
              取消
            </button>
            <button className="button primary" disabled={registerTarget.isPending}>
              {registerTarget.isPending ? '正在核验' : '核验并注册'}
            </button>
          </div>
          {registerTarget.error && (
            <span className="form-error">{registerTarget.error.message}</span>
          )}
        </form>
      )}
      {agentFormOpen && (
        <form
          className="management-form"
          onSubmit={(event) => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(event.currentTarget));
            const selected = catalog.data?.find((item) => item.agentKind === values.agentKind);
            registerAgent.mutate({
              name: String(values.name || selected?.name || values.agentKind),
              agentKind: String(values.agentKind),
              targetId: String(values.targetId),
              ...(values.defaultModel ? { defaultModel: String(values.defaultModel) } : {}),
              ...(values.defaultMode ? { defaultMode: String(values.defaultMode) } : {}),
            });
          }}
        >
          <div className="form-heading">
            <div>
              <span className="section-kicker">Agent Profile</span>
              <h3>添加内置 Agent</h3>
            </div>
            <p>使用服务端固定命令和 adapter 版本；不会临时执行 latest 安装。</p>
          </div>
          <div className="form-grid">
            <label>
              Agent 类型
              <select required name="agentKind">
                {catalog.data?.map((entry) => (
                  <option key={entry.agentKind} value={entry.agentKind}>
                    {entry.name} · {entry.adapterKind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              名称
              <input required name="name" placeholder="例如 Codex 主力" />
            </label>
            <label className="span-two">
              Execution Target
              <select required name="targetId">
                <option value="">请选择</option>
                {targets.data?.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name} · {target.kind}
                  </option>
                ))}
              </select>
            </label>
            <label>
              默认模型
              <input name="defaultModel" placeholder="由 Agent 决定" />
            </label>
            <label>
              默认模式
              <input name="defaultMode" placeholder="由 Agent 决定" />
            </label>
          </div>
          <div className="catalog-notes">
            {catalog.data?.map((entry) => (
              <div key={entry.agentKind}>
                <strong>{entry.name}</strong>
                <code>{entry.command}</code>
                <span>{entry.notes}</span>
              </div>
            ))}
          </div>
          <div className="form-footer">
            <button
              type="button"
              className="button secondary"
              onClick={() => setAgentFormOpen(false)}
            >
              取消
            </button>
            <button className="button primary" disabled={registerAgent.isPending}>
              {registerAgent.isPending ? '正在添加' : '添加 Agent'}
            </button>
          </div>
          {registerAgent.error && <span className="form-error">{registerAgent.error.message}</span>}
        </form>
      )}
      <div className="agent-layout">
        <section className="control-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Agent Profiles</span>
              <h3>已注册 Agent</h3>
            </div>
            <RefreshCw size={17} />
          </div>
          {agents.isLoading ? (
            <LoadingState />
          ) : agents.error ? (
            <ErrorState error={agents.error} />
          ) : !agents.data?.length ? (
            <EmptyState
              title="尚未注册 Agent"
              description="先注册 Execution Target，再选择内置 Agent Profile。"
            />
          ) : (
            agents.data.map((agent) => (
              <div className="agent-row" key={agent.id}>
                <span className="agent-glyph large">
                  <Bot size={19} />
                </span>
                <div className="grow">
                  <div className="row-title">
                    <strong>{agent.name}</strong>
                    <StatusBadge status={agent.status} />
                  </div>
                  <span>
                    {agent.agentKind} · {agent.adapterKind} · {agent.detectedVersion ?? '版本未知'}
                  </span>
                  <small>最近预检 {formatTime(agent.lastPreflightAt)}</small>
                  <div className="capability-strip" aria-label="Agent capability">
                    {capabilityLabels(agent.capabilitiesJson).map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                    {!capabilityLabels(agent.capabilitiesJson).length && (
                      <span>尚未获取 capability</span>
                    )}
                  </div>
                  <details className="debug-details">
                    <summary>调试视图</summary>
                    <pre>{JSON.stringify(agent.capabilitiesJson, null, 2)}</pre>
                  </details>
                </div>
                <button
                  className="button secondary compact"
                  onClick={() => preflight.mutate({ id: agent.id, cwd })}
                  disabled={preflight.isPending}
                >
                  重新预检
                </button>
              </div>
            ))
          )}
        </section>
        <section className="control-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Execution Targets</span>
              <h3>宿主机与 Docker</h3>
            </div>
            <Box size={18} />
          </div>
          {targets.data?.map((target) => (
            <div className="target-row" key={target.id}>
              <div>
                <strong>{target.name}</strong>
                <code>{target.containerName ?? target.hostname}</code>
                <small>
                  {target.os}/{target.arch} · {target.startPolicy ?? 'HOST'}
                </small>
                {target.expectedContainerId && (
                  <code title={target.expectedContainerId}>ID {target.expectedContainerId}</code>
                )}
                {!!target.workspaceMappingsJson.length && (
                  <details className="debug-details target-details">
                    <summary>目录映射</summary>
                    {target.workspaceMappingsJson.map((mapping) => (
                      <code key={`${mapping.hostRoot}:${mapping.containerRoot}`}>
                        {mapping.hostRoot} → {mapping.containerRoot}
                      </code>
                    ))}
                  </details>
                )}
              </div>
              <div>
                <StatusBadge status={target.status} />
                <button
                  className="button ghost compact"
                  onClick={() =>
                    targetPreflight.mutate({
                      id: target.id,
                      ...(projects.data?.[0]?.realRootPath
                        ? { cwd: projects.data[0].realRootPath }
                        : {}),
                    })
                  }
                  disabled={targetPreflight.isPending}
                >
                  预检
                </button>
                {target.kind === 'DOCKER_CONTAINER' && (
                  <button
                    className="button ghost compact"
                    onClick={() =>
                      lifecycle.mutate({
                        id: target.id,
                        action: target.status === 'READY' ? 'stop' : 'start',
                      })
                    }
                  >
                    {target.status === 'READY' ? '停止' : '启动'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {!targets.data?.length && (
            <EmptyState
              title="没有 Execution Target"
              description="Docker 容器必须以完整 container ID 显式注册。"
            />
          )}
          {(lifecycle.error || targetPreflight.error) && (
            <p className="inline-error">{(lifecycle.error ?? targetPreflight.error)?.message}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function capabilityLabels(capabilities: Record<string, unknown>): string[] {
  const groups: Array<[string, Array<[string, string]>]> = [
    ['sessions', [['resume', '恢复 Session']]],
    [
      'interaction',
      [
        ['streaming', '流式输出'],
        ['approvals', 'Approval'],
        ['plan', 'Plan'],
      ],
    ],
    [
      'workspace',
      [
        ['files', '文件'],
        ['terminal', 'Terminal'],
        ['mcpStdio', 'MCP stdio'],
        ['mcpHttp', 'MCP HTTP'],
      ],
    ],
    [
      'configuration',
      [
        ['models', '模型'],
        ['modes', '模式'],
        ['reasoningEffort', '推理强度'],
      ],
    ],
  ];
  return groups.flatMap(([groupName, entries]) => {
    const group = capabilities[groupName];
    if (!group || typeof group !== 'object') return [];
    return entries
      .filter(([key]) => (group as Record<string, unknown>)[key] === true)
      .map(([, label]) => label);
  });
}

export function SessionsPage() {
  const navigate = useNavigate();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<SessionRecord[]>('/sessions'),
  });
  return (
    <div className="page-stack">
      <PageIntro
        title="Coding Session"
        description="进入多栏工作区查看对话、Approval、文件、Diff、Git 和运行上下文。"
      />
      {sessions.isLoading ? (
        <LoadingState />
      ) : sessions.error ? (
        <ErrorState error={sessions.error} />
      ) : !sessions.data?.length ? (
        <EmptyState
          title="还没有 Session"
          description="从 Task 或 Project 选择 Agent 后开始第一次会话。"
        />
      ) : (
        <div className="session-cards">
          {sessions.data.map((session) => (
            <button
              key={session.id}
              className="session-card"
              onClick={() => navigate(`/sessions/${session.id}`)}
            >
              <div>
                <span className="session-icon">
                  <Bot size={17} />
                </span>
                <StatusBadge status={session.status} />
              </div>
              <strong>{session.title}</strong>
              <code>{session.cwd}</code>
              <span>
                {session.branch || '无 Git 分支'} · {formatTime(session.lastActiveAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TasksPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState('');
  const [goalFormOpen, setGoalFormOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<Record<string, string>>({});
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRecord[]>('/projects'),
  });
  const effectiveProjectId = projectId || projects.data?.[0]?.id || '';
  const goals = useQuery({
    queryKey: ['goals', effectiveProjectId],
    queryFn: () => api.get<GoalRecord[]>(`/goals?projectId=${effectiveProjectId}`),
    enabled: Boolean(effectiveProjectId),
  });
  const tasks = useQuery({
    queryKey: ['tasks', effectiveProjectId],
    queryFn: () => api.get<TaskRecord[]>(`/tasks?projectId=${effectiveProjectId}`),
    enabled: Boolean(effectiveProjectId),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['tasks'] });
    void client.invalidateQueries({ queryKey: ['goals'] });
  };
  const createGoal = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/goals', body),
    onSuccess: () => {
      setGoalFormOpen(false);
      refresh();
    },
  });
  const createTask = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/tasks', body),
    onSuccess: () => {
      setTaskFormOpen(false);
      refresh();
    },
  });
  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskRecord['status'] }) =>
      api.post(`/tasks/${id}/transition`, { status }),
    onSuccess: refresh,
  });
  const start = useMutation({
    mutationFn: ({ id, agentId }: { id: string; agentId: string }) =>
      api.post<{ session: { id: string } }>(`/tasks/${id}/start`, { agentId }),
    onSuccess: (result) => {
      refresh();
      void client.invalidateQueries({ queryKey: ['sessions'] });
      navigate(`/sessions/${result.session.id}`);
    },
  });
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVE' | 'REWORK' }) =>
      api.post(`/tasks/${id}/review`, { decision }),
    onSuccess: refresh,
  });
  const columns: Array<{
    status: TaskRecord['status'];
    title: string;
    description: string;
  }> = [
    { status: 'BACKLOG', title: '待规划', description: '明确范围后设为就绪' },
    { status: 'READY', title: '就绪', description: '可交给 Agent 开始' },
    { status: 'IN_PROGRESS', title: '进行中', description: 'Agent 正在执行' },
    { status: 'WAITING_REVIEW', title: '待审阅', description: '需要用户确认结果' },
    { status: 'DONE', title: '完成', description: '已经人工确认' },
  ];

  return (
    <div className="page-stack">
      <PageIntro
        title="Goal 与 Task"
        description="任务进入 Agent Run 后先到待审阅，只有用户确认才会完成。"
        action={
          <div className="page-actions">
            <button className="button secondary" onClick={() => setGoalFormOpen(!goalFormOpen)}>
              <Plus size={15} /> 创建 Goal
            </button>
            <button className="button primary" onClick={() => setTaskFormOpen(!taskFormOpen)}>
              <Plus size={15} /> 创建 Task
            </button>
          </div>
        }
      />
      <div className="task-toolbar">
        <label>
          当前 Project
          <select value={effectiveProjectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <div className="goal-strip">
          {(goals.data ?? []).map((goal) => (
            <span key={goal.id}>
              <StatusBadge status={goal.status} />
              <strong>{goal.title}</strong>
            </span>
          ))}
          {!goals.data?.length && <small>当前 Project 尚无 Goal</small>}
        </div>
      </div>
      {goalFormOpen && (
        <form
          className="inline-form task-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(event.currentTarget));
            createGoal.mutate({
              projectId: effectiveProjectId,
              title: String(values.title),
              ...(values.description ? { description: String(values.description) } : {}),
              ...(values.successCriteria
                ? { successCriteria: String(values.successCriteria) }
                : {}),
            });
          }}
        >
          <label>
            Goal 标题
            <input required name="title" placeholder="例如发布 AgentHub v0.1" />
          </label>
          <label>
            说明
            <input name="description" placeholder="目标范围与背景" />
          </label>
          <label>
            成功标准
            <input name="successCriteria" placeholder="可验证的完成条件" />
          </label>
          <button className="button primary" disabled={!effectiveProjectId || createGoal.isPending}>
            创建 Goal
          </button>
        </form>
      )}
      {taskFormOpen && (
        <form
          className="inline-form task-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(event.currentTarget));
            createTask.mutate({
              projectId: effectiveProjectId,
              title: String(values.title),
              ...(values.goalId ? { goalId: String(values.goalId) } : {}),
              ...(values.description ? { description: String(values.description) } : {}),
              ...(values.acceptanceCriteria
                ? { acceptanceCriteria: String(values.acceptanceCriteria) }
                : {}),
            });
          }}
        >
          <label>
            Task 标题
            <input required name="title" placeholder="例如完成真实 Agent smoke" />
          </label>
          <label>
            所属 Goal
            <select name="goalId">
              <option value="">不绑定 Goal</option>
              {goals.data?.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            任务与验收标准
            <input name="description" placeholder="Agent 要完成的工作" />
            <input name="acceptanceCriteria" placeholder="验收标准" />
          </label>
          <button className="button primary" disabled={!effectiveProjectId || createTask.isPending}>
            创建 Task
          </button>
        </form>
      )}
      {projects.isLoading || tasks.isLoading ? (
        <LoadingState label="正在加载任务看板" />
      ) : projects.error || tasks.error ? (
        <ErrorState error={(projects.error ?? tasks.error) as Error} />
      ) : !projects.data?.length ? (
        <EmptyState
          title="尚未添加 Project"
          description="先添加 Project，才能创建 Goal 与 Task。"
        />
      ) : (
        <div className="task-board" aria-label="Task 看板">
          {columns.map((column) => {
            const entries = (tasks.data ?? []).filter((task) => task.status === column.status);
            return (
              <section className="task-column" key={column.status}>
                <header>
                  <div>
                    <strong>{column.title}</strong>
                    <span>{column.description}</span>
                  </div>
                  <small>{entries.length}</small>
                </header>
                <div className="task-column-body">
                  {entries.map((task) => {
                    const agentId = selectedAgents[task.id] || agents.data?.[0]?.id || '';
                    return (
                      <article className="task-card" key={task.id}>
                        <div className="task-card-heading">
                          <span>优先级 {task.priority}</span>
                          <StatusBadge status={task.status} />
                        </div>
                        <strong>{task.title}</strong>
                        <p>{task.description || '暂无任务说明'}</p>
                        {task.branch && <code>{task.branch}</code>}
                        {task.status === 'READY' && (
                          <label className="task-agent-select">
                            Agent
                            <select
                              value={agentId}
                              onChange={(event) =>
                                setSelectedAgents((current) => ({
                                  ...current,
                                  [task.id]: event.target.value,
                                }))
                              }
                            >
                              <option value="">请选择 Agent</option>
                              {agents.data?.map((agent) => (
                                <option
                                  key={agent.id}
                                  value={agent.id}
                                  disabled={agent.status !== 'READY'}
                                >
                                  {agent.name} · {agent.status}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <div className="task-card-actions">
                          {task.status === 'BACKLOG' && (
                            <button
                              className="button primary compact"
                              onClick={() => transition.mutate({ id: task.id, status: 'READY' })}
                            >
                              设为就绪
                            </button>
                          )}
                          {task.status === 'READY' && (
                            <button
                              className="button primary compact"
                              disabled={!agentId || start.isPending}
                              onClick={() => start.mutate({ id: task.id, agentId })}
                            >
                              <Play size={13} /> 交给 Agent
                            </button>
                          )}
                          {task.status === 'IN_PROGRESS' && task.sessionId && (
                            <button
                              className="button secondary compact"
                              onClick={() => navigate(`/sessions/${task.sessionId}`)}
                            >
                              打开 Session
                            </button>
                          )}
                          {task.status === 'WAITING_REVIEW' && (
                            <>
                              <button
                                className="button primary compact"
                                onClick={() => review.mutate({ id: task.id, decision: 'APPROVE' })}
                              >
                                <ClipboardCheck size={13} /> 确认完成
                              </button>
                              <button
                                className="button secondary compact"
                                onClick={() => review.mutate({ id: task.id, decision: 'REWORK' })}
                              >
                                继续修改
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
                  {!entries.length && <span className="task-column-empty">暂无 Task</span>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {!!tasks.data?.some((task) => task.status === 'BLOCKED') && (
        <section className="control-section blocked-tasks">
          <div className="section-heading">
            <div>
              <span className="section-kicker">需要处理</span>
              <h3>受阻 Task</h3>
            </div>
          </div>
          {tasks.data
            .filter((task) => task.status === 'BLOCKED')
            .map((task) => (
              <div className="action-row" key={task.id}>
                <ShieldAlert size={17} />
                <div>
                  <strong>{task.title}</strong>
                  <span>上次 Run 未成功完成</span>
                </div>
                <button
                  className="button secondary compact"
                  onClick={() => transition.mutate({ id: task.id, status: 'READY' })}
                >
                  重新就绪
                </button>
              </div>
            ))}
        </section>
      )}
      {(createGoal.error ||
        createTask.error ||
        transition.error ||
        start.error ||
        review.error) && (
        <p className="inline-error">
          {
            (
              createGoal.error ??
              createTask.error ??
              transition.error ??
              start.error ??
              review.error
            )?.message
          }
        </p>
      )}
    </div>
  );
}

export function SettingsPage() {
  const client = useQueryClient();
  const [accessToken, setAccessToken] = useState(() => authTokenStore.get());
  const [oneTimeToken, setOneTimeToken] = useState('');
  const auth = useQuery({
    queryKey: ['auth-status'],
    queryFn: () =>
      api.get<{ mode: 'local_trusted' | 'token'; localTrusted: boolean }>('/auth/status'),
  });
  const capability = useQuery({
    queryKey: ['capabilities'],
    queryFn: () =>
      api.get<{
        terminal: {
          available: boolean;
          code: string;
          message: string;
          platform: string;
          arch: string;
        };
        remoteNode: { available: boolean };
      }>('/settings/capabilities'),
  });
  const tokens = useQuery({
    queryKey: ['api-tokens', Boolean(accessToken)],
    queryFn: () => api.get<ApiTokenRecord[]>('/auth/tokens'),
    enabled: auth.data?.localTrusted === true || Boolean(accessToken),
  });
  const createToken = useMutation({
    mutationFn: (name: string) =>
      api.post<ApiTokenRecord & { token: string }>('/auth/tokens', { name }),
    onSuccess: (created) => {
      setOneTimeToken(created.token);
      void client.invalidateQueries({ queryKey: ['api-tokens'] });
    },
  });
  const revokeToken = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/tokens/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['api-tokens'] }),
  });
  const saveAccessToken = (token: string) => {
    authTokenStore.set(token);
    setAccessToken(token.trim());
    realtime.reconnect();
    void client.invalidateQueries();
  };
  return (
    <div className="page-stack">
      <PageIntro
        title="设置与诊断"
        description="查看服务能力、安全边界和高权限 Docker 风险。凭据只保存引用。"
      />
      <div className="settings-grid">
        <section className="control-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">平台能力</span>
              <h3>Terminal</h3>
            </div>
            <SquareTerminal size={18} />
          </div>
          {capability.isLoading ? (
            <LoadingState />
          ) : capability.error ? (
            <ErrorState error={capability.error} />
          ) : (
            <div className="capability-block">
              <StatusBadge status={capability.data?.terminal.available ? 'READY' : 'MISSING'} />
              <strong>{capability.data?.terminal.message}</strong>
              <code>
                {capability.data?.terminal.platform}/{capability.data?.terminal.arch} ·{' '}
                {capability.data?.terminal.code}
              </code>
              <p>
                {capability.data?.terminal.available
                  ? '用户 PTY 可在 Workspace 中启用。'
                  : 'Terminal 控件将隐藏，Agent core 不受影响。'}
              </p>
            </div>
          )}
        </section>
        <section className="control-section auth-panel">
          <div className="section-heading">
            <div>
              <span className="section-kicker">访问认证</span>
              <h3>当前浏览器 token</h3>
            </div>
            <ShieldAlert size={18} />
          </div>
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              saveAccessToken(String(values.get('accessToken') ?? ''));
            }}
          >
            <label>
              Bearer token
              <input
                name="accessToken"
                type="password"
                defaultValue={accessToken}
                autoComplete="off"
                placeholder="仅保存在当前浏览器 Session"
              />
            </label>
            <button className="button secondary">保存到当前 Session</button>
            {accessToken && (
              <button type="button" className="button ghost" onClick={() => saveAccessToken('')}>
                清除
              </button>
            )}
          </form>
          <p>浏览器访问 token 只保存在 sessionStorage，关闭浏览器 Session 后失效。</p>
        </section>
        <section className="control-section auth-panel">
          <div className="section-heading">
            <div>
              <span className="section-kicker">API tokens</span>
              <h3>创建与撤销</h3>
            </div>
            <CheckCircle2 size={18} />
          </div>
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              createToken.mutate(String(values.get('name') ?? ''));
            }}
          >
            <label>
              token 名称
              <input required name="name" placeholder="例如 NAS 控制端" />
            </label>
            <button className="button primary" disabled={createToken.isPending}>
              创建 token
            </button>
          </form>
          {oneTimeToken && (
            <div className="token-once">
              <strong>只显示一次，请立即保存</strong>
              <code>{oneTimeToken}</code>
              <button
                className="button secondary compact"
                onClick={() => saveAccessToken(oneTimeToken)}
              >
                用于当前浏览器
              </button>
            </div>
          )}
          <div className="token-list">
            {tokens.data?.map((token) => (
              <div key={token.id}>
                <span>
                  <strong>{token.name}</strong>
                  <small>最近使用 {formatTime(token.lastUsedAt)}</small>
                </span>
                <StatusBadge status={token.revokedAt ? 'CANCELED' : 'ACTIVE'} />
                {!token.revokedAt && (
                  <button
                    className="button ghost compact"
                    onClick={() => revokeToken.mutate(token.id)}
                  >
                    撤销
                  </button>
                )}
              </div>
            ))}
          </div>
          {(tokens.error || createToken.error || revokeToken.error) && (
            <p className="inline-error">
              {(tokens.error ?? createToken.error ?? revokeToken.error)?.message}
            </p>
          )}
        </section>
        <section className="control-section warning-surface">
          <div className="section-heading">
            <div>
              <span className="section-kicker">高权限能力</span>
              <h3>Docker 控制</h3>
            </div>
            <ShieldAlert size={18} />
          </div>
          <p>
            Docker 权限等同主机高权限。AgentHub 只允许操作显式注册且完整 container ID 仍匹配的容器。
          </p>
          <ul>
            <li>不会修改 Compose、镜像或 volume</li>
            <li>不提供通用 Docker 命令入口</li>
            <li>活动 Session 会阻止停止容器</li>
          </ul>
        </section>
        <section className="control-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">服务模式</span>
              <h3>{auth.data?.localTrusted ? '本地可信' : 'token auth'}</h3>
            </div>
            <CheckCircle2 size={18} />
          </div>
          <div className="capability-block">
            <strong>{auth.data?.localTrusted ? 'loopback 默认模式' : '远程访问保护已启用'}</strong>
            <p>非 loopback bind 必须配置 token auth；服务端 token 仅保存 SHA-256 hash。</p>
          </div>
        </section>
      </div>
    </div>
  );
}
