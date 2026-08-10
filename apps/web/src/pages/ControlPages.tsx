import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Button,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  CubeIcon as Box,
  Dialog,
  GitBranch,
  GitMerge,
  IconButton,
  KeyRound,
  Layers3,
  Plus,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  SquareTerminal,
  X,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';

import {
  api,
  authSession,
  type AgentCatalogEntry,
  type AgentRecord,
  type ApiTokenRecord,
  type ExecutionTargetRecord,
  type GoalRecord,
  type ProjectRecord,
  type SessionRecord,
  type TaskRecord,
  type WorktreeExecutionRecord,
  type WorktreeReviewRecord,
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
import type { AuthStatus } from '../components/AccessGate';
import { PasswordField } from '../components/PasswordField';
import { RemoteNodesPanel } from './RemoteNodesPanel';

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
          <Button onClick={() => setAdding(!adding)}>
            <Plus size={15} /> 添加 Project
          </Button>
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
          <Button disabled={add.isPending}>{add.isPending ? '正在预检' : '预检并添加'}</Button>
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
  return (
    <div className="page-stack">
      <PageIntro
        title="Agent 与执行目标"
        description="真实展示 Agent capability、认证、Docker 与 Remote Node 状态；不会自动安装、重建或停止容器。"
        action={
          <div className="page-actions">
            <Button color="gray" variant="soft" onClick={() => setTargetFormOpen(!targetFormOpen)}>
              <Box size={15} /> 注册 Execution Target
            </Button>
            <Button onClick={() => setAgentFormOpen(!agentFormOpen)}>
              <Plus size={15} /> 添加 Agent
            </Button>
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
            <p>Docker target 会核验完整 container ID；Remote Node 请在设置页使用一次性注册码。</p>
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
            <Button
              type="button"
              color="gray"
              variant="soft"
              onClick={() => setTargetFormOpen(false)}
            >
              取消
            </Button>
            <Button disabled={registerTarget.isPending}>
              {registerTarget.isPending ? '正在核验' : '核验并注册'}
            </Button>
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
            <Button
              type="button"
              color="gray"
              variant="soft"
              onClick={() => setAgentFormOpen(false)}
            >
              取消
            </Button>
            <Button disabled={registerAgent.isPending}>
              {registerAgent.isPending ? '正在添加' : '添加 Agent'}
            </Button>
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
                <Button
                  color="gray"
                  size="1"
                  variant="soft"
                  title={
                    projects.data?.some((project) => project.targetId === agent.targetId)
                      ? undefined
                      : '请先为同一 Execution Target 添加 Project'
                  }
                  onClick={() => {
                    const project = projects.data?.find(
                      (candidate) => candidate.targetId === agent.targetId,
                    );
                    if (project) preflight.mutate({ id: agent.id, cwd: project.realRootPath });
                  }}
                  disabled={
                    preflight.isPending ||
                    !projects.data?.some((project) => project.targetId === agent.targetId)
                  }
                >
                  重新预检
                </Button>
              </div>
            ))
          )}
        </section>
        <section className="control-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Execution Targets</span>
              <h3>宿主机、Docker 与 Remote Node</h3>
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
                <Button
                  color="gray"
                  size="1"
                  variant="ghost"
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
                </Button>
                {target.kind === 'DOCKER_CONTAINER' && (
                  <Button
                    color="gray"
                    size="1"
                    variant="ghost"
                    onClick={() =>
                      lifecycle.mutate({
                        id: target.id,
                        action: target.status === 'READY' ? 'stop' : 'start',
                      })
                    }
                  >
                    {target.status === 'READY' ? '停止' : '启动'}
                  </Button>
                )}
              </div>
            </div>
          ))}
          {!targets.data?.length && (
            <EmptyState
              title="没有 Execution Target"
              description="Docker 容器需显式注册；Remote Node 由一次性注册码自动建立。"
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
  const [selectedExecutionId, setSelectedExecutionId] = useState('');
  const [reworkFeedback, setReworkFeedback] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
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
  const worktrees = useQuery({
    queryKey: ['worktree-executions', effectiveProjectId],
    queryFn: () =>
      api.get<WorktreeExecutionRecord[]>(`/worktree-executions?projectId=${effectiveProjectId}`),
    enabled: Boolean(effectiveProjectId),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const latestWorktreeByTask = new Map<string, WorktreeExecutionRecord>();
  for (const execution of worktrees.data ?? [])
    latestWorktreeByTask.set(execution.taskId, execution);
  const selectedExecution = (worktrees.data ?? []).find(
    (execution) => execution.id === selectedExecutionId,
  );
  const selectedTask = (tasks.data ?? []).find((task) => task.id === selectedExecution?.taskId);
  const worktreeReview = useQuery({
    queryKey: ['worktree-review', selectedExecutionId],
    queryFn: () =>
      api.get<WorktreeReviewRecord>(`/worktree-executions/${selectedExecutionId}/review`),
    enabled: Boolean(selectedExecutionId && selectedExecution?.worktreePath),
    retry: false,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['tasks'] });
    void client.invalidateQueries({ queryKey: ['goals'] });
    void client.invalidateQueries({ queryKey: ['worktree-executions'] });
    void client.invalidateQueries({ queryKey: ['worktree-review'] });
  };
  useEffect(
    () =>
      realtime.subscribe('worktrees', () => {
        refresh();
        void client.invalidateQueries({ queryKey: ['sessions'] });
      }),
    [client],
  );
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
  const queueWorktree = useMutation({
    mutationFn: ({ id, agentId }: { id: string; agentId: string }) =>
      api.post(`/tasks/${id}/worktree/queue`, { agentId }),
    onSuccess: refresh,
  });
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVE' | 'REWORK' }) =>
      api.post(`/tasks/${id}/review`, { decision }),
    onSuccess: refresh,
  });
  const reworkWorktree = useMutation({
    mutationFn: ({ id, feedback }: { id: string; feedback: string }) =>
      api.post<WorktreeExecutionRecord>(`/worktree-executions/${id}/rework`, { feedback }),
    onSuccess: (execution) => {
      refresh();
      setReworkFeedback('');
      setSelectedExecutionId('');
      if (execution.sessionId) navigate(`/sessions/${execution.sessionId}`);
    },
  });
  const mergeWorktree = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) =>
      api.post(`/worktree-executions/${id}/merge`, {
        ...(message.trim() ? { commitMessage: message.trim() } : {}),
      }),
    onSuccess: () => {
      refresh();
      setCommitMessage('');
      setSelectedExecutionId('');
    },
  });
  const cancelWorktree = useMutation({
    mutationFn: (id: string) => api.post(`/worktree-executions/${id}/cancel`),
    onSuccess: () => {
      refresh();
      setSelectedExecutionId('');
    },
  });
  const openExecution = (id: string) => {
    setSelectedExecutionId(id);
    setReworkFeedback('');
    setCommitMessage('');
  };
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
        description="可直接运行，也可进入隔离 Worktree 队列；隔离任务只有经过 Review 与显式合并才会完成。"
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
            <input required name="title" placeholder="例如发布 AgentHub v0.2" />
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
      {projects.isLoading || tasks.isLoading || worktrees.isLoading ? (
        <LoadingState label="正在加载任务看板" />
      ) : projects.error || tasks.error || worktrees.error ? (
        <ErrorState error={(projects.error ?? tasks.error ?? worktrees.error) as Error} />
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
                    const execution = latestWorktreeByTask.get(task.id);
                    return (
                      <article
                        className={`task-card${execution ? ' worktree-task-card' : ''}`}
                        key={task.id}
                      >
                        <div className="task-card-heading">
                          <span>优先级 {task.priority}</span>
                          <StatusBadge status={task.status} />
                        </div>
                        <strong>{task.title}</strong>
                        <p>{task.description || '暂无任务说明'}</p>
                        {task.branch && <code>{task.branch}</code>}
                        {execution && <ExecutionRail execution={execution} compact />}
                        {execution?.errorMessage && (
                          <span className="worktree-card-error">{execution.errorMessage}</span>
                        )}
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
                            <>
                              {projects.data?.find((project) => project.id === task.projectId)
                                ?.repoKind === 'GIT' && (
                                <button
                                  className="button primary compact"
                                  disabled={!agentId || queueWorktree.isPending}
                                  onClick={() => queueWorktree.mutate({ id: task.id, agentId })}
                                >
                                  <Layers3 size={13} /> 隔离执行
                                </button>
                              )}
                              <button
                                className="button secondary compact"
                                disabled={!agentId || start.isPending}
                                onClick={() => start.mutate({ id: task.id, agentId })}
                              >
                                <Play size={13} /> 直接运行
                              </button>
                            </>
                          )}
                          {task.status === 'IN_PROGRESS' && (
                            <>
                              {(execution?.sessionId || task.sessionId) && (
                                <button
                                  className="button secondary compact"
                                  onClick={() =>
                                    navigate(`/sessions/${execution?.sessionId || task.sessionId}`)
                                  }
                                >
                                  打开 Session
                                </button>
                              )}
                              {execution && (
                                <button
                                  className="button ghost compact"
                                  onClick={() => openExecution(execution.id)}
                                >
                                  执行详情
                                </button>
                              )}
                            </>
                          )}
                          {task.status === 'WAITING_REVIEW' && (
                            <>
                              {execution?.status === 'REVIEW' ? (
                                <button
                                  className="button primary compact"
                                  onClick={() => openExecution(execution.id)}
                                >
                                  <GitMerge size={13} /> 审阅并合并
                                </button>
                              ) : (
                                <>
                                  <button
                                    className="button primary compact"
                                    onClick={() =>
                                      review.mutate({ id: task.id, decision: 'APPROVE' })
                                    }
                                  >
                                    <ClipboardCheck size={13} /> 确认完成
                                  </button>
                                  <button
                                    className="button secondary compact"
                                    onClick={() =>
                                      review.mutate({ id: task.id, decision: 'REWORK' })
                                    }
                                  >
                                    继续修改
                                  </button>
                                </>
                              )}
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
            .map((task) => {
              const execution = latestWorktreeByTask.get(task.id);
              return (
                <div className="action-row" key={task.id}>
                  <ShieldAlert size={17} />
                  <div>
                    <strong>{task.title}</strong>
                    <span>{execution?.errorMessage || '上次 Run 未成功完成'}</span>
                  </div>
                  {execution?.worktreePath && (
                    <button
                      className="button ghost compact"
                      onClick={() => openExecution(execution.id)}
                    >
                      查看现场
                    </button>
                  )}
                  <button
                    className="button secondary compact"
                    onClick={() => transition.mutate({ id: task.id, status: 'READY' })}
                  >
                    重新就绪
                  </button>
                </div>
              );
            })}
        </section>
      )}
      {(createGoal.error ||
        createTask.error ||
        transition.error ||
        start.error ||
        review.error ||
        queueWorktree.error ||
        reworkWorktree.error ||
        mergeWorktree.error ||
        cancelWorktree.error) && (
        <p className="inline-error">
          {
            (
              createGoal.error ??
              createTask.error ??
              transition.error ??
              start.error ??
              review.error ??
              queueWorktree.error ??
              reworkWorktree.error ??
              mergeWorktree.error ??
              cancelWorktree.error
            )?.message
          }
        </p>
      )}
      {selectedExecution && (
        <WorktreeReviewPanel
          execution={selectedExecution}
          task={selectedTask}
          review={worktreeReview.data}
          loading={worktreeReview.isLoading}
          error={worktreeReview.error as Error | null}
          reworkFeedback={reworkFeedback}
          commitMessage={commitMessage}
          busy={reworkWorktree.isPending || mergeWorktree.isPending || cancelWorktree.isPending}
          onClose={() => setSelectedExecutionId('')}
          onReworkFeedback={setReworkFeedback}
          onCommitMessage={setCommitMessage}
          onOpenSession={() => {
            if (selectedExecution.sessionId) {
              navigate(`/sessions/${selectedExecution.sessionId}`);
            }
          }}
          onRework={() =>
            reworkWorktree.mutate({
              id: selectedExecution.id,
              feedback: reworkFeedback.trim(),
            })
          }
          onMerge={() => mergeWorktree.mutate({ id: selectedExecution.id, message: commitMessage })}
          onCancel={() => cancelWorktree.mutate(selectedExecution.id)}
        />
      )}
    </div>
  );
}

const executionStages: Array<{
  label: string;
  statuses: WorktreeExecutionRecord['status'][];
}> = [
  { label: '排队', statuses: ['QUEUED'] },
  { label: '工作区', statuses: ['SETTING_UP'] },
  { label: 'Agent Run', statuses: ['RUNNING', 'AWAITING_INPUT'] },
  { label: 'Review', statuses: ['REVIEW'] },
  { label: 'Merge', statuses: ['MERGING', 'DONE'] },
];

function ExecutionRail({
  execution,
  compact = false,
}: {
  execution: WorktreeExecutionRecord;
  compact?: boolean;
}) {
  const stage = Math.max(
    0,
    executionStages.findIndex((item) => item.statuses.includes(execution.status)),
  );
  const terminalFailure = ['BLOCKED', 'CANCELED'].includes(execution.status);
  return (
    <div className={`execution-rail${compact ? ' compact' : ''}`} aria-label="Worktree 执行进度">
      {executionStages.map((item, index) => (
        <div
          className={`${index < stage || execution.status === 'DONE' ? 'complete' : ''}${
            index === stage && !terminalFailure ? ' current' : ''
          }${index === stage && terminalFailure ? ' stopped' : ''}`}
          key={item.label}
        >
          <span />
          <small>{item.label}</small>
        </div>
      ))}
      <StatusBadge status={execution.status} />
    </div>
  );
}

function WorktreeReviewPanel({
  execution,
  task,
  review,
  loading,
  error,
  reworkFeedback,
  commitMessage,
  busy,
  onClose,
  onReworkFeedback,
  onCommitMessage,
  onOpenSession,
  onRework,
  onMerge,
  onCancel,
}: {
  execution: WorktreeExecutionRecord;
  task?: TaskRecord | undefined;
  review?: WorktreeReviewRecord | undefined;
  loading: boolean;
  error: Error | null;
  reworkFeedback: string;
  commitMessage: string;
  busy: boolean;
  onClose: () => void;
  onReworkFeedback: (value: string) => void;
  onCommitMessage: (value: string) => void;
  onOpenSession: () => void;
  onRework: () => void;
  onMerge: () => void;
  onCancel: () => void;
}) {
  const canCancel = !['SETTING_UP', 'MERGING', 'DONE', 'CANCELED'].includes(execution.status);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content
        className="worktree-review-panel"
        aria-label={task?.title || '隔离执行详情'}
        aria-describedby="worktree-review-copy"
      >
        <header className="worktree-review-header">
          <div>
            <span className="section-kicker">Worktree Execution</span>
            <Dialog.Title id="worktree-review-title">{task?.title || '隔离执行详情'}</Dialog.Title>
            <Dialog.Description id="worktree-review-copy">
              检查真实 Diff 与分支身份后，再决定继续修改或合并。
            </Dialog.Description>
          </div>
          <Dialog.Close>
            <IconButton color="gray" variant="soft" aria-label="关闭执行详情">
              <X size={17} />
            </IconButton>
          </Dialog.Close>
        </header>

        <div className="worktree-review-body">
          <ExecutionRail execution={execution} />
          <div className="worktree-identity-grid">
            <div>
              <span>base branch</span>
              <strong>{execution.baseBranch}</strong>
              <code>{execution.baseSha.slice(0, 12)}</code>
            </div>
            <div>
              <span>task branch</span>
              <strong>{execution.taskBranch}</strong>
              <code>{review?.headSha.slice(0, 12) || '—'}</code>
            </div>
            <div className="worktree-path-fact">
              <span>worktree path</span>
              <code>{execution.worktreePath || '尚未创建'}</code>
            </div>
          </div>

          {execution.errorMessage && (
            <div className="worktree-gate-message danger">
              <ShieldAlert size={16} />
              <div>
                <strong>{execution.errorCode || '执行受阻'}</strong>
                <span>{execution.errorMessage}</span>
              </div>
            </div>
          )}

          {loading ? (
            <LoadingState label="正在读取 Worktree status 与 Diff" />
          ) : error ? (
            <ErrorState error={error} />
          ) : review ? (
            <section className="worktree-diff-docket">
              <header>
                <div>
                  <span className="section-kicker">Review evidence</span>
                  <h3>变更清单</h3>
                </div>
                <div className="worktree-diff-facts">
                  <span>{review.entries.length} 个路径</span>
                  <span>{review.aheadBy} 个提交</span>
                  <StatusBadge status={review.clean ? 'READY' : 'UNVERIFIED'} />
                </div>
              </header>
              {review.entries.length > 0 && (
                <div className="worktree-file-strip">
                  {review.entries.map((entry) => (
                    <span key={`${entry.path}-${entry.index}-${entry.worktree}`}>
                      <code>{`${entry.index}${entry.worktree}`}</code>
                      {entry.path}
                    </span>
                  ))}
                </div>
              )}
              <pre className="worktree-diff">{review.patch || '当前任务分支没有文件变更。'}</pre>
              {review.truncated && <small>Diff 已达到输出上限，仅展示前 4 MiB。</small>}
            </section>
          ) : (
            <div className="worktree-gate-message">
              <Layers3 size={16} />
              <span>Worktree 尚未生成可审阅的 Git 证据。</span>
            </div>
          )}

          {execution.status === 'REVIEW' && (
            <div className="worktree-review-actions">
              <label>
                继续修改说明
                <textarea
                  onChange={(event) => onReworkFeedback(event.target.value)}
                  placeholder="指出需要补充或修正的内容；将复用当前 Session 启动新 Run。"
                  rows={3}
                  value={reworkFeedback}
                />
                <Button
                  color="gray"
                  variant="soft"
                  disabled={busy || !reworkFeedback.trim()}
                  onClick={onRework}
                >
                  <RotateCcw size={14} /> 继续修改
                </Button>
              </label>
              <label className="merge-gate-control">
                受管 Commit message
                <input
                  maxLength={240}
                  onChange={(event) => onCommitMessage(event.target.value)}
                  placeholder={`feat(task): ${task?.title || '完成隔离任务'}`}
                  value={commitMessage}
                />
                <span>批准后才会暂存隔离变更、创建 commit，并以 `--no-ff` 合并。</span>
                <Button disabled={busy || loading || !!error} onClick={onMerge}>
                  <GitMerge size={14} /> 批准并合并
                </Button>
              </label>
            </div>
          )}
        </div>

        <footer className="worktree-review-footer">
          <span>Worktree 与 task branch 会保留，不会自动清理。</span>
          <div>
            {execution.sessionId && (
              <Button color="gray" variant="soft" onClick={onOpenSession}>
                打开 Session
              </Button>
            )}
            {canCancel && (
              <Button color="red" variant="ghost" disabled={busy} onClick={onCancel}>
                取消隔离执行
              </Button>
            )}
          </div>
        </footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function SettingsPage() {
  const client = useQueryClient();
  const [oneTimeToken, setOneTimeToken] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const auth = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => api.get<AuthStatus>('/auth/status'),
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
    queryKey: ['api-tokens'],
    queryFn: () => api.get<ApiTokenRecord[]>('/auth/tokens'),
    enabled: auth.data?.localTrusted === true || auth.data?.authenticated === true,
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
  const changePassword = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.put<{ user: AuthStatus['user'] }>('/auth/account/password', body),
    onSuccess: () => {
      setPasswordMessage('密码已更新，其他浏览器登录已退出。');
      void client.invalidateQueries({ queryKey: ['auth-status'] });
      realtime.reconnect();
    },
  });
  const logout = useMutation({
    mutationFn: () => api.post<{ loggedOut: boolean }>('/auth/logout'),
    onSuccess: () => {
      client.clear();
      realtime.disconnect();
      authSession.notifyAuthorizationRequired();
    },
  });
  return (
    <div className="page-stack">
      <PageIntro
        title="设置与诊断"
        description="查看服务能力、Remote Node、安全边界和高权限 Docker 风险。凭据只保存引用。"
      />
      <RemoteNodesPanel />
      <div className="settings-grid">
        <div className="settings-column">
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
          <section className="control-section account-panel">
            <div className="section-heading">
              <div>
                <span className="section-kicker">账号安全</span>
                <h3>{auth.data?.user?.username ?? '本机管理员'}</h3>
              </div>
              <KeyRound size={18} />
            </div>
            {auth.data?.localTrusted ? (
              <div className="capability-block">
                <strong>当前为 loopback 本地可信模式</strong>
                <p>服务没有开放到局域网，因此不要求账号登录。</p>
              </div>
            ) : (
              <>
                <form
                  className="account-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setPasswordMessage('');
                    const values = new FormData(event.currentTarget);
                    const currentPassword = String(values.get('currentPassword') ?? '');
                    const newPassword = String(values.get('newPassword') ?? '');
                    const confirmation = String(values.get('passwordConfirmation') ?? '');
                    if (newPassword !== confirmation) {
                      setPasswordMessage('两次输入的新密码不一致。');
                      return;
                    }
                    const form = event.currentTarget;
                    changePassword.mutate(
                      { currentPassword, newPassword },
                      { onSuccess: () => form.reset() },
                    );
                  }}
                >
                  <label>
                    当前密码
                    <PasswordField
                      required
                      minLength={6}
                      maxLength={128}
                      name="currentPassword"
                      size="3"
                      autoComplete="current-password"
                    />
                  </label>
                  <div className="account-password-row">
                    <label>
                      新密码
                      <PasswordField
                        required
                        minLength={6}
                        maxLength={128}
                        name="newPassword"
                        size="3"
                        autoComplete="new-password"
                      />
                    </label>
                    <label>
                      确认新密码
                      <PasswordField
                        required
                        minLength={6}
                        maxLength={128}
                        name="passwordConfirmation"
                        size="3"
                        autoComplete="new-password"
                      />
                    </label>
                  </div>
                  <div className="account-actions">
                    <Button disabled={changePassword.isPending}>
                      {changePassword.isPending ? '正在更新…' : '更新密码'}
                    </Button>
                    <Button
                      type="button"
                      color="red"
                      variant="soft"
                      disabled={logout.isPending}
                      onClick={() => logout.mutate()}
                    >
                      {logout.isPending ? '正在退出…' : '退出登录'}
                    </Button>
                  </div>
                </form>
                {(passwordMessage || changePassword.error || logout.error) && (
                  <p
                    className={
                      changePassword.error || logout.error ? 'inline-error' : 'inline-success'
                    }
                    role="status"
                  >
                    {passwordMessage || changePassword.error?.message || logout.error?.message}
                  </p>
                )}
              </>
            )}
          </section>
        </div>
        <div className="settings-column">
          <section className="control-section auth-panel">
            <div className="section-heading">
              <div>
                <span className="section-kicker">高级功能</span>
                <h3>外部集成</h3>
              </div>
              <KeyRound size={18} />
            </div>
            <p className="section-help">
              网页登录不需要 API token。CLI、自动化脚本或外部服务需要接入时，再展开管理。
            </p>
            <details className="advanced-disclosure">
              <summary>
                <span>
                  <strong>管理 API token</strong>
                  <small>仅供 CLI 与自动化集成</small>
                </span>
                <ChevronRight aria-hidden size={16} />
              </summary>
              <div className="advanced-disclosure-body">
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
                    <input required name="name" placeholder="例如：自动化脚本" />
                  </label>
                  <Button disabled={createToken.isPending}>创建 token</Button>
                </form>
                {oneTimeToken && (
                  <div className="token-once">
                    <strong>只显示一次，请立即保存</strong>
                    <code>{oneTimeToken}</code>
                    <Button
                      color="gray"
                      size="1"
                      variant="soft"
                      onClick={() => setOneTimeToken('')}
                    >
                      我已保存
                    </Button>
                  </div>
                )}
                <div className="token-list">
                  {tokens.isLoading ? (
                    <p className="token-empty">正在读取外部集成…</p>
                  ) : !tokens.data?.length ? (
                    <p className="token-empty">还没有 API token。</p>
                  ) : (
                    tokens.data.map((token) => (
                      <div key={token.id}>
                        <span>
                          <strong>{token.name}</strong>
                          <small>最近使用 {formatTime(token.lastUsedAt)}</small>
                        </span>
                        <StatusBadge status={token.revokedAt ? 'CANCELED' : 'ACTIVE'} />
                        {!token.revokedAt && (
                          <Button
                            color="red"
                            size="1"
                            variant="ghost"
                            onClick={() => revokeToken.mutate(token.id)}
                          >
                            撤销
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {(tokens.error || createToken.error || revokeToken.error) && (
                  <p className="inline-error">
                    {(tokens.error ?? createToken.error ?? revokeToken.error)?.message}
                  </p>
                )}
              </div>
            </details>
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
              Docker 权限等同主机高权限。AgentHub 只允许操作显式注册且完整 container ID
              仍匹配的容器。
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
                <h3>{auth.data?.localTrusted ? '本地可信' : '账号登录'}</h3>
              </div>
              <CheckCircle2 size={18} />
            </div>
            <div className="capability-block">
              <strong>
                {auth.data?.localTrusted ? 'loopback 默认模式' : '管理员登录保护已启用'}
              </strong>
              <p>
                网页登录使用 HttpOnly Cookie；API token 仅供外部集成，并且只以 SHA-256 hash 保存。
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
