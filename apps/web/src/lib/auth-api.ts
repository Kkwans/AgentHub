import { ApiError } from './api-error';

const errorMessages: Record<string, string> = {
  HTTP_ERROR: '请求失败，请稍后重试。',
  AUTH_REQUIRED: '请先登录 AgentHub。',
  AUTH_SETUP_REQUIRED: '请先创建管理员账号。',
  AUTH_SETUP_COMPLETED: '管理员账号已经创建，请直接登录。',
  AUTH_SETUP_NOT_REQUIRED: '当前为本地可信模式，不需要创建登录账号。',
  AUTH_LOGIN_NOT_REQUIRED: '当前为本地可信模式，不需要登录。',
  AUTH_INVALID_CREDENTIALS: '用户名或密码不正确。',
  AUTH_LOGIN_RATE_LIMITED: '登录尝试过多，请 15 分钟后重试。',
  AUTH_PASSWORD_LOGIN_REQUIRED: '请使用管理员账号登录后修改密码。',
  AUTH_MODE_REQUIRED: '当前服务模式需要登录。',
};

const authorizationRequiredEvent = 'agenthub:authorization-required';

export const authSession = {
  onAuthorizationRequired(listener: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined;
    window.addEventListener(authorizationRequiredEvent, listener);
    return () => window.removeEventListener(authorizationRequiredEvent, listener);
  },
  notifyAuthorizationRequired(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(authorizationRequiredEvent));
  },
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError('HTTP_ERROR', errorMessages.HTTP_ERROR ?? '请求失败，请稍后重试。', 0);
  }

  let body: { data?: T; error?: { code?: string; message?: string; details?: unknown } };
  try {
    const parsed: unknown = await response.json();
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid response envelope');
    body = parsed as typeof body;
  } catch {
    throw new ApiError(
      'HTTP_ERROR',
      errorMessages.HTTP_ERROR ?? '请求失败，请稍后重试。',
      response.status,
    );
  }
  if (!response.ok || body.error) {
    const code = body.error?.code ?? 'HTTP_ERROR';
    if (code === 'AUTH_REQUIRED') authSession.notifyAuthorizationRequired();
    throw new ApiError(
      code,
      errorMessages[code] ?? body.error?.message ?? '请求失败，请稍后重试。',
      response.status,
      isRecord(body.error?.details) ? body.error.details : undefined,
    );
  }
  return body.data as T;
}

export const authApi = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export { ApiError } from './api-error';
