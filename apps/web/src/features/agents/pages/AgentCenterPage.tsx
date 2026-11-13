import {
  AhButton,
  AhEmptyState,
  AhInput,
  AhSelect,
  ArrowRight,
  Badge,
  Bot,
  Link2,
  RefreshCw,
  Search,
  Server,
  X,
} from '@agenthub/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ErrorState, LoadingState } from '../../../components/Feedback';
import type { AgentCandidateRecord, AgentRecord, ExecutionTargetRecord } from '../../../lib/api';
import { api } from '../../../lib/api';
import layout from '../../shared/layout.module.css';
import styles from './AgentDirectory.module.css';
import { NavigationPageHeader, displayDate } from '../../shared/page-primitives';

import { agentKindLabel, capabilitiesFor, executionTargetKindLabel } from '../agent-presentation';

type AgentFilter = 'all' | 'ready' | 'attention';

function providerLabel(adapter: string): string {
  const normalized = adapter.replace(/^ACP[_-]?/, '').replace(/[_-]+/g, ' ');
  return normalized || '默认 Provider';
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
  const ready = agent.status === 'READY' && agent.enabled;
  const runtimeLabel = executionTargetKindLabel(target?.kind);
  const capabilities = capabilitiesFor(agent);

  return (
    <article
      className={styles.agentRow}
      role="group"
      aria-label={`${agent.name}，${agentKindLabel(agent.agentKind)}，${ready ? '已就绪' : '需要处理'}`}
    >
      <div className={styles.agentIdentity}>
        <Bot size={22} aria-hidden />
        <div>
          <h3>{agent.name}</h3>
          <p>
            {agentKindLabel(agent.agentKind)} · {agent.detectedVersion ?? '版本待检测'}
          </p>
        </div>
        <div className={styles.badges}>
          <Badge variant={ready ? 'success' : 'warning'} dot>
            {ready ? '已就绪' : '需要处理'}
          </Badge>
          <Badge variant={agent.enabled ? 'outline' : 'destructive'}>
            {agent.enabled ? '已启用' : '已停用'}
          </Badge>
        </div>
      </div>
      <dl className={styles.agentFacts}>
        <div>
          <dt>Runtime</dt>
          <dd>
            {target?.name ?? '运行环境待确认'} · {runtimeLabel}
          </dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>{providerLabel(agent.adapterKind)}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{agent.defaultModel ?? 'Session 中选择'}</dd>
        </div>
      </dl>
      <div className={styles.agentFooter}>
        <div className={styles.capabilities}>
          {!capabilities.length ? <span>能力待确认</span> : null}
          {capabilities.map((capability) => (
            <span key={capability}>{capability}</span>
          ))}
        </div>
        <span>最近检查 {displayDate(agent.lastPreflightAt)}</span>
        <Link className={styles.action} to={`/agents/${encodeURIComponent(agent.id)}`}>
          管理 Agent
        </Link>
        <Link
          className={styles.action}
          aria-description="当前 AgentHub 服务器，不是此 Agent 专属诊断"
          to="/agents/diagnostics"
        >
          服务器诊断 <ArrowRight size={13} aria-hidden />
        </Link>
        <span className="sr-only">当前状态：{statusLabel(agent.status, agent.enabled)}</span>
      </div>
    </article>
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
    <section aria-label="Agent 筛选与操作" className={styles.filterBar}>
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
            className="min-h-9 w-full text-xs max-md:min-h-11 max-md:text-sm sm:w-[170px]"
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
            <div className={styles.agentList}>
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
