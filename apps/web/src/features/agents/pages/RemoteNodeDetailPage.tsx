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

export function RemoteNodeDetailPage() {
  const { nodeId } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const node = useQuery({
    queryKey: ['remote-node-diagnostics', nodeId],
    queryFn: () => api.get<RemoteNodeDiagnostics>(`/remote-nodes/${nodeId}/diagnostics`),
    enabled: Boolean(nodeId),
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const revoke = useMutation({
    mutationFn: () => api.post(`/remote-nodes/${nodeId}/revoke`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['remote-nodes'] });
      navigate('/agents/nodes');
    },
  });
  if (node.isLoading) return <AhLoadingState label="正在读取 Node 诊断" />;
  if (node.error || !node.data)
    return (
      <AhErrorState
        description={node.error?.message ?? 'Remote Node 不存在'}
        retry={() => void node.refetch()}
      />
    );
  return (
    <Screen
      eyebrow="Remote Node"
      title={node.data.id ? 'Node 详情' : 'Remote Node'}
      description="身份、授权 roots、inventory 与连接状态。原始指纹只在诊断上下文内展示。"
      actions={
        <AhButton variant="default" onClick={() => setConfirmOpen(true)} loading={revoke.isPending}>
          撤销授权
        </AhButton>
      }
    >
      <div className={layout.grid + ' ' + layout.grid2}>
        <AhSurface>
          <div className={layout.surfaceHeader}>
            <div>
              <h3>连接状态</h3>
              <p>{node.data.lastSeenAt ? displayDate(node.data.lastSeenAt) : '暂无心跳'}</p>
            </div>
            <AhStatusPill status={node.data.status} />
          </div>
          <div className={layout.surfaceBody}>
            <div className={layout.row}>
              <Network size={17} />
              <div className={layout.rowMain}>
                <span className={layout.rowTitle}>协议</span>
                <span className={layout.rowMeta}>
                  {node.data.protocolVersion} · daemon {node.data.daemonVersion}
                </span>
              </div>
            </div>
            <div className={layout.row}>
              <Server size={17} />
              <div className={layout.rowMain}>
                <span className={layout.rowTitle}>授权目录</span>
                <span className={layout.rowMeta}>{node.data.allowedRoots.length} 个 root</span>
              </div>
            </div>
            <details>
              <summary>查看设备指纹</summary>
              <pre className={layout.codeBlock}>{node.data.fingerprint}</pre>
            </details>
          </div>
        </AhSurface>
        <AhSurface>
          <div className={layout.surfaceHeader}>
            <div>
              <h3>Agent inventory</h3>
              <p>只有固定 Profile 会进入普通流程。</p>
            </div>
          </div>
          <div className={layout.surfaceBody}>
            {node.data.inventory.map((agent) => (
              <div className={layout.row} key={agent.key}>
                <Bot size={17} />
                <div className={layout.rowMain}>
                  <span className={layout.rowTitle}>{agent.name}</span>
                  <span className={layout.rowMeta}>{agent.detectedVersion ?? '版本待检测'}</span>
                </div>
                <AhStatusPill status={agent.status} />
              </div>
            ))}
          </div>
        </AhSurface>
      </div>
      <AhDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="撤销 Remote Node？"
        description="撤销后该设备不能再访问授权目录；历史记录会保留。"
      >
        <div className={layout.actions}>
          <AhButton variant="default" onClick={() => setConfirmOpen(false)}>
            取消
          </AhButton>
          <AhButton color="red" onClick={() => revoke.mutate()} loading={revoke.isPending}>
            确认撤销
          </AhButton>
        </div>
      </AhDialog>
    </Screen>
  );
}
