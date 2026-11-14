import { useProjectEligibility } from '../hooks/useProjectEligibility';
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
import { ApiError, api } from '../../../lib/api';
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
  const eligibility = useProjectEligibility(project.id);
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
    () => new Map((agents.isSuccess ? agents.data : []).map((agent) => [agent.id, agent])),
    [agents.data, agents.isSuccess],
  );
  const agentLabel = (id: string | null | undefined, emptyLabel: string) => {
    if (!id) return emptyLabel;
    if (agents.isError) return 'Agent 信息未知';
    if (agents.isPending) return '正在读取 Agent 信息';
    return agentById.get(id)?.name ?? 'Agent 记录未找到';
  };
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
  const reviewEmpty = tasks.data !== undefined && reviewTasks.length === 0;
  const workEmpty = tasks.data !== undefined && activeTasks.length === 0;
  const sessionsEmpty = sessions.data !== undefined && recentSessions.length === 0;
  const preflightKnown = preflight.isSuccess && !preflight.isFetching;
  const eligibilityKnown = eligibility.isSuccess && !eligibility.isFetching;
  const healthItems: Array<{ label: string; detail: string; ok: boolean | null }> = [
    ...(project.repoKind === 'GIT'
      ? [
          {
            label: 'Git 仓库',
            detail: !preflightKnown
              ? '已登记为 Git 项目；当前预检结果待确认'
              : preflight.data.git?.detected !== true
                ? '当前预检未确认 Git 仓库'
                : preflight.data.git.branch
                  ? `${preflight.data.git.branch}${preflight.data.git.dirty === true ? ' · 有未提交变更' : preflight.data.git.dirty === false ? ' · 工作区干净' : ''}`
                  : '当前预检已确认 Git 仓库',
            ok: preflightKnown
              ? preflight.data.status === 'READY' && preflight.data.git?.detected === true
              : null,
          },
        ]
      : []),
    {
      label: '项目 Agent 资格',
      detail: eligibilityKnown
        ? `登记状态下 ${eligibility.data.filter((entry) => entry.eligible).length} 个可用；运行前仍需预检`
        : eligibility.isError
          ? '登记资格读取失败，无法确认可用数量'
          : '正在读取项目登记资格',
      ok: eligibilityKnown ? eligibility.data.some((entry) => entry.eligible) : null,
    },
    {
      label: '项目目录',
      detail: !preflightKnown
        ? '当前路径与权限检查结果待确认'
        : preflight.data.status === 'READY'
          ? '路径与权限检查通过'
          : '需要处理目录检查',
      ok: preflightKnown ? preflight.data.status === 'READY' : null,
    },
  ];
  return (
    <div className={projectsStyles.overviewGrid}>
      <div className={projectsStyles.overviewMain}>
        {agents.isPending || agents.isError || agents.isFetching ? (
          <div
            className={projectsStyles.projectSourceStatus}
            role={agents.isError ? 'alert' : 'status'}
            aria-label="Agent 姓名读取状态"
          >
            <span>
              {agents.isError
                ? agents.error instanceof ApiError && agents.error.code === 'AUTH_REQUIRED'
                  ? '登录已失效，无法确认 Agent 姓名。'
                  : 'Agent 信息读取失败，姓名暂时未知；不代表工作未分配 Agent。'
                : agents.isPending
                  ? '正在读取 Agent 信息。'
                  : '正在更新 Agent 信息，暂显示上次读取的姓名。'}
            </span>
            {agents.isError ? (
              <AhButton
                size="sm"
                variant="subtle"
                disabled={agents.isFetching}
                onClick={() => void agents.refetch()}
              >
                重新读取 Agent 信息
              </AhButton>
            ) : null}
          </div>
        ) : null}
        {reviewEmpty ? (
          <section className={projectsStyles.overviewCompact} aria-label="待审阅">
            <div className={projectsStyles.overviewCompactCopy}>
              <h3>待审阅</h3>
              <span role={tasks.isError ? 'alert' : tasks.isFetching ? 'status' : undefined}>
                {tasks.isFetching
                  ? '正在核对待审阅工作…'
                  : tasks.isError
                    ? tasks.error.message
                    : '没有待审阅结果'}
              </span>
            </div>
            <div className={projectsStyles.overviewCompactActions}>
              {tasks.isError ? (
                <AhButton
                  size="sm"
                  variant="subtle"
                  disabled={tasks.isFetching}
                  onClick={() => void tasks.refetch()}
                >
                  重新读取待审阅工作
                </AhButton>
              ) : null}
              <Link to={`/projects/${project.id}/work?status=WAITING_REVIEW`}>全部审阅 →</Link>
            </div>
          </section>
        ) : (
          <section className={projectsStyles.overviewPanel}>
            <div className={projectsStyles.panelHeader}>
              <div>
                <h3>待审阅</h3>
                <p>需要你做决策的工作结果。</p>
              </div>
              <Link to={`/projects/${project.id}/work?status=WAITING_REVIEW`}>全部审阅 →</Link>
            </div>
            <div className={projectsStyles.overviewList}>
              <QueryMessage
                loading={tasks.isFetching}
                error={tasks.error}
                retry={() => void tasks.refetch()}
                label={
                  tasks.data && !tasks.isError
                    ? '正在更新待审阅工作，下方为上次读取结果'
                    : '正在读取待审阅工作'
                }
              />
              {(!tasks.isError ? reviewTasks : []).map((task) => (
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
            </div>
          </section>
        )}
        {workEmpty ? (
          <section className={projectsStyles.overviewCompact} aria-label="正在进行">
            <div className={projectsStyles.overviewCompactCopy}>
              <h3>正在进行</h3>
              <span role={tasks.isError ? 'alert' : tasks.isFetching ? 'status' : undefined}>
                {tasks.isFetching
                  ? '正在核对工作…'
                  : tasks.isError
                    ? tasks.error.message
                    : '没有进行中的工作'}
              </span>
            </div>
            <div className={projectsStyles.overviewCompactActions}>
              {tasks.isError ? (
                <AhButton
                  size="sm"
                  variant="subtle"
                  disabled={tasks.isFetching}
                  onClick={() => void tasks.refetch()}
                >
                  重新读取工作
                </AhButton>
              ) : null}
              <Link to={`/projects/${project.id}/work`}>查看工作 →</Link>
            </div>
          </section>
        ) : (
          <section className={projectsStyles.overviewPanel}>
            <div className={projectsStyles.panelHeader}>
              <div>
                <h3>正在进行</h3>
                <p>当前项目中的活跃工作。</p>
              </div>
              <Link to={`/projects/${project.id}/work`}>查看工作 →</Link>
            </div>
            <div className={projectsStyles.overviewList}>
              <QueryMessage
                loading={tasks.isFetching}
                error={tasks.error}
                retry={() => void tasks.refetch()}
                label={
                  tasks.data && !tasks.isError ? '正在更新工作，下方为上次读取结果' : '正在读取工作'
                }
              />
              {(!tasks.isError ? activeTasks : []).map((task) => {
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
                        {agentLabel(task.assignedAgentId, '尚未分配 Agent')}
                        {task.branch ? ` · ${task.branch}` : ''} · {displayDate(task.updatedAt)}
                      </small>
                    </span>
                    <AhStatusPill status={task.status} />
                  </Link>
                );
              })}
            </div>
          </section>
        )}
        {sessionsEmpty ? (
          <section className={projectsStyles.overviewCompact} aria-label="最近会话">
            <div className={projectsStyles.overviewCompactCopy}>
              <h3>最近会话</h3>
              <span role={sessions.isError ? 'alert' : sessions.isFetching ? 'status' : undefined}>
                {sessions.isFetching
                  ? '正在核对会话…'
                  : sessions.isError
                    ? sessions.error.message
                    : '还没有 Session'}
              </span>
            </div>
            <div className={projectsStyles.overviewCompactActions}>
              {sessions.isError ? (
                <AhButton
                  size="sm"
                  variant="subtle"
                  disabled={sessions.isFetching}
                  onClick={() => void sessions.refetch()}
                >
                  重新读取会话
                </AhButton>
              ) : null}
              <Link to={`/projects/${project.id}/sessions`}>全部会话 →</Link>
            </div>
          </section>
        ) : (
          <section className={projectsStyles.overviewPanel}>
            <div className={projectsStyles.panelHeader}>
              <div>
                <h3>最近会话</h3>
                <p>继续上一次对话或代码审阅。</p>
              </div>
              <Link to={`/projects/${project.id}/sessions`}>全部会话 →</Link>
            </div>
            <div className={projectsStyles.overviewList}>
              <QueryMessage
                loading={sessions.isFetching}
                error={sessions.error}
                retry={() => void sessions.refetch()}
                label={
                  sessions.data && !sessions.isError
                    ? '正在更新会话，下方为上次读取结果'
                    : '正在读取会话'
                }
              />
              {(!sessions.isError ? recentSessions : []).map((session) => {
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
                        {agentLabel(session.agentId, 'Agent 未记录')}
                        {session.model ? ` · ${session.model}` : ''} ·{' '}
                        {displayDate(session.lastActiveAt)}
                      </small>
                    </span>
                    <AhStatusPill status={session.status} />
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>
      <aside className={projectsStyles.overviewAside} aria-label="项目环境状态">
        <section className={projectsStyles.overviewPanel}>
          <div className={projectsStyles.panelHeader}>
            <div>
              <h3>项目状态</h3>
              <p>当前环境与 Agent 可用性。</p>
            </div>
          </div>
          <div className={projectsStyles.healthStack}>
            <QueryMessage
              loading={eligibility.isFetching}
              error={eligibility.error}
              retry={() => void eligibility.refetch()}
              label="正在读取项目登记资格"
            />
            <QueryMessage
              loading={preflight.isFetching}
              error={preflight.error}
              retry={() => void preflight.refetch()}
              label="正在进行项目预检"
            />
            {healthItems.map((item) => (
              <div className={projectsStyles.healthRow} key={item.label}>
                <span
                  className={
                    item.ok === null
                      ? undefined
                      : `${projectsStyles.healthMark} ${item.ok === false ? projectsStyles.healthMarkWarning : ''}`
                  }
                  aria-hidden="true"
                >
                  {item.ok === null ? '?' : item.ok ? '✓' : '!'}
                </span>
                <span className={projectsStyles.healthCopy}>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
              </div>
            ))}
            {!healthItems.length ? (
              <div className={projectsStyles.overviewEmpty}>
                <div>
                  <h4>状态信息暂不可用</h4>
                  <p>完成一次项目预检后会在这里显示。</p>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </aside>
    </div>
  );
}
