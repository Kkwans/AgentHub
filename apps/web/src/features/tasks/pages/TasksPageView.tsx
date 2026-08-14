import { useEffect, useState } from 'react';
import {
  Button,
  ClipboardCheck,
  Dialog,
  FormDialog,
  FormTextArea,
  FormTextField,
  SelectField,
  GitMerge,
  IconButton,
  Layers3,
  Plus,
  Pencil,
  Play,
  RotateCcw,
  ShieldAlert,
  X,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  api,
  type AgentRecord,
  type GoalRecord,
  type ProjectRecord,
  type RunRecord,
  type TaskRecord,
  type WorktreeExecutionRecord,
  type WorktreeReviewRecord,
} from '../../../lib/api';
import {
  EmptyState,
  ErrorState,
  formatTime,
  LoadingState,
  PageIntro,
  StatusBadge,
} from '../../../components/Common';
import { realtime } from '../../../lib/realtime';

export function TasksPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('projectId') ?? '';
  const selectedExecutionId = searchParams.get('execution') ?? '';
  const selectedTaskReviewId = searchParams.get('review') ?? '';
  const [goalFormOpen, setGoalFormOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalRecord | null>(null);
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [selectedTaskGoalId, setSelectedTaskGoalId] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<Record<string, string>>({});
  const [reworkFeedback, setReworkFeedback] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [taskReworkFeedback, setTaskReworkFeedback] = useState('');

  const setProjectId = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('projectId', id);
    else next.delete('projectId');
    next.delete('execution');
    next.delete('review');
    setSearchParams(next);
  };

  const setSelectedExecutionId = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('execution', id);
    else next.delete('execution');
    next.delete('review');
    setSearchParams(next);
  };

  const setSelectedTaskReviewId = (id: string) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('review', id);
    else next.delete('review');
    next.delete('execution');
    setSearchParams(next);
  };
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
    refetchInterval: (query) =>
      query.state.data?.some((task) => task.status === 'IN_PROGRESS') ? 1_000 : false,
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
  const selectedTaskReview = (tasks.data ?? []).find((task) => task.id === selectedTaskReviewId);
  const selectedTaskReviewProject = (projects.data ?? []).find(
    (project) => project.id === selectedTaskReview?.projectId,
  );
  const selectedTaskRuns = useQuery({
    queryKey: ['task-review-runs', selectedTaskReview?.sessionId],
    queryFn: () => api.get<RunRecord[]>(`/sessions/${selectedTaskReview?.sessionId ?? ''}/runs`),
    enabled: Boolean(selectedTaskReview?.sessionId),
  });
  const selectedTaskGitStatus = useQuery({
    queryKey: ['task-review-git-status', selectedTaskReviewProject?.id],
    queryFn: () =>
      api.get<{
        branch?: string;
        headSha?: string;
        clean: boolean;
        entries: Array<{ index: string; worktree: string; path: string }>;
      }>(`/projects/${selectedTaskReviewProject?.id ?? ''}/git/status`),
    enabled: selectedTaskReviewProject?.repoKind === 'GIT',
    retry: false,
  });
  const selectedTaskGitDiff = useQuery({
    queryKey: ['task-review-git-diff', selectedTaskReviewProject?.id],
    queryFn: () =>
      api.get<{ patch: string; truncated: boolean }>(
        `/projects/${selectedTaskReviewProject?.id ?? ''}/git/diff`,
      ),
    enabled: selectedTaskReviewProject?.repoKind === 'GIT',
    retry: false,
  });
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
  const updateGoal = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch<GoalRecord>(`/goals/${id}`, body),
    onSuccess: () => {
      setEditingGoal(null);
      refresh();
    },
  });
  const updateTask = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch<TaskRecord>(`/tasks/${id}`, body),
    onSuccess: () => {
      setEditingTask(null);
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
    mutationFn: ({
      id,
      decision,
      feedback,
    }: {
      id: string;
      decision: 'APPROVE' | 'REWORK';
      feedback?: string;
    }) =>
      api.post<{
        task: TaskRecord;
        session: { id: string } | null;
        run: { id: string } | null;
      }>(`/tasks/${id}/review`, {
        decision,
        ...(decision === 'REWORK' ? { feedback: feedback?.trim() ?? '' } : {}),
      }),
    onSuccess: (result) => {
      refresh();
      setSelectedTaskReviewId('');
      setTaskReworkFeedback('');
      if (result.session) navigate(`/sessions/${result.session.id}`);
    },
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
            <Button color="gray" variant="soft" onClick={() => setGoalFormOpen(!goalFormOpen)}>
              <Plus size={15} /> 创建 Goal
            </Button>
            <Button onClick={() => setTaskFormOpen(!taskFormOpen)}>
              <Plus size={15} /> 创建 Task
            </Button>
          </div>
        }
      />
      <div className="task-toolbar">
        <SelectField
          label="当前 Project"
          id="tasks-project-filter"
          value={effectiveProjectId || '__none__'}
          onValueChange={(value) => setProjectId(value === '__none__' ? '' : value)}
          options={
            projects.data?.length
              ? projects.data.map((project) => ({ value: project.id, label: project.name }))
              : [{ value: '__none__', label: '暂无 Project', disabled: true }]
          }
          disabled={!projects.data?.length}
        />
        <div className="goal-strip">
          {(goals.data ?? []).map((goal) => (
            <span key={goal.id} className="goal-strip-item">
              <StatusBadge status={goal.status} />
              <strong>{goal.title}</strong>
              <button
                type="button"
                className="icon-button"
                aria-label={`编辑 Goal ${goal.title}`}
                onClick={() => setEditingGoal(goal)}
              >
                <Pencil size={13} />
              </button>
            </span>
          ))}
          {!goals.data?.length && <small>当前 Project 尚无 Goal</small>}
        </div>
      </div>
      {goalFormOpen && (
        <FormDialog
          open={goalFormOpen}
          onOpenChange={setGoalFormOpen}
          title="创建 Goal"
          description="把一个可验证的结果交给后续 Task 追踪。"
          footer={
            <>
              <Button
                type="button"
                color="gray"
                variant="soft"
                onClick={() => setGoalFormOpen(false)}
              >
                取消
              </Button>
              <Button
                type="submit"
                form="v06-create-goal-form"
                disabled={!effectiveProjectId || createGoal.isPending}
                loading={createGoal.isPending}
              >
                创建 Goal
              </Button>
            </>
          }
        >
          <form
            id="v06-create-goal-form"
            className="v06-form"
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
            <FormTextField
              label="Goal 标题"
              id="v06-goal-title"
              name="title"
              required
              placeholder="例如发布 AgentHub v0.6"
            />
            <FormTextArea
              label="说明"
              id="v06-goal-description"
              name="description"
              placeholder="目标范围与背景"
            />
            <FormTextArea
              label="成功标准"
              id="v06-goal-success"
              name="successCriteria"
              placeholder="可验证的完成条件"
            />
          </form>
        </FormDialog>
      )}
      {taskFormOpen && (
        <FormDialog
          open={taskFormOpen}
          onOpenChange={setTaskFormOpen}
          title="创建 Task"
          description="为当前 Project 创建一个可执行、可审阅的工作项。"
          footer={
            <>
              <Button
                type="button"
                color="gray"
                variant="soft"
                onClick={() => setTaskFormOpen(false)}
              >
                取消
              </Button>
              <Button
                type="submit"
                form="v06-create-task-form"
                disabled={!effectiveProjectId || createTask.isPending}
                loading={createTask.isPending}
              >
                创建 Task
              </Button>
            </>
          }
        >
          <form
            id="v06-create-task-form"
            className="v06-form"
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
            <FormTextField
              label="Task 标题"
              id="v06-task-title"
              name="title"
              required
              placeholder="例如完成真实 Agent smoke"
            />
            <SelectField
              label="所属 Goal"
              id="v06-task-goal"
              value={selectedTaskGoalId || '__none__'}
              options={[
                { value: '__none__', label: '不绑定 Goal' },
                ...(goals.data ?? []).map((goal) => ({ value: goal.id, label: goal.title })),
              ]}
              onValueChange={(value) => setSelectedTaskGoalId(value === '__none__' ? '' : value)}
            />
            <input type="hidden" name="goalId" value={selectedTaskGoalId} readOnly />
            <FormTextArea
              label="任务描述"
              id="v06-task-description"
              name="description"
              placeholder="Agent 要完成的工作"
            />
            <FormTextArea
              label="验收标准"
              id="v06-task-acceptance"
              name="acceptanceCriteria"
              placeholder="验收标准"
            />
          </form>
        </FormDialog>
      )}
      {editingGoal && (
        <FormDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditingGoal(null);
              updateGoal.reset();
            }
          }}
          title="编辑 Goal"
          description="修改目标说明和成功标准，不会改变已有 Task 记录。"
          footer={
            <>
              <Button
                type="button"
                color="gray"
                variant="soft"
                onClick={() => setEditingGoal(null)}
              >
                取消
              </Button>
              <Button type="submit" form="v06-edit-goal-form" loading={updateGoal.isPending}>
                保存修改
              </Button>
            </>
          }
        >
          <form
            id="v06-edit-goal-form"
            className="v06-form"
            onSubmit={(event) => {
              event.preventDefault();
              const values = Object.fromEntries(new FormData(event.currentTarget));
              updateGoal.mutate({
                id: editingGoal.id,
                body: {
                  title: String(values.title),
                  description: String(values.description || ''),
                  successCriteria: String(values.successCriteria || ''),
                },
              });
            }}
          >
            <FormTextField
              label="Goal 标题"
              id="v06-edit-goal-title"
              name="title"
              required
              defaultValue={editingGoal.title}
            />
            <FormTextArea
              label="说明"
              id="v06-edit-goal-description"
              name="description"
              defaultValue={editingGoal.description ?? ''}
            />
            <FormTextArea
              label="成功标准"
              id="v06-edit-goal-success"
              name="successCriteria"
              defaultValue={editingGoal.successCriteria ?? ''}
            />
            {updateGoal.error ? <p className="form-error">{updateGoal.error.message}</p> : null}
          </form>
        </FormDialog>
      )}
      {editingTask && (
        <FormDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditingTask(null);
              updateTask.reset();
            }
          }}
          title="编辑 Task"
          description="调整任务描述和验收标准；当前执行状态与历史 Run 不会被覆盖。"
          footer={
            <>
              <Button
                type="button"
                color="gray"
                variant="soft"
                onClick={() => setEditingTask(null)}
              >
                取消
              </Button>
              <Button type="submit" form="v06-edit-task-form" loading={updateTask.isPending}>
                保存修改
              </Button>
            </>
          }
        >
          <form
            id="v06-edit-task-form"
            className="v06-form"
            onSubmit={(event) => {
              event.preventDefault();
              const values = Object.fromEntries(new FormData(event.currentTarget));
              updateTask.mutate({
                id: editingTask.id,
                body: {
                  title: String(values.title),
                  description: String(values.description || ''),
                  acceptanceCriteria: String(values.acceptanceCriteria || ''),
                },
              });
            }}
          >
            <FormTextField
              label="Task 标题"
              id="v06-edit-task-title"
              name="title"
              required
              defaultValue={editingTask.title}
            />
            <FormTextArea
              label="任务描述"
              id="v06-edit-task-description"
              name="description"
              defaultValue={editingTask.description ?? ''}
            />
            <FormTextArea
              label="验收标准"
              id="v06-edit-task-acceptance"
              name="acceptanceCriteria"
              defaultValue={editingTask.acceptanceCriteria ?? ''}
            />
            {updateTask.error ? <p className="form-error">{updateTask.error.message}</p> : null}
          </form>
        </FormDialog>
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
                    const taskProject = projects.data?.find(
                      (project) => project.id === task.projectId,
                    );
                    const compatibleAgents = (agents.data ?? []).filter(
                      (agent) =>
                        agent.targetId === taskProject?.targetId &&
                        agent.enabled !== false &&
                        agent.status === 'READY',
                    );
                    const agentId = selectedAgents[task.id] || compatibleAgents[0]?.id || '';
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
                        {task.acceptanceCriteria && (
                          <div className="task-acceptance">
                            <span>验收标准</span>
                            <p>{task.acceptanceCriteria}</p>
                          </div>
                        )}
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
                              {compatibleAgents.map((agent) => (
                                <option key={agent.id} value={agent.id}>
                                  {agent.name} · 就绪
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <div className="task-card-actions">
                          <button
                            className="button ghost compact"
                            onClick={() => setEditingTask(task)}
                            aria-label={`编辑 Task ${task.title}`}
                          >
                            <Pencil size={13} /> 编辑
                          </button>
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
                                <button
                                  className="button primary compact"
                                  onClick={() => {
                                    setSelectedTaskReviewId(task.id);
                                    setTaskReworkFeedback('');
                                  }}
                                >
                                  <ClipboardCheck size={13} /> 审阅结果
                                </button>
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
      {selectedTaskReview && (
        <TaskReviewPanel
          task={selectedTaskReview}
          project={selectedTaskReviewProject}
          runs={selectedTaskRuns.data}
          gitStatus={selectedTaskGitStatus.data}
          gitDiff={selectedTaskGitDiff.data}
          loading={
            selectedTaskRuns.isLoading ||
            selectedTaskGitStatus.isLoading ||
            selectedTaskGitDiff.isLoading
          }
          error={
            (selectedTaskRuns.error ??
              selectedTaskGitStatus.error ??
              selectedTaskGitDiff.error) as Error | null
          }
          actionError={review.error as Error | null}
          feedback={taskReworkFeedback}
          busy={review.isPending}
          onFeedback={(value) => {
            review.reset();
            setTaskReworkFeedback(value);
          }}
          onClose={() => {
            setSelectedTaskReviewId('');
            setTaskReworkFeedback('');
          }}
          onOpenSession={() => {
            if (selectedTaskReview.sessionId) navigate(`/sessions/${selectedTaskReview.sessionId}`);
          }}
          onApprove={() => review.mutate({ id: selectedTaskReview.id, decision: 'APPROVE' })}
          onRework={() =>
            review.mutate({
              id: selectedTaskReview.id,
              decision: 'REWORK',
              feedback: taskReworkFeedback,
            })
          }
        />
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

function TaskReviewPanel({
  task,
  project,
  runs,
  gitStatus,
  gitDiff,
  loading,
  error,
  actionError,
  feedback,
  busy,
  onFeedback,
  onClose,
  onOpenSession,
  onApprove,
  onRework,
}: {
  task: TaskRecord;
  project?: ProjectRecord | undefined;
  runs?: RunRecord[] | undefined;
  gitStatus?:
    | {
        branch?: string;
        headSha?: string;
        clean: boolean;
        entries: Array<{ index: string; worktree: string; path: string }>;
      }
    | undefined;
  gitDiff?: { patch: string; truncated: boolean } | undefined;
  loading: boolean;
  error: Error | null;
  actionError: Error | null;
  feedback: string;
  busy: boolean;
  onFeedback: (value: string) => void;
  onClose: () => void;
  onOpenSession: () => void;
  onApprove: () => void;
  onRework: () => void;
}) {
  const finalRun = runs?.find((run) => run.id === task.finalRunId) ?? runs?.at(-1);
  const feedbackId = `task-review-feedback-${task.id}`;
  const feedbackHelpId = `${feedbackId}-help`;
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content
        className="task-review-panel"
        aria-labelledby="task-review-title"
        aria-describedby="task-review-description"
      >
        <header className="task-review-header">
          <div>
            <span className="section-kicker">Task Review</span>
            <Dialog.Title id="task-review-title">{task.title}</Dialog.Title>
            <Dialog.Description id="task-review-description">
              先核对验收标准、最终 Run 和 Git 现场，再确认完成或发起下一轮。
            </Dialog.Description>
          </div>
          <Dialog.Close>
            <IconButton color="gray" variant="ghost" aria-label="关闭审阅">
              <X size={17} />
            </IconButton>
          </Dialog.Close>
        </header>

        <div className="task-review-body">
          <section className="task-review-criteria">
            <span>验收标准</span>
            <p>{task.acceptanceCriteria || '未填写验收标准，请结合任务说明人工判断。'}</p>
            {task.description && <small>{task.description}</small>}
          </section>

          {loading ? (
            <LoadingState label="正在读取 Run 与 Git 证据" />
          ) : error ? (
            <ErrorState error={error} />
          ) : (
            <div className="task-review-evidence">
              <section>
                <div className="task-review-evidence-heading">
                  <span>最终 Run</span>
                  {finalRun && <StatusBadge status={finalRun.status} />}
                </div>
                {finalRun ? (
                  <dl>
                    <div>
                      <dt>开始</dt>
                      <dd>{formatTime(finalRun.startedAt)}</dd>
                    </div>
                    <div>
                      <dt>Git before</dt>
                      <dd>
                        <code>{finalRun.gitBeforeSha?.slice(0, 12) || '—'}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Git after</dt>
                      <dd>
                        <code>{finalRun.gitAfterSha?.slice(0, 12) || '—'}</code>
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p>没有找到最终 Run 记录，不能把自动执行当作已验证证据。</p>
                )}
              </section>
              <section>
                <div className="task-review-evidence-heading">
                  <span>当前 Git 现场</span>
                  {gitStatus && <StatusBadge status={gitStatus.clean ? 'READY' : 'UNVERIFIED'} />}
                </div>
                {project?.repoKind !== 'GIT' ? (
                  <p>当前 Project 不是 Git 仓库，没有可展示的 Diff。</p>
                ) : gitStatus ? (
                  <dl>
                    <div>
                      <dt>分支</dt>
                      <dd>{gitStatus.branch || 'detached'}</dd>
                    </div>
                    <div>
                      <dt>HEAD</dt>
                      <dd>
                        <code>{gitStatus.headSha?.slice(0, 12) || '—'}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>变更</dt>
                      <dd>{gitStatus.entries.length} 个路径</dd>
                    </div>
                  </dl>
                ) : (
                  <p>Git 状态不可用。</p>
                )}
              </section>
            </div>
          )}

          {project?.repoKind === 'GIT' && !loading && !error && (
            <section className="task-review-diff">
              <div>
                <strong>未提交 Diff</strong>
                {gitDiff?.truncated && <span>仅展示前 4 MiB</span>}
              </div>
              <pre>{gitDiff?.patch || '当前工作区没有未提交 Diff。'}</pre>
            </section>
          )}

          <div className="task-review-decisions">
            <label htmlFor={feedbackId}>
              <span>继续修改说明</span>
              <textarea
                id={feedbackId}
                value={feedback}
                rows={3}
                required
                aria-describedby={feedbackHelpId}
                onChange={(event) => onFeedback(event.target.value)}
                placeholder="明确指出未通过的验收项；提交后会创建新的 Session 和 Run。"
              />
              <small id={feedbackHelpId}>继续修改必须说明未通过的验收项和期望结果。</small>
              <Button
                color="gray"
                variant="soft"
                disabled={busy || !feedback.trim()}
                onClick={onRework}
              >
                <RotateCcw size={14} /> 继续修改并启动新 Run
              </Button>
            </label>
            <div>
              <span>确认完成后 Task 将进入“完成”，不会再自动启动 Agent。</span>
              <Button disabled={busy || loading || Boolean(error)} onClick={onApprove}>
                <ClipboardCheck size={14} /> 确认达到验收标准
              </Button>
            </div>
            {actionError && (
              <div className="workspace-query-error task-review-action-error" role="alert">
                <span>{actionError.message}</span>
              </div>
            )}
          </div>
        </div>

        <footer className="task-review-footer">
          <span>审阅只改变当前 Task；Project 文件和 Git 历史不会被自动清理。</span>
          {task.sessionId && (
            <Button color="gray" variant="ghost" onClick={onOpenSession}>
              打开原 Session
            </Button>
          )}
        </footer>
      </Dialog.Content>
    </Dialog.Root>
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
