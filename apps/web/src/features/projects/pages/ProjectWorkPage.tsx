import { WorktreeCancelAction, type WorktreeCancelState } from '../components/WorktreeCancelAction';
import { TaskWorktreeQueueAction } from '../components/TaskWorktreeQueueAction';
import { WorktreeReviewActions } from '../components/WorktreeReviewActions';
import { TaskReviewActions } from '../components/TaskReviewActions';
import { useProjectEligibility } from '../hooks/useProjectEligibility';
import { eligibilityReasons } from '../lib/project-eligibility';
import { TaskPromptVariablesEditor } from '../components/TaskPromptVariablesEditor';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { browserCreationScope } from '../lib/task-creation-recovery';
import { useManualTaskStart } from '../hooks/useManualTaskStart';
import { TaskCancelAction } from '../components/TaskCancelAction';
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
import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
  const queueTargets = useQuery({
    queryKey: ['execution-targets'],
    queryFn: () => api.get<ExecutionTargetRecord[]>('/execution-targets'),
    enabled: project.repoKind === 'GIT',
  });
  const prompts = useQuery({
    queryKey: ['prompts', project.id],
    queryFn: () => api.get<PromptRecord[]>(`/prompts?projectId=${project.id}`),
  });
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(statusFromQuery ?? 'all');
  const [agentFilter, setAgentFilter] = useState('all');
  const compact = useCompactViewport();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterOptionsId = useId();
  const activeFilterCount = [
    query.trim() !== '',
    statusFilter !== 'all',
    agentFilter !== 'all',
  ].filter(Boolean).length;
  const clearFilters = () => {
    setQuery('');
    setStatusFilter('all');
    setAgentFilter('all');
  };
  const [selectedId, setSelectedId] = useState(selectedFromQuery ?? '');
  const [agentChoice, setAgentChoice] = useState<{ key: string; value: string }>();
  useEffect(() => {
    if (selectedFromQuery && tasks.data?.some((task) => task.id === selectedFromQuery))
      setSelectedId(selectedFromQuery);
  }, [selectedFromQuery, tasks.data]);
  useEffect(() => {
    if (!selectedId && tasks.data?.[0]) setSelectedId(tasks.data[0].id);
  }, [selectedId, tasks.data]);
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
  const agentChoiceKey = JSON.stringify([project.id, selected?.id, selectedAgentFromQuery]);
  const runAgentId =
    agentChoice?.key === agentChoiceKey
      ? agentChoice.value
      : (selectedAgentFromQuery ?? selected?.assignedAgentId ?? '');
  useEffect(() => {
    setAgentChoice((choice) => (choice?.key === agentChoiceKey ? choice : undefined));
  }, [agentChoiceKey]);
  const selectedAgent = agents.data?.find((agent) => agent.id === runAgentId);
  const eligibility = useProjectEligibility(project.id);
  const eligibilityKnown =
    eligibility.isSuccess && !eligibility.isFetching && agents.isSuccess && !agents.isFetching;
  const agentReason = (agent: AgentRecord | undefined) => {
    if (!agent) return 'Agent 不存在或不可读取';
    if (!agent.enabled) return '已禁用';
    if (agent.status !== 'READY') return '尚未就绪';
    if (!eligibilityKnown)
      return eligibility.isError || agents.isError ? '资格无法确认，请刷新' : '资格待确认';
    const entry = eligibility.data?.find((item) => item.agentId === agent.id);
    return entry?.eligible ? '' : entry?.reason ? eligibilityReasons[entry.reason] : '资格未返回';
  };
  const selectedAgentReason = agentReason(selectedAgent);
  const selectedEligible = Boolean(selectedAgent && !selectedAgentReason);
  const startEligibility = useRef({ eligible: selectedEligible, generation: 0 });
  if (startEligibility.current.eligible !== selectedEligible) {
    startEligibility.current.eligible = selectedEligible;
    startEligibility.current.generation += 1;
  }
  const selectedPrompt = prompts.data?.find((prompt) => prompt.id === selectedPromptId);
  const selectedWorktree = selected
    ? worktrees.data?.find((item) => item.taskId === selected.id)
    : undefined;
  const taskStatuses = useMemo(
    () => Array.from(new Set((tasks.data ?? []).map((task) => task.status))),
    [tasks.data],
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
  const [variableSaveKey, setVariableSaveKey] = useState<string | null>(null);
  const variablesSaving = variableSaveKey !== null;
  const [reviewPendingKey, setReviewPendingKey] = useState<string | null>(null);
  const reviewPending = reviewPendingKey === `${project.id}:${selected?.id}`;
  const [queuePendingKeys, setQueuePendingKeys] = useState<Record<string, boolean>>({});
  const [queueUnknownKeys, setQueueUnknownKeys] = useState<Record<string, boolean>>({});
  const queueKey = `${project.id}:${selected?.id}`;
  const [queueAcceptedKeys, setQueueAcceptedKeys] = useState<Record<string, boolean>>({});
  const queueAccepted = Boolean(queueAcceptedKeys[queueKey]);
  const queuePending = Boolean(queuePendingKeys[queueKey]);
  const queueUnknown = Boolean(queueUnknownKeys[queueKey]);
  const [cancelStates, setCancelStates] = useState<Record<string, WorktreeCancelState>>({});
  const cancelPrefix = `${project.id}:${selected?.id}:${selectedWorktree?.id}:`;
  const cancelState = selectedWorktree
    ? (cancelStates[`${cancelPrefix}${selectedWorktree.runId ?? 'no-run'}`] ??
      Object.entries(cancelStates).find(
        ([key, value]) =>
          key.startsWith(cancelPrefix) && ['pending', 'unknown', 'checking'].includes(value.phase),
      )?.[1])
    : undefined;
  const cancelLocked = Boolean(
    cancelState && !['resolved', 'retryable'].includes(cancelState.phase),
  );
  const queueLocked =
    queuePending || queueUnknown || (queueAccepted && !selectedWorktree) || cancelLocked;
  const queueTarget = queueTargets.data?.find((item) => item.id === project.targetId);
  const queueEligible =
    selectedEligible &&
    worktrees.isSuccess &&
    !worktrees.isFetching &&
    !selectedWorktree &&
    queueTargets.isSuccess &&
    !queueTargets.isFetching &&
    Boolean(queueTarget && queueTarget.kind !== 'REMOTE_NODE') &&
    project.status === 'ACTIVE' &&
    project.repoKind === 'GIT';
  const operationContext = useRef({ identity: '', generation: 0, mounted: true });
  const selectionIdentity = JSON.stringify([project.id, selected?.id, runAgentId]);
  if (operationContext.current.identity !== selectionIdentity) {
    operationContext.current.identity = selectionIdentity;
    operationContext.current.generation += 1;
  }
  useEffect(() => {
    operationContext.current.mounted = true;
    return () => {
      operationContext.current.mounted = false;
      operationContext.current.generation += 1;
    };
  }, []);
  const currentOperation = (generation: number) =>
    operationContext.current.mounted && operationContext.current.generation === generation;
  const transition = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: TaskRecord['status'];
      generation: number;
    }) => api.post(`/tasks/${id}/transition`, { status }),
    onSettled: () => void client.invalidateQueries({ queryKey: ['tasks', project.id] }),
  });
  const start = useMutation({
    mutationFn: async ({
      id,
      agentId,
      status,
      generation,
      eligibilityGeneration,
    }: {
      id: string;
      agentId: string;
      status: TaskRecord['status'];
      generation: number;
      eligibilityGeneration: number;
    }) => {
      if (!selectedEligible) throw new Error('所选 Agent 的项目资格尚未确认，未启动。');
      if (!['BACKLOG', 'BLOCKED', 'READY'].includes(status))
        throw new Error('当前任务状态不支持启动，请刷新后核对。');
      if (
        !currentOperation(generation) ||
        startEligibility.current.generation !== eligibilityGeneration
      )
        return null;
      if (status === 'BACKLOG' || status === 'BLOCKED')
        await api.post(`/tasks/${id}/transition`, { status: 'READY' });
      // A new selection or navigation must not continue the old multi-step action.
      if (
        !currentOperation(generation) ||
        startEligibility.current.generation !== eligibilityGeneration
      )
        return null;
      return api.post<{ session: { id: string } }>(`/tasks/${id}/start`, { agentId });
    },
    onSuccess: (result, variables) => {
      if (result && currentOperation(variables.generation))
        navigate(`/workspace/${result.session.id}`);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['tasks', project.id] });
      void client.invalidateQueries({ queryKey: ['sessions', project.id] });
    },
  });
  const actionError =
    start.error && start.variables && currentOperation(start.variables.generation)
      ? start.error
      : transition.error &&
          transition.variables &&
          currentOperation(transition.variables.generation)
        ? transition.error
        : null;
  const manualScope = browserCreationScope(useAuthMode(), useAuthUser());
  const manual = useManualTaskStart(project.id, selected?.id, manualScope, () => {
    void client.invalidateQueries({ queryKey: ['tasks', project.id] });
  });
  const setWorkView = (nextView: 'list' | 'board') => {
    const next = new URLSearchParams(searchParams);
    if (nextView === 'board') next.set('view', 'board');
    else next.delete('view');
    setSearchParams(next);
  };
  const selectTask = (task: TaskRecord, fromBoard = false) => {
    setSelectedId(task.id);
    const next = new URLSearchParams(searchParams);
    next.set('task', task.id);
    // Commit selection and board exit together; two URL writes can lose task/agentId.
    if (fromBoard) next.delete('view');
    if (task.id !== selected?.id) {
      next.delete('agentId');
      setAgentChoice(undefined);
    }
    setSearchParams(next, { replace: true });
  };
  const acceptanceCriteria =
    selected?.acceptanceCriteria
      ?.split(/\r?\n/)
      .map((item) => item.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean) ?? [];
  const workError = tasks.error ?? goals.error ?? worktrees.error;
  const workLoading = tasks.isLoading || goals.isLoading || worktrees.isLoading;
  const emptyWork = tasks.isSuccess && tasks.data.length === 0 && !workLoading && !workError;
  return (
    <div className={projectsStyles.workPage}>
      <QueryMessage
        loading={workLoading}
        error={workError}
        retry={() => {
          void tasks.refetch();
          void goals.refetch();
          void worktrees.refetch();
        }}
        label="正在加载 Work"
      />
      {emptyWork ? (
        <section className={projectsStyles.workEmpty} aria-labelledby={`work-empty-${project.id}`}>
          <h2 id={`work-empty-${project.id}`}>开始这个项目的第一项工作</h2>
          <p>使用上方“新建工作”，描述想完成的结果、约束和验收标准。</p>
          <p>
            工作将归入 <strong>{project.name}</strong>；创建后可在这里查看进展与结果。
          </p>
          {goals.data?.length ? (
            <p>已有 {goals.data.length} 个 Goal，可在新建工作的高级设置中关联。</p>
          ) : null}
        </section>
      ) : !workLoading && !workError ? (
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
            {compact ? (
              <button
                type="button"
                className={projectsStyles.toolbarMore}
                aria-expanded={filtersOpen}
                aria-controls={filterOptionsId}
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <ScanSearch size={14} aria-hidden="true" />
                筛选{activeFilterCount ? `（${activeFilterCount}）` : ''}
              </button>
            ) : null}
            {compact && activeFilterCount ? (
              <button type="button" className={projectsStyles.toolbarMore} onClick={clearFilters}>
                清除条件
              </button>
            ) : null}
            <div
              id={filterOptionsId}
              className={projectsStyles.workFilterOptions}
              hidden={compact && !filtersOpen}
            >
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
                            onClick={() => selectTask(task, true)}
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
                    {manual.message ? <p role="status">{manual.message}</p> : null}
                    {actionError ? (
                      <AhErrorState title="任务操作失败" description={actionError.message} />
                    ) : null}
                    {selectedWorktree?.errorMessage ? (
                      <section className={projectsStyles.inspectorSection}>
                        <h4>需要处理</h4>
                        <p>{selectedWorktree.errorMessage}</p>
                      </section>
                    ) : null}
                    {(reviewPending && !selectedWorktree) ||
                    (selected.status === 'WAITING_REVIEW' &&
                      worktrees.isSuccess &&
                      !selectedWorktree) ? (
                      <section className={projectsStyles.inspectorSection}>
                        <h4>审阅结果</h4>
                        <TaskReviewActions
                          key={`${project.id}:${selected.id}`}
                          task={selected}
                          disabled={
                            worktrees.isFetching ||
                            start.isPending ||
                            transition.isPending ||
                            manual.busy ||
                            manual.unknown ||
                            variablesSaving ||
                            reviewPending ||
                            queueLocked
                          }
                          onPendingChange={(key, pending) =>
                            setReviewPendingKey((current) =>
                              pending ? key : current === key ? null : current,
                            )
                          }
                        />
                      </section>
                    ) : null}
                    {selectedWorktree && (selectedWorktree.status === 'REVIEW' || reviewPending) ? (
                      <section className={projectsStyles.inspectorSection}>
                        <h4>隔离工作区审阅</h4>
                        <WorktreeReviewActions
                          key={`${project.id}:${selected.id}:${selectedWorktree.id}`}
                          execution={selectedWorktree}
                          disabled={
                            worktrees.isFetching ||
                            start.isPending ||
                            transition.isPending ||
                            manual.busy ||
                            variablesSaving ||
                            reviewPending ||
                            queueLocked
                          }
                          onPendingChange={(key, pending) =>
                            setReviewPendingKey((current) =>
                              pending ? key : current === key ? null : current,
                            )
                          }
                        />
                      </section>
                    ) : null}
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
                        disabled={
                          start.isPending ||
                          transition.isPending ||
                          manual.busy ||
                          variablesSaving ||
                          reviewPending ||
                          queueLocked
                        }
                        label=""
                        value={runAgentId}
                        onChange={(value) =>
                          setAgentChoice({ key: agentChoiceKey, value: value ?? '' })
                        }
                        data={[
                          { value: '', label: '不选择 Agent' },
                          ...(agents.data ?? []).map((agent) => ({
                            value: agent.id,
                            label: `${agent.name}${agentReason(agent) ? ` · ${agentReason(agent)}` : ''}`,
                            disabled: Boolean(agentReason(agent)),
                          })),
                          ...(runAgentId && !selectedAgent
                            ? [
                                {
                                  value: runAgentId,
                                  label: '所选 Agent 不存在或不可读取',
                                  disabled: true,
                                },
                              ]
                            : []),
                        ]}
                        placeholder="选择可用 Agent"
                      />
                      {runAgentId && !selectedEligible ? (
                        <p role="status">
                          所选 Agent 不可用于当前项目：{selectedAgentReason}
                          。请刷新资格或明确选择其他 Agent。
                        </p>
                      ) : null}
                      <p className={layout.subtle}>
                        资格仅依据已登记状态和工作区映射，启动时仍会检查实际运行环境。
                      </p>
                      <AhButton
                        size="xs"
                        variant="default"
                        disabled={
                          start.isPending ||
                          transition.isPending ||
                          manual.busy ||
                          variablesSaving ||
                          reviewPending ||
                          queueLocked
                        }
                        onClick={() => {
                          void agents.refetch();
                          void eligibility.refetch();
                        }}
                      >
                        刷新 Agent 资格
                      </AhButton>
                      <div className={projectsStyles.runSummary}>
                        <span className={projectsStyles.agentAvatar} aria-hidden="true">
                          {selectedAgent?.name?.slice(0, 1).toUpperCase() ?? 'A'}
                        </span>
                        <span>
                          <strong>
                            {selectedAgent?.name ??
                              (runAgentId ? '所选 Agent 不可读取' : '尚未选择 Agent')}
                          </strong>
                          <small>
                            {selected.branch ?? selectedWorktree?.taskBranch ?? '尚未创建分支'}
                          </small>
                        </span>
                      </div>
                      {selectedWorktree ? <AhStatusPill status={selectedWorktree.status} /> : null}
                    </section>
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
                    {['BACKLOG', 'READY'].includes(selected.status) &&
                    selected.sessionId === null ? (
                      <section className={projectsStyles.inspectorSection}>
                        <h4>Prompt 变量</h4>
                        <TaskPromptVariablesEditor
                          key={`${project.id}:${selected.id}`}
                          task={selected}
                          disabled={
                            start.isPending ||
                            transition.isPending ||
                            manual.busy ||
                            manual.unknown ||
                            variablesSaving ||
                            reviewPending ||
                            queueLocked
                          }
                          onSaved={() => start.reset()}
                          onSavingChange={(key, saving) =>
                            setVariableSaveKey((current) =>
                              saving ? key : current === key ? null : current,
                            )
                          }
                        />
                      </section>
                    ) : null}
                    {queuePending ||
                    queueUnknown ||
                    (project.repoKind === 'GIT' &&
                      ['BACKLOG', 'READY'].includes(selected.status) &&
                      selected.sessionId === null &&
                      !selectedWorktree) ? (
                      <section className={projectsStyles.inspectorSection}>
                        <h4>隔离执行</h4>
                        <TaskWorktreeQueueAction
                          key={`${project.id}:${selected.id}`}
                          task={selected}
                          agentId={runAgentId}
                          eligible={queueEligible}
                          disabled={
                            start.isPending ||
                            transition.isPending ||
                            manual.busy ||
                            manual.unknown ||
                            variablesSaving ||
                            reviewPending
                          }
                          uncertain={queueUnknown}
                          inFlight={queuePending}
                          accepted={queueAccepted}
                          onAccepted={(key) =>
                            setQueueAcceptedKeys((current) => ({ ...current, [key]: true }))
                          }
                          onPendingChange={(key, pending) =>
                            setQueuePendingKeys((current) => ({ ...current, [key]: pending }))
                          }
                          onUncertainChange={(key, value) =>
                            setQueueUnknownKeys((current) => ({ ...current, [key]: value }))
                          }
                        />
                        {!queueEligible ? (
                          <>
                            <AhButton
                              size="xs"
                              variant="light"
                              disabled={queuePending}
                              onClick={() => {
                                void queueTargets.refetch();
                                void worktrees.refetch();
                                void agents.refetch();
                                void eligibility.refetch();
                              }}
                            >
                              刷新隔离执行条件
                            </AhButton>
                            <p>
                              隔离执行需要已确认可用的 Agent、活动 Git 项目和非 Remote Node
                              执行环境；请先等待或刷新相关状态。
                            </p>
                          </>
                        ) : null}
                      </section>
                    ) : null}
                    {selectedWorktree ? (
                      <section className={projectsStyles.inspectorSection}>
                        <h4>隔离执行取消</h4>
                        <WorktreeCancelAction
                          key={`${project.id}:${selected.id}:${selectedWorktree.id}:${selectedWorktree.runId}`}
                          execution={selectedWorktree}
                          state={cancelState}
                          disabled={
                            worktrees.isFetching ||
                            start.isPending ||
                            transition.isPending ||
                            manual.busy ||
                            variablesSaving ||
                            reviewPending ||
                            queuePending ||
                            queueUnknown
                          }
                          onStateChange={(key, value) =>
                            setCancelStates((current) => ({
                              ...current,
                              [key]: { ...value, registryKey: key },
                            }))
                          }
                        />
                        <p>此任务由隔离 Worktree 管理，不使用普通任务启动或取消入口。</p>
                      </section>
                    ) : null}
                    {!runAgentId ? <p>手工开始仅更新任务进度，不会启动 Agent。</p> : null}
                    <div className={projectsStyles.inspectorActions}>
                      <AhButton
                        size="xs"
                        variant="light"
                        onClick={() =>
                          runAgentId
                            ? start.mutate({
                                id: selected.id,
                                agentId: runAgentId,
                                status: selected.status,
                                generation: operationContext.current.generation,
                                eligibilityGeneration: startEligibility.current.generation,
                              })
                            : void manual.begin()
                        }
                        loading={transition.isPending || start.isPending || manual.busy}
                        disabled={
                          Boolean(selectedWorktree) ||
                          ['IN_PROGRESS', 'WAITING_REVIEW', 'DONE', 'CANCELED'].includes(
                            selected.status,
                          ) ||
                          (Boolean(runAgentId) && !selectedEligible) ||
                          (!runAgentId && manual.unavailable) ||
                          manual.busy ||
                          variablesSaving ||
                          reviewPending ||
                          queueLocked ||
                          transition.isPending ||
                          start.isPending ||
                          (manual.unknown && (Boolean(runAgentId) || !manual.status)) ||
                          (!runAgentId && !['BACKLOG', 'READY'].includes(selected.status))
                        }
                      >
                        <Play size={14} />{' '}
                        {runAgentId
                          ? '启动 Session'
                          : manual.unknown
                            ? '继续手工开始'
                            : '开始手工任务'}
                      </AhButton>
                      {manual.unknown || manual.message ? (
                        <AhButton
                          size="xs"
                          variant="light"
                          disabled={
                            manual.unavailable ||
                            manual.busy ||
                            transition.isPending ||
                            start.isPending
                          }
                          onClick={() => void manual.check()}
                        >
                          查询原任务状态
                        </AhButton>
                      ) : null}
                      {!selectedWorktree ? (
                        <TaskCancelAction
                          task={selected}
                          pending={
                            transition.isPending ||
                            start.isPending ||
                            manual.busy ||
                            manual.unknown ||
                            variablesSaving ||
                            reviewPending ||
                            queueLocked
                          }
                          onCancel={() =>
                            transition.mutate({
                              id: selected.id,
                              status: 'CANCELED',
                              generation: operationContext.current.generation,
                            })
                          }
                        />
                      ) : null}
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
