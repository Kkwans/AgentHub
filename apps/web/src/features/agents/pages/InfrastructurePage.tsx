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

export function InfrastructurePage({ kind }: { kind: 'runtimes' | 'nodes' | 'diagnostics' }) {
  const client = useQueryClient();
  const runtimes = useQuery({
    queryKey: ['discovery-runtimes'],
    queryFn: () => api.get<RuntimeCandidateRecord[]>('/discovery/runtimes'),
    enabled: kind === 'runtimes',
  });
  const nodes = useQuery({
    queryKey: ['remote-nodes'],
    queryFn: () => api.get<RemoteNodeRecord[]>('/remote-nodes'),
    enabled: kind === 'nodes',
  });
  const host = useQuery({
    queryKey: ['host-diagnostics'],
    queryFn: () => api.get<Record<string, unknown>>('/agents/diagnostics/host'),
    enabled: kind === 'diagnostics',
  });
  const rescan = useMutation({
    mutationFn: () => api.post('/discovery/runtimes/rescan'),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-runtimes'] }),
  });
  const adopt = useMutation({
    mutationFn: (id: string) => api.post(`/discovery/runtimes/${encodeURIComponent(id)}/adopt`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-runtimes'] }),
  });
  const lifecycle = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'stop' }) =>
      api.post(`/execution-targets/${id}/${action}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-runtimes'] }),
  });
  const title = kind === 'runtimes' ? 'Runtime' : kind === 'nodes' ? 'Remote Nodes' : 'Diagnostics';
  const description =
    kind === 'runtimes'
      ? '管理本机与 Docker 执行环境，状态反馈与 Agent 可用性保持一致。'
      : kind === 'nodes'
        ? '管理已授权的 Remote Node，注册码只展示一次，撤销需要明确确认。'
        : '先给出面向用户的结论，再按需展开原始诊断信息。';
  return (
    <Screen
      eyebrow="Agent Infrastructure"
      title={title}
      description={description}
      actions={
        kind === 'runtimes' ? (
          <AhButton
            variant="default"
            onClick={() => rescan.mutate()}
            loading={rescan.isPending}
            leftSection={<RefreshCw size={16} />}
          >
            重新扫描
          </AhButton>
        ) : kind === 'nodes' ? (
          <Link to="/agents/nodes/register">
            <AhButton leftSection={<Link2 size={16} />}>授权 Node</AhButton>
          </Link>
        ) : undefined
      }
    >
      {kind === 'runtimes' ? (
        <AhSurface>
          <div className={layout.surfaceBody}>
            <QueryMessage
              loading={runtimes.isLoading}
              error={runtimes.error}
              retry={() => void runtimes.refetch()}
              label="正在扫描运行环境"
            />
            {(runtimes.data ?? []).map((runtime) => (
              <div
                className={`${layout.row} ${layout.infrastructureRow}`}
                key={runtime.candidateId}
              >
                <Server size={19} />
                <div className={layout.rowMain}>
                  <span className={layout.rowTitle}>{runtime.displayName}</span>
                  <span className={layout.rowMeta}>
                    {runtime.image ?? 'Local Host'} · {runtime.statusText ?? '状态待确认'}
                  </span>
                </div>
                <AhStatusPill status={runtime.state} />
                {!runtime.targetId && runtime.adoptable ? (
                  <AhButton
                    size="xs"
                    onClick={() => adopt.mutate(runtime.candidateId)}
                    loading={adopt.isPending}
                  >
                    接入
                  </AhButton>
                ) : runtime.targetId && runtime.state === 'STOPPED' ? (
                  <AhButton
                    size="xs"
                    onClick={() => lifecycle.mutate({ id: runtime.targetId!, action: 'start' })}
                    loading={lifecycle.isPending}
                  >
                    <Play size={14} /> 启动
                  </AhButton>
                ) : runtime.targetId &&
                  runtime.state === 'READY' &&
                  runtime.kind === 'DOCKER_CONTAINER' ? (
                  <AhButton
                    size="xs"
                    variant="default"
                    onClick={() => lifecycle.mutate({ id: runtime.targetId!, action: 'stop' })}
                    loading={lifecycle.isPending}
                  >
                    <CircleStop size={14} /> 停止
                  </AhButton>
                ) : null}
              </div>
            ))}
            {!runtimes.isLoading && !runtimes.error && !runtimes.data?.length ? (
              <AhEmptyState
                title="暂时没有可管理的 Runtime"
                description="重新扫描后会显示本机或支持的 Docker 环境。"
              />
            ) : null}
          </div>
        </AhSurface>
      ) : kind === 'nodes' ? (
        <AhSurface>
          <div className={layout.surfaceBody}>
            <QueryMessage
              loading={nodes.isLoading}
              error={nodes.error}
              retry={() => void nodes.refetch()}
              label="正在加载 Remote Nodes"
            />
            {(nodes.data ?? []).map((node) => (
              <div className={`${layout.row} ${layout.infrastructureRow}`} key={node.id}>
                <Network size={19} />
                <div className={layout.rowMain}>
                  <span className={layout.rowTitle}>{node.name}</span>
                  <span className={layout.rowMeta}>
                    {node.hostname} · {node.allowedRootsJson.length} 个授权目录 · 最近{' '}
                    {displayDate(node.lastSeenAt)}
                  </span>
                </div>
                <AhStatusPill status={node.status} />
                <Link className={layout.rowAction} to={`/agents/nodes/${node.id}`}>
                  查看
                </Link>
              </div>
            ))}
            {!nodes.isLoading && !nodes.error && !nodes.data?.length ? (
              <AhEmptyState
                title="还没有 Remote Node"
                description="生成一次性注册码并在目标设备运行 Node daemon。"
                action={
                  <Link to="/agents/nodes/register">
                    <AhButton>授权 Node</AhButton>
                  </Link>
                }
              />
            ) : null}
          </div>
        </AhSurface>
      ) : (
        <AhSurface>
          <div className={layout.surfaceHeader}>
            <div>
              <h3>主机诊断</h3>
              <p>高级供应商细节保持在 progressive disclosure 内。</p>
            </div>
            <AhButton
              variant="default"
              size="xs"
              onClick={() => void host.refetch()}
              leftSection={<RefreshCw size={14} />}
            >
              刷新
            </AhButton>
          </div>
          <div className={layout.surfaceBody}>
            <QueryMessage
              loading={host.isLoading}
              error={host.error}
              retry={() => void host.refetch()}
              label="正在读取诊断"
            />
            {host.data ? (
              <>
                <div className={layout.mutedBox}>
                  <strong>结论</strong>
                  <p>
                    {typeof host.data.message === 'string'
                      ? host.data.message
                      : '服务诊断已返回，请展开详细信息。'}
                  </p>
                </div>
                <details>
                  <summary>查看详细诊断</summary>
                  <pre className={layout.codeBlock}>{JSON.stringify(host.data, null, 2)}</pre>
                </details>
              </>
            ) : null}
          </div>
        </AhSurface>
      )}
    </Screen>
  );
}
