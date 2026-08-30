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
import { ProjectWorkPage } from './ProjectWorkPage';

export function NewWorkPage() {
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
  useEffect(() => {
    if (!agentId) setAgentId(agents.data?.find((agent) => agent.status === 'READY')?.id ?? '');
  }, [agentId, agents.data]);
  const selectedAgent = agents.data?.find((agent) => agent.id === agentId);
  const selectedPrompt = prompts.data?.find((prompt) => prompt.id === promptId);
  const contextQuery = () =>
    new URLSearchParams({
      ...(agentId ? { agentId } : {}),
      ...(promptId ? { promptId } : {}),
    }).toString();
  const createGoal = useMutation({
    mutationFn: () =>
      api.post<GoalRecord>('/goals', {
        projectId: project.id,
        title: title.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: (goal) => {
      const query = contextQuery();
      navigate(`/projects/${project.id}/work?goal=${goal.id}${query ? `&${query}` : ''}`);
    },
  });
  const createTask = useMutation({
    mutationFn: async () => {
      const task = await api.post<TaskRecord>('/tasks', {
        projectId: project.id,
        goalId: goalId || undefined,
        title: title.trim(),
        description: description.trim() || undefined,
        priority: 2,
      });
      if (!agentId) return { task, sessionId: undefined };
      if (task.status === 'BACKLOG')
        await api.post(`/tasks/${task.id}/transition`, { status: 'READY' });
      const started = await api.post<{ session: { id: string } }>(`/tasks/${task.id}/start`, {
        agentId,
      });
      return { task, sessionId: started.session.id };
    },
    onSuccess: ({ task, sessionId }) => {
      const query = contextQuery();
      navigate(
        sessionId
          ? `/workspace/${sessionId}`
          : `/projects/${project.id}/work?task=${task.id}${query ? `&${query}` : ''}`,
      );
    },
  });
  const workError = createGoal.error ?? createTask.error;
  const close = () => navigate(`/projects/${project.id}/work`);
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
              取消
            </AhButton>
            <AhButton
              onClick={() => (kind === 'goal' ? createGoal.mutate() : createTask.mutate())}
              loading={createGoal.isPending || createTask.isPending}
              disabled={!title.trim()}
            >
              {kind === 'goal' ? '创建 Goal' : '创建并开始'}
            </AhButton>
          </>
        }
      >
        <div className={layout.dialogBody} data-testid="new-work-dialog">
          <div className={layout.dialogContext}>
            <span>当前 Project</span>
            <strong>{project.name}</strong>
            <code title={project.rootPath}>{project.rootPath}</code>
          </div>
          <AhTextarea
            label="你想完成什么？"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            placeholder="例如：修复登录流程并补齐回归测试"
            required
            minRows={5}
          />
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
            value={agentId}
            onChange={(value) => setAgentId(value ?? '')}
            data={(agents.data ?? [])
              .filter((agent) => agent.status === 'READY')
              .map((agent) => ({
                value: agent.id,
                label: `${agent.name} · ${agent.detectedVersion ?? '版本待检测'}`,
              }))}
            placeholder="稍后在 Work Inspector 中选择"
          />
          <div className={layout.mutedBox}>
            {selectedAgent ? (
              <>
                <strong>{selectedAgent.name} 可用</strong>
                <div>创建后会用这个 Agent 启动 Session，并把实时事件带入 Workspace。</div>
              </>
            ) : (
              '还没有选择 Agent；创建后仍可在 Work Inspector 中选择并开始。'
            )}
          </div>
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
                  value={goalId}
                  onChange={(value) => setGoalId(value ?? '')}
                  data={(goals.data ?? []).map((goal) => ({ value: goal.id, label: goal.title }))}
                  placeholder="选择已有 Goal"
                  mt="md"
                />
              ) : null}
              <AhSelect
                label="PromptOS 资产（可选）"
                value={promptId}
                onChange={(value) => setPromptId(value ?? '')}
                data={(prompts.data ?? []).map((prompt) => ({
                  value: prompt.id,
                  label: `${prompt.name} · ${labelPromptKind(prompt.kind)}`,
                }))}
                placeholder="使用 Project Binding"
                mt="md"
              />
              <p className={layout.subtle}>
                {selectedPrompt
                  ? `已选择 ${selectedPrompt.name}（${labelPromptType(selectedPrompt.type)}）。`
                  : '未选择时按当前 Project / Task Binding 解析 Prompt。'}
              </p>
            </div>
          </details>
          {workError ? (
            <AhErrorState title="创建或启动失败" description={workError.message} />
          ) : null}
        </div>
      </AhDialog>
    </>
  );
}
