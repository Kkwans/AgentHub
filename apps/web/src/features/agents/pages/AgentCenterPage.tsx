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

export function AgentCenterPage() {
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const candidates = useQuery({
    queryKey: ['discovery-agents'],
    queryFn: () => api.get<AgentCandidateRecord[]>('/discovery/agents'),
  });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const filteredAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (agents.data ?? []).filter((agent) => {
      const matchesQuery =
        !normalized ||
        `${agent.name} ${agent.agentKind} ${agent.detectedVersion ?? ''}`
          .toLowerCase()
          .includes(normalized);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'ready' && agent.status === 'READY') ||
        (filter === 'attention' && agent.status !== 'READY');
      return matchesQuery && matchesFilter;
    });
  }, [agents.data, filter, query]);
  const capabilitiesFor = (agent: AgentRecord) => {
    const labels: Record<string, string> = {
      session: 'Session',
      sessions: 'Sessions',
      run: 'Run',
      runs: 'Runs',
      approval: 'Approval',
      approvals: 'Approval',
      files: '文件',
      terminal: 'Terminal',
      git: 'Git',
    };
    const keys = Object.keys(agent.capabilitiesJson ?? {})
      .filter((key) => Boolean(agent.capabilitiesJson[key]))
      .map((key) => labels[key.toLowerCase()] ?? '')
      .filter(Boolean);
    return Array.from(new Set(['Session', 'Run', ...keys])).slice(0, 4);
  };
  const agentKindLabel = (kind: string) =>
    ({ CODEX: 'Codex', CLAUDE_CODE: 'Claude Code', OPENCLAW: 'OpenClaw' })[kind] ?? 'Agent';
  return (
    <Screen
      eyebrow="AGENTS"
      title="Agent 中心"
      description="发现、管理和配置 AI Agent，让多个 Agent 协同工作。底层实现细节只在 Diagnostics 中展开。"
      actions={
        <>
          <Link to="/agents/runtime">
            <AhButton variant="default" leftSection={<Server size={16} />}>
              Runtime
            </AhButton>
          </Link>
          <Link to="/agents/agents/discover">
            <AhButton leftSection={<RefreshCw size={16} />}>发现 Agent</AhButton>
          </Link>
        </>
      }
    >
      <div className={layout.metrics}>
        <div className={layout.metric}>
          <AhMetric
            label="已就绪"
            value={agents.data?.filter((agent) => agent.status === 'READY').length ?? '—'}
            tone="success"
          />
        </div>
        <div className={layout.metric}>
          <AhMetric
            label="需要处理"
            value={
              (candidates.data ?? []).filter((candidate) => candidate.state !== 'READY').length
            }
            tone="warning"
          />
        </div>
        <div className={layout.metric}>
          <AhMetric label="能力" value="Session / Run" hint="按 Agent capability 呈现" />
        </div>
        <div className={layout.metric}>
          <AhMetric
            label="诊断"
            value={
              <Link className={layout.link} to="/agents/diagnostics">
                查看
              </Link>
            }
          />
        </div>
      </div>
      <AhSurface>
        <div className={layout.toolbar}>
          <AhInput
            label=""
            aria-label="搜索 Agent"
            placeholder="搜索名称或版本"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            leftSection={<Search size={15} />}
          />
          <AhSelect
            aria-label="Agent 筛选"
            label=""
            value={filter}
            onChange={(value) => setFilter(value ?? 'all')}
            data={[
              { value: 'all', label: '全部' },
              { value: 'ready', label: '已接入' },
              { value: 'attention', label: '需要处理' },
            ]}
          />
        </div>
        <div className={layout.surfaceHeader}>
          <div>
            <h3>已接入 Agent</h3>
            <p>每个身份都可以被 Project Work 选择。</p>
          </div>
          <Link className={layout.link} to="/agents/diagnostics">
            健康诊断
          </Link>
        </div>
        <div className={layout.agentCards}>
          {filteredAgents.map((agent) => (
            <article className={layout.agentCard} key={agent.id}>
              <div className={layout.agentCardHeader}>
                <span className={layout.agentMark}>
                  <Bot size={22} />
                </span>
                <div className={layout.rowMain}>
                  <h3>{agent.name}</h3>
                  <p>
                    {agentKindLabel(agent.agentKind)} · {agent.detectedVersion ?? '版本待检测'}
                  </p>
                </div>
                <AhStatusPill status={agent.status} />
              </div>
              <p className={layout.agentDescription}>
                可用于 Project Work 与 Coding Workspace 的真实执行身份。
              </p>
              <div className={layout.chipList}>
                {capabilitiesFor(agent).map((capability) => (
                  <span className={layout.chip} key={capability}>
                    {capability}
                  </span>
                ))}
              </div>
              <div className={layout.agentCardFooter}>
                <span>{agent.enabled ? '已启用' : '已停用'}</span>
                <span>{agent.defaultModel ?? 'Session 中选择模型'}</span>
              </div>
            </article>
          ))}
          {!agents.isLoading && !filteredAgents.length ? (
            <AhEmptyState
              title={query || filter !== 'all' ? '没有匹配的 Agent' : '还没有接入 Agent'}
              description="扫描本机或运行环境以发现可用 Agent。"
              action={
                <Link to="/agents/agents/discover">
                  <AhButton>开始发现</AhButton>
                </Link>
              }
            />
          ) : null}
        </div>
      </AhSurface>
    </Screen>
  );
}
