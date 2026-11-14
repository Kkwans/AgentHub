import { createLegacyAgent } from './migration-test-helpers.js';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { createPgliteDatabase } from './client.js';
import {
  ExecutionTargetRepository,
  ProjectRepository,
  SessionRepository,
  RunRepository,
  MessageRepository,
} from './repositories.js';
import { createLegacySession } from './migration-test-helpers.js';

it('0016 preserves legacy archive values; independent CAS does not change runtime/history and persists', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'session-archive-migration-'));
  const migrationRoot = resolve(import.meta.dirname, '../drizzle');
  const old = join(temp, 'old');
  await mkdir(join(old, 'meta'), { recursive: true });
  const journal = JSON.parse(await readFile(join(migrationRoot, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 16);
  await writeFile(join(old, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    await cp(join(migrationRoot, `${entry.tag}.sql`), join(old, `${entry.tag}.sql`));
  const dataDir = join(temp, 'db');
  let database: Awaited<ReturnType<typeof createPgliteDatabase>> | undefined;
  try {
    database = await createPgliteDatabase({ dataDir, migrationsFolder: old });
    const target = await new ExecutionTargetRepository(database.db).create({
      id: randomUUID(),
      name: 'fixture',
      kind: 'LOCAL_HOST',
      hostname: 'fixture',
      os: 'linux',
      arch: 'x64',
      status: 'READY',
    });
    const project = await new ProjectRepository(database.db).create({
      id: randomUUID(),
      targetId: target.id,
      name: 'fixture',
      rootPath: '/tmp/fixture',
      realRootPath: '/tmp/fixture',
      repoKind: 'NONE',
      status: 'ACTIVE',
    });
    const agent = await createLegacyAgent(database.db, {
      id: randomUUID(),
      targetId: target.id,
      name: 'fixture',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/never-execute',
      status: 'READY',
    });
    const legacy = await createLegacySession(database.db, {
      id: randomUUID(),
      projectId: project.id,
      agentId: agent.id,
      title: '原始会话',
      cwd: '/tmp/fixture',
      status: 'RUNNING',
    });
    const unarchived = await createLegacySession(database.db, {
      id: randomUUID(),
      projectId: project.id,
      agentId: agent.id,
      title: '未归档',
      cwd: '/tmp/fixture',
      status: 'CLOSED',
    });
    const archivedAt = new Date('2020-01-02T03:04:05.000Z');
    await database.db.execute(
      sql`update agent_sessions set archived_at=${archivedAt.toISOString()},title_revision=7 where id=${legacy.id}`,
    );
    const oldColumns = await database.db.execute(
      sql`select column_name from information_schema.columns where table_name='agent_sessions' and column_name='archive_revision'`,
    );
    expect(oldColumns.rows).toEqual([]);
    const message = await new MessageRepository(database.db).append({
      sessionId: legacy.id,
      role: 'USER',
      kind: 'TEXT',
      text: '历史不可丢失',
    });
    const runId = randomUUID();
    await database.db.execute(
      sql`insert into agent_runs(id,session_id,status) values(${runId},${legacy.id},'RUNNING')`,
    );
    const run = await new RunRepository(database.db).get(runId);
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    const sessions = new SessionRepository(database.db);
    const original = { ...legacy, archivedAt, titleRevision: 7, archiveRevision: 0 };
    expect(await sessions.get(legacy.id)).toEqual(original);
    expect(await sessions.get(unarchived.id)).toEqual({
      ...unarchived,
      titleRevision: 0,
      archiveRevision: 0,
    });
    const same = await sessions.compareAndSetArchive(legacy.id, true, 0);
    expect(same).toEqual({ ...original, archiveRevision: 1 });
    const concurrent = await Promise.all([
      sessions.compareAndSetArchive(legacy.id, false, 1),
      sessions.compareAndSetArchive(legacy.id, false, 1),
    ]);
    expect(concurrent.filter(Boolean)).toHaveLength(1);
    expect(concurrent.find(Boolean)).toEqual({ ...original, archivedAt: null, archiveRevision: 2 });
    expect(await sessions.compareAndSetArchive(legacy.id, false, 2)).toEqual({
      ...original,
      archivedAt: null,
      archiveRevision: 3,
    });
    const archived = await sessions.compareAndSetArchive(legacy.id, true, 3);
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    expect(await sessions.compareAndSetArchive(legacy.id, true, 4)).toEqual({
      ...archived,
      archiveRevision: 5,
    });
    expect(await sessions.compareAndSetArchive(legacy.id, false, 0)).toBeUndefined();
    expect(await sessions.compareAndSetArchive(randomUUID(), true, 0)).toBeUndefined();
    for (const revision of [-1, 0.5, NaN, Infinity, 2147483647])
      await expect(sessions.compareAndSetArchive(legacy.id, true, revision)).rejects.toMatchObject({
        code: 'SESSION_ARCHIVE_INPUT_INVALID',
      });
    await expect(
      sessions.compareAndSetArchive(legacy.id, 'false' as unknown as boolean, 5),
    ).rejects.toMatchObject({ code: 'SESSION_ARCHIVE_INPUT_INVALID' });
    for (const patch of [
      { archivedAt: null },
      { archiveRevision: 0 },
      { archivedAt: undefined },
      { archiveRevision: undefined },
    ]) {
      await expect(
        sessions.transition(legacy.id, 'DISCONNECTED', patch as never),
      ).rejects.toMatchObject({ code: 'SESSION_ARCHIVE_PROTECTED' });
      await expect(sessions.updateConfiguration(legacy.id, patch as never)).rejects.toMatchObject({
        code: 'SESSION_ARCHIVE_PROTECTED',
      });
      await expect(
        sessions.create({
          id: randomUUID(),
          projectId: project.id,
          agentId: agent.id,
          title: '禁止旁路',
          cwd: '/tmp/fixture',
          status: 'CLOSED',
          ...patch,
        } as never),
      ).rejects.toMatchObject({ code: 'SESSION_ARCHIVE_PROTECTED' });
    }
    expect(await new RunRepository(database.db).get(runId)).toEqual(run);
    expect(await new MessageRepository(database.db).list(legacy.id)).toEqual([message]);
    expect((await sessions.list()).map((row) => row.id)).toEqual(
      expect.arrayContaining([legacy.id, unarchived.id]),
    );
    expect((await sessions.list(project.id)).map((row) => row.id)).toEqual(
      expect.arrayContaining([legacy.id, unarchived.id]),
    );
    await expect(
      database.db.execute(
        sql`update agent_sessions set archive_revision=-1 where id=${unarchived.id}`,
      ),
    ).rejects.toThrow();
    await database.db.execute(
      sql`update agent_sessions set archive_revision=2147483646 where id=${unarchived.id}`,
    );
    expect(await sessions.compareAndSetArchive(unarchived.id, true, 2147483646)).toMatchObject({
      archiveRevision: 2147483647,
    });
    expect(await sessions.renameTitle(legacy.id, '独立改名', 7)).toMatchObject({
      titleRevision: 8,
      archiveRevision: 5,
      archivedAt: archived!.archivedAt,
      lastActiveAt: original.lastActiveAt,
    });
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    expect(await new SessionRepository(database.db).get(legacy.id)).toMatchObject({
      title: '独立改名',
      titleRevision: 8,
      archiveRevision: 5,
      archivedAt: archived!.archivedAt,
      status: 'RUNNING',
      lastActiveAt: original.lastActiveAt,
    });
    const recoveredSessions = new SessionRepository(database.db);
    await recoveredSessions.recoverInterrupted();
    expect(await recoveredSessions.get(legacy.id)).toMatchObject({
      status: 'DISCONNECTED',
      archiveRevision: 5,
      archivedAt: archived!.archivedAt,
      titleRevision: 8,
    });
  } finally {
    await database?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
