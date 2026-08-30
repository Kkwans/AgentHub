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

export function ProjectOverviewPage() {
  const project = useProjectContext();
  const tasks = useQuery({
    queryKey: ['tasks', project.id],
    queryFn: () => api.get<TaskRecord[]>(`/tasks?projectId=${project.id}`),
  });
  const sessions = useQuery({
    queryKey: ['sessions', project.id],
    queryFn: () => api.get<SessionRecord[]>(`/sessions?projectId=${project.id}`),
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const preflight = useQuery({
    queryKey: ['project-preflight', project.id],
    queryFn: () =>
      api.post<{
        status: string;
        git?: { detected?: boolean; branch?: string; dirty?: boolean };
        permissions?: { readable?: boolean; writable?: boolean };
        checks?: Array<{ status: string; message: string }>;
      }>(`/projects/${project.id}/preflight`),
  });
  const agentById = useMemo(
    () => new Map((agents.data ?? []).map((agent) => [agent.id, agent])),
    [agents.data],
  );
  const activeTasks = useMemo(
    () =>
      [...(tasks.data ?? [])]
        .filter(
          (task) =>
            task.status !== 'DONE' &&
            task.status !== 'CANCELED' &&
            task.status !== 'WAITING_REVIEW',
        )
        .sort((left, right) => {
          const rank: Record<TaskRecord['status'], number> = {
            IN_PROGRESS: 0,
            WAITING_REVIEW: 1,
            BLOCKED: 2,
            READY: 3,
            BACKLOG: 4,
            DONE: 5,
            CANCELED: 6,
          };
          return (
            rank[left.status] - rank[right.status] ||
            Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
          );
        })
        .slice(0, 5),
    [tasks.data],
  );
  const reviewTasks = useMemo(
    () =>
      [...(tasks.data ?? [])]
        .filter((task) => task.status === 'WAITING_REVIEW')
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, 4),
    [tasks.data],
  );
  const recentSessions = useMemo(
    () =>
      [...(sessions.data ?? [])]
        .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt))
        .slice(0, 4),
    [sessions.data],
  );
  const healthItems = [
    project.repoKind === 'GIT'
      ? {
          label: 'Git 仓库',
          detail: preflight.data?.git?.branch
            ? `${preflight.data.git.branch}${preflight.data.git.dirty ? ' · 有未提交变更' : ' · 工作区干净'}`
            : '已识别 Git 仓库',
          ok: preflight.data?.git?.detected !== false && !preflight.error,
        }
      : null,
    agents.data
      ? {
          label: 'Agent 可用',
          detail: `${agents.data.filter((agent) => agent.status === 'READY' && agent.enabled).length} 个已就绪`,
          ok: agents.data.some((agent) => agent.status === 'READY' && agent.enabled),
        }
      : null,
    preflight.data
      ? {
          label: '项目目录',
          detail: preflight.data.status === 'READY' ? '路径与权限检查通过' : '需要处理目录检查',
          ok: preflight.data.status === 'READY',
        }
      : null,
  ].filter((item): item is { label: string; detail: string; ok: boolean } => Boolean(item));
  return (
    <div className={projectsStyles.overviewGrid}>
      <AhSurface className={`${projectsStyles.overviewPanel} ${projectsStyles.overviewPanelWide}`}>
        <div className={projectsStyles.panelHeader}>
          <div>
            <h3>正在进行</h3>
            <p>当前项目中的活跃工作。</p>
          </div>
          <Link to={`/projects/${project.id}/work`}>查看工作 →</Link>
        </div>
        <div className={projectsStyles.overviewList}>
          {activeTasks.map((task) => {
            const agent = task.assignedAgentId ? agentById.get(task.assignedAgentId) : undefined;
            return (
              <Link
                className={projectsStyles.overviewWorkRow}
                key={task.id}
                to={`/projects/${project.id}/work?task=${task.id}`}
              >
                <span
                  className={`${projectsStyles.workStateDot} ${taskStateClass(task.status)}`}
                  aria-hidden="true"
                />
                <span className={projectsStyles.overviewCopy}>
                  <strong>{task.title}</strong>
                  <small>
                    {agent?.name ?? '尚未分配 Agent'}
                    {task.branch ? ` · ${task.branch}` : ''} · {displayDate(task.updatedAt)}
                  </small>
                </span>
                <AhStatusPill status={task.status} />
              </Link>
            );
          })}
          {!tasks.isLoading && !activeTasks.length ? (
            <AhEmptyState
              compact
              title="没有进行中的 Work"
              description="从 Work 创建并开始一项工作。"
              action={
                <Link to={`/projects/${project.id}/work/new`}>
                  <AhButton size="sm">新建工作</AhButton>
                </Link>
              }
            />
          ) : null}
        </div>
      </AhSurface>
      <AhSurface
        className={`${projectsStyles.overviewPanel} ${projectsStyles.overviewPanelNarrow}`}
      >
        <div className={projectsStyles.panelHeader}>
          <div>
            <h3>项目状态</h3>
            <p>当前环境与 Agent 可用性。</p>
          </div>
        </div>
        <div className={projectsStyles.healthStack}>
          {healthItems.map((item) => (
            <div className={projectsStyles.healthRow} key={item.label}>
              <span
                className={`${projectsStyles.healthMark} ${item.ok ? '' : projectsStyles.healthMarkWarning}`}
                aria-hidden="true"
              >
                {item.ok ? '✓' : '!'}
              </span>
              <span className={projectsStyles.healthCopy}>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </div>
          ))}
          {!healthItems.length ? (
            <AhEmptyState
              compact
              title="状态信息暂不可用"
              description="完成一次项目预检后会在这里显示。"
            />
          ) : null}
        </div>
      </AhSurface>
      <AhSurface
        className={`${projectsStyles.overviewPanel} ${projectsStyles.overviewPanelBottomNarrow}`}
      >
        <div className={projectsStyles.panelHeader}>
          <div>
            <h3>最近会话</h3>
            <p>继续上一次对话或代码审阅。</p>
          </div>
          <Link to={`/projects/${project.id}/sessions`}>全部会话 →</Link>
        </div>
        <div className={projectsStyles.overviewList}>
          {recentSessions.map((session) => {
            const agent = agentById.get(session.agentId);
            return (
              <Link
                className={projectsStyles.overviewSessionRow}
                key={session.id}
                to={`/workspace/${session.id}`}
              >
                <span className={projectsStyles.agentAvatar} aria-hidden="true">
                  {agent?.name?.slice(0, 1).toUpperCase() ?? 'A'}
                </span>
                <span className={projectsStyles.overviewCopy}>
                  <strong>{session.title}</strong>
                  <small>
                    {agent?.name ?? 'Agent'}
                    {session.model ? ` · ${session.model}` : ''} ·{' '}
                    {displayDate(session.lastActiveAt)}
                  </small>
                </span>
                <AhStatusPill status={session.status} />
              </Link>
            );
          })}
          {!sessions.isLoading && !recentSessions.length ? (
            <AhEmptyState
              compact
              title="还没有 Session"
              description="从 Work 创建第一项工作，再选择 Agent 运行。"
            />
          ) : null}
        </div>
      </AhSurface>
      <AhSurface
        className={`${projectsStyles.overviewPanel} ${projectsStyles.overviewPanelBottom}`}
      >
        <div className={projectsStyles.panelHeader}>
          <div>
            <h3>Review Queue</h3>
            <p>需要你做决策的工作结果。</p>
          </div>
          <Link to={`/projects/${project.id}/work?status=WAITING_REVIEW`}>全部审阅 →</Link>
        </div>
        <div className={projectsStyles.overviewList}>
          {reviewTasks.map((task) => (
            <Link
              className={projectsStyles.reviewQueueRow}
              key={task.id}
              to={`/projects/${project.id}/work?task=${task.id}`}
            >
              <span className={projectsStyles.reviewMark} aria-hidden="true">
                ✓
              </span>
              <span className={projectsStyles.overviewCopy}>
                <strong>{task.title}</strong>
                <small>
                  {task.branch ?? '尚未创建分支'} · {displayDate(task.updatedAt)}
                </small>
              </span>
              <span className={projectsStyles.reviewAction}>查看结果</span>
            </Link>
          ))}
          {!tasks.isLoading && !reviewTasks.length ? (
            <AhEmptyState
              compact
              title="没有待审阅结果"
              description="Agent 完成工作后，会在这里等待你的决策。"
            />
          ) : null}
        </div>
      </AhSurface>
    </div>
  );
}
