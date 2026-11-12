import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { createPgliteDatabase } from './client.js';
import {
  AgentRepository,
  ExecutionTargetRepository,
  ProjectRepository,
  RunRepository,
  SessionRepository,
} from './repositories.js';

it('0007升级不把历史QUEUED猜成未派发；新证据与历史正文跨重开保留', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agenthub-dispatch-migration-'));
  const folder = join(temp, 'old'),
    root = resolve(import.meta.dirname, '../drizzle');
  const journal = JSON.parse(await readFile(join(root, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const previous = { ...journal, entries: journal.entries.filter((entry) => entry.idx < 8) };
  await mkdir(join(folder, 'meta'), { recursive: true });
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(previous));
  for (const entry of previous.entries)
    await cp(join(root, entry.tag + '.sql'), join(folder, entry.tag + '.sql'));
  const dataDir = join(temp, 'db');
  let database = await createPgliteDatabase({ dataDir, migrationsFolder: folder });
  try {
    const target = await new ExecutionTargetRepository(database.db).create({
      id: randomUUID(),
      name: '旧',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    const project = await new ProjectRepository(database.db).create({
      id: randomUUID(),
      name: '旧',
      targetId: target.id,
      rootPath: '/tmp',
      realRootPath: '/tmp',
      repoKind: 'NONE',
      status: 'ACTIVE',
    });
    const agent = await new AgentRepository(database.db).create({
      id: randomUUID(),
      targetId: target.id,
      name: '旧',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    const session = await new SessionRepository(database.db).create({
      id: randomUUID(),
      projectId: project.id,
      agentId: agent.id,
      title: '旧正文😀',
      cwd: '/tmp',
      status: 'READY',
    });
    const id = randomUUID();
    await database.db.execute(
      sql`insert into agent_runs(id,session_id,status) values(${id},${session.id},'QUEUED')`,
    );
    await database.close();
    database = await createPgliteDatabase({ dataDir });
    expect((await new SessionRepository(database.db).get(session.id))?.title).toBe('旧正文😀');
    let runs = new RunRepository(database.db);
    expect(await runs.get(id)).toMatchObject({ status: 'QUEUED', dispatchState: 'LEGACY_UNKNOWN' });
    const fresh = await runs.create({
      id: randomUUID(),
      sessionId: session.id,
      status: 'QUEUED',
      dispatchState: 'PREPARING',
    });
    await database.close();
    database = await createPgliteDatabase({ dataDir });
    runs = new RunRepository(database.db);
    expect((await runs.get(fresh.id))?.dispatchState).toBe('PREPARING');
    await runs.recoverInterrupted();
    expect(await runs.get(id)).toMatchObject({
      status: 'DISCONNECTED',
      dispatchState: 'LEGACY_UNKNOWN',
    });
    expect(await runs.get(fresh.id)).toMatchObject({
      status: 'FAILED',
      dispatchState: 'PREPARING',
    });
  } finally {
    await database.close();
    await rm(temp, { recursive: true, force: true });
  }
});
