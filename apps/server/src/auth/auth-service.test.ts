import { ApiTokenRepository, apiTokens, createPgliteDatabase } from '@agenthub/db';
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
    const auth = new AuthService(repository, 'token', 'bootstrap-secret');
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

  it('token 模式没有 bootstrap 或数据库 token 时拒绝启动', async () => {
    const database = await createPgliteDatabase({ dataDir: 'memory://' });
    databases.push(database);
    const auth = new AuthService(new ApiTokenRepository(database.db), 'token');
    await expect(auth.assertConfigured()).rejects.toMatchObject({
      code: 'AUTH_TOKEN_NOT_CONFIGURED',
    });
  });
});
