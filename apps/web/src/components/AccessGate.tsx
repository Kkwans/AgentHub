import { type FormEvent, type PropsWithChildren, useEffect, useState } from 'react';
import { AlertTriangle, Button, KeyRound, ShieldCheck, TextField } from '@agenthub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api, authSession } from '../lib/api';
import { realtime } from '../lib/realtime';

export type AuthStatus = {
  mode: 'local_trusted' | 'token';
  localTrusted: boolean;
  setupRequired: boolean;
  authenticated: boolean;
  user: { id: string; username: string; role: 'ADMIN' } | null;
};

export function AccessGate({ children }: PropsWithChildren) {
  const client = useQueryClient();
  const [authorizationRequired, setAuthorizationRequired] = useState(false);
  const auth = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => api.get<AuthStatus>('/auth/status'),
    retry: false,
    staleTime: 30_000,
  });
  const authenticate = useMutation({
    mutationFn: (input: { mode: 'setup' | 'login'; username: string; password: string }) =>
      api.post<{ user: AuthStatus['user'] }>(`/auth/${input.mode}`, {
        username: input.username,
        password: input.password,
      }),
    onSuccess: async () => {
      setAuthorizationRequired(false);
      await client.invalidateQueries();
      realtime.reconnect();
    },
    onError: async (error, input) => {
      if (
        error instanceof ApiError &&
        ((input.mode === 'setup' && error.code === 'AUTH_SETUP_COMPLETED') ||
          (input.mode === 'login' && error.code === 'AUTH_SETUP_REQUIRED'))
      ) {
        await client.invalidateQueries({ queryKey: ['auth-status'] });
      }
    },
  });

  useEffect(
    () =>
      authSession.onAuthorizationRequired(() => {
        setAuthorizationRequired(true);
        realtime.disconnect();
        void client.invalidateQueries({ queryKey: ['auth-status'] });
      }),
    [client],
  );

  if (auth.isLoading) return <AccessLoading />;
  if (auth.error) {
    return (
      <AccessPrompt
        mode="unavailable"
        error="无法读取服务认证状态。请确认 AgentHub 正在运行并检查网络连接。"
        onRetry={() => void auth.refetch()}
      />
    );
  }
  if (
    auth.data?.mode === 'local_trusted' ||
    (auth.data?.mode === 'token' && auth.data.authenticated && !authorizationRequired)
  ) {
    return children;
  }

  if (auth.data?.mode !== 'token') {
    return (
      <AccessPrompt
        mode="unavailable"
        error="服务返回了无法识别的认证状态。请检查版本是否匹配。"
        onRetry={() => void auth.refetch()}
      />
    );
  }

  const mode = auth.data?.setupRequired ? 'setup' : 'login';
  const promptError =
    authenticate.error instanceof ApiError
      ? authenticate.error.message
      : authenticate.error
        ? '登录请求失败。请检查网络后重试。'
        : authorizationRequired
          ? '登录已失效，请重新登录。'
          : undefined;
  return (
    <AccessPrompt
      mode={mode}
      busy={authenticate.isPending}
      {...(promptError ? { error: promptError } : {})}
      onSubmit={(username, password) => authenticate.mutate({ mode, username, password })}
    />
  );
}

function AccessLoading() {
  return (
    <main className="access-gate" aria-busy="true" aria-label="正在连接 AgentHub">
      <section className="access-card access-card-loading" role="status" aria-live="polite">
        <div className="access-brand" aria-hidden>
          <span>A</span>
          <strong>AgentHub</strong>
        </div>
        <div className="access-loading-copy">
          <span className="access-loading-icon" />
          <span className="access-loading-line wide" />
          <span className="access-loading-line" />
        </div>
        <span className="visually-hidden">正在读取服务认证状态…</span>
      </section>
    </main>
  );
}

function AccessPrompt({
  mode,
  busy = false,
  error,
  onRetry,
  onSubmit,
}: {
  mode: 'setup' | 'login' | 'unavailable';
  busy?: boolean;
  error?: string;
  onRetry?: () => void;
  onSubmit?: (username: string, password: string) => void;
}) {
  const [formError, setFormError] = useState<string>();
  const unavailable = mode === 'unavailable';
  const setup = mode === 'setup';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const username = String(values.get('username') ?? '').trim();
    const password = String(values.get('password') ?? '');
    const confirmation = String(values.get('passwordConfirmation') ?? '');
    if (setup && password !== confirmation) {
      setFormError('两次输入的密码不一致。');
      return;
    }
    setFormError(undefined);
    onSubmit?.(username, password);
  }

  return (
    <main className="access-gate">
      <section className="access-card" aria-labelledby="access-title">
        <div className="access-brand">
          <span aria-hidden>A</span>
          <div>
            <strong>AgentHub</strong>
            <small>工程控制平面</small>
          </div>
        </div>
        <div className="access-hero-icon" aria-hidden>
          {unavailable ? <AlertTriangle size={24} /> : <KeyRound size={24} weight="duotone" />}
        </div>
        <div className="access-copy">
          <span>{setup ? '首次使用' : unavailable ? '服务不可用' : '欢迎回来'}</span>
          <h1 id="access-title">
            {setup ? '创建管理员账号' : unavailable ? '暂时无法连接' : '登录 AgentHub'}
          </h1>
          <p>
            {setup
              ? '设置本机管理员账号。创建完成后，其他人必须登录才能访问这个 AgentHub。'
              : unavailable
                ? 'AgentHub 没有返回可用状态。服务恢复后可以直接重试。'
                : '输入管理员账号和密码，继续管理 Project、Agent 与 Session。'}
          </p>
        </div>
        {(error || formError) && (
          <div className="access-inline-error" role="alert" aria-live="polite">
            <AlertTriangle aria-hidden size={17} />
            <span>{formError ?? error}</span>
          </div>
        )}
        {!unavailable ? (
          <form className="access-form" onSubmit={submit}>
            <label htmlFor="username">用户名</label>
            <TextField.Root
              id="username"
              name="username"
              size="3"
              autoFocus
              autoComplete="username"
              spellCheck={false}
              placeholder="例如：admin"
              minLength={3}
              maxLength={64}
              required
            />
            {setup && (
              <small className="access-field-help">至少 12 个字符，建议使用密码管理器生成。</small>
            )}
            <label htmlFor="password">密码</label>
            <TextField.Root
              id="password"
              name="password"
              type="password"
              size="3"
              autoComplete={setup ? 'new-password' : 'current-password'}
              placeholder="至少 12 个字符"
              minLength={12}
              maxLength={128}
              required
            />
            {setup && (
              <>
                <label htmlFor="password-confirmation">确认密码</label>
                <TextField.Root
                  id="password-confirmation"
                  name="passwordConfirmation"
                  type="password"
                  size="3"
                  autoComplete="new-password"
                  placeholder="再次输入密码"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </>
            )}
            <Button size="3" disabled={busy}>
              <ShieldCheck aria-hidden size={17} />
              {busy ? (setup ? '正在创建…' : '正在登录…') : setup ? '创建账号并进入' : '登录'}
            </Button>
          </form>
        ) : (
          <Button size="3" onClick={onRetry}>
            重试连接
          </Button>
        )}
        {!unavailable && <footer>此设备将保持登录 7 天。你可以随时从设置页退出。</footer>}
      </section>
    </main>
  );
}
