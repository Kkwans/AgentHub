import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgliteDatabase } from './client.js';
import {
  ExecutionTargetRepository,
  ProjectRepository,
  AgentRepository,
  SessionRepository,
  RunRepository,
  TaskRepository,
} from './repositories.js';

it('从0006升级保留会话与Run，不猜历史所有权；新指针跨重开与重复迁移保留', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agenthub-latest-run-migration-'));
  const oldMigrations = join(temp, 'old-migrations');
  const migrationRoot = resolve(import.meta.dirname, '../drizzle');
  const journal = JSON.parse(await readFile(join(migrationRoot, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const previous = { ...journal, entries: journal.entries.filter((entry) => entry.idx < 7) };
  await mkdir(join(oldMigrations, 'meta'), { recursive: true });
  await writeFile(join(oldMigrations, 'meta/_journal.json'), JSON.stringify(previous));
  for (const entry of previous.entries)
    await cp(join(migrationRoot, `${entry.tag}.sql`), join(oldMigrations, `${entry.tag}.sql`));
  const dataDir = join(temp, 'pgdata');
  let database: Awaited<ReturnType<typeof createPgliteDatabase>> | undefined;
  try {
    database = await createPgliteDatabase({ dataDir, migrationsFolder: oldMigrations });
    const target = await new ExecutionTargetRepository(database.db).create({
      id: randomUUID(),
      name: '旧环境',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    const project = await new ProjectRepository(database.db).create({
      id: randomUUID(),
      name: '旧项目',
      targetId: target.id,
      rootPath: '/tmp/migration',
      realRootPath: '/tmp/migration',
      status: 'ACTIVE',
      repoKind: 'NONE',
    });
    const original = await new TaskRepository(database.db).create({
      id: randomUUID(),
      projectId: project.id,
      title: '原始任务',
      description: '旧正文😀不丢失',
      status: 'BACKLOG',
    });

    const agent = await new AgentRepository(database.db).create({
      id: randomUUID(),
      targetId: target.id,
      name: '旧Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    const sessionId = randomUUID();
    const oldRunId = randomUUID();
    await database.db.execute(sql`insert into agent_sessions
      (id, project_id, agent_id, task_id, title, cwd, status)
      values (${sessionId}, ${project.id}, ${agent.id}, ${original.id}, '旧会话😀', '/tmp/migration', 'READY')`);
    await database.db.execute(sql`insert into agent_runs (id, session_id, task_id, status)
      values (${oldRunId}, ${sessionId}, ${original.id}, 'COMPLETED')`);
    await new TaskRepository(database.db).update(original.id, {
      status: 'IN_PROGRESS',
      sessionId,
      assignedAgentId: agent.id,
    });
    const before = await new TaskRepository(database.db).get(original.id);
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    let sessions = new SessionRepository(database.db);
    let runs = new RunRepository(database.db);
    let tasks = new TaskRepository(database.db);
    expect(await tasks.get(original.id)).toEqual(before);
    expect((await sessions.get(sessionId))?.title).toBe('旧会话😀');
    expect((await sessions.get(sessionId))?.latestRunId).toBeNull();
    expect((await runs.get(oldRunId))?.status).toBe('COMPLETED');
    // Historical admission is unknown, not guessed from timestamps.
    expect(await tasks.tryApplyRunOutcome(original.id, oldRunId, 'COMPLETED')).toBe(false);
    expect(await tasks.get(original.id)).toEqual(before);
    const latest = await runs.create({
      id: randomUUID(),
      sessionId,
      taskId: original.id,
      status: 'RUNNING',
    });
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    sessions = new SessionRepository(database.db);
    runs = new RunRepository(database.db);
    tasks = new TaskRepository(database.db);
    expect((await sessions.get(sessionId))?.latestRunId).toBe(latest.id);
    expect(await runs.list(sessionId)).toHaveLength(2);
    expect(await tasks.get(original.id)).toEqual(before);
    await runs.transition(latest.id, 'COMPLETED');
    expect(await tasks.tryApplyRunOutcome(original.id, latest.id, 'COMPLETED')).toBe(true);
  } finally {
    await database?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
