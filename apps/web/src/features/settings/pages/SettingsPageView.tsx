import { useState, type ReactNode } from 'react';
import {
  AhSelect,
  AhSwitch,
  ArrowRight,
  AhButton,
  CheckCircle2,
  ChevronRight,
  FormDialog,
  Field,
  FormTextField,
  KeyRound,
  Link2,
  Plus,
  ShieldAlert,
  SquareTerminal,
  Sun,
  Wrench,
  type IconProps,
  useAgentHubTheme,
} from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, useParams } from 'react-router-dom';

import { ErrorState, formatTime, LoadingState, StatusBadge } from '../../../components/Feedback';
import type { AuthStatus } from '../../../components/AccessGate';
import { PasswordField } from '../../../components/PasswordField';
import { api, authSession, type ApiTokenRecord } from '../../../lib/api';
import { realtime } from '../../../lib/realtime';
import styles from '../settings.module.css';

type SettingsSectionId =
  'appearance' | 'account' | 'security' | 'integrations' | 'system' | 'advanced';

const settingSections: Array<{
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: React.ComponentType<IconProps>;
}> = [
  { id: 'appearance', label: '外观', description: '主题、密度与动效', icon: Sun },
  { id: 'account', label: '账号', description: '账户与登录状态', icon: KeyRound },
  { id: 'security', label: '安全', description: '密码与会话保护', icon: ShieldAlert },
  { id: 'integrations', label: '集成', description: 'API token 与外部工具', icon: Link2 },
  { id: 'system', label: '系统', description: 'Terminal 与服务状态', icon: SquareTerminal },
  { id: 'advanced', label: '高级', description: '高权限能力与风险', icon: Wrench },
];

function SettingSection({
  title,
  description,
  children,
  tone,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  tone?: 'warning';
}) {
  return (
    <section className={`${styles.section} ${tone === 'warning' ? styles.warningSection : ''}`}>
      <header className={styles.sectionHeader}>
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingCopy}>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <div className={styles.settingControl}>{children}</div>
    </div>
  );
}

function SettingLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink className={styles.inlineLink ?? ''} to={to}>
      {children} <ArrowRight size={14} />
    </NavLink>
  );
}

export function SettingsPage() {
  const { section } = useParams<{ section?: string }>();
  const activeSection: SettingsSectionId = settingSections.some((item) => item.id === section)
    ? (section as SettingsSectionId)
    : 'appearance';
  const activeMeta =
    settingSections.find((item) => item.id === activeSection) ?? settingSections[0]!;
  const ActiveIcon = activeMeta.icon;
  const client = useQueryClient();
  const {
    density,
    preference,
    reducedMotion,
    setDensity,
    setPreference,
    setReducedMotion,
    setSidebarPreference,
    sidebarPreference,
  } = useAgentHubTheme();
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

  const passwordDialog = (
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
          <AhButton
            type="button"
            color="gray"
            variant="light"
            onClick={() => setPasswordDialogOpen(false)}
          >
            取消
          </AhButton>
          <AhButton
            type="submit"
            form="settings-password-form"
            disabled={changePassword.isPending}
            loading={changePassword.isPending}
          >
            更新密码
          </AhButton>
        </>
      }
    >
      <form
        id="settings-password-form"
        className={styles.form}
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
            autoComplete="new-password"
          />
        </Field>
        {passwordMessage ? <p className={styles.formError}>{passwordMessage}</p> : null}
        {changePassword.error ? (
          <p className={styles.formError}>{changePassword.error.message}</p>
        ) : null}
      </form>
    </FormDialog>
  );

  const tokenDialog = (
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
          <AhButton
            type="button"
            color="gray"
            variant="light"
            onClick={() => setTokenDialogOpen(false)}
          >
            取消
          </AhButton>
          <AhButton
            type="submit"
            form="settings-token-form"
            disabled={createToken.isPending || !tokenName.trim()}
            loading={createToken.isPending}
          >
            创建 token
          </AhButton>
        </>
      }
    >
      <form
        id="settings-token-form"
        className={styles.form}
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
        {createToken.error ? <p className={styles.formError}>{createToken.error.message}</p> : null}
      </form>
    </FormDialog>
  );

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>SETTINGS</span>
          <h1>设置</h1>
          <p>管理 AgentHub 的外观、账号、安全与集成。运行环境和远程节点请前往 Infrastructure。</p>
        </div>
        <span className={styles.sectionHint}>
          <ActiveIcon size={15} /> {activeMeta.label}
        </span>
      </header>

      <div className={styles.layout}>
        <nav className={styles.navigation} aria-label="设置分区">
          <span className={styles.navigationLabel}>设置分区</span>
          {settingSections.map(({ id, label, description, icon: Icon }) => (
            <NavLink
              key={id}
              to={`/settings/${id}`}
              className={({ isActive }) =>
                `${styles.navigationLink}${isActive ? ` ${styles.navigationLinkActive}` : ''}`
              }
            >
              <span className={styles.navigationIcon}>
                <Icon size={16} />
              </span>
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <ChevronRight className={styles.navigationArrow} size={14} />
            </NavLink>
          ))}
        </nav>

        <main className={styles.content}>
          {activeSection === 'appearance' ? (
            <>
              <SettingSection title="外观偏好" description="让工作台适应你的工作节奏。">
                <SettingRow label="主题" description="选择浅色、深色或跟随系统。">
                  <AhSelect
                    aria-label="主题"
                    label=""
                    value={preference}
                    onChange={(value) => {
                      if (value === 'light' || value === 'dark' || value === 'system')
                        setPreference(value);
                    }}
                    data={[
                      { value: 'light', label: '浅色' },
                      { value: 'dark', label: '深色' },
                      { value: 'system', label: '跟随系统' },
                    ]}
                    allowDeselect={false}
                  />
                </SettingRow>
                <SettingRow label="界面密度" description="紧凑模式减少列表间距，适合高频处理工作。">
                  <AhSelect
                    aria-label="界面密度"
                    label=""
                    value={density}
                    onChange={(value) => {
                      if (value === 'compact' || value === 'comfortable') setDensity(value);
                    }}
                    data={[
                      { value: 'comfortable', label: '舒适' },
                      { value: 'compact', label: '紧凑' },
                    ]}
                    allowDeselect={false}
                  />
                </SettingRow>
                <SettingRow label="减少动效" description="关闭过渡和动画，降低视觉干扰。">
                  <AhSwitch
                    aria-label="减少动效"
                    checked={reducedMotion}
                    onChange={(event) => setReducedMotion(event.currentTarget.checked)}
                  />
                </SettingRow>
                <SettingRow label="侧边栏" description="记住上次状态，或固定展开/折叠。">
                  <AhSelect
                    aria-label="侧边栏行为"
                    label=""
                    value={sidebarPreference}
                    onChange={(value) => {
                      if (value === 'remember' || value === 'expanded' || value === 'collapsed')
                        setSidebarPreference(value);
                    }}
                    data={[
                      { value: 'remember', label: '记住状态' },
                      { value: 'expanded', label: '始终展开' },
                      { value: 'collapsed', label: '始终折叠' },
                    ]}
                    allowDeselect={false}
                  />
                </SettingRow>
              </SettingSection>
              <SettingSection title="可访问性" description="这些偏好只保存在当前浏览器。">
                <div className={styles.infoCallout}>
                  <CheckCircle2 size={17} />
                  <p>
                    所有主要操作支持键盘焦点和屏幕阅读器标签。你也可以使用 Ctrl/⌘ B 切换侧边栏。
                  </p>
                </div>
              </SettingSection>
            </>
          ) : null}

          {activeSection === 'account' ? (
            <SettingSection title="账户" description="查看当前登录身份和会话范围。">
              {auth.isLoading ? <LoadingState label="正在读取账户状态" /> : null}
              {auth.error ? <ErrorState error={auth.error} /> : null}
              {auth.data ? (
                <>
                  <SettingRow label="当前账户" description="用于识别当前浏览器会话。">
                    <div className={styles.valueStack}>
                      <strong>{auth.data.user?.username ?? '本机管理员'}</strong>
                      <small>{auth.data.localTrusted ? '本地可信模式' : '管理员账户'}</small>
                    </div>
                  </SettingRow>
                  <SettingRow label="登录范围" description="本地可信模式只允许 loopback 访问。">
                    <StatusBadge status={auth.data.localTrusted ? 'AVAILABLE' : 'ACTIVE'} />
                  </SettingRow>
                  <SettingRow label="安全设置" description="修改密码和管理当前登录会话。">
                    <SettingLink to="/settings/security">前往安全设置</SettingLink>
                  </SettingRow>
                </>
              ) : null}
            </SettingSection>
          ) : null}

          {activeSection === 'security' ? (
            <>
              <SettingSection title="登录安全" description="保护管理员账户和浏览器会话。">
                <SettingRow label="管理员密码" description="修改后，其他浏览器登录会话会立即失效。">
                  <AhButton onClick={() => setPasswordDialogOpen(true)}>修改密码</AhButton>
                </SettingRow>
                <SettingRow label="当前会话" description="结束此浏览器的登录状态。">
                  <AhButton
                    type="button"
                    color="red"
                    variant="light"
                    disabled={logout.isPending || auth.data?.localTrusted === true}
                    onClick={() => logout.mutate()}
                  >
                    {logout.isPending ? '正在退出…' : '退出登录'}
                  </AhButton>
                </SettingRow>
                {(passwordMessage || changePassword.error || logout.error) && (
                  <p
                    className={
                      changePassword.error || logout.error
                        ? styles.inlineError
                        : styles.inlineSuccess
                    }
                    role="status"
                  >
                    {passwordMessage || changePassword.error?.message || logout.error?.message}
                  </p>
                )}
              </SettingSection>
              <SettingSection title="会话策略" description="登录凭据由服务端安全管理。">
                <div className={styles.infoCallout}>
                  <ShieldAlert size={17} />
                  <p>
                    网页登录使用 HttpOnly Cookie；API token 只保存 SHA-256
                    hash，无法从服务端反向读取。
                  </p>
                </div>
              </SettingSection>
              {passwordDialog}
            </>
          ) : null}

          {activeSection === 'integrations' ? (
            <SettingSection
              title="外部集成"
              description="CLI、自动化脚本或外部服务可以使用 API token。"
            >
              <div className={styles.integrationIntro}>
                <div>
                  <strong>API token</strong>
                  <p>token 只显示一次；网页登录不需要 token。</p>
                </div>
                <AhButton onClick={() => setTokenDialogOpen(true)}>
                  <Plus size={15} /> 创建 token
                </AhButton>
              </div>
              {oneTimeToken ? (
                <div className={styles.tokenOnce}>
                  <div>
                    <strong>只显示一次，请立即保存</strong>
                    <code>{oneTimeToken}</code>
                  </div>
                  <AhButton
                    color="gray"
                    size="xs"
                    variant="light"
                    onClick={() => setOneTimeToken('')}
                  >
                    我已保存
                  </AhButton>
                </div>
              ) : null}
              <div className={styles.tokenList}>
                {tokens.isLoading ? <p className={styles.muted}>正在读取 token…</p> : null}
                {!tokens.isLoading && !tokens.data?.length ? (
                  <p className={styles.muted}>还没有 API token。</p>
                ) : null}
                {tokens.data?.map((token) => (
                  <div className={styles.tokenRow} key={token.id}>
                    <span className={styles.valueStack}>
                      <strong>{token.name}</strong>
                      <small>最近使用 {formatTime(token.lastUsedAt)}</small>
                    </span>
                    <StatusBadge status={token.revokedAt ? 'CANCELED' : 'ACTIVE'} />
                    {!token.revokedAt ? (
                      <AhButton
                        color="red"
                        size="xs"
                        variant="subtle"
                        onClick={() => revokeToken.mutate(token.id)}
                      >
                        撤销
                      </AhButton>
                    ) : null}
                  </div>
                ))}
              </div>
              {tokens.error || createToken.error || revokeToken.error ? (
                <p className={styles.inlineError} role="alert">
                  {(tokens.error ?? createToken.error ?? revokeToken.error)?.message}
                </p>
              ) : null}
              {tokenDialog}
            </SettingSection>
          ) : null}

          {activeSection === 'system' ? (
            <>
              <SettingSection
                title="Terminal"
                description="Workspace 使用真实 PTY；不可用时会明确显示原因。"
              >
                {capability.isLoading ? <LoadingState label="正在读取 Terminal 状态" /> : null}
                {capability.error ? <ErrorState error={capability.error} /> : null}
                {capability.data ? (
                  <>
                    <SettingRow label="可用性" description={capability.data.terminal.message}>
                      <StatusBadge
                        status={capability.data.terminal.available ? 'READY' : 'MISSING'}
                      />
                    </SettingRow>
                    <SettingRow label="运行平台" description="由当前服务运行环境提供。">
                      <code className={styles.mono}>
                        {capability.data.terminal.platform}/{capability.data.terminal.arch}
                      </code>
                    </SettingRow>
                  </>
                ) : null}
              </SettingSection>
              <SettingSection
                title="Infrastructure"
                description="运行环境和远程节点使用独立的诊断页面。"
              >
                <SettingRow label="运行环境" description="查看 Local、Docker 与远程执行环境。">
                  <SettingLink to="/agents/runtime">打开运行环境</SettingLink>
                </SettingRow>
                <SettingRow label="远程节点" description="连接和管理远程 Agent 节点。">
                  <SettingLink to="/agents/nodes">打开远程节点</SettingLink>
                </SettingRow>
              </SettingSection>
            </>
          ) : null}

          {activeSection === 'advanced' ? (
            <>
              <SettingSection
                title="高权限能力"
                description="仅在明确注册并匹配身份后允许操作。"
                tone="warning"
              >
                <div className={styles.warningCopy}>
                  <ShieldAlert size={18} />
                  <div>
                    <strong>Docker 控制</strong>
                    <p>
                      Docker 权限等同主机高权限。AgentHub 只允许操作显式注册且完整 container ID
                      仍匹配的容器。
                    </p>
                  </div>
                </div>
                <ul className={styles.riskList}>
                  <li>不会修改 Compose、镜像或 volume。</li>
                  <li>不提供通用 Docker 命令入口。</li>
                  <li>活动 Session 会阻止停止容器。</li>
                </ul>
              </SettingSection>
              <SettingSection
                title="Danger Zone"
                description="需要明确确认的账户操作。"
                tone="warning"
              >
                <SettingRow label="退出当前账户" description="清除此浏览器的登录状态。">
                  <AhButton
                    type="button"
                    color="red"
                    variant="light"
                    disabled={logout.isPending || auth.data?.localTrusted === true}
                    onClick={() => logout.mutate()}
                  >
                    {logout.isPending ? '正在退出…' : '退出登录'}
                  </AhButton>
                </SettingRow>
              </SettingSection>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
