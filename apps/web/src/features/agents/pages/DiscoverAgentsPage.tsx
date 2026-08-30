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
import { AgentCenterPage } from './AgentCenterPage';
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

export function DiscoverAgentsPage() {
  const client = useQueryClient();
  const compact = useCompactViewport();
  const candidates = useQuery({
    queryKey: ['discovery-agents'],
    queryFn: () => api.get<AgentCandidateRecord[]>('/discovery/agents'),
  });
  const rescan = useMutation({
    mutationFn: () => api.post('/discovery/agents/rescan'),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-agents'] }),
  });
  const adopt = useMutation({
    mutationFn: (id: string) => api.post(`/discovery/agents/${encodeURIComponent(id)}/adopt`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['discovery-agents'] }),
  });
  const visibleCandidates = (candidates.data ?? []).filter(
    (candidate) => candidate.agentKind !== 'UNKNOWN',
  );
  const sourceCount = (prefix: string) =>
    visibleCandidates.filter((candidate) =>
      (candidate.targetCandidateId ?? '').toLowerCase().startsWith(prefix),
    ).length;
  const sources = [
    {
      label: 'Local Host',
      hint: '本机已授权目录',
      count: sourceCount('host') + sourceCount('local'),
    },
    { label: 'Remote Nodes', hint: '已连接的远程设备', count: sourceCount('remote') },
    { label: 'NAS Docker', hint: '已发现的容器运行环境', count: sourceCount('docker') },
  ];
  const candidateAction = (candidate: AgentCandidateRecord) => {
    if (candidate.adoptable)
      return (
        <AhButton
          size="xs"
          onClick={() => adopt.mutate(candidate.candidateId)}
          loading={adopt.isPending}
        >
          {candidate.state === 'AUTH_REQUIRED' ? '去授权' : '添加'}
        </AhButton>
      );
    if (candidate.state === 'STOPPED')
      return (
        <Link className={layout.rowAction} to="/agents/runtime">
          查看 Runtime
        </Link>
      );
    if (candidate.state === 'MISSING_DEPENDENCY')
      return (
        <Link className={layout.rowAction} to="/agents/diagnostics">
          查看诊断
        </Link>
      );
    return null;
  };
  return (
    <>
      <AgentCenterPage />
      <AhDialog
        open
        onClose={() => window.history.back()}
        title="发现 Agent"
        description="扫描 → 候选 → 接入 → preflight → Ready，每一步都保留可恢复的状态。"
        size={960}
        fullScreen={compact}
        actions={
          <>
            <AhButton variant="default" onClick={() => window.history.back()}>
              完成
            </AhButton>
            <AhButton
              onClick={() => rescan.mutate()}
              loading={rescan.isPending}
              leftSection={<RefreshCw size={16} />}
            >
              重新扫描
            </AhButton>
          </>
        }
      >
        <div className={layout.discoveryDialog} data-testid="discover-agents-dialog">
          <section className={layout.discoveryScanner} aria-label="扫描进度">
            <div className={layout.scannerOrb}>
              <ScanSearch size={32} />
            </div>
            <span className={layout.eyebrow}>Agent Discovery</span>
            <h3>
              {rescan.isPending || candidates.isFetching ? '正在扫描可用 Agent' : '扫描已完成'}
            </h3>
            <p>只读取已授权的本机、Remote Node 和 NAS Docker 来源，不会静默修改认证或配置。</p>
            <div className={layout.discoveryStats}>
              <div>
                <strong>{visibleCandidates.length}</strong>
                <span>发现</span>
              </div>
              <div>
                <strong>
                  {visibleCandidates.filter((candidate) => candidate.state === 'READY').length}
                </strong>
                <span>可添加</span>
              </div>
              <div>
                <strong>
                  {
                    visibleCandidates.filter((candidate) => candidate.state === 'AUTH_REQUIRED')
                      .length
                  }
                </strong>
                <span>需授权</span>
              </div>
            </div>
            <div className={layout.mutedBox}>
              隐私提示：扫描只返回 AgentHub 支持的 Profile；原始 executable、adapter 和 container
              identity 仅在 Diagnostics 展开。
            </div>
          </section>
          <section className={layout.discoveryResults} aria-label="来源与候选 Agent">
            <div className={layout.sourceList}>
              {sources.map((source) => (
                <div className={layout.sourceRow} key={source.label}>
                  <span className={layout.sourceIcon}>
                    <Server size={16} />
                  </span>
                  <div>
                    <strong>{source.label}</strong>
                    <span>{source.hint}</span>
                  </div>
                  <AhStatusPill status={source.count ? 'READY' : 'UNAVAILABLE'} />
                  <span className={layout.subtle}>{source.count}</span>
                </div>
              ))}
            </div>
            <div className={layout.dialogSection}>
              <div className={layout.surfaceHeader}>
                <div>
                  <h3>候选 Agent</h3>
                  <p>选择要接入的身份，部分失败不会阻塞其它候选。</p>
                </div>
                <span className={layout.subtle}>{visibleCandidates.length} 个</span>
              </div>
              <QueryMessage
                loading={candidates.isLoading}
                error={candidates.error}
                retry={() => void candidates.refetch()}
                label="正在扫描 Agent"
              />
              {!candidates.isLoading && !candidates.error ? (
                <div className={layout.discoveryCandidates}>
                  {visibleCandidates.map((candidate) => (
                    <div className={layout.candidateRow} key={candidate.candidateId}>
                      <span className={layout.candidateMark}>
                        <Bot size={18} />
                      </span>
                      <div className={layout.rowMain}>
                        <strong className={layout.rowTitle}>{candidate.displayName}</strong>
                        <span className={layout.rowMeta}>
                          {candidate.detectedVersion ?? '版本待检测'} ·{' '}
                          {candidate.reasonCode ? '需要处理' : '已识别'}
                        </span>
                      </div>
                      <AhStatusPill status={candidate.state} />
                      {candidateAction(candidate)}
                    </div>
                  ))}
                  {!visibleCandidates.length ? (
                    <AhEmptyState
                      compact
                      title="暂时没有候选 Agent"
                      description="重新扫描会重新读取授权来源。"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </AhDialog>
    </>
  );
}
