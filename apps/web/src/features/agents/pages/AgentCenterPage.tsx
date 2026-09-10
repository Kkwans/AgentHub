import {
  AhButton,
  AhEmptyState,
  AhInput,
  AhSelect,
  ArrowRight,
  Badge,
  Bot,
  Card,
  Link2,
  RefreshCw,
  Search,
  Server,
  X,
} from '@agenthub/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ErrorState, LoadingState } from '../../../components/Feedback';
import type { AgentCandidateRecord, AgentRecord, ExecutionTargetRecord } from '../../../lib/api';
import { api } from '../../../lib/api';
import layout from '../../shared/layout.module.css';
import { NavigationPageHeader, displayDate } from '../../shared/page-primitives';

type AgentFilter = 'all' | 'ready' | 'attention';

export function agentKindLabel(kind: string): string {
  return { CODEX: 'Codex', CLAUDE_CODE: 'Claude Code', OPENCLAW: 'OpenClaw' }[kind] ?? 'Agent';
}

function providerLabel(adapter: string): string {
  const normalized = adapter.replace(/^ACP[_-]?/, '').replace(/[_-]+/g, ' ');
  return normalized || '默认 Provider';
}

function capabilitiesFor(agent: AgentRecord): string[] {
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
}

function statusLabel(status: string, enabled: boolean): string {
  if (!enabled) return '已停用';
  return status;
}

function AgentResourceCard({
  agent,
  target,
}: {
  agent: AgentRecord;
  target?: ExecutionTargetRecord;
}) {
  const navigate = useNavigate();
  const ready = agent.status === 'READY' && agent.enabled;
  const runtimeLabel = target?.kind === 'DOCKER_CONTAINER' ? 'Docker' : 'Local';
  const capabilities = capabilitiesFor(agent);
  const activate = () => navigate('/agents/diagnostics');
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate();
  };

  return (
    <Card
      variant="interactive"
      className="resource-card group relative flex min-h-0 cursor-pointer flex-col overflow-hidden p-0 transition-[border-color,box-shadow,background-color] duration-150 ease-out sm:min-h-[190px]"
      role="link"
      tabIndex={0}
      aria-label={`${agent.name}，${agentKindLabel(agent.agentKind)}，${ready ? '已就绪' : '需要处理'}`}
      onClick={activate}
      onKeyDown={onKeyDown}
    >
      <div className="flex flex-1 flex-col px-4 pb-3 pt-4">
        <div className="mb-3 flex min-h-5 flex-wrap items-center gap-1">
          <Badge variant={ready ? 'success' : 'warning'} dot>
            <span>{ready ? '已就绪' : '需要处理'}</span>
          </Badge>
          <Badge variant="secondary">
            <span>{agentKindLabel(agent.agentKind)}</span>
          </Badge>
          <Badge variant={agent.enabled ? 'outline' : 'destructive'} className="ml-auto">
            <span>{agent.enabled ? '已启用' : '已停用'}</span>
          </Badge>
        </div>

        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full border border-[hsl(var(--primary))]/15 bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))] transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)] group-hover:scale-[1.03]">
            <Bot size={19} weight="duotone" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold tracking-[-0.01em] text-[hsl(var(--foreground))] transition-colors duration-[var(--motion-fast)] group-hover:text-[hsl(var(--primary))]">
              {agent.name}
            </h3>
            <code className="mt-1 block truncate font-mono text-xs text-[hsl(var(--foreground-faint))]">
              {agentKindLabel(agent.agentKind)} · {agent.detectedVersion ?? '版本待检测'}
            </code>
          </div>
        </div>

        <div className="mt-4 grid min-w-0 gap-2 text-xs text-[hsl(var(--foreground-muted))]">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="shrink-0 text-[hsl(var(--foreground-faint))]">Runtime</span>
            <span className="min-w-0 truncate font-medium text-[hsl(var(--foreground-subtle))]">
              {target?.name ?? '运行环境待确认'} · {runtimeLabel}
            </span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="shrink-0 text-[hsl(var(--foreground-faint))]">Provider</span>
            <span className="min-w-0 truncate font-medium text-[hsl(var(--foreground-subtle))]">
              {providerLabel(agent.adapterKind)}
            </span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="shrink-0 text-[hsl(var(--foreground-faint))]">Model</span>
            <span className="min-w-0 truncate font-medium text-[hsl(var(--foreground-subtle))]">
              {agent.defaultModel ?? 'Session 中选择'}
            </span>
          </div>
        </div>

        <div className="mt-3 flex min-h-6 flex-wrap items-center gap-1.5">
          {capabilities.map((capability) => (
            <span
              key={capability}
              className="inline-flex items-center rounded-md border border-[hsl(var(--border))]/70 bg-[hsl(var(--surface-muted))]/65 px-1.5 py-0.5 text-xs font-medium text-[hsl(var(--foreground-subtle))]"
            >
              {capability}
            </span>
          ))}
        </div>
      </div>

      <div className="border-t border-[hsl(var(--border))]/70 bg-[hsl(var(--surface-muted))]/25 px-4 py-2.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 text-xs text-[hsl(var(--foreground-faint))]">
            <span className="mr-1.5">最近检查</span>
            <span className="font-mono tabular-nums text-[hsl(var(--foreground-subtle))]">
              {displayDate(agent.lastPreflightAt)}
            </span>
          </div>
          <Link
            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[hsl(var(--primary))] transition-colors duration-[var(--motion-fast)] hover:text-[hsl(var(--primary-hover))]"
            to="/agents/diagnostics"
            onClick={(event) => event.stopPropagation()}
          >
            查看诊断 <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
        <span className="sr-only">当前状态：{statusLabel(agent.status, agent.enabled)}</span>
      </div>
    </Card>
  );
}

function AgentFilterBar({
  query,
  filter,
  onQueryChange,
  onFilterChange,
  onRefresh,
  refreshing,
}: {
  query: string;
  filter: AgentFilter;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: AgentFilter) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <section
      aria-label="Agent 筛选与操作"
      className="resource-filter-bar overflow-hidden rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] shadow-[var(--shadow-sm)]"
    >
      <div className="resource-filter-main flex min-h-12 flex-wrap items-center gap-2 px-3 py-2.5">
        <div className="resource-filter-search relative w-full min-w-0 sm:w-96">
          <AhInput
            aria-label="搜索 Agent"
            className="w-full min-h-9 py-2 pr-8 text-xs max-md:min-h-11 max-md:text-sm"
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="搜索名称、类型或版本"
            leftSection={<Search aria-hidden size={15} />}
          />
          {query ? (
            <button
              type="button"
              className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-[hsl(var(--foreground-faint))] transition-colors hover:bg-[hsl(var(--surface-hover))] hover:text-[hsl(var(--foreground))] max-md:size-11"
              aria-label="清除搜索"
              onClick={() => onQueryChange('')}
            >
              <X aria-hidden size={13} />
            </button>
          ) : null}
        </div>
        <div className="resource-filter-actions flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:flex-1 sm:justify-end">
          <label className="sr-only" htmlFor="agent-status-filter">
            Agent 状态
          </label>
          <AhSelect
            id="agent-status-filter"
            aria-label="Agent 状态"
            className="min-h-9 w-full text-xs max-md:min-h-11 max-md:text-sm sm:w-auto"
            value={filter}
            searchable={false}
            clearable={false}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'ready', label: '已就绪' },
              { value: 'attention', label: '需要处理' },
            ]}
            onChange={(value) => {
              if (value) onFilterChange(value as AgentFilter);
            }}
          />
          <button
            type="button"
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-xs font-semibold text-[hsl(var(--foreground-subtle))] shadow-[var(--shadow-sm)] transition-[background-color,border-color,color] duration-[var(--motion-fast)] hover:border-[hsl(var(--border-strong))] hover:bg-[hsl(var(--surface-muted))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/30 max-md:min-h-11"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              aria-hidden
              className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''}
              size={14}
            />
            刷新
          </button>
        </div>
      </div>
    </section>
  );
}

export function AgentCenterPage() {
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<AgentRecord[]>('/agents'),
  });
  const candidates = useQuery({
    queryKey: ['discovery-agents'],
    queryFn: () => api.get<AgentCandidateRecord[]>('/discovery/agents'),
  });
  const targets = useQuery({
    queryKey: ['execution-targets'],
    queryFn: () => api.get<ExecutionTargetRecord[]>('/execution-targets'),
  });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AgentFilter>('all');
  const filteredAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (agents.data ?? []).filter((agent) => {
      const matchesQuery =
        !normalized ||
        `${agent.name} ${agent.agentKind} ${agent.adapterKind} ${agent.detectedVersion ?? ''}`
          .toLowerCase()
          .includes(normalized);
      const ready = agent.status === 'READY' && agent.enabled;
      const matchesFilter =
        filter === 'all' || (filter === 'ready' && ready) || (filter === 'attention' && !ready);
      return matchesQuery && matchesFilter;
    });
  }, [agents.data, filter, query]);
  const targetById = useMemo(
    () => new Map((targets.data ?? []).map((target) => [target.id, target])),
    [targets.data],
  );
  const readyCount =
    agents.data?.filter((agent) => agent.status === 'READY' && agent.enabled).length ?? 0;
  const attentionCount = (candidates.data ?? []).filter(
    (candidate) => candidate.state !== 'READY',
  ).length;

  return (
    <div className="workspace-page flex h-full min-h-0 flex-col overflow-hidden">
      <NavigationPageHeader
        icon={Bot}
        title="Agent 中心"
        description="发现和管理可用于 Project Work 的 Agent 身份。运行环境与远程节点诊断在 Infrastructure 中单独展示。"
        actions={
          <Link to="/agents/agents/discover">
            <AhButton leftSection={<RefreshCw size={16} />}>发现 Agent</AhButton>
          </Link>
        }
      />
      <div className="page-content flex-1 overflow-y-auto">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[hsl(var(--foreground-muted))]">
          <span>
            <strong className="font-semibold text-[hsl(var(--foreground))]">
              {agents.isLoading ? '—' : (agents.data?.length ?? 0)}
            </strong>{' '}
            个 Agent
          </span>
          <span>
            <strong className="font-semibold text-[hsl(var(--success-fg))]">
              {agents.isLoading ? '—' : readyCount}
            </strong>{' '}
            已就绪
          </span>
          <span>
            <strong className="font-semibold text-[hsl(var(--warning-fg))]">
              {candidates.isLoading ? '—' : attentionCount}
            </strong>{' '}
            个发现结果待处理
          </span>
          <Link
            className={`${layout.link} ml-auto inline-flex items-center gap-1`}
            to="/agents/runtime"
          >
            打开 Infrastructure <Link2 size={13} aria-hidden />
          </Link>
        </div>

        <AgentFilterBar
          query={query}
          filter={filter}
          onQueryChange={setQuery}
          onFilterChange={setFilter}
          onRefresh={() => {
            void agents.refetch();
            void candidates.refetch();
            void targets.refetch();
          }}
          refreshing={agents.isFetching || candidates.isFetching || targets.isFetching}
        />

        <div className="mt-4">
          {agents.isLoading ? <LoadingState label="正在加载 Agent" /> : null}
          {agents.error ? (
            <ErrorState error={agents.error} retry={() => void agents.refetch()} />
          ) : null}
          {!agents.isLoading && !agents.error && filteredAgents.length ? (
            <div className="responsive-card-grid resource-card-grid">
              {filteredAgents.map((agent) => {
                const target = targetById.get(agent.targetId);
                return (
                  <AgentResourceCard key={agent.id} agent={agent} {...(target ? { target } : {})} />
                );
              })}
            </div>
          ) : null}
          {!agents.isLoading && !agents.error && !filteredAgents.length ? (
            <AhEmptyState
              title={query || filter !== 'all' ? '没有匹配的 Agent' : '还没有接入 Agent'}
              description={
                query || filter !== 'all'
                  ? '尝试其他关键词或切换状态筛选。'
                  : '从发现流程接入可用 Agent；原始运行时细节会在 Infrastructure 中展开。'
              }
              action={
                query || filter !== 'all' ? (
                  <AhButton
                    variant="outline"
                    onClick={() => {
                      setQuery('');
                      setFilter('all');
                    }}
                  >
                    清除筛选
                  </AhButton>
                ) : (
                  <Link to="/agents/agents/discover">
                    <AhButton>开始发现</AhButton>
                  </Link>
                )
              }
              icon={<Bot size={22} aria-hidden />}
            />
          ) : null}
        </div>

        <div className="mt-4 flex items-center gap-2 border-t border-[hsl(var(--border))]/60 pt-3 text-xs text-[hsl(var(--foreground-faint))]">
          <Server size={14} aria-hidden />
          <span>Runtime 与 Remote Node 诊断已独立</span>
          <Link
            className={`${layout.link} ml-auto inline-flex items-center gap-1`}
            to="/agents/diagnostics"
          >
            查看状态 <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
