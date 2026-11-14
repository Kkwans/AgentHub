import { EventEmitter } from 'node:events';
import * as pgliteOwnership from './pglite-runtime-ownership.js';
import { beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({
  order: [] as string[],
  held: true,
  migrate: vi.fn(),
  end: vi.fn(),
  client: undefined as EventEmitter | undefined,
  pgliteClose: vi.fn(),
  pgliteMigrate: vi.fn(),
}));
vi.mock('pg', () => ({
  default: {
    Client: class extends EventEmitter {
      constructor() {
        super();
        f.client = this;
        f.order.push('dedicated-client');
      }
      async connect() {
        f.order.push('connect');
      }
      async query() {
        f.order.push('lock');
        return { rows: [{ held: f.held }] };
      }
      async end() {
        f.order.push('ownership-end');
        this.emit('end');
      }
    },
    Pool: class {
      constructor() {
        f.order.push('pool');
      }
      async end() {
        f.order.push('pool-end');
        await f.end();
      }
    },
  },
}));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: () => ({}) }));
vi.mock('drizzle-orm/node-postgres/migrator', () => ({
  migrate: async () => {
    f.order.push('migrate');
    await f.migrate();
  },
}));
vi.mock('@electric-sql/pglite', () => ({
  PGlite: class {
    async close() {
      f.order.push('pglite-close');
      await f.pgliteClose();
    }
  },
}));
vi.mock('drizzle-orm/pglite', () => ({ drizzle: () => ({}) }));
vi.mock('drizzle-orm/pglite/migrator', () => ({ migrate: () => f.pgliteMigrate() }));
import { createPostgresDatabase, createPgliteDatabase } from './client.js';
beforeEach(() => {
  f.order.length = 0;
  f.held = true;
  f.migrate.mockReset();
  f.end.mockReset();
  f.client = undefined;
  f.pgliteClose.mockReset();
  f.pgliteMigrate.mockReset();
});
it('显式启动先持有锁再创建pool与迁移，关闭pool后才释放锁', async () => {
  const db = await createPostgresDatabase('unused', { runtimeOwnership: true });
  expect(f.order).toEqual(['dedicated-client', 'connect', 'lock', 'pool', 'migrate']);
  db.runtimeOwnership!.assertHeld();
  await db.close();
  await db.close();
  expect(f.order.slice(-2)).toEqual(['pool-end', 'ownership-end']);
});
it('未获排他权不创建pool或运行迁移', async () => {
  f.held = false;
  await expect(createPostgresDatabase('unused', { runtimeOwnership: true })).rejects.toMatchObject({
    code: 'RUNTIME_OWNERSHIP_HELD',
  });
  expect(f.order).toEqual(['dedicated-client', 'connect', 'lock', 'ownership-end']);
});
it('迁移失败清理两个连接资源', async () => {
  f.migrate.mockRejectedValue(new Error('migration failed'));
  await expect(createPostgresDatabase('unused', { runtimeOwnership: true })).rejects.toThrow(
    'migration failed',
  );
  expect(f.order).toContain('pool-end');
  expect(f.order).toContain('ownership-end');
});
it('迁移中失去锁不能返回可用数据库', async () => {
  f.migrate.mockImplementation(() => {
    f.client!.emit('error');
  });
  await expect(createPostgresDatabase('unused', { runtimeOwnership: true })).rejects.toMatchObject({
    code: 'RUNTIME_OWNERSHIP_LOST',
  });
  expect(f.order).toContain('pool-end');
  expect(f.order).toContain('ownership-end');
});
it('关闭pool失败保留健康归属并保持失败', async () => {
  const db = await createPostgresDatabase('unused', { runtimeOwnership: true });
  f.end.mockRejectedValue(new Error('pool failed'));
  await expect(db.close()).rejects.toThrow('pool failed');
  expect(f.order.at(-1)).toBe('pool-end');
  expect(f.order).not.toContain('ownership-end');
  db.runtimeOwnership!.assertHeld();
  await expect(db.close()).rejects.toThrow('pool failed');
  expect(f.end).toHaveBeenCalledTimes(1);
});
it('普通repository数据库调用不暗中获取runtime锁', async () => {
  const db = await createPostgresDatabase('unused');
  expect(db.runtimeOwnership).toBeUndefined();
  expect(f.order).toEqual(['pool', 'migrate']);
  await db.close();
});

it('已失去归属时pool关闭失败仍清理专用连接', async () => {
  const db = await createPostgresDatabase('unused', { runtimeOwnership: true });
  f.client!.emit('error');
  f.end.mockRejectedValue(new Error('pool failed'));
  await expect(db.close()).rejects.toThrow('pool failed');
  expect(f.order.at(-1)).toBe('ownership-end');
  expect(() => db.runtimeOwnership!.assertHeld()).toThrow();
});
it('迁移失败且pool清理失败不释放健康归属，保留原始迁移错误', async () => {
  f.migrate.mockRejectedValue(new Error('migration failed'));
  f.end.mockRejectedValue(new Error('pool failed'));
  await expect(createPostgresDatabase('unused', { runtimeOwnership: true })).rejects.toThrow(
    'migration failed',
  );
  expect(f.order).toContain('pool-end');
  expect(f.order).not.toContain('ownership-end');
});
it('PGlite关闭失败不释放健康归属', async () => {
  const db = await createPgliteDatabase({ dataDir: 'memory://', runtimeOwnership: true });
  f.pgliteClose.mockRejectedValue(new Error('pglite failed'));
  await expect(db.close()).rejects.toThrow('pglite failed');
  db.runtimeOwnership!.assertHeld();
  await expect(db.close()).rejects.toThrow('pglite failed');
  expect(f.pgliteClose).toHaveBeenCalledTimes(1);
});
it('PGlite正常关闭后才撤销归属', async () => {
  const db = await createPgliteDatabase({ dataDir: 'memory://', runtimeOwnership: true });
  db.runtimeOwnership!.assertHeld();
  await db.close();
  expect(() => db.runtimeOwnership!.assertHeld()).toThrow();
});
it('PGlite迁移失败且清理失败保留健康归属和原始错误', async () => {
  const acquired = vi.spyOn(pgliteOwnership, 'acquirePgliteRuntimeOwnership');
  f.pgliteMigrate.mockRejectedValue(new Error('migration failed'));
  f.pgliteClose.mockRejectedValue(new Error('pglite failed'));
  await expect(
    createPgliteDatabase({ dataDir: 'memory://', runtimeOwnership: true }),
  ).rejects.toThrow('migration failed');
  expect(f.pgliteClose).toHaveBeenCalledTimes(1);
  const result = await acquired.mock.results[0]!.value;
  result.guard.assertHeld();
  await result.guard.release();
  acquired.mockRestore();
});
