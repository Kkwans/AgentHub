import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge, Button, Play, RefreshCw, SectionHeader, Settings } from '@agenthub/ui';

import type { AgentCandidateRecord, RuntimeCandidateRecord } from '../../../lib/api';
import { api } from '../../../lib/api';
import { labelExecutionTargetKind, labelRuntimeStatus } from '../../../presentation/domain-labels';
import { ErrorState, InlineError, LoadingState, EmptyState } from '../../../components/Common';

/**
 * Runtime discovery is a shared control-plane surface. It is intentionally
 * available from Settings → Runtime (where execution environments belong) and
 * reused by the Agent page so discovery, adopt and lifecycle behavior never diverge.
 */
export function RuntimeDiscoveryPanel() {
  const client = useQueryClient();
  const runtimes = useQuery({
    queryKey: ['discovery-runtimes'],
    queryFn: () => api.get<RuntimeCandidateRecord[]>('/discovery/runtimes'),
  });
  const agents = useQuery({
    queryKey: ['discovery-agents'],
    queryFn: () => api.get<AgentCandidateRecord[]>('/discovery/agents'),
  });
  const rescan = useMutation({
    mutationFn: () => api.post('/discovery/agents/rescan'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['discovery-runtimes'] });
      void client.invalidateQueries({ queryKey: ['discovery-agents'] });
      void client.invalidateQueries({ queryKey: ['agents'] });
      void client.invalidateQueries({ queryKey: ['targets'] });
    },
  });
  const adoptRuntime = useMutation({
    mutationFn: (candidateId: string) =>
      api.post(`/discovery/runtimes/${encodeURIComponent(candidateId)}/adopt`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['discovery-runtimes'] });
      void client.invalidateQueries({ queryKey: ['discovery-agents'] });
      void client.invalidateQueries({ queryKey: ['targets'] });
    },
  });
  const lifecycle = useMutation({
    mutationFn: ({ targetId, action }: { targetId: string; action: 'start' | 'stop' }) =>
      api.post(`/execution-targets/${targetId}/${action}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['discovery-runtimes'] });
      void client.invalidateQueries({ queryKey: ['targets'] });
    },
  });

  const visibleAgentCandidates = useMemo(
    () => (agents.data ?? []).filter((candidate) => candidate.agentKind !== 'UNKNOWN'),
    [agents.data],
  );
  const visibleRuntimeCandidates = useMemo(() => {
    const all = runtimes.data ?? [];
    if (!agents.isSuccess) {
      return all.filter((runtime) => runtime.kind === 'LOCAL_HOST' || Boolean(runtime.targetId));
    }
    const supportedRuntimeIds = new Set(
      visibleAgentCandidates.map((candidate) => candidate.targetCandidateId),
    );
    return all.filter(
      (runtime) =>
        runtime.kind === 'LOCAL_HOST' ||
        Boolean(runtime.targetId) ||
        supportedRuntimeIds.has(runtime.candidateId),
    );
  }, [agents.isSuccess, runtimes.data, visibleAgentCandidates]);
  const hiddenRuntimeCount = agents.isSuccess
    ? Math.max(0, (runtimes.data?.length ?? 0) - visibleRuntimeCandidates.length)
    : 0;
  const actionError = rescan.error ?? adoptRuntime.error ?? lifecycle.error;

  return (
    <section className="v06-panel" data-testid="runtime-discovery-panel">
      <SectionHeader
        title="运行环境"
        description="管理 AgentHub、本机与 Docker 运行环境；接入只保存身份和允许的工作区映射。"
        action={
          <Button
            variant="soft"
            color="gray"
            onClick={() => rescan.mutate()}
            disabled={rescan.isPending}
            loading={rescan.isPending}
          >
            <RefreshCw size={16} /> 重新扫描
          </Button>
        }
      />
      {actionError ? <InlineError error={actionError} /> : null}
      {hiddenRuntimeCount ? (
        <p className="v06-summary-muted">
          已隐藏 {hiddenRuntimeCount} 个未识别容器；如需接入，请先为容器配置支持的 Agent Profile。
        </p>
      ) : null}
      {runtimes.isLoading ? <LoadingState label="正在扫描运行环境" /> : null}
      {runtimes.error ? (
        <ErrorState error={runtimes.error} retry={() => void runtimes.refetch()} />
      ) : null}
      {agents.isLoading ? <LoadingState label="正在识别运行环境中的 Agent" /> : null}
      {agents.error ? (
        <ErrorState error={agents.error} retry={() => void agents.refetch()} />
      ) : null}
      {!runtimes.isLoading && !runtimes.error && !visibleRuntimeCandidates.length ? (
        <EmptyState
          title="暂时没有可管理的运行环境"
          description="重新扫描后，已接入或包含受支持 Agent 的环境会显示在这里。"
        />
      ) : null}
      <div className="v06-card-grid">
        {visibleRuntimeCandidates.map((runtime) => (
          <article className="v06-discovery-card" key={runtime.candidateId}>
            <div className="v06-discovery-card-top">
              <div className="v06-record-icon">
                <Settings size={19} />
              </div>
              <Badge
                color={
                  runtime.state === 'READY'
                    ? 'green'
                    : runtime.state === 'STOPPED'
                      ? 'orange'
                      : 'gray'
                }
              >
                {labelRuntimeStatus(runtime.state)}
              </Badge>
            </div>
            <h3>{runtime.displayName}</h3>
            <p>
              {labelExecutionTargetKind(runtime.kind)}
              {runtime.image ? ` · ${runtime.image}` : ''}
            </p>
            {runtime.statusText ? <small>{runtime.statusText}</small> : null}
            <div className="v06-discovery-card-actions">
              {!runtime.targetId && runtime.adoptable ? (
                <Button
                  size="2"
                  onClick={() => adoptRuntime.mutate(runtime.candidateId)}
                  loading={adoptRuntime.isPending}
                >
                  接入运行环境
                </Button>
              ) : null}
              {runtime.targetId && runtime.state === 'STOPPED' ? (
                <Button
                  size="2"
                  onClick={() => lifecycle.mutate({ targetId: runtime.targetId!, action: 'start' })}
                  loading={lifecycle.isPending}
                >
                  <Play size={14} /> 启动
                </Button>
              ) : null}
              {runtime.targetId &&
              runtime.state === 'READY' &&
              runtime.kind === 'DOCKER_CONTAINER' ? (
                <Button
                  size="2"
                  variant="soft"
                  color="gray"
                  onClick={() => lifecycle.mutate({ targetId: runtime.targetId!, action: 'stop' })}
                  loading={lifecycle.isPending}
                >
                  停止
                </Button>
              ) : null}
              {runtime.targetId ? <span className="v06-connected">已接入</span> : null}
            </div>
            {runtime.reasonCode ? (
              <small className="v06-card-warning">
                {labelRuntimeCandidateReason(runtime.reasonCode)}
              </small>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function labelRuntimeCandidateReason(reasonCode: string): string {
  switch (reasonCode) {
    case 'DOCKER_ENGINE_UNAVAILABLE':
      return 'Docker Engine 不可用，请检查服务权限后重新扫描。';
    case 'DOCKER_INSPECT_FAILED':
      return '无法读取 Docker 容器状态，请重新扫描；若仍失败，请检查 Docker Engine 权限。';
    default:
      return '当前运行环境需要处理，请重新扫描或查看设置中的诊断信息。';
  }
}
