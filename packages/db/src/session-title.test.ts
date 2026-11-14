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
} from './repositories.js';
import { createLegacySession } from './migration-test-helpers.js';

it('0014 upgrades existing titles without activity changes; CAS has one winner and survives reopen', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'session-title-migration-'));
  const migrationRoot = resolve(import.meta.dirname, '../drizzle');
  const old = join(temp, 'old');
  await mkdir(join(old, 'meta'), { recursive: true });
  const journal = JSON.parse(await readFile(join(migrationRoot, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 14);
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
      executable: '/bin/false',
      status: 'READY',
    });
    const original = await createLegacySession(database.db, {
      id: randomUUID(),
      projectId: project.id,
      agentId: agent.id,
      title: '旧会话😀',
      cwd: '/tmp/fixture',
      status: 'RUNNING',
    });
    const runId = randomUUID();
    await database.db.execute(
      sql`insert into agent_runs(id,session_id,status) values(${runId},${original.id},'RUNNING')`,
    );
    const run = (await new RunRepository(database.db).get(runId))!;
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    const sessions = new SessionRepository(database.db);
    expect(await sessions.get(original.id)).toEqual({ ...original, titleRevision: 0 });
    const result = await Promise.all([
      sessions.renameTitle(original.id, '新名称 A', 0),
      sessions.renameTitle(original.id, '新名称 B', 0),
    ]);
    expect(result.filter(Boolean)).toHaveLength(1);
    const winner = result.find(Boolean)!;
    expect(winner.titleRevision).toBe(1);
    const { title, titleRevision, ...rest } = winner;
    void title;
    void titleRevision;
    const { title: oldTitle, ...before } = original;
    void oldTitle;
    expect(rest).toEqual(before);
    expect(await new RunRepository(database.db).get(run.id)).toEqual(run);
    expect(await sessions.renameTitle(original.id, '过期写', 0)).toBeUndefined();
    expect(await sessions.renameTitle(randomUUID(), '不存在', 0)).toBeUndefined();
    await database.db.execute(
      sql`update agent_sessions set status='CLOSED' where id=${original.id}`,
    );
    expect(await sessions.renameTitle(original.id, '关闭后仍可改名', 1)).toMatchObject({
      titleRevision: 2,
      status: 'CLOSED',
      lastActiveAt: original.lastActiveAt,
    });
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    expect(await new SessionRepository(database.db).get(original.id)).toMatchObject({
      title: '关闭后仍可改名',
      titleRevision: 2,
      lastActiveAt: original.lastActiveAt,
    });
  } finally {
    await database?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
