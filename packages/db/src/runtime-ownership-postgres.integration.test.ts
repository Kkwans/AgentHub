import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPostgresDatabase } from './client.js';
import {
  acquirePostgresRuntimeOwnership,
  type RuntimeOwnershipGuard,
} from './runtime-ownership.js';

// Never read DATABASE_URL. Only the explicitly provisioned disposable loopback CI service is allowed.
const enabled = process.env.AGENTHUB_PG_OWNERSHIP_TEST === '1';
describe.skipIf(!enabled)('真实PostgreSQL运行归属（隔离临时数据库）', () => {
  let admin: pg.Client | undefined;
  let control: pg.Client | undefined;
  let databaseUrl = '';
  let created = false;
  const name = `agenthub_ownership_${randomUUID().replaceAll('-', '')}`;
  const connection = () =>
    new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5_000,
      query_timeout: 5_000,
    });

  beforeAll(async () => {
    const raw = process.env.AGENTHUB_PG_OWNERSHIP_TEST_URL;
    if (!raw) throw new Error('显式PG归属测试需要独立CI服务URL');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('PG归属测试URL无效');
    }
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/agenthub_runtime_ci' ||
      url.search ||
      url.hash
    )
      throw new Error('仅允许专用loopback agenthub_runtime_ci服务，禁止使用用户数据库');
    admin = new pg.Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 5_000,
      query_timeout: 5_000,
    });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    databaseUrl = url.toString();
    control = connection();
    await control.connect();
  });
  afterAll(async () => {
    try {
      await control?.end();
      // No FORCE and no wildcard: cleanup can only remove the database created above.
      if (created) await admin!.query(`DROP DATABASE "${name}"`);
    } finally {
      await admin?.end();
    }
  });

  it('第二实例在迁移前被拒绝，正常关闭后可迁移并重新持有', async () => {
    const a = await acquirePostgresRuntimeOwnership(connection());
    try {
      await expect(
        createPostgresDatabase(databaseUrl, {
          runtimeOwnership: true,
          migrationsFolder: join(tmpdir(), `absent-migrations-${randomUUID()}`),
        }),
      ).rejects.toMatchObject({ code: 'RUNTIME_OWNERSHIP_HELD' });
      a.assertHeld();
      const schemas = await control!.query("SELECT to_regnamespace('drizzle') AS migration_schema");
      expect(schemas.rows[0].migration_schema).toBeNull();
    } finally {
      await a.release();
    }

    const b = await createPostgresDatabase(databaseUrl, { runtimeOwnership: true });
    try {
      b.runtimeOwnership!.assertHeld();
      await expect(acquirePostgresRuntimeOwnership(connection())).rejects.toMatchObject({
        code: 'RUNTIME_OWNERSHIP_HELD',
      });
      const migrated = await control!.query(
        "SELECT to_regclass('drizzle.__drizzle_migrations') AS migrations",
      );
      expect(migrated.rows[0].migrations).not.toBeNull();
    } finally {
      await b.close();
    }
    const c = await acquirePostgresRuntimeOwnership(connection());
    try {
      c.assertHeld();
    } finally {
      await c.release();
    }
  });

  it('终止本测试的专用backend会永久撤销原归属，独立新连接可获取', async () => {
    const owner = connection();
    const a = await acquirePostgresRuntimeOwnership(owner);
    const lost = vi.fn();
    a.onLost(lost);
    let b: RuntimeOwnershipGuard | undefined;
    try {
      const { rows } = await owner.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const pid = rows[0]!.pid;
      const terminated = await control!.query<{ terminated: boolean }>(
        'SELECT pg_terminate_backend($1) AS terminated',
        [pid],
      );
      expect(terminated.rows[0]!.terminated).toBe(true);
      await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1), { timeout: 5_000 });
      expect(() => a.assertHeld()).toThrowError(
        expect.objectContaining({ code: 'RUNTIME_OWNERSHIP_LOST' }),
      );
      await vi.waitFor(
        async () => {
          const locks = await control!.query(
            'SELECT count(*)::integer AS count FROM pg_locks WHERE pid = $1',
            [pid],
          );
          expect(locks.rows[0].count).toBe(0);
        },
        { timeout: 5_000 },
      );
      b = await acquirePostgresRuntimeOwnership(connection());
      b.assertHeld();
      expect(() => a.assertHeld()).toThrow();
      expect(lost).toHaveBeenCalledTimes(1);
    } finally {
      await a.release();
      await b?.release();
    }
  });
});
