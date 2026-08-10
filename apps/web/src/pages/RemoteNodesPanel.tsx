import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Fingerprint, KeyRound, Network, RefreshCw, Server, ShieldAlert } from 'lucide-react';

import {
  EmptyState,
  ErrorState,
  formatTime,
  LoadingState,
  StatusBadge,
} from '../components/Common';
import {
  api,
  type RemoteNodeDiagnostics,
  type RemoteNodeRecord,
  type RemoteNodeRegistration,
} from '../lib/api';
import { realtime } from '../lib/realtime';

export function RemoteNodesPanel() {
  const client = useQueryClient();
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registration, setRegistration] = useState<RemoteNodeRegistration>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [copied, setCopied] = useState<'token' | 'command'>();
  const nodes = useQuery({
    queryKey: ['remote-nodes'],
    queryFn: () => api.get<RemoteNodeRecord[]>('/remote-nodes'),
  });
  const diagnostics = useQuery({
    queryKey: ['remote-node-diagnostics', selectedNodeId],
    queryFn: () => api.get<RemoteNodeDiagnostics>(`/remote-nodes/${selectedNodeId}/diagnostics`),
    enabled: Boolean(selectedNodeId),
  });
  const createRegistration = useMutation({
    mutationFn: (body: { name: string; allowedRoots: string[]; expiresInMinutes: number }) =>
      api.post<RemoteNodeRegistration>('/remote-nodes/registration-tokens', body),
    onSuccess: (created) => {
      setRegistration(created);
      setCopied(undefined);
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/remote-nodes/${id}/revoke`),
    onSuccess: () => {
      setSelectedNodeId(undefined);
      void client.invalidateQueries({ queryKey: ['remote-nodes'] });
      void client.invalidateQueries({ queryKey: ['targets'] });
    },
  });

  useEffect(
    () =>
      realtime.subscribe('remote-nodes', () => {
        void client.invalidateQueries({ queryKey: ['remote-nodes'] });
        void client.invalidateQueries({ queryKey: ['targets'] });
        if (selectedNodeId) {
          void client.invalidateQueries({
            queryKey: ['remote-node-diagnostics', selectedNodeId],
          });
        }
      }),
    [client, selectedNodeId],
  );

  const daemonCommand = useMemo(
    () => (registration ? buildDaemonCommand(registration) : ''),
    [registration],
  );
  const copy = async (kind: 'token' | 'command', value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(undefined), 2_000);
  };
  const failure = nodes.error ?? createRegistration.error ?? revoke.error ?? diagnostics.error;

  return (
    <section className="control-section remote-node-section">
      <div className="section-heading remote-node-heading">
        <div>
          <span className="section-kicker">Outbound control plane</span>
          <h3>Remote Node</h3>
          <p>Node 主动连接 AgentHub；Central Server 不使用 SSH，也不接收 Agent 登录凭据。</p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setRegistrationOpen((open) => !open);
            setRegistration(undefined);
          }}
        >
          <KeyRound size={15} /> 生成一次性注册码
        </button>
      </div>

      {registrationOpen && (
        <form
          className="remote-node-registration"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const allowedRoots = String(values.get('allowedRoots') ?? '')
              .split(/\r?\n/)
              .map((root) => root.trim())
              .filter(Boolean);
            createRegistration.mutate({
              name: String(values.get('name') ?? '').trim(),
              allowedRoots: [...new Set(allowedRoots)],
              expiresInMinutes: Number(values.get('expiresInMinutes') ?? 15),
            });
          }}
        >
          <div className="remote-node-form-copy">
            <strong>授权一台新 Node</strong>
            <span>每行一个绝对路径。请只授权 Agent 实际需要访问的 Project 根目录。</span>
          </div>
          <label>
            Node 名称
            <input required maxLength={120} name="name" placeholder="例如 TX5Pro 开发节点" />
          </label>
          <label>
            有效期
            <select defaultValue="15" name="expiresInMinutes">
              <option value="5">5 分钟</option>
              <option value="15">15 分钟</option>
              <option value="60">1 小时</option>
            </select>
          </label>
          <label className="remote-node-roots">
            授权 roots
            <textarea
              required
              name="allowedRoots"
              placeholder={'/srv/projects/AgentHub\n/volume2/Project/example'}
              rows={3}
            />
          </label>
          <div className="form-footer remote-node-form-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setRegistrationOpen(false)}
            >
              取消
            </button>
            <button className="button primary" disabled={createRegistration.isPending}>
              {createRegistration.isPending ? '正在生成' : '生成注册码'}
            </button>
          </div>
        </form>
      )}

      {registration && (
        <div className="remote-node-secret" role="status">
          <div className="remote-node-secret-warning">
            <ShieldAlert size={18} />
            <div>
              <strong>注册码只显示这一次</strong>
              <span>
                将它安全地传给目标 Node。有效期至 {formatTime(registration.expiresAt)}
                ，成功注册后立即失效。
              </span>
            </div>
          </div>
          <div className="remote-node-copy-row">
            <code aria-label="一次性注册码">{registration.token}</code>
            <button
              className="button secondary compact"
              onClick={() => copy('token', registration.token)}
            >
              <Copy size={13} /> {copied === 'token' ? '已复制' : '复制注册码'}
            </button>
          </div>
          <div className="remote-node-command">
            <span>在已构建 AgentHub Node 的机器上运行</span>
            <pre>{daemonCommand}</pre>
            <button
              className="button secondary compact"
              onClick={() => copy('command', daemonCommand)}
            >
              <Copy size={13} /> {copied === 'command' ? '已复制' : '复制启动命令'}
            </button>
          </div>
        </div>
      )}

      {nodes.isLoading ? (
        <LoadingState label="正在读取 Remote Node 状态" />
      ) : nodes.error ? (
        <ErrorState error={nodes.error} retry={() => void nodes.refetch()} />
      ) : !nodes.data?.length ? (
        <EmptyState
          title="还没有 Remote Node"
          description="生成一次性注册码，并在远端设备启动 outbound daemon。"
        />
      ) : (
        <div className="remote-node-list">
          {nodes.data.map((node) => {
            const selected = selectedNodeId === node.id;
            return (
              <article className="remote-node-card" key={node.id}>
                <header>
                  <span className="remote-node-icon">
                    <Server size={18} />
                  </span>
                  <div>
                    <strong>{node.name}</strong>
                    <span>
                      {node.hostname} · {node.os}/{node.arch}
                    </span>
                  </div>
                  <StatusBadge status={node.status} />
                </header>
                <div className="remote-node-facts">
                  <span>
                    <Network size={13} /> {node.protocolVersion}
                  </span>
                  <span>daemon {node.daemonVersion}</span>
                  <span>最后在线 {formatTime(node.lastSeenAt)}</span>
                </div>
                <div className="remote-node-fingerprint">
                  <Fingerprint size={14} />
                  <code title={node.fingerprint}>{node.fingerprint}</code>
                </div>
                <div className="remote-node-roots-list" aria-label="授权 roots">
                  {node.allowedRootsJson.map((root) => (
                    <code key={root}>{root}</code>
                  ))}
                </div>
                <div className="remote-node-inventory">
                  {node.inventoryJson.map((agent) => (
                    <span key={agent.key}>
                      <strong>{agent.name}</strong>
                      <small>
                        {agent.adapterKind} · {agent.detectedVersion ?? agent.status}
                      </small>
                      <StatusBadge status={agent.status} />
                    </span>
                  ))}
                  {!node.inventoryJson.length && <small>Node 尚未报告 Agent inventory</small>}
                </div>
                <footer>
                  <button
                    className="button secondary compact"
                    onClick={() => {
                      setSelectedNodeId(selected ? undefined : node.id);
                      if (selected) return;
                      void client.invalidateQueries({
                        queryKey: ['remote-node-diagnostics', node.id],
                      });
                    }}
                  >
                    <RefreshCw size={13} /> {selected ? '收起诊断' : '查看诊断'}
                  </button>
                  {node.status !== 'REVOKED' && (
                    <button
                      className="button ghost danger compact"
                      disabled={revoke.isPending}
                      onClick={() => {
                        if (window.confirm(`撤销 ${node.name} 的设备身份？撤销后必须重新注册。`)) {
                          revoke.mutate(node.id);
                        }
                      }}
                    >
                      撤销设备身份
                    </button>
                  )}
                </footer>
                {selected && (
                  <RemoteNodeDiagnosticsView
                    diagnostics={diagnostics.data}
                    loading={diagnostics.isLoading || diagnostics.isFetching}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
      {failure && !nodes.error && <p className="inline-error">{failure.message}</p>}
    </section>
  );
}

function RemoteNodeDiagnosticsView({
  diagnostics,
  loading,
}: {
  diagnostics: RemoteNodeDiagnostics | undefined;
  loading: boolean;
}) {
  if (loading) return <LoadingState label="正在刷新 Node 诊断" />;
  if (!diagnostics) return null;
  return (
    <div className="remote-node-diagnostics">
      <div>
        <span>Gateway 连接</span>
        <strong>{diagnostics.connected ? '已建立' : '未连接'}</strong>
      </div>
      <div>
        <span>设备状态</span>
        <strong>
          {diagnostics.status === 'ONLINE'
            ? '在线'
            : diagnostics.status === 'OFFLINE'
              ? '离线'
              : '已撤销'}
        </strong>
      </div>
      <div>
        <span>最近心跳</span>
        <strong>{formatTime(diagnostics.lastSeenAt)}</strong>
      </div>
      <p>身份校验使用 Ed25519；Central Server 只下发固定 allow-list RPC。</p>
    </div>
  );
}

function buildDaemonCommand(registration: RemoteNodeRegistration): string {
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const protocol = window.location.protocol === 'https:' || !loopback ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/node/ws`;
  const roots = shellSingleQuote(JSON.stringify(registration.allowedRoots));
  return [
    `AGENTHUB_NODE_SERVER_URL=${shellSingleQuote(url)} \\`,
    `AGENTHUB_NODE_REGISTRATION_TOKEN=${shellSingleQuote(registration.token)} \\`,
    `AGENTHUB_NODE_ROOTS_JSON=${roots} \\`,
    `AGENTHUB_NODE_NAME=${shellSingleQuote(registration.name)} \\`,
    'corepack pnpm --filter @agenthub/node start',
  ].join('\n');
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
