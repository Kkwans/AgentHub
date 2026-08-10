import {
  ApiTokenRepository,
  apiTokens,
  browserSessions,
  createPgliteDatabase,
  LocalAuthRepository,
  localAccounts,
} from '@agenthub/db';
import { afterEach, describe, expect, it } from 'vitest';

import { AuthService, resolveAuthMode } from './auth-service.js';

describe('Auth service', () => {
  const databases: Array<Awaited<ReturnType<typeof createPgliteDatabase>>> = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.close()));
  });

  it('loopback 默认 local_trusted，非 loopback 强制 token', () => {
    expect(resolveAuthMode('127.0.0.1')).toBe('local_trusted');
    expect(resolveAuthMode('::1')).toBe('local_trusted');
    expect(resolveAuthMode('0.0.0.0', 'token')).toBe('token');
    expect(() => resolveAuthMode('0.0.0.0')).toThrowError(
      expect.objectContaining({ code: 'AUTH_MODE_REQUIRED' }),
    );
    expect(() => resolveAuthMode('192.168.1.2', 'local_trusted')).toThrowError(
      expect.objectContaining({ code: 'INSECURE_NON_LOOPBACK_BIND' }),
    );
  });

  it('token 只保存 hash、仅展示一次并支持撤销', async () => {
    const database = await createPgliteDatabase({ dataDir: 'memory://' });
    databases.push(database);
    const repository = new ApiTokenRepository(database.db);
    const auth = new AuthService(
      repository,
      new LocalAuthRepository(database.db),
      'token',
      'bootstrap-secret',
    );
    await auth.assertConfigured();
    expect(await auth.authorizeHeader('Bearer bootstrap-secret')).toBe(true);

    const created = await auth.createToken('NAS 控制端');
    expect(created.token).toMatch(/^ah_[A-Za-z0-9_-]{43}$/);
    const [stored] = await database.db.select().from(apiTokens);
    expect(stored?.tokenHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(stored?.tokenHash).not.toContain(created.token);
    expect(await auth.listTokens()).toEqual([
      expect.not.objectContaining({ token: expect.anything(), tokenHash: expect.anything() }),
    ]);
    expect(await auth.authorizeHeader(`Bearer ${created.token}`)).toBe(true);
    expect(await auth.authorizeHeader(`agenthub-v1, agenthub-token.${created.token}`)).toBe(true);
    await auth.revokeToken(created.id);
    expect(await auth.authorizeHeader(`Bearer ${created.token}`)).toBe(false);
  });

  it('首次创建唯一管理员并使用浏览器 Cookie 登录', async () => {
    const database = await createPgliteDatabase({ dataDir: 'memory://' });
    databases.push(database);
    const auth = new AuthService(
      new ApiTokenRepository(database.db),
      new LocalAuthRepository(database.db),
      'token',
    );

    expect(await auth.status({})).toMatchObject({
      setupRequired: true,
      authenticated: false,
    });
    const setup = await auth.setup('Kkwans', 'very-secure-password');
    expect(setup.token).toMatch(/^ahs_[A-Za-z0-9_-]{43}$/);
    expect(await auth.authorize({ cookie: `agenthub_session=${setup.token}` })).toBe(true);
    const [account] = await database.db.select().from(localAccounts);
    const [session] = await database.db.select().from(browserSessions);
    expect(account?.passwordHash).toMatch(/^scrypt\$/);
    expect(account?.passwordHash).not.toContain('very-secure-password');
    expect(session?.tokenHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(session?.tokenHash).not.toContain(setup.token);
    await expect(auth.setup('other', 'another-secure-password')).rejects.toMatchObject({
      code: 'AUTH_SETUP_COMPLETED',
    });

    const login = await auth.login('kkWANS', 'very-secure-password', '127.0.0.1');
    expect(await auth.status({ cookie: `agenthub_session=${login.token}` })).toMatchObject({
      setupRequired: false,
      authenticated: true,
      user: { username: 'Kkwans', role: 'ADMIN' },
    });
    await auth.logout(`agenthub_session=${login.token}`);
    expect(await auth.authorize({ cookie: `agenthub_session=${login.token}` })).toBe(false);
  });

  it('连续错误密码会触发登录限流', async () => {
    const database = await createPgliteDatabase({ dataDir: 'memory://' });
    databases.push(database);
    const auth = new AuthService(
      new ApiTokenRepository(database.db),
      new LocalAuthRepository(database.db),
      'token',
    );
    await auth.setup('admin', 'correct-password-123');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(auth.login('admin', 'wrong-password-123', 'client-1')).rejects.toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
      });
    }
    await expect(auth.login('admin', 'correct-password-123', 'client-1')).rejects.toMatchObject({
      code: 'AUTH_LOGIN_RATE_LIMITED',
    });
  });

  it('修改密码会撤销全部旧浏览器会话并签发新会话', async () => {
    const database = await createPgliteDatabase({ dataDir: 'memory://' });
    databases.push(database);
    const auth = new AuthService(
      new ApiTokenRepository(database.db),
      new LocalAuthRepository(database.db),
      'token',
    );
    const first = await auth.setup('admin', 'old-password-12345');
    const second = await auth.login('admin', 'old-password-12345', 'client-2');
    const changed = await auth.changePassword(
      {
        kind: 'browser_session',
        sessionId: 'current-session',
        accountId: first.user.id,
        username: first.user.username,
        role: 'ADMIN',
      },
      'old-password-12345',
      'new-password-67890',
    );

    expect(await auth.authorize({ cookie: `agenthub_session=${first.token}` })).toBe(false);
    expect(await auth.authorize({ cookie: `agenthub_session=${second.token}` })).toBe(false);
    expect(await auth.authorize({ cookie: `agenthub_session=${changed.token}` })).toBe(true);
    await expect(auth.login('admin', 'old-password-12345', 'client-3')).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
    await expect(auth.login('admin', 'new-password-67890', 'client-4')).resolves.toMatchObject({
      user: { username: 'admin' },
    });
  });
});
