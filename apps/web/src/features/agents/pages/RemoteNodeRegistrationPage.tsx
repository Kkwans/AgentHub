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

export function RemoteNodeRegistrationPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [expiresInMinutes, setExpiresInMinutes] = useState('15');
  const [rootDraft, setRootDraft] = useState('');
  const [roots, setRoots] = useState<string[]>([]);
  const [registration, setRegistration] = useState<RemoteNodeRegistration>();
  const create = useMutation({
    mutationFn: () =>
      api.post<RemoteNodeRegistration>('/remote-nodes/registration-tokens', {
        name: name.trim(),
        allowedRoots: roots,
        expiresInMinutes: Number(expiresInMinutes),
      }),
    onSuccess: setRegistration,
  });
  const addRoot = () => {
    const value = rootDraft.trim();
    if (!value || roots.includes(value)) return;
    setRoots((current) => [...current, value]);
    setRootDraft('');
  };
  return (
    <Screen
      eyebrow="Remote Nodes"
      title="授权 Remote Node"
      description="只授权 Agent 实际需要访问的目录。注册码为一次性凭据，生成后只展示一次。"
      actions={
        <AhButton variant="default" onClick={() => navigate('/agents/nodes')}>
          返回 Nodes
        </AhButton>
      }
    >
      <AhSurface>
        <div className={layout.surfaceBody}>
          {registration ? (
            <div className={layout.stack}>
              <div className={layout.mutedBox}>
                <strong>注册码已生成</strong>
                <p>请在目标设备完成 Node daemon 配置。关闭页面后 token 不会再次显示。</p>
                <pre className={layout.codeBlock}>{registration.token}</pre>
                <AhButton
                  size="sm"
                  leftSection={<Copy size={14} />}
                  onClick={() => void navigator.clipboard?.writeText(registration.token)}
                >
                  复制注册码
                </AhButton>
              </div>
              <div className={layout.mutedBox}>
                <strong>允许目录</strong>
                {registration.allowedRoots.map((root) => (
                  <div className={layout.mono} key={root}>
                    {root}
                  </div>
                ))}
              </div>
              <div className={layout.actions}>
                <AhButton onClick={() => navigate('/agents/nodes')}>完成</AhButton>
              </div>
            </div>
          ) : (
            <div className={layout.stack}>
              <AhInput
                label="Node 名称"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="例如：开发节点"
              />
              <AhSelect
                label="有效期"
                value={expiresInMinutes}
                onChange={(value) => setExpiresInMinutes(value ?? '15')}
                data={[
                  { value: '5', label: '5 分钟' },
                  { value: '15', label: '15 分钟' },
                  { value: '60', label: '1 小时' },
                ]}
              />
              <div>
                <AhInput
                  label="授权目录"
                  value={rootDraft}
                  onChange={(event) => setRootDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addRoot();
                    }
                  }}
                  placeholder="/srv/projects/AgentHub"
                  description="目标设备上的绝对路径。按 Enter 加入授权清单。"
                />
                <div className={layout.actions} style={{ marginTop: 8 }}>
                  {roots.map((root) => (
                    <AhButton
                      key={root}
                      size="xs"
                      variant="default"
                      onClick={() => setRoots((current) => current.filter((item) => item !== root))}
                    >
                      {root} ×
                    </AhButton>
                  ))}
                </div>
              </div>
              {create.error ? <AhErrorState description={create.error.message} /> : null}
              <AhButton
                onClick={() => create.mutate()}
                loading={create.isPending}
                disabled={!name.trim() || roots.length === 0}
              >
                生成一次性注册码
              </AhButton>
            </div>
          )}
        </div>
      </AhSurface>
    </Screen>
  );
}
