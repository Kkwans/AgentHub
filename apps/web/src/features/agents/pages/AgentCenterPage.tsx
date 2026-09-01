import {
  AhButton,
  AhEmptyState,
  AhInput,
  AhSelect,
  AhStatusPill,
  AhSurface,
  ArrowRight,
  Bot,
  Link2,
  RefreshCw,
  Search,
  Server,
} from '@agenthub/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ErrorState, LoadingState } from '../../../components/Common';
import type { AgentCandidateRecord, AgentRecord, ExecutionTargetRecord } from '../../../lib/api';
import { api } from '../../../lib/api';
import layout from '../../shared/layout.module.css';
import { Screen, displayDate } from '../../shared/page-primitives';
import styles from '../agentCenter.module.css';

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
  const [filter, setFilter] = useState('all');
  const filteredAgents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (agents.data ?? []).filter((agent) => {
      const matchesQuery =
        !normalized ||
        `${agent.name} ${agent.agentKind} ${agent.adapterKind} ${agent.detectedVersion ?? ''}`
          .toLowerCase()
          .includes(normalized);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'ready' && agent.status === 'READY') ||
        (filter === 'attention' && agent.status !== 'READY');
      return matchesQuery && matchesFilter;
    });
  }, [agents.data, filter, query]);
  const targetById = useMemo(
    () => new Map((targets.data ?? []).map((target) => [target.id, target])),
    [targets.data],
  );
  const agentKindLabel = (kind: string) =>
    ({ CODEX: 'Codex', CLAUDE_CODE: 'Claude Code', OPENCLAW: 'OpenClaw' })[kind] ?? 'Agent';
  const providerLabel = (adapter: string) => {
    const normalized = adapter.replace(/^ACP[_-]?/, '').replace(/[_-]+/g, ' ');
    return normalized || '默认 Provider';
  };
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
  const readyCount = agents.data?.filter((agent) => agent.status === 'READY').length ?? 0;
  const attentionCount = (candidates.data ?? []).filter(
    (candidate) => candidate.state !== 'READY',
  ).length;
  return (
    <Screen
      eyebrow="AGENTS"
      title="Agent 中心"
      description="发现和管理可用于 Project Work 的 Agent 身份。运行环境与远程节点诊断在 Infrastructure 中单独展示。"
      actions={
        <Link to="/agents/agents/discover">
          <AhButton leftSection={<RefreshCw size={16} />}>发现 Agent</AhButton>
        </Link>
      }
    >
      <div className={styles.summary} aria-label="Agent 摘要">
        <div>
          <span>已就绪</span>
          <strong>{agents.isLoading ? '—' : readyCount}</strong>
          <small>可以开始工作</small>
        </div>
        <div>
          <span>需要处理</span>
          <strong>{candidates.isLoading ? '—' : attentionCount}</strong>
          <small>发现结果与授权</small>
        </div>
        <div>
          <span>Agent 总数</span>
          <strong>{agents.isLoading ? '—' : (agents.data?.length ?? 0)}</strong>
          <small>已接入身份</small>
        </div>
      </div>
      <AhSurface className={styles.surface}>
        <div className={styles.toolbar} aria-label="Agent 筛选">
          <AhInput
            label=""
            aria-label="搜索 Agent"
            placeholder="搜索名称、类型或版本"
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
              { value: 'all', label: '全部状态' },
              { value: 'ready', label: '已就绪' },
              { value: 'attention', label: '需要处理' },
            ]}
          />
        </div>
        <div className={styles.listHeader} aria-hidden="true">
          <span>Agent</span>
          <span>Runtime / Provider</span>
          <span>模型摘要</span>
          <span>最近检查</span>
          <span>状态</span>
          <span>操作</span>
        </div>
        {agents.isLoading ? <LoadingState label="正在加载 Agent" /> : null}
        {agents.error ? <ErrorState error={agents.error} /> : null}
        {!agents.isLoading && !agents.error && filteredAgents.length ? (
          <div className={styles.list}>
            {filteredAgents.map((agent) => {
              const target = targetById.get(agent.targetId);
              const ready = agent.status === 'READY' && agent.enabled;
              return (
                <article className={styles.row} key={agent.id}>
                  <div className={styles.identity}>
                    <span className={styles.mark} aria-hidden="true">
                      <Bot size={18} />
                    </span>
                    <span className={styles.identityCopy}>
                      <strong>{agent.name}</strong>
                      <small>
                        {agentKindLabel(agent.agentKind)} · {agent.detectedVersion ?? '版本待检测'}
                      </small>
                    </span>
                  </div>
                  <div className={styles.cellStack}>
                    <strong>{target?.name ?? '运行环境待确认'}</strong>
                    <small>
                      {target?.kind === 'DOCKER_CONTAINER' ? 'Docker' : 'Local'} ·{' '}
                      {providerLabel(agent.adapterKind)}
                    </small>
                  </div>
                  <div className={styles.cellStack}>
                    <strong>{agent.defaultModel ?? 'Session 中选择'}</strong>
                    <small>{capabilitiesFor(agent).join(' · ')}</small>
                  </div>
                  <div className={styles.cellStack}>
                    <strong>{displayDate(agent.lastPreflightAt)}</strong>
                    <small>{agent.lastPreflightAt ? '最近预检' : '尚未预检'}</small>
                  </div>
                  <span className={styles.statusCell}>
                    <span className={`${styles.statusDot} ${ready ? styles.statusReady : ''}`} />
                    <AhStatusPill status={ready ? 'READY' : agent.status} />
                  </span>
                  <Link className={styles.action} to="/agents/diagnostics">
                    查看状态 <ArrowRight size={13} />
                  </Link>
                </article>
              );
            })}
          </div>
        ) : null}
        {!agents.isLoading && !agents.error && !filteredAgents.length ? (
          <AhEmptyState
            title={query || filter !== 'all' ? '没有匹配的 Agent' : '还没有接入 Agent'}
            description="从发现流程接入可用 Agent；原始运行时细节会在 Infrastructure 中展开。"
            action={
              <Link to="/agents/agents/discover">
                <AhButton>开始发现</AhButton>
              </Link>
            }
          />
        ) : null}
        <div className={styles.surfaceFooter}>
          <span>
            <Server size={14} /> Runtime 与 Remote Node 诊断已独立
          </span>
          <Link className={layout.link} to="/agents/runtime">
            打开 Infrastructure <Link2 size={13} />
          </Link>
        </div>
      </AhSurface>
    </Screen>
  );
}
