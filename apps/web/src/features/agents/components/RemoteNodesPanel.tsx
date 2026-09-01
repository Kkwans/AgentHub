import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  AhButton,
  Copy,
  ConfirmDialog,
  Fingerprint,
  FormDialog,
  FormTextField,
  KeyRound,
  Network,
  Plus,
  RefreshCw,
  Server,
  SelectField,
  ShieldAlert,
  X,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  EmptyState,
  ErrorState,
  formatTime,
  LoadingState,
  StatusBadge,
} from '../../../components/Feedback';
import {
  api,
  type RemoteNodeDiagnostics,
  type RemoteNodeRecord,
  type RemoteNodeRegistration,
} from '../../../lib/api';
import { labelDiscoveryStatus } from '../../../presentation/domain-labels';
import { realtime } from '../../../lib/realtime';

export function RemoteNodesPanel() {
  const client = useQueryClient();
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registration, setRegistration] = useState<RemoteNodeRegistration>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [revokeCandidate, setRevokeCandidate] = useState<RemoteNodeRecord>();
  const [copied, setCopied] = useState<'token' | 'command'>();
  const [expiresInMinutes, setExpiresInMinutes] = useState('15');
  const [allowedRoots, setAllowedRoots] = useState<string[]>([]);
  const [rootDraft, setRootDraft] = useState('');
  const [rootError, setRootError] = useState('');
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
    <section className="panel-section remote-node-section">
      <div className="section-heading remote-node-heading">
        <div>
          <span className="section-kicker">远程连接</span>
          <h3>Remote Node</h3>
          <p>
            Remote Node 会主动连接 AgentHub；Central Server 不使用 SSH，也不接收 Agent 登录凭据。
          </p>
        </div>
        <AhButton
          className="remote-node-register-button"
          onClick={() => {
            setRegistrationOpen((open) => !open);
            setRegistration(undefined);
            setExpiresInMinutes('15');
            setAllowedRoots([]);
            setRootDraft('');
            setRootError('');
          }}
        >
          <KeyRound size={15} /> 生成一次性注册码
        </AhButton>
      </div>

      <FormDialog
        open={registrationOpen}
        onOpenChange={(open) => {
          setRegistrationOpen(open);
          if (!open) {
            createRegistration.reset();
            setAllowedRoots([]);
            setRootDraft('');
            setRootError('');
          }
        }}
        title="授权一台新 Node"
        description="先添加目标 Node 上的项目目录，再生成一次性注册码。只授权 Agent 实际需要访问的目录。"
        footer={
          <>
            <AhButton
              type="button"
              color="gray"
              variant="light"
              onClick={() => setRegistrationOpen(false)}
            >
              取消
            </AhButton>
            <AhButton
              type="submit"
              form="remote-node-registration-form"
              disabled={createRegistration.isPending}
              loading={createRegistration.isPending}
            >
              生成注册码
            </AhButton>
          </>
        }
      >
        <form
          id="remote-node-registration-form"
          className="remote-node-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            if (!allowedRoots.length) {
              setRootError('至少添加一个授权目录。');
              return;
            }
            createRegistration.mutate({
              name: String(values.get('name') ?? '').trim(),
              allowedRoots,
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
            placeholder="例如：开发节点"
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
          <div className="remote-node-roots-editor">
            <FormTextField
              label="授权目录"
              id="remote-node-root-draft"
              value={rootDraft}
              placeholder="例如 /srv/projects/AgentHub"
              description="输入目标 Node 上的绝对目录，按“添加目录”加入授权清单。"
              {...(rootError ? { error: rootError } : {})}
              onChange={(event) => {
                setRootDraft(event.target.value);
                if (rootError) setRootError('');
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                addAllowedRoot(
                  rootDraft,
                  allowedRoots,
                  setAllowedRoots,
                  setRootDraft,
                  setRootError,
                );
              }}
            />
            <AhButton
              type="button"
              color="gray"
              variant="light"
              onClick={() =>
                addAllowedRoot(rootDraft, allowedRoots, setAllowedRoots, setRootDraft, setRootError)
              }
            >
              <Plus size={14} /> 添加目录
            </AhButton>
            {allowedRoots.length ? (
              <div className="remote-node-root-chips" aria-label="已添加的授权目录">
                {allowedRoots.map((root) => (
                  <span className="remote-node-root-chip" key={root}>
                    <code title={root}>{root}</code>
                    <button
                      type="button"
                      className="remote-node-root-remove"
                      aria-label={`移除授权目录 ${root}`}
                      onClick={() => {
                        setAllowedRoots((current) => current.filter((item) => item !== root));
                        setRootError('');
                      }}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="remote-node-root-empty">尚未添加目录，注册码不会授权任何文件。</p>
            )}
          </div>
          {createRegistration.error ? (
            <p className="form-error">{createRegistration.error.message}</p>
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
            <AhButton
              color="gray"
              size="xs"
              variant="light"
              onClick={() => copy('token', registration.token)}
            >
              <Copy size={13} /> {copied === 'token' ? '已复制' : '复制注册码'}
            </AhButton>
          </div>
          <div className="remote-node-command">
            <span>在已构建 AgentHub Node 的机器上运行</span>
            <pre>{daemonCommand}</pre>
            <AhButton
              color="gray"
              size="xs"
              variant="light"
              onClick={() => copy('command', daemonCommand)}
            >
              <Copy size={13} /> {copied === 'command' ? '已复制' : '复制启动命令'}
            </AhButton>
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
                <div className="remote-node-roots-list" aria-label="授权目录">
                  {node.allowedRootsJson.map((root) => (
                    <code key={root}>{root}</code>
                  ))}
                </div>
                <div className="remote-node-inventory">
                  {node.inventoryJson.map((agent) => (
                    <span key={agent.key}>
                      <strong>{agent.name}</strong>
                      <small>{agent.detectedVersion ?? labelDiscoveryStatus(agent.status)}</small>
                      <StatusBadge status={agent.status} />
                    </span>
                  ))}
                  {!node.inventoryJson.length && <small>Node 尚未报告 Agent inventory</small>}
                </div>
                <footer>
                  <AhButton
                    color="gray"
                    size="xs"
                    variant="light"
                    onClick={() => {
                      setSelectedNodeId(selected ? undefined : node.id);
                      if (selected) return;
                      void client.invalidateQueries({
                        queryKey: ['remote-node-diagnostics', node.id],
                      });
                    }}
                  >
                    <RefreshCw size={13} /> {selected ? '收起诊断' : '查看诊断'}
                  </AhButton>
                  {node.status !== 'REVOKED' && (
                    <AhButton
                      color="red"
                      size="xs"
                      variant="subtle"
                      disabled={revoke.isPending}
                      onClick={() => setRevokeCandidate(node)}
                    >
                      撤销设备身份
                    </AhButton>
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
      <ConfirmDialog
        open={Boolean(revokeCandidate)}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setRevokeCandidate(undefined);
        }}
        title="撤销 Remote Node 身份"
        description={`撤销 ${revokeCandidate?.name ?? '该 Node'} 后，该 Node 会立即断开，并且必须重新注册才能恢复连接。`}
        confirmLabel="确认撤销"
        cancelLabel="取消"
        destructive
        pending={revoke.isPending}
        onConfirm={() => {
          if (revokeCandidate) revoke.mutate(revokeCandidate.id);
        }}
      />
    </section>
  );
}

function addAllowedRoot(
  draft: string,
  current: string[],
  setRoots: Dispatch<SetStateAction<string[]>>,
  setDraft: Dispatch<SetStateAction<string>>,
  setError: Dispatch<SetStateAction<string>>,
): void {
  const root = draft.trim();
  if (!root) {
    setError('请输入要授权的目录。');
    return;
  }
  if (!isAbsoluteNodePath(root)) {
    setError('请输入目标 Node 上的绝对目录，例如 /srv/projects/AgentHub。');
    return;
  }
  if (current.includes(root)) {
    setError('这个目录已经添加。');
    return;
  }
  if (current.length >= 32) {
    setError('最多添加 32 个授权目录。');
    return;
  }
  setRoots((items) => [...items, root]);
  setDraft('');
  setError('');
}

function isAbsoluteNodePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
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
