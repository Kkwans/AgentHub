import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import type { AgentHubDatabase, ApiTokenRepository, LocalAuthRepository } from '@agenthub/db';
import type { RequestHandler } from 'express';

import { AppError } from '../errors.js';
import type { WebSocketAuthenticator } from '../websocket.js';
import { hashPassword, verifyPassword } from './password.js';

export type AuthMode = 'local_trusted' | 'token';
export const browserSessionCookie = 'agenthub_session';

const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const maxLoginFailures = 5;
const loginWindowMs = 15 * 60 * 1000;
const dummyPasswordHash =
  'scrypt$32768$8$1$MDEyMzQ1Njc4OWFiY2RlZg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export type AuthPrincipal =
  | { kind: 'local_trusted'; role: 'ADMIN' }
  | { kind: 'api_token'; tokenId: string; role: 'ADMIN' }
  | {
      kind: 'browser_session';
      sessionId: string;
      accountId: string;
      username: string;
      role: 'ADMIN';
    };

export class AuthService implements WebSocketAuthenticator {
  private readonly bootstrapHash: string | undefined;
  private readonly loginFailures = new Map<string, { count: number; blockedUntil?: number }>();

  constructor(
    private readonly tokens: ApiTokenRepository<AgentHubDatabase>,
    private readonly localAuth: LocalAuthRepository<AgentHubDatabase>,
    readonly mode: AuthMode,
    bootstrapToken?: string,
    readonly secureCookie = false,
  ) {
    this.bootstrapHash = bootstrapToken ? hashToken(bootstrapToken) : undefined;
  }

  async assertConfigured(): Promise<void> {
    // token mode may start without a bootstrap token so the first browser can create the
    // single local administrator. The database singleton constraint closes that setup path.
  }

  async status(headers: IncomingHttpHeaders) {
    const setupRequired = this.mode === 'token' && !(await this.localAuth.hasAccount());
    const principal = setupRequired ? undefined : await this.authenticate(headers, false);
    return {
      mode: this.mode,
      localTrusted: this.mode === 'local_trusted',
      setupRequired,
      authenticated: Boolean(principal),
      user:
        principal?.kind === 'browser_session'
          ? { id: principal.accountId, username: principal.username, role: principal.role }
          : null,
    };
  }

  async setup(username: string, password: string) {
    if (this.mode !== 'token') {
      throw new AppError(409, 'AUTH_SETUP_NOT_REQUIRED', '本地可信模式不需要创建登录账号');
    }
    if (await this.localAuth.hasAccount()) {
      throw new AppError(409, 'AUTH_SETUP_COMPLETED', '管理员账号已经创建，请直接登录');
    }
    const normalizedUsername = normalizeUsername(username);
    const passwordHash = await hashPassword(password);
    let account;
    try {
      account = await this.localAuth.createFirstAccount({
        id: randomUUID(),
        username: username.trim(),
        normalizedUsername,
        passwordHash,
      });
    } catch (error) {
      if (await this.localAuth.hasAccount()) {
        throw new AppError(409, 'AUTH_SETUP_COMPLETED', '管理员账号已经创建，请直接登录');
      }
      throw error;
    }
    if (!account) throw new AppError(409, 'AUTH_SETUP_COMPLETED', '管理员账号已经创建，请直接登录');
    return this.createBrowserSession(account.id, account.username, 'ADMIN');
  }

  async login(username: string, password: string, clientKey: string) {
    if (this.mode !== 'token') {
      throw new AppError(409, 'AUTH_LOGIN_NOT_REQUIRED', '本地可信模式不需要登录');
    }
    this.assertLoginAllowed(clientKey);
    if (!(await this.localAuth.hasAccount())) {
      throw new AppError(409, 'AUTH_SETUP_REQUIRED', '请先创建本机管理员账号');
    }
    const account = await this.localAuth.findAccountByUsername(normalizeUsername(username));
    const valid = await verifyPassword(password, account?.passwordHash ?? dummyPasswordHash);
    if (!account || !valid) {
      this.recordLoginFailure(clientKey);
      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', '用户名或密码不正确');
    }
    this.loginFailures.delete(clientKey);
    return this.createBrowserSession(account.id, account.username, 'ADMIN');
  }

  async logout(cookieHeader: string | undefined) {
    const token = readCookie(cookieHeader, browserSessionCookie);
    if (token) await this.localAuth.revokeSessionByHash(hashToken(token));
  }

  async changePassword(
    principal: AuthPrincipal | undefined,
    currentPassword: string,
    newPassword: string,
  ) {
    if (principal?.kind !== 'browser_session') {
      throw new AppError(403, 'AUTH_PASSWORD_LOGIN_REQUIRED', '请使用管理员账号登录后修改密码');
    }
    const account = await this.localAuth.findAccountByUsername(
      normalizeUsername(principal.username),
    );
    if (!account || !(await verifyPassword(currentPassword, account.passwordHash))) {
      throw new AppError(400, 'AUTH_INVALID_CREDENTIALS', '当前密码不正确');
    }
    await this.localAuth.updatePassword(account.id, await hashPassword(newPassword));
    await this.localAuth.revokeAccountSessions(account.id);
    return this.createBrowserSession(account.id, account.username, 'ADMIN');
  }

  listTokens() {
    return this.tokens.list();
  }

  async createToken(name: string) {
    if (await this.tokens.getByName(name))
      throw new AppError(409, 'API_TOKEN_NAME_EXISTS', 'API token 名称已存在');
    const token = `ah_${randomBytes(32).toString('base64url')}`;
    const record = await this.tokens.create({
      id: randomUUID(),
      name,
      tokenHash: hashToken(token),
    });
    return { ...record, token };
  }

  async revokeToken(id: string) {
    const revoked = await this.tokens.revoke(id);
    if (!revoked) throw new AppError(404, 'API_TOKEN_NOT_FOUND', 'API token 不存在或已撤销');
    return revoked;
  }

  readonly middleware = (): RequestHandler => async (request, response, next) => {
    try {
      const principal = await this.authenticate(request.headers);
      if (!principal) throw new AppError(401, 'AUTH_REQUIRED', '请先登录 AgentHub');
      response.locals.authPrincipal = principal;
      next();
    } catch (error) {
      next(error);
    }
  };

  async authorize(headers: IncomingHttpHeaders): Promise<boolean> {
    return Boolean(await this.authenticate(headers));
  }

  async authorizeHeader(header: string | undefined): Promise<boolean> {
    return Boolean(await this.authenticate({ authorization: header }));
  }

  cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: this.secureCookie,
      path: '/',
      maxAge: sessionTtlMs,
    };
  }

  clearCookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: this.secureCookie,
      path: '/',
    };
  }

  private async authenticate(
    headers: IncomingHttpHeaders,
    markUsed = true,
  ): Promise<AuthPrincipal | undefined> {
    if (this.mode === 'local_trusted') return { kind: 'local_trusted', role: 'ADMIN' };

    const headerCredential = headers.authorization ?? headers['sec-websocket-protocol'];
    const apiToken = readBearerToken(headerCredential) ?? readWebSocketToken(headerCredential);
    if (apiToken) {
      const tokenHash = hashToken(apiToken);
      if (this.bootstrapHash && safeHashEqual(tokenHash, this.bootstrapHash)) {
        return { kind: 'api_token', tokenId: 'bootstrap', role: 'ADMIN' };
      }
      const stored = await this.tokens.findActiveByHash(tokenHash);
      if (!stored) return undefined;
      if (markUsed) await this.tokens.markUsed(stored.id);
      return { kind: 'api_token', tokenId: stored.id, role: 'ADMIN' };
    }

    const browserToken = readCookie(headers.cookie, browserSessionCookie);
    if (!browserToken) return undefined;
    const session = await this.localAuth.findActiveSession(hashToken(browserToken));
    if (!session) return undefined;
    if (
      markUsed &&
      (!session.lastUsedAt || Date.now() - session.lastUsedAt.getTime() >= 5 * 60 * 1000)
    ) {
      await this.localAuth.markSessionUsed(session.sessionId);
    }
    return {
      kind: 'browser_session',
      sessionId: session.sessionId,
      accountId: session.accountId,
      username: session.username,
      role: 'ADMIN',
    };
  }

  private async createBrowserSession(accountId: string, username: string, role: 'ADMIN') {
    const token = `ahs_${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + sessionTtlMs);
    await this.localAuth.createSession({
      id: randomUUID(),
      accountId,
      tokenHash: hashToken(token),
      expiresAt,
    });
    return { token, expiresAt, user: { id: accountId, username, role } };
  }

  private assertLoginAllowed(clientKey: string) {
    const failure = this.loginFailures.get(clientKey);
    if (!failure?.blockedUntil) return;
    if (failure.blockedUntil <= Date.now()) {
      this.loginFailures.delete(clientKey);
      return;
    }
    throw new AppError(429, 'AUTH_LOGIN_RATE_LIMITED', '登录尝试过多，请 15 分钟后重试');
  }

  private recordLoginFailure(clientKey: string) {
    const current = this.loginFailures.get(clientKey);
    const count = (current?.count ?? 0) + 1;
    this.loginFailures.set(clientKey, {
      count,
      ...(count >= maxLoginFailures ? { blockedUntil: Date.now() + loginWindowMs } : {}),
    });
  }
}

export function resolveAuthMode(host: string, configured?: string): AuthMode {
  const loopback = isLoopbackHost(host);
  const mode = configured ?? (loopback ? 'local_trusted' : undefined);
  if (mode !== 'local_trusted' && mode !== 'token') {
    throw new AppError(500, 'AUTH_MODE_REQUIRED', '非 loopback 监听必须明确配置 token auth');
  }
  if (!loopback && mode !== 'token') {
    throw new AppError(500, 'INSECURE_NON_LOOPBACK_BIND', '非 loopback 监听只允许 token auth');
  }
  return mode;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

export function hashToken(token: string): string {
  return `sha256:${createHash('sha256').update(token).digest('hex')}`;
}

export function normalizeUsername(username: string): string {
  return username.trim().normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function readBearerToken(header?: string): string | undefined {
  const match = header?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1];
}

function readWebSocketToken(header?: string): string | undefined {
  const protocol = header
    ?.split(',')
    .map((value) => value.trim())
    .find((value) => value.startsWith('agenthub-token.'));
  return protocol?.slice('agenthub-token.'.length);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
