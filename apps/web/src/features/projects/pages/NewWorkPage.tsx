import { eligibilityReasons } from '../lib/project-eligibility';
import { useProjectEligibility } from '../hooks/useProjectEligibility';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { browserCreationScope } from '../lib/task-creation-recovery';
import { useTaskCreationRecovery } from '../hooks/useTaskCreationRecovery';
import { TaskCreationRecoveryPanel } from '../components/TaskCreationRecoveryPanel';
import { prepareNewWork, suggestTaskTitle } from '../lib/new-work-draft';
import { AhButton, AhDialog, AhErrorState, AhSelect, AhTextarea, AhInput } from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type {
  AgentRecord,
  GoalRecord,
  ProjectRecord,
  PromptRecord,
  RenderedPromptRecord,
} from '../../../lib/api';
import { api, authSession } from '../../../lib/api';
import { labelPromptKind, labelPromptType } from '../../../presentation/domain-labels';
import layout from '../../shared/layout.module.css';
import { domainStatusLabel, useCompactViewport } from '../../shared/page-primitives';
import { useNewTaskCreation } from '../hooks/useNewTaskCreation';
import { useProjectContext } from './ProjectContextLayout';
import { ProjectWorkPage } from './ProjectWorkPage';

export function NewWorkPage() {
  const project = useProjectContext();
  const scope = browserCreationScope(useAuthMode(), useAuthUser());
  return (
    <NewWorkForm key={`${project.id}:${scope ?? 'unknown'}`} project={project} scope={scope} />
  );
}

function NewWorkForm({ project, scope }: { project: ProjectRecord; scope: string | null }) {
  const recovery = useTaskCreationRecovery(project.id, scope);
  const navigate = useNavigate();
  const client = useQueryClient();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const abandon = () => {
      live.current = false;
    };
    const unsubscribe = authSession.onAuthorizationRequired(abandon);
    return () => {
      abandon();
      unsubscribe();
    };
  }, []);
  const compact = useCompactViewport();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [shortTitle, setShortTitle] = useState<string | undefined>();
  const [intent, setIntent] = useState('');
  const [kind, setKind] = useState<'goal' | 'task'>('task');
  const prepared = prepareNewWork({
    kind,
    instructions: title,
    supplemental: description,
    shortTitle,
  });
  const [goalId, setGoalId] = useState('');
  const [agentId, setAgentId] = useState('');
  const agentChoiceMade = useRef(false);
  const [promptId, setPromptId] = useState('');
  const [variableText, setVariableText] = useState('{}');
  const [preview, setPreview] = useState<RenderedPromptRecord>();
  const [pinnedVersion, setPinnedVersion] = useState<number>();
  const [previewError, setPreviewError] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewGeneration = useRef(0);
  let promptVariables: Record<string, unknown> = {};
  let variablesValid = true;
  try {
    const parsed: unknown = JSON.parse(variableText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) variablesValid = false;
    else promptVariables = parsed as Record<string, unknown>;
  } catch {
    variablesValid = false;
  }
  const invalidatePreview = () => {
    previewGeneration.current += 1;
    setPreview(undefined);
    setPreviewBusy(false);
    setPreviewError('');
  };
  const previewPrompt = async () => {
    if (!live.current || !promptId || !variablesValid || previewBusy) return;
    const generation = ++previewGeneration.current;
    setPreviewBusy(true);
    setPreviewError('');
    try {
      const rendered = await api.post<RenderedPromptRecord>(
        `/prompts/${encodeURIComponent(promptId)}/render`,
        {
          version: pinnedVersion,
          variables: promptVariables,
        },
      );
      if (!live.current || generation !== previewGeneration.current) return;
      if (
        !rendered ||
        typeof rendered !== 'object' ||
        rendered.promptId !== promptId ||
        typeof rendered.versionId !== 'string' ||
        !rendered.versionId.trim() ||
        !Number.isInteger(rendered.version) ||
        rendered.version <= 0 ||
        (pinnedVersion !== undefined && rendered.version !== pinnedVersion) ||
        typeof rendered.text !== 'string' ||
        !Array.isArray(rendered.missingVariables) ||
        !rendered.missingVariables.every((variable) => typeof variable === 'string')
      )
        throw new Error('Prompt 预览响应无法确认，请重新选择资产。');
      setPinnedVersion(rendered.version);
      setPreview(rendered);
    } catch (error) {
      if (live.current && generation === previewGeneration.current) {
        setPreview(undefined);
        setPreviewError(error instanceof Error ? error.message : 'Prompt 预览失败');
      }
    } finally {
      if (live.current && generation === previewGeneration.current) setPreviewBusy(false);
    }
  };
  const promptReady =
    !promptId ||
    Boolean(preview && !previewBusy && variablesValid && !preview.missingVariables.length);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const goals = useQuery({
    queryKey: ['goals', project.id],
    queryFn: () => api.get<GoalRecord[]>(`/goals?projectId=${project.id}`),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const prompts = useQuery({
    queryKey: ['prompts', project.id],
    queryFn: () => api.get<PromptRecord[]>(`/prompts?projectId=${project.id}`),
  });
  const eligibility = useProjectEligibility(project.id);
  const eligibilityKnown =
    eligibility.isSuccess && !eligibility.isFetching && !agents.isError && !agents.isPending;
  const selectableAgents = (agents.data ?? []).filter(
    (agent) =>
      agent.enabled &&
      agent.status === 'READY' &&
      eligibilityKnown &&
      eligibility.data?.some((entry) => entry.agentId === agent.id && entry.eligible),
  );
  const selectedEligible = !agentId || selectableAgents.some((agent) => agent.id === agentId);
  const selectedAgent = agents.data?.find((agent) => agent.id === agentId);
  const selectedPrompt = prompts.data?.find((prompt) => prompt.id === promptId);
  const contextQuery = () =>
    new URLSearchParams({
      ...(agentId ? { agentId } : {}),
    }).toString();
  const createGoal = useMutation({
    mutationFn: () =>
      api.post<GoalRecord>('/goals', {
        projectId: project.id,
        title: title.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: (goal) => {
      if (!live.current) return;
      const query = contextQuery();
      navigate(`/projects/${project.id}/work?goal=${goal.id}${query ? `&${query}` : ''}`);
    },
  });
  const taskCreation = useNewTaskCreation((draft, task, sessionId) => {
    const query = new URLSearchParams({
      ...(draft.agentId ? { agentId: draft.agentId } : {}),
      ...(draft.promptId ? { promptId: draft.promptId } : {}),
    }).toString();
    navigate(
      sessionId
        ? `/workspace/${encodeURIComponent(sessionId)}`
        : `/projects/${encodeURIComponent(draft.projectId)}/work?task=${encodeURIComponent(task.id)}${query ? `&${query}` : ''}`,
    );
  }, recovery);
  useEffect(() => {
    if (!agentChoiceMade.current && !taskCreation.locked && !recovery.blocked && eligibilityKnown) {
      agentChoiceMade.current = true;
      setAgentId(selectableAgents[0]?.id ?? '');
    }
  }, [eligibilityKnown, selectableAgents, taskCreation.locked, recovery.blocked]);
  const busy = createGoal.isPending || taskCreation.busy;
  const locked = busy || taskCreation.locked || recovery.blocked;
  const close = () => {
    live.current = false;
    taskCreation.abandon();
    void client.invalidateQueries({ queryKey: ['tasks'] });
    const targetProject = taskCreation.draft?.projectId ?? project.id;
    navigate(
      `/projects/${encodeURIComponent(targetProject)}/work${taskCreation.task ? `?task=${encodeURIComponent(taskCreation.task.id)}` : ''}`,
    );
  };
  const openSession = () => {
    if (!taskCreation.sessionId) return;
    live.current = false;
    taskCreation.abandon();
    navigate(`/workspace/${encodeURIComponent(taskCreation.sessionId)}`);
  };
  const submit = () => {
    if (
      !live.current ||
      locked ||
      Boolean(prepared.error) ||
      (kind === 'task' && (!promptReady || !selectedEligible))
    )
      return;
    if (kind === 'goal') createGoal.mutate();
    else
      taskCreation.submit({
        projectId: project.id,
        title: prepared.title,
        description: prepared.description,
        goalId,
        agentId,
        promptId,
        promptVersionId: preview?.versionId,
        promptVariables: promptId ? promptVariables : undefined,
      });
  };
  const quickIntents = ['Bug', 'Feature', 'Refactor', 'Research'];
  return (
    <>
      <ProjectWorkPage />
      <AhDialog
        open
        onClose={close}
        title="描述一项工作"
        description="先表达结果，再选择推荐 Agent。创建并开始后会直接进入 Workspace。"
        size={720}
        fullScreen={compact}
        actions={
          <>
            <AhButton variant="default" onClick={close}>
              {taskCreation.locked ? (taskCreation.task ? '查看原任务' : '核对任务列表') : '取消'}
            </AhButton>
            {taskCreation.locked ? (
              <>
                {taskCreation.canRetryCreate ? (
                  <AhButton
                    variant="default"
                    onClick={taskCreation.retryCreate}
                    loading={taskCreation.busy}
                  >
                    同编号重试创建
                  </AhButton>
                ) : null}
                {taskCreation.task ? (
                  <AhButton
                    variant="default"
                    onClick={taskCreation.check}
                    loading={taskCreation.busy}
                  >
                    核对原任务状态
                  </AhButton>
                ) : null}
                {taskCreation.retryable ? (
                  <AhButton onClick={taskCreation.retry} loading={taskCreation.busy}>
                    重试启动
                  </AhButton>
                ) : null}
                {taskCreation.sessionId ? (
                  <AhButton onClick={openSession} disabled={busy}>
                    打开已有工作区
                  </AhButton>
                ) : null}
              </>
            ) : (
              <AhButton
                onClick={submit}
                loading={busy}
                disabled={
                  recovery.blocked ||
                  Boolean(prepared.error) ||
                  (kind === 'task' && (!promptReady || !selectedEligible))
                }
              >
                {kind === 'goal' ? '创建 Goal' : agentId ? '创建并开始' : '创建任务'}
              </AhButton>
            )}
          </>
        }
      >
        <div className={layout.dialogBody} data-testid="new-work-dialog">
          <div className={layout.dialogContext}>
            <span>当前 Project</span>
            <strong>{project.name}</strong>
            <code title={project.rootPath}>{project.rootPath}</code>
          </div>
          <TaskCreationRecoveryPanel
            recovery={recovery}
            open={(result, workspace) => {
              if (!live.current) return;
              live.current = false;
              taskCreation.abandon();
              navigate(
                workspace && result.sessionId
                  ? `/workspace/${encodeURIComponent(result.sessionId)}`
                  : `/projects/${encodeURIComponent(project.id)}/work?task=${encodeURIComponent(result.taskId)}`,
              );
            }}
          />
          <fieldset
            disabled={locked}
            className={layout.dialogBody}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <AhTextarea
              label="你想完成什么？"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder="例如：修复登录流程并补齐回归测试"
              required
              minRows={5}
            />
            {kind === 'task' ? (
              <>
                <AhInput
                  label="任务短标题（可编辑）"
                  value={shortTitle ?? suggestTaskTitle(title)}
                  onChange={(event) => setShortTitle(event.currentTarget.value)}
                />
                <AhButton variant="default" size="xs" onClick={() => setShortTitle(undefined)}>
                  恢复自动标题
                </AhButton>
                <p className={layout.subtle}>
                  标题用于列表；以上完整要求会保留在任务说明。自动标题仅摘要首行，不会截断完整要求。
                </p>
                <p className={layout.subtle}>
                  任务说明：{prepared.description.length} / 100000 字符（含分节标题）
                </p>
              </>
            ) : (
              <p className={layout.subtle}>Goal 标题上限 240 字符，补充上下文上限 20000 字符。</p>
            )}
            {prepared.error && title.trim() ? <p role="alert">{prepared.error}</p> : null}
            <div className={layout.quickIntents} aria-label="快速意图">
              <span className={layout.subtle}>快速意图（可选）</span>
              {quickIntents.map((value) => (
                <AhButton
                  key={value}
                  size="xs"
                  variant={intent === value ? 'light' : 'default'}
                  aria-pressed={intent === value}
                  onClick={() => {
                    setIntent(value);
                    if (!title.trim()) setTitle(`${value}：`);
                  }}
                >
                  {value}
                </AhButton>
              ))}
            </div>
            <AhTextarea
              label="补充上下文（可选）"
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              placeholder="验收标准、约束或参考资料"
              minRows={3}
            />
            <AhSelect
              label="推荐 Agent"
              value={agentId || '__later__'}
              disabled={locked}
              onChange={(value) => {
                agentChoiceMade.current = true;
                setAgentId(value === '__later__' ? '' : (value ?? ''));
              }}
              data={[
                { value: '__later__', label: '稍后选择，仅创建任务' },
                ...(agents.data ?? []).map((agent) => {
                  const entry = eligibility.data?.find((item) => item.agentId === agent.id);
                  const selectable = selectableAgents.some((item) => item.id === agent.id);
                  const reason = !agent.enabled
                    ? '已禁用'
                    : agent.status !== 'READY'
                      ? '尚未就绪'
                      : !eligibilityKnown
                        ? '资格待确认'
                        : entry?.reason
                          ? eligibilityReasons[entry.reason]
                          : !entry
                            ? '资格未返回'
                            : '';
                  return {
                    value: agent.id,
                    label: `${agent.name} · ${selectable ? '可选择，启动时检查' : reason} · 环境记录：${entry?.targetStatus ?? '未知'}`,
                    disabled: !selectable,
                  };
                }),
              ]}
              placeholder="稍后在 Work Inspector 中选择"
            />
            <div className={layout.mutedBox}>
              {selectedAgent ? (
                <>
                  <strong>
                    {selectedAgent.name}{' '}
                    {selectedEligible
                      ? '可选择，启动时检查'
                      : '当前资格不满足，请重新选择或仅创建任务'}
                  </strong>
                  <div>
                    选择依据是已登记状态与工作区映射，不代表实时登录、进程或容器健康。启动时仍会检查。
                  </div>
                </>
              ) : (
                '还没有选择 Agent；创建后仍可在 Work Inspector 中选择并开始。'
              )}
            </div>
            {eligibility.isPending || eligibility.isFetching ? (
              <p role="status">正在确认项目 Agent 资格；也可选择仅创建任务。</p>
            ) : null}
            {eligibility.isError || agents.isError ? (
              <p role="alert">无法确认项目 Agent 资格，不会自动选择 Agent。</p>
            ) : null}
            <AhButton
              variant="default"
              onClick={() => {
                void eligibility.refetch();
                void agents.refetch();
              }}
              disabled={locked}
            >
              刷新 Agent 资格
            </AhButton>
            <details
              open={advancedOpen}
              onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
              className={layout.dialogDetails}
            >
              <summary>高级设置</summary>
              <div className={layout.dialogSection}>
                <div className={layout.actions}>
                  <AhButton
                    size="xs"
                    variant={kind === 'task' ? 'light' : 'default'}
                    onClick={() => setKind('task')}
                  >
                    Task
                  </AhButton>
                  <AhButton
                    size="xs"
                    variant={kind === 'goal' ? 'light' : 'default'}
                    onClick={() => setKind('goal')}
                  >
                    Goal
                  </AhButton>
                </div>
                {kind === 'task' ? (
                  <AhSelect
                    label="所属 Goal（可选）"
                    disabled={locked}
                    value={goalId}
                    onChange={(value) => setGoalId(value ?? '')}
                    data={(goals.data ?? []).map((goal) => ({ value: goal.id, label: goal.title }))}
                    placeholder="选择已有 Goal"
                    mt="md"
                  />
                ) : null}
                <AhSelect
                  label="PromptOS 资产（可选）"
                  disabled={locked || kind === 'goal'}
                  value={kind === 'task' ? promptId : ''}
                  onChange={(value) => {
                    invalidatePreview();
                    setPinnedVersion(undefined);
                    setPromptId(value ?? '');
                  }}
                  data={(prompts.data ?? []).map((prompt) => ({
                    value: prompt.id,
                    label: `${prompt.name} · ${labelPromptKind(prompt.kind)}`,
                  }))}
                  placeholder="使用 Project Binding"
                  mt="md"
                />
                <p className={layout.subtle}>
                  {kind === 'goal'
                    ? 'Goal 创建不会绑定 Prompt；请在具体 Task 上选择。'
                    : selectedPrompt
                      ? `待预览 ${selectedPrompt.name}（${labelPromptType(selectedPrompt.type)}）；确认版本后才会绑定任务。`
                      : '未选择时按当前 Project / Task Binding 解析 Prompt。'}
                </p>
                {kind === 'task' && promptId ? (
                  <>
                    <AhTextarea
                      label="Prompt 变量（JSON 对象）"
                      value={variableText}
                      onChange={(event) => {
                        invalidatePreview();
                        setVariableText(event.currentTarget.value);
                      }}
                      minRows={3}
                    />
                    {!variablesValid ? <p role="alert">请输入有效的 JSON 对象。</p> : null}
                    <AhButton
                      variant="default"
                      onClick={() => {
                        void previewPrompt();
                      }}
                      disabled={!variablesValid || locked}
                      loading={previewBusy}
                    >
                      预览并固定版本
                    </AhButton>
                    {preview ? (
                      <section aria-label="Prompt 预览">
                        <p>已固定版本 v{preview.version}；作为任务补充上下文，主目标保持不变。</p>
                        {!agentId ? <p>保存模板版本与变量，稍后启动自动使用。</p> : null}
                        {preview.missingVariables.length ? (
                          <p role="alert">缺少变量：{preview.missingVariables.join('、')}</p>
                        ) : null}
                        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          {preview.text}
                        </pre>
                      </section>
                    ) : null}
                    {previewError ? (
                      <AhErrorState title="Prompt 预览失败" description={previewError} />
                    ) : null}
                  </>
                ) : null}
              </div>
            </details>
          </fieldset>
          {taskCreation.locked ? (
            <section role="status" aria-live="polite" className={layout.mutedBox}>
              <strong>
                {taskCreation.busy
                  ? '正在处理，请勿重复提交'
                  : taskCreation.task
                    ? '任务已创建'
                    : '创建结果待核对'}
              </strong>
              {taskCreation.task ? (
                <p>原任务：{taskCreation.draft?.title}。后续操作只针对这个任务，不会重新创建。</p>
              ) : null}
              {taskCreation.canRetryCreate ? (
                <p>
                  当前页仍保留冻结的原请求；同编号重试使用完全相同内容，成功后只提供原任务入口，不会继续启动。
                </p>
              ) : null}
              {taskCreation.unknown ? (
                <p>
                  请求可能已生效。已暂停自动续启和新建，请先核对任务列表或原任务状态；页面关闭不等于取消。
                </p>
              ) : null}
              {taskCreation.retryable && !taskCreation.busy ? (
                <p>尚未成功启动。重试会先核对原任务状态，再恢复启动。</p>
              ) : null}
              {taskCreation.task && !taskCreation.busy ? (
                <p>当前任务状态：{domainStatusLabel(taskCreation.task.status)}</p>
              ) : null}
              {taskCreation.error ? (
                <AhErrorState title="后续结果需要处理" description={taskCreation.error} />
              ) : null}
            </section>
          ) : null}
          {createGoal.error ? (
            <AhErrorState title="创建失败" description={createGoal.error.message} />
          ) : null}
          {!taskCreation.locked && taskCreation.error ? (
            <AhErrorState title="创建被拒绝" description={taskCreation.error} />
          ) : null}
        </div>
      </AhDialog>
    </>
  );
}
