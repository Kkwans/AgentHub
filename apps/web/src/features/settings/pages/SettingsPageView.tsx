import { useState } from 'react';
import {
  Button,
  CheckCircle2,
  ChevronRight,
  FormDialog,
  Field,
  FormTextField,
  KeyRound,
  Plus,
  ShieldAlert,
  SquareTerminal,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, authSession, type ApiTokenRecord } from '../../../lib/api';
import {
  ErrorState,
  formatTime,
  LoadingState,
  PageIntro,
  StatusBadge,
} from '../../../components/Common';
import type { AuthStatus } from '../../../components/AccessGate';
import { PasswordField } from '../../../components/PasswordField';
import { realtime } from '../../../lib/realtime';
import { RemoteNodesPanel } from '../../../pages/RemoteNodesPanel';

export function SettingsPage() {
  const client = useQueryClient();
  const [oneTimeToken, setOneTimeToken] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const auth = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => api.get<AuthStatus>('/auth/status'),
  });
  const capability = useQuery({
    queryKey: ['capabilities'],
    queryFn: () =>
      api.get<{
        terminal: {
          available: boolean;
          code: string;
          message: string;
          platform: string;
          arch: string;
        };
        remoteNode: { available: boolean };
      }>('/settings/capabilities'),
  });
  const tokens = useQuery({
    queryKey: ['api-tokens'],
    queryFn: () => api.get<ApiTokenRecord[]>('/auth/tokens'),
    enabled: auth.data?.localTrusted === true || auth.data?.authenticated === true,
  });
  const createToken = useMutation({
    mutationFn: (name: string) =>
      api.post<ApiTokenRecord & { token: string }>('/auth/tokens', { name }),
    onSuccess: (created) => {
      setOneTimeToken(created.token);
      setTokenDialogOpen(false);
      setTokenName('');
      void client.invalidateQueries({ queryKey: ['api-tokens'] });
    },
  });
  const revokeToken = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/tokens/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['api-tokens'] }),
  });
  const changePassword = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.put<{ user: AuthStatus['user'] }>('/auth/account/password', body),
    onSuccess: () => {
      setPasswordMessage('密码已更新，其他浏览器登录已退出。');
      setPasswordDialogOpen(false);
      void client.invalidateQueries({ queryKey: ['auth-status'] });
      realtime.reconnect();
    },
  });
  const logout = useMutation({
    mutationFn: () => api.post<{ loggedOut: boolean }>('/auth/logout'),
    onSuccess: () => {
      client.clear();
      realtime.disconnect();
      authSession.notifyAuthorizationRequired();
    },
  });
  return (
    <div className="page-stack">
      <PageIntro
        title="设置与诊断"
        description="查看服务能力、Remote Node、安全边界和高权限 Docker 风险。凭据只保存引用。"
      />
      <RemoteNodesPanel />
      <div className="settings-grid">
        <div className="settings-column">
          <section className="control-section">
            <div className="section-heading">
              <div>
                <span className="section-kicker">平台能力</span>
                <h3>Terminal</h3>
              </div>
              <SquareTerminal size={18} />
            </div>
            {capability.isLoading ? (
              <LoadingState />
            ) : capability.error ? (
              <ErrorState error={capability.error} />
            ) : (
              <div className="capability-block">
                <StatusBadge status={capability.data?.terminal.available ? 'READY' : 'MISSING'} />
                <strong>{capability.data?.terminal.message}</strong>
                <code>
                  {capability.data?.terminal.platform}/{capability.data?.terminal.arch} ·{' '}
                  {capability.data?.terminal.code}
                </code>
                <p>
                  {capability.data?.terminal.available
                    ? '当前版本只完成 Local Project Terminal 的能力诊断与安全边界；浏览器端 PTY 交互将在后续版本开放。'
                    : '当前环境缺少可加载的 node-pty native binding，Terminal 交互已明确关闭；Agent core 不受影响。'}
                </p>
              </div>
            )}
          </section>
          <section className="control-section account-panel">
            <div className="section-heading">
              <div>
                <span className="section-kicker">账号安全</span>
                <h3>{auth.data?.user?.username ?? '本机管理员'}</h3>
              </div>
              <KeyRound size={18} />
            </div>
            {auth.data?.localTrusted ? (
              <div className="capability-block">
                <strong>当前为 loopback 本地可信模式</strong>
                <p>服务没有开放到局域网，因此不要求账号登录。</p>
              </div>
            ) : (
              <>
                <div className="account-actions">
                  <Button onClick={() => setPasswordDialogOpen(true)}>修改密码</Button>
                  <Button
                    type="button"
                    color="red"
                    variant="soft"
                    disabled={logout.isPending}
                    onClick={() => logout.mutate()}
                  >
                    {logout.isPending ? '正在退出…' : '退出登录'}
                  </Button>
                </div>
                <FormDialog
                  open={passwordDialogOpen}
                  onOpenChange={(open) => {
                    setPasswordDialogOpen(open);
                    if (!open) {
                      setPasswordMessage('');
                      changePassword.reset();
                    }
                  }}
                  title="修改管理员密码"
                  description="修改成功后，其他浏览器中的登录会话会立即失效。"
                  footer={
                    <>
                      <Button
                        type="button"
                        color="gray"
                        variant="soft"
                        onClick={() => setPasswordDialogOpen(false)}
                      >
                        取消
                      </Button>
                      <Button
                        type="submit"
                        form="settings-password-form"
                        disabled={changePassword.isPending}
                        loading={changePassword.isPending}
                      >
                        更新密码
                      </Button>
                    </>
                  }
                >
                  <form
                    id="settings-password-form"
                    className="v06-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setPasswordMessage('');
                      const form = event.currentTarget;
                      const values = new FormData(form);
                      const currentPassword = String(values.get('currentPassword') ?? '');
                      const newPassword = String(values.get('newPassword') ?? '');
                      const confirmation = String(values.get('passwordConfirmation') ?? '');
                      if (newPassword !== confirmation) {
                        setPasswordMessage('两次输入的新密码不一致。');
                        return;
                      }
                      changePassword.mutate(
                        { currentPassword, newPassword },
                        { onSuccess: () => form.reset() },
                      );
                    }}
                  >
                    <Field label="当前密码" htmlFor="settings-current-password" required>
                      <PasswordField
                        id="settings-current-password"
                        required
                        minLength={6}
                        maxLength={128}
                        name="currentPassword"
                        size="3"
                        autoComplete="current-password"
                      />
                    </Field>
                    <Field label="新密码" htmlFor="settings-new-password" required>
                      <PasswordField
                        id="settings-new-password"
                        required
                        minLength={6}
                        maxLength={128}
                        name="newPassword"
                        size="3"
                        autoComplete="new-password"
                      />
                    </Field>
                    <Field label="确认新密码" htmlFor="settings-password-confirmation" required>
                      <PasswordField
                        id="settings-password-confirmation"
                        required
                        minLength={6}
                        maxLength={128}
                        name="passwordConfirmation"
                        size="3"
                        autoComplete="new-password"
                      />
                    </Field>
                    {passwordMessage ? <p className="v06-form-error">{passwordMessage}</p> : null}
                    {changePassword.error ? (
                      <p className="v06-form-error">{changePassword.error.message}</p>
                    ) : null}
                  </form>
                </FormDialog>
                {(passwordMessage || changePassword.error || logout.error) && (
                  <p
                    className={
                      changePassword.error || logout.error ? 'inline-error' : 'inline-success'
                    }
                    role="status"
                  >
                    {passwordMessage || changePassword.error?.message || logout.error?.message}
                  </p>
                )}
              </>
            )}
          </section>
        </div>
        <div className="settings-column">
          <section className="control-section auth-panel">
            <div className="section-heading">
              <div>
                <span className="section-kicker">高级功能</span>
                <h3>外部集成</h3>
              </div>
              <KeyRound size={18} />
            </div>
            <p className="section-help">
              网页登录不需要 API token。CLI、自动化脚本或外部服务需要接入时，再展开管理。
            </p>
            <details className="advanced-disclosure">
              <summary>
                <span>
                  <strong>管理 API token</strong>
                  <small>仅供 CLI 与自动化集成</small>
                </span>
                <ChevronRight aria-hidden size={16} />
              </summary>
              <div className="advanced-disclosure-body">
                <Button onClick={() => setTokenDialogOpen(true)}>
                  <Plus size={15} /> 创建 token
                </Button>
                <FormDialog
                  open={tokenDialogOpen}
                  onOpenChange={(open) => {
                    setTokenDialogOpen(open);
                    if (!open) {
                      setTokenName('');
                      createToken.reset();
                    }
                  }}
                  title="创建 API token"
                  description="token 只显示一次，仅供 CLI、自动化脚本或外部服务使用。"
                  footer={
                    <>
                      <Button
                        type="button"
                        color="gray"
                        variant="soft"
                        onClick={() => setTokenDialogOpen(false)}
                      >
                        取消
                      </Button>
                      <Button
                        type="submit"
                        form="settings-token-form"
                        disabled={createToken.isPending || !tokenName.trim()}
                        loading={createToken.isPending}
                      >
                        创建 token
                      </Button>
                    </>
                  }
                >
                  <form
                    id="settings-token-form"
                    className="v06-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      createToken.mutate(tokenName.trim());
                    }}
                  >
                    <FormTextField
                      label="token 名称"
                      id="settings-token-name"
                      value={tokenName}
                      onChange={(event) => setTokenName(event.target.value)}
                      placeholder="例如：自动化脚本"
                      required
                    />
                    {createToken.error ? (
                      <p className="v06-form-error">{createToken.error.message}</p>
                    ) : null}
                  </form>
                </FormDialog>
                {oneTimeToken && (
                  <div className="token-once">
                    <strong>只显示一次，请立即保存</strong>
                    <code>{oneTimeToken}</code>
                    <Button
                      color="gray"
                      size="1"
                      variant="soft"
                      onClick={() => setOneTimeToken('')}
                    >
                      我已保存
                    </Button>
                  </div>
                )}
                <div className="token-list">
                  {tokens.isLoading ? (
                    <p className="token-empty">正在读取外部集成…</p>
                  ) : !tokens.data?.length ? (
                    <p className="token-empty">还没有 API token。</p>
                  ) : (
                    tokens.data.map((token) => (
                      <div key={token.id}>
                        <span>
                          <strong>{token.name}</strong>
                          <small>最近使用 {formatTime(token.lastUsedAt)}</small>
                        </span>
                        <StatusBadge status={token.revokedAt ? 'CANCELED' : 'ACTIVE'} />
                        {!token.revokedAt && (
                          <Button
                            color="red"
                            size="1"
                            variant="ghost"
                            onClick={() => revokeToken.mutate(token.id)}
                          >
                            撤销
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {(tokens.error || createToken.error || revokeToken.error) && (
                  <p className="inline-error">
                    {(tokens.error ?? createToken.error ?? revokeToken.error)?.message}
                  </p>
                )}
              </div>
            </details>
          </section>
          <section className="control-section warning-surface">
            <div className="section-heading">
              <div>
                <span className="section-kicker">高权限能力</span>
                <h3>Docker 控制</h3>
              </div>
              <ShieldAlert size={18} />
            </div>
            <p>
              Docker 权限等同主机高权限。AgentHub 只允许操作显式注册且完整 container ID
              仍匹配的容器。
            </p>
            <ul>
              <li>不会修改 Compose、镜像或 volume</li>
              <li>不提供通用 Docker 命令入口</li>
              <li>活动 Session 会阻止停止容器</li>
            </ul>
          </section>
          <section className="control-section">
            <div className="section-heading">
              <div>
                <span className="section-kicker">服务模式</span>
                <h3>{auth.data?.localTrusted ? '本地可信' : '账号登录'}</h3>
              </div>
              <CheckCircle2 size={18} />
            </div>
            <div className="capability-block">
              <strong>
                {auth.data?.localTrusted ? 'loopback 默认模式' : '管理员登录保护已启用'}
              </strong>
              <p>
                网页登录使用 HttpOnly Cookie；API token 仅供外部集成，并且只以 SHA-256 hash 保存。
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
