import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { AgentHubDatabase, ApiTokenRepository } from '@agenthub/db';
import type { RequestHandler } from 'express';

import { AppError } from '../errors.js';
import type { WebSocketAuthenticator } from '../websocket.js';

export type AuthMode = 'local_trusted' | 'token';

export class AuthService implements WebSocketAuthenticator {
  private readonly bootstrapHash: string | undefined;

  constructor(
    private readonly tokens: ApiTokenRepository<AgentHubDatabase>,
    readonly mode: AuthMode,
    bootstrapToken?: string,
  ) {
    this.bootstrapHash = bootstrapToken ? hashToken(bootstrapToken) : undefined;
  }

  async assertConfigured(): Promise<void> {
    if (this.mode !== 'token') return;
    if (this.bootstrapHash || (await this.tokens.hasActive())) return;
    throw new AppError(
      500,
      'AUTH_TOKEN_NOT_CONFIGURED',
      'token auth 模式需要 AGENTHUB_BOOTSTRAP_TOKEN 或已有有效 token',
    );
  }

  status() {
    return { mode: this.mode, localTrusted: this.mode === 'local_trusted' };
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

  readonly middleware = (): RequestHandler => async (request, _response, next) => {
    if (this.mode === 'local_trusted') {
      next();
      return;
    }
    try {
      const authorized = await this.authorizeHeader(request.headers.authorization);
      if (!authorized) throw new AppError(401, 'AUTH_REQUIRED', '需要有效的 Bearer token');
      next();
    } catch (error) {
      next(error);
    }
  };

  async authorizeHeader(header: string | undefined): Promise<boolean> {
    if (this.mode === 'local_trusted') return true;
    const token = readBearerToken(header) ?? readWebSocketToken(header);
    if (!token) return false;
    const tokenHash = hashToken(token);
    if (this.bootstrapHash && safeHashEqual(tokenHash, this.bootstrapHash)) return true;
    const stored = await this.tokens.findActiveByHash(tokenHash);
    if (!stored) return false;
    await this.tokens.markUsed(stored.id);
    return true;
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

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
