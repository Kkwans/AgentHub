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
import { useProjectContext } from './ProjectContextLayout';

export function ProjectWorkPage() {
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
            <>
              <p className={projectsStyles.boardHint} id="work-board-hint">
                手机端左右滑动查看其他状态
              </p>
              <div
                className={projectsStyles.board}
                aria-label="工作看板"
                aria-describedby="work-board-hint"
              >
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
                        {!columnTasks.length ? (
                          <span className={layout.subtle}>暂无工作</span>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
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
                          <Link className={layout.link} to={`/workspace/${selected.sessionId}`}>
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
