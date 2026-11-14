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

import type { AgentDiscoveryOutletContext } from './AgentDiscoveryLayout';
import styles from './DiscoverAgentsPage.module.css';

export function DiscoverAgentsPage() {
  const { closeDiscovery } = useOutletContext<AgentDiscoveryOutletContext>();
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
          className={styles.control ?? ''}
          onClick={() => adopt.mutate(candidate.candidateId)}
          loading={adopt.isPending}
        >
          {candidate.state === 'AUTH_REQUIRED' ? '去授权' : '添加'}
        </AhButton>
      );
    if (candidate.state === 'STOPPED')
      return (
        <Link className={styles.readLink} to="/agents/runtime">
          查看 Runtime
        </Link>
      );
    if (candidate.state === 'MISSING_DEPENDENCY')
      return (
        <Link className={styles.readLink} to="/agents/diagnostics">
          查看诊断
        </Link>
      );
    return null;
  };
  return (
    <>
      <AhDialog
        open
        onClose={closeDiscovery}
        title="发现 Agent"
        description="扫描 → 候选 → 接入 → preflight → Ready，每一步都保留可恢复的状态。"
        size={960}
        fullScreen={compact}
        actions={
          <>
            <AhButton className={styles.control ?? ''} variant="default" onClick={closeDiscovery}>
              完成
            </AhButton>
            <AhButton
              className={styles.control ?? ''}
              variant="default"
              onClick={() => rescan.mutate()}
              loading={rescan.isPending}
              leftSection={<RefreshCw size={16} />}
            >
              重新扫描
            </AhButton>
          </>
        }
      >
        <div className={styles.dialog} data-testid="discover-agents-dialog">
          <section className={styles.progress} aria-label="扫描进度">
            <h3>
              {candidates.error
                ? '无法确认扫描结果'
                : rescan.isPending || candidates.isFetching
                  ? '正在扫描可用 Agent'
                  : '扫描已完成'}
            </h3>
            {!candidates.error && !candidates.isLoading ? (
              <p>
                {visibleCandidates.length} 个候选 ·{' '}
                {
                  visibleCandidates.filter(
                    (candidate) => candidate.adoptable && candidate.state !== 'AUTH_REQUIRED',
                  ).length
                }{' '}
                个可添加 ·{' '}
                {
                  visibleCandidates.filter(
                    (candidate) => candidate.adoptable && candidate.state === 'AUTH_REQUIRED',
                  ).length
                }{' '}
                个需授权
              </p>
            ) : null}
          </section>
          <section aria-label="候选 Agent" className={styles.results}>
            <h3>候选 Agent</h3>
            <p className={styles.hint}>选择要接入的身份，部分失败不会阻塞其它候选。</p>
            <QueryMessage
              loading={candidates.isLoading}
              error={candidates.error}
              retry={() => void candidates.refetch()}
              label="正在扫描 Agent"
            />
            {!candidates.isLoading && !candidates.error ? (
              <div>
                {visibleCandidates.map((candidate) => (
                  <div className={styles.candidate} key={candidate.candidateId}>
                    <div className={styles.copy}>
                      <strong>{candidate.displayName}</strong>
                      <span>
                        {candidate.detectedVersion ?? '版本待检测'} ·{' '}
                        {candidate.reasonCode ? '需要处理' : '已识别'}
                      </span>
                    </div>
                    <div className={styles.candidateActions}>
                      {candidate.state === 'INSTALLED' ? (
                        <span className={styles.installed}>已安装</span>
                      ) : (
                        <AhStatusPill status={candidate.state} />
                      )}
                      {candidateAction(candidate)}
                    </div>
                    {candidate.state === 'INSTALLED' ? (
                      <p className={styles.installHint}>已检测到安装，不代表已登录或可运行。</p>
                    ) : null}
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
          </section>
          <details className={styles.sources}>
            <summary>来源与隐私说明</summary>
            <p>只读取已授权的本机、Remote Node 和 NAS Docker 来源，不会静默修改认证或配置。</p>
            <div>
              {sources.map((source) => (
                <div className={styles.source} key={source.label}>
                  <strong>{source.label}</strong>
                  <span>{source.hint}</span>
                  <span>
                    {candidates.error || candidates.isLoading
                      ? '数量待确认'
                      : `${source.count} 个候选`}
                  </span>
                </div>
              ))}
            </div>
            <p>
              隐私提示：扫描只返回 AgentHub 支持的 Profile；原始 executable、adapter 和 container
              identity 仅在 Diagnostics 展开。
            </p>
          </details>
        </div>
      </AhDialog>
    </>
  );
}
