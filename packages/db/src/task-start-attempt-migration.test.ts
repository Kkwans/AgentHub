import { createLegacyAgent } from './migration-test-helpers.js';
import { createLegacySession } from './migration-test-helpers.js';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { createPgliteDatabase } from './client.js';
import {
  ExecutionTargetRepository,
  ProjectRepository,
  SessionRepository,
  TaskRepository,
} from './repositories.js';
import { taskStartAttempts } from './schema.js';

it('0010升级保留历史Task/Session，不猜创建证据，启动尝试跨重开且唯一约束生效', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agenthub-start-attempt-migration-'));
  const oldFolder = join(temp, 'old');
  const root = resolve(import.meta.dirname, '../drizzle');
  const journal = JSON.parse(await readFile(join(root, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const previous = { ...journal, entries: journal.entries.filter((entry) => entry.idx < 10) };
  await mkdir(join(oldFolder, 'meta'), { recursive: true });
  await writeFile(join(oldFolder, 'meta/_journal.json'), JSON.stringify(previous));
  for (const entry of previous.entries)
    await cp(join(root, `${entry.tag}.sql`), join(oldFolder, `${entry.tag}.sql`));
  const dataDir = join(temp, 'db');
  let database: Awaited<ReturnType<typeof createPgliteDatabase>> | undefined;
  try {
    database = await createPgliteDatabase({ dataDir, migrationsFolder: oldFolder });
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
      targetId: target.id,
      name: '旧项目',
      rootPath: '/tmp/migration',
      realRootPath: '/tmp/migration',
      repoKind: 'NONE',
      status: 'ACTIVE',
    });
    const agent = await createLegacyAgent(database.db, {
      id: randomUUID(),
      targetId: target.id,
      name: '旧Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    const task = await new TaskRepository(database.db).create({
      id: randomUUID(),
      projectId: project.id,
      title: '原始任务😀',
      status: 'READY',
      description: '正文与未知创建证据都不能被迁移猜写',
      promptVariablesJson: { empty: null, n: 0 },
    });
    const oldSessions = [];
    for (const status of ['CREATED', 'FAILED', 'READY'])
      oldSessions.push(
        await createLegacySession(database.db, {
          id: randomUUID(),
          projectId: project.id,
          agentId: agent.id,
          taskId: task.id,
          title: `历史${status}`,
          cwd: '/tmp/migration',
          status,
        }),
      );
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    expect(await new TaskRepository(database.db).get(task.id)).toEqual(task);
    for (const session of oldSessions)
      expect(await new SessionRepository(database.db).get(session.id)).toEqual({
        ...session,
        titleRevision: 0,
      });
    expect(await database.db.select().from(taskStartAttempts)).toEqual([]);
    const input = {
      id: randomUUID(),
      taskId: task.id,
      sessionId: oldSessions[0]!.id,
      expectedOldSessionId: oldSessions[1]!.id,
      kind: 'START',
      phase: 'RESERVED',
      projectId: project.id,
      agentId: agent.id,
      inputHash: 'a'.repeat(64),
    };
    const [attempt] = await database.db.insert(taskStartAttempts).values(input).returning();
    // The new table is a foundation only: inserting evidence does not mutate
    // historical Task/Session state or call any runtime.
    expect(await new TaskRepository(database.db).get(task.id)).toEqual(task);
    await expect(
      database.db
        .insert(taskStartAttempts)
        .values({ ...input, id: randomUUID(), sessionId: oldSessions[1]!.id }),
    ).rejects.toThrow();
    await database.db
      .update(taskStartAttempts)
      .set({ phase: 'FAILED_KNOWN' })
      .where(eq(taskStartAttempts.id, input.id));
    await expect(
      database.db
        .insert(taskStartAttempts)
        .values({ ...input, id: randomUUID(), phase: 'FAILED_KNOWN' }),
    ).rejects.toThrow();
    const [next] = await database.db
      .insert(taskStartAttempts)
      .values({
        ...input,
        id: randomUUID(),
        sessionId: oldSessions[1]!.id,
        kind: 'REWORK',
        phase: 'UNKNOWN',
      })
      .returning();
    await expect(
      database.db
        .insert(taskStartAttempts)
        .values({ ...input, id: randomUUID(), sessionId: oldSessions[2]!.id, phase: 'INVALID' }),
    ).rejects.toThrow();
    await expect(
      database.db.insert(taskStartAttempts).values({
        ...input,
        id: randomUUID(),
        sessionId: oldSessions[2]!.id,
        phase: 'FAILED_KNOWN',
        kind: 'INVALID',
      }),
    ).rejects.toThrow();
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    const rows = await database.db.select().from(taskStartAttempts);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === input.id)).toEqual({ ...attempt, phase: 'FAILED_KNOWN' });
    expect(rows.find((row) => row.id === next!.id)).toEqual(next);
    expect(await new TaskRepository(database.db).get(task.id)).toEqual(task);
    for (const session of oldSessions)
      expect(await new SessionRepository(database.db).get(session.id)).toEqual({
        ...session,
        titleRevision: 0,
      });
  } finally {
    await database?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
