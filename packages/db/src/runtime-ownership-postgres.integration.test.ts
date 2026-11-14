import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import {
  AgentRepository,
  ExecutionTargetRepository,
  ProjectRepository,
  SessionRepository,
  MessageRepository,
  RunRepository,
} from './repositories.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPostgresDatabase } from './client.js';
import {
  acquirePostgresRuntimeOwnership,
  type RuntimeOwnershipGuard,
} from './runtime-ownership.js';

function assertClosed(results: PromiseSettledResult<void>[]) {
  const failed = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failed.length)
    throw new AggregateError(
      failed.map((result) => result.reason),
      '本例临时PG连接关闭未确认，保留临时数据库',
    );
}

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

  it('启停CAS在两个独立PG连接竞争时仅一方成功，持久状态不被默认配置或预检覆盖', async () => {
    // Separate database: do not depend on test order or change the ownership test's
    // initial no-migrations assertion. The admin is the validated disposable CI service.
    const casName = `agenthub_availability_${randomUUID().replaceAll('-', '')}`;
    const casUrl = new URL(databaseUrl);
    casUrl.pathname = `/${casName}`;
    let casCreated = false;
    let migration: Awaited<ReturnType<typeof createPostgresDatabase>> | undefined;
    const clients: pg.Client[] = [];
    const connect = async () => {
      const client = new pg.Client({
        connectionString: casUrl.toString(),
        connectionTimeoutMillis: 5_000,
        query_timeout: 5_000,
      });
      clients.push(client);
      await client.connect();
      return client;
    };
    try {
      await admin!.query(`CREATE DATABASE "${casName}"`);
      casCreated = true;
      migration = await createPostgresDatabase(casUrl.toString());
      await migration.close();
      migration = undefined;
      const first = await connect();
      const second = await connect();
      const firstDb = drizzle(first, { schema });
      const secondDb = drizzle(second, { schema });
      const a = new AgentRepository(firstDb);
      const b = new AgentRepository(secondDb);
      const target = await new ExecutionTargetRepository(firstDb).create({
        id: randomUUID(),
        name: 'CAS fixture',
        kind: 'LOCAL_HOST',
        hostname: 'fixture',
        os: 'linux',
        arch: 'x64',
        status: 'READY',
      });
      const agent = await a.create({
        id: randomUUID(),
        targetId: target.id,
        name: 'CAS fixture',
        agentKind: 'CUSTOM_ACP',
        adapterKind: 'ACP_STDIO',
        executable: '/fixture/never-launched',
        status: 'READY',
        defaultModel: 'before',
        enabled: true,
      });
      const firstPid = (await first.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]!.pid;
      const secondPid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]!.pid;
      expect(firstPid).not.toBe(secondPid);
      await first.query('BEGIN');
      try {
        const winner = await a.compareAndSetAvailability(agent.id, false, 0);
        expect(winner).toMatchObject({ enabled: false, enabledRevision: 1 });
        const competing = b.compareAndSetAvailability(agent.id, true, 0);
        void competing.catch(() => undefined); // Observe timeout/rejection even if the lock assertion fails.
        await vi.waitFor(
          async () => {
            const state = await admin!.query<{ wait_event_type: string | null }>(
              'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',
              [secondPid],
            );
            expect(state.rows[0]?.wait_event_type).toBe('Lock');
          },
          { timeout: 2_000 },
        );
        await first.query('COMMIT');
        expect(await competing).toBeUndefined();
      } finally {
        await first.query('ROLLBACK'); // Harmless after COMMIT; releases lock on any earlier failure.
      }
      await b.update(agent.id, { defaultModel: 'after', defaultMode: 'fixture' });
      await a.updatePreflight(agent.id, {
        status: 'BROKEN',
        detectedVersion: '1.2.3',
        capabilitiesJson: { history: true },
      });
      await expect(b.update(agent.id, { enabled: true } as never)).rejects.toMatchObject({
        code: 'AGENT_AVAILABILITY_PROTECTED',
      });
      const reopened = await connect();
      const persisted = await new AgentRepository(drizzle(reopened, { schema })).get(agent.id);
      expect(persisted).toMatchObject({
        id: agent.id,
        enabled: false,
        enabledRevision: 1,
        status: 'BROKEN',
        defaultModel: 'after',
        defaultMode: 'fixture',
        detectedVersion: '1.2.3',
        capabilitiesJson: { history: true },
      });
    } finally {
      const cleanup = await Promise.allSettled([
        ...(migration ? [Promise.resolve().then(() => migration!.close())] : []),
        ...clients.map((client) => Promise.resolve().then(() => client.end())),
      ]);
      assertClosed(cleanup);
      // No FORCE, wildcard, existing schema reset, or reference to DATABASE_URL.
      if (casCreated) await admin!.query(`DROP DATABASE "${casName}"`);
    }
  });
  it('归档CAS在两个独立PG连接真实锁竞争后仅一方提交，恢复与同值写不改历史', async () => {
    const archiveName = `agenthub_archive_${randomUUID().replaceAll('-', '')}`;
    const archiveUrl = new URL(databaseUrl);
    archiveUrl.pathname = `/${archiveName}`;
    let archiveCreated = false;
    let migration: Awaited<ReturnType<typeof createPostgresDatabase>> | undefined;
    const clients: pg.Client[] = [];
    const connect = async () => {
      const client = new pg.Client({
        connectionString: archiveUrl.toString(),
        connectionTimeoutMillis: 5_000,
        query_timeout: 5_000,
      });
      clients.push(client);
      await client.connect();
      return client;
    };
    try {
      await admin!.query(`CREATE DATABASE "${archiveName}"`);
      archiveCreated = true;
      migration = await createPostgresDatabase(archiveUrl.toString());
      await migration.close();
      migration = undefined;
      const first = await connect(),
        second = await connect();
      const firstDb = drizzle(first, { schema }),
        secondDb = drizzle(second, { schema });
      const a = new SessionRepository(firstDb),
        b = new SessionRepository(secondDb);
      const target = await new ExecutionTargetRepository(firstDb).create({
        id: randomUUID(),
        name: 'archive fixture',
        kind: 'LOCAL_HOST',
        hostname: 'fixture',
        os: 'linux',
        arch: 'x64',
        status: 'READY',
      });
      const agent = await new AgentRepository(firstDb).create({
        id: randomUUID(),
        targetId: target.id,
        name: 'archive fixture',
        agentKind: 'CUSTOM_ACP',
        adapterKind: 'ACP_STDIO',
        executable: '/fixture/never-launched',
        status: 'READY',
      });
      const project = await new ProjectRepository(firstDb).create({
        id: randomUUID(),
        targetId: target.id,
        name: 'archive fixture',
        rootPath: '/fixture',
        realRootPath: '/fixture',
        repoKind: 'NONE',
        status: 'ACTIVE',
      });
      const session = await a.create({
        id: randomUUID(),
        projectId: project.id,
        agentId: agent.id,
        title: '历史保持',
        cwd: '/fixture',
        status: 'RUNNING',
      });
      const runId = randomUUID();
      await first.query('INSERT INTO agent_runs(id,session_id,status) VALUES($1,$2,$3)', [
        runId,
        session.id,
        'RUNNING',
      ]);
      const run = await new RunRepository(firstDb).get(runId);
      const message = await new MessageRepository(firstDb).append({
        sessionId: session.id,
        role: 'USER',
        kind: 'TEXT',
        text: '归档不是删除',
      });
      const firstPid = (await first.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]!.pid;
      const secondPid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]!.pid;
      expect(firstPid).not.toBe(secondPid);
      await first.query('BEGIN');
      let archivedAt: Date | null = null;
      try {
        const winner = await a.compareAndSetArchive(session.id, true, 0);
        expect(winner).toMatchObject({ archiveRevision: 1 });
        archivedAt = winner!.archivedAt;
        expect(archivedAt).toBeInstanceOf(Date);
        const competing = b.compareAndSetArchive(session.id, false, 0);
        void competing.catch(() => undefined);
        await vi.waitFor(
          async () => {
            const state = await admin!.query<{ wait_event_type: string | null }>(
              'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',
              [secondPid],
            );
            expect(state.rows[0]?.wait_event_type).toBe('Lock');
          },
          { timeout: 2_000 },
        );
        await first.query('COMMIT');
        expect(await competing).toBeUndefined();
      } finally {
        await first.query('ROLLBACK');
      }
      expect(await b.get(session.id)).toEqual({ ...session, archivedAt, archiveRevision: 1 });
      expect(await b.compareAndSetArchive(session.id, true, 1)).toEqual({
        ...session,
        archivedAt,
        archiveRevision: 2,
      });
      expect(await a.compareAndSetArchive(session.id, false, 2)).toEqual({
        ...session,
        archivedAt: null,
        archiveRevision: 3,
      });
      expect(await b.compareAndSetArchive(session.id, false, 3)).toEqual({
        ...session,
        archivedAt: null,
        archiveRevision: 4,
      });
      const archived = await a.compareAndSetArchive(session.id, true, 4);
      await expect(
        b.transition(session.id, 'DISCONNECTED', { archiveRevision: 0 } as never),
      ).rejects.toMatchObject({ code: 'SESSION_ARCHIVE_PROTECTED' });
      await expect(
        b.updateConfiguration(session.id, { archivedAt: null } as never),
      ).rejects.toMatchObject({ code: 'SESSION_ARCHIVE_PROTECTED' });
      const reopened = await connect(),
        reopenedDb = drizzle(reopened, { schema });
      expect(await new SessionRepository(reopenedDb).get(session.id)).toEqual({
        ...session,
        archivedAt: archived!.archivedAt,
        archiveRevision: 5,
      });
      expect(await new RunRepository(reopenedDb).get(runId)).toEqual(run);
      expect(await new MessageRepository(reopenedDb).list(session.id)).toEqual([message]);
      expect(await new SessionRepository(reopenedDb).list(project.id)).toEqual([
        { ...session, archivedAt: archived!.archivedAt, archiveRevision: 5 },
      ]);
    } finally {
      assertClosed(
        await Promise.allSettled([
          ...(migration ? [Promise.resolve().then(() => migration!.close())] : []),
          ...clients.map((client) => Promise.resolve().then(() => client.end())),
        ]),
      );
      if (archiveCreated) await admin!.query(`DROP DATABASE "${archiveName}"`);
    }
  });
});
