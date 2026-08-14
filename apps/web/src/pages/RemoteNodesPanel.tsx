import { useEffect, useMemo, useState } from 'react';
import {
  AlertDialog,
  Button,
  Copy,
  Flex,
  Fingerprint,
  FormDialog,
  FormTextArea,
  FormTextField,
  KeyRound,
  Network,
  RefreshCw,
  Server,
  SelectField,
  ShieldAlert,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
import { labelDiscoveryStatus } from '../presentation/domain-labels';
import { realtime } from '../lib/realtime';

export function RemoteNodesPanel() {
  const client = useQueryClient();
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registration, setRegistration] = useState<RemoteNodeRegistration>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [revokeCandidate, setRevokeCandidate] = useState<RemoteNodeRecord>();
  const [copied, setCopied] = useState<'token' | 'command'>();
  const [expiresInMinutes, setExpiresInMinutes] = useState('15');
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
      setRegistrationOpen(false);
      setCopied(undefined);
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/remote-nodes/${id}/revoke`),
    onSuccess: () => {
      setSelectedNodeId(undefined);
      setRevokeCandidate(undefined);
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
        <Button
          className="remote-node-register-button"
          onClick={() => {
            setRegistrationOpen((open) => !open);
            setRegistration(undefined);
            setExpiresInMinutes('15');
          }}
        >
          <KeyRound size={15} /> 生成一次性注册码
        </Button>
      </div>

      <FormDialog
        open={registrationOpen}
        onOpenChange={(open) => {
          setRegistrationOpen(open);
          if (!open) {
            createRegistration.reset();
          }
        }}
        title="授权一台新 Node"
        description="每行一个绝对路径。只授权 Agent 实际需要访问的 Project 根目录。注册码只显示一次。"
        footer={
          <>
            <Button
              type="button"
              color="gray"
              variant="soft"
              onClick={() => setRegistrationOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="remote-node-registration-form"
              disabled={createRegistration.isPending}
              loading={createRegistration.isPending}
            >
              生成注册码
            </Button>
          </>
        }
      >
        <form
          id="remote-node-registration-form"
          className="v06-form remote-node-dialog-form"
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
              expiresInMinutes: Number(expiresInMinutes),
            });
          }}
        >
          <FormTextField
            label="Node 名称"
            id="remote-node-name"
            name="name"
            required
            maxLength={120}
            placeholder="例如 TX5Pro 开发节点"
          />
          <SelectField
            label="有效期"
            id="remote-node-expiry"
            value={expiresInMinutes}
            options={[
              { value: '5', label: '5 分钟' },
              { value: '15', label: '15 分钟' },
              { value: '60', label: '1 小时' },
            ]}
            onValueChange={setExpiresInMinutes}
          />
          <FormTextArea
            label="授权 roots"
            id="remote-node-roots"
            name="allowedRoots"
            required
            placeholder={'/srv/projects/AgentHub\n/volume2/Project/example'}
            rows={4}
            description="仅允许浏览和执行这些根目录内的 Project。"
          />
          {createRegistration.error ? (
            <p className="v06-form-error">{createRegistration.error.message}</p>
          ) : null}
        </form>
      </FormDialog>

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
            <Button
              color="gray"
              size="1"
              variant="soft"
              onClick={() => copy('token', registration.token)}
            >
              <Copy size={13} /> {copied === 'token' ? '已复制' : '复制注册码'}
            </Button>
          </div>
          <div className="remote-node-command">
            <span>在已构建 AgentHub Node 的机器上运行</span>
            <pre>{daemonCommand}</pre>
            <Button
              color="gray"
              size="1"
              variant="soft"
              onClick={() => copy('command', daemonCommand)}
            >
              <Copy size={13} /> {copied === 'command' ? '已复制' : '复制启动命令'}
            </Button>
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
                        {agent.adapterKind} ·{' '}
                        {agent.detectedVersion ?? labelDiscoveryStatus(agent.status)}
                      </small>
                      <StatusBadge status={agent.status} />
                    </span>
                  ))}
                  {!node.inventoryJson.length && <small>Node 尚未报告 Agent inventory</small>}
                </div>
                <footer>
                  <Button
                    color="gray"
                    size="1"
                    variant="soft"
                    onClick={() => {
                      setSelectedNodeId(selected ? undefined : node.id);
                      if (selected) return;
                      void client.invalidateQueries({
                        queryKey: ['remote-node-diagnostics', node.id],
                      });
                    }}
                  >
                    <RefreshCw size={13} /> {selected ? '收起诊断' : '查看诊断'}
                  </Button>
                  {node.status !== 'REVOKED' && (
                    <Button
                      color="red"
                      size="1"
                      variant="ghost"
                      disabled={revoke.isPending}
                      onClick={() => setRevokeCandidate(node)}
                    >
                      撤销设备身份
                    </Button>
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
      <AlertDialog.Root
        open={Boolean(revokeCandidate)}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setRevokeCandidate(undefined);
        }}
      >
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>撤销 Remote Node 身份</AlertDialog.Title>
          <AlertDialog.Description size="2">
            撤销 {revokeCandidate?.name} 后，该 Node 会立即断开，并且必须重新注册才能恢复连接。
          </AlertDialog.Description>
          <Flex gap="3" justify="end" mt="4">
            <AlertDialog.Cancel>
              <Button color="gray" variant="soft" disabled={revoke.isPending}>
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                disabled={revoke.isPending}
                onClick={() => revokeCandidate && revoke.mutate(revokeCandidate.id)}
              >
                {revoke.isPending ? '正在撤销' : '确认撤销'}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
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
