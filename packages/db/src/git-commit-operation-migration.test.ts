import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { createPgliteDatabase } from './client.js';
import { ExecutionTargetRepository, ProjectRepository, TaskRepository } from './repositories.js';
import { gitCommitOperations, gitWriteClaims } from './schema.js';

it('0011升级保留历史数据，未知Git账本/资源锁跨重开保留且不级联删除', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agenthub-git-ledger-migration-'));
  const previousFolder = join(temp, 'previous');
  const root = resolve(import.meta.dirname, '../drizzle');
  const journal = JSON.parse(await readFile(join(root, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const previous = { ...journal, entries: journal.entries.filter((entry) => entry.idx < 11) };
  await mkdir(join(previousFolder, 'meta'), { recursive: true });
  await writeFile(join(previousFolder, 'meta/_journal.json'), JSON.stringify(previous));
  for (const entry of previous.entries)
    await cp(join(root, `${entry.tag}.sql`), join(previousFolder, `${entry.tag}.sql`));
  const dataDir = join(temp, 'db');
  let database: Awaited<ReturnType<typeof createPgliteDatabase>> | undefined;
  try {
    database = await createPgliteDatabase({ dataDir, migrationsFolder: previousFolder });
    const target = await new ExecutionTargetRepository(database.db).create({
      id: randomUUID(),
      name: '历史执行环境',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    const project = await new ProjectRepository(database.db).create({
      id: randomUUID(),
      targetId: target.id,
      name: '历史项目',
      rootPath: '/tmp/ledger-fixture',
      realRootPath: '/tmp/ledger-fixture',
      repoKind: 'GIT',
      status: 'ACTIVE',
    });
    const task = await new TaskRepository(database.db).create({
      id: randomUUID(),
      projectId: project.id,
      title: '历史任务😀',
      status: 'READY',
      description: '迁移不能推断Git执行结果',
      promptVariablesJson: { empty: null, n: 0 },
    });
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    expect(await new ProjectRepository(database.db).get(project.id)).toEqual(project);
    expect(await new TaskRepository(database.db).get(task.id)).toEqual(task);
    expect(await database.db.select().from(gitCommitOperations)).toEqual([]);
    expect(await database.db.select().from(gitWriteClaims)).toEqual([]);
    const input = {
      ownerScope: `browser:${randomUUID()}`,
      operationId: randomUUID(),
      projectId: project.id,
      protocolVersion: 1,
      requestHash: 'a'.repeat(64),
      payloadJson: {
        mode: 'SELECTED',
        paths: ['src/长路径.ts'],
        message: '原始说明',
        expectedHead: null,
      },
      targetId: target.id,
      executionDeviceId: 'device:test-instance',
      repositoryKey: 'device:test-instance:/tmp/ledger-fixture/.git',
      canonicalCommonDir: '/tmp/ledger-fixture/.git',
      worktreeIdentity: '/tmp/ledger-fixture',
      expectedHead: null,
      phase: 'UNKNOWN',
      dispatchToken: randomUUID(),
      workerId: 'test-worker:boot-1',
      beforeHead: null,
      observedAfterHead: 'b'.repeat(40),
      commandExit: 0,
      resultEvidenceJson: { kind: 'OBSERVED_HEAD_ONLY', note: '不是精确提交归属' },
      errorCode: 'RESULT_PERSISTENCE_UNCERTAIN',
      dispatchedAt: new Date('2026-11-13T00:00:00.000Z'),
    };
    const [operation] = await database.db.insert(gitCommitOperations).values(input).returning();
    const [claim] = await database.db
      .insert(gitWriteClaims)
      .values({
        repositoryKey: input.repositoryKey,
        ownerScope: input.ownerScope,
        operationId: input.operationId,
        dispatchToken: input.dispatchToken,
        workerId: input.workerId,
        phase: 'UNKNOWN',
      })
      .returning();
    await expect(database.db.insert(gitCommitOperations).values(input)).rejects.toThrow();
    await expect(
      database.db
        .insert(gitCommitOperations)
        .values({ ...input, operationId: randomUUID(), protocolVersion: 2 }),
    ).rejects.toThrow();
    await expect(
      database.db
        .insert(gitCommitOperations)
        .values({ ...input, operationId: randomUUID(), phase: 'RETRY' }),
    ).rejects.toThrow();
    await expect(
      database.db.insert(gitWriteClaims).values({ ...claim!, repositoryKey: 'other-repository' }),
    ).rejects.toThrow();
    await expect(
      database.db
        .insert(gitWriteClaims)
        .values({ ...claim!, repositoryKey: 'missing-operation', operationId: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      database.db
        .delete(gitCommitOperations)
        .where(
          and(
            eq(gitCommitOperations.ownerScope, input.ownerScope),
            eq(gitCommitOperations.operationId, input.operationId),
          ),
        ),
    ).rejects.toThrow();
    expect(await database.db.select().from(gitWriteClaims)).toEqual([claim]);
    await database.close();
    database = undefined;
    // Re-running migrations when reopening must neither duplicate nor erase the ledger/claim.
    database = await createPgliteDatabase({ dataDir });
    expect(await database.db.select().from(gitCommitOperations)).toEqual([operation]);
    expect(await database.db.select().from(gitWriteClaims)).toEqual([claim]);
    expect(await new ProjectRepository(database.db).get(project.id)).toEqual(project);
    expect(await new TaskRepository(database.db).get(task.id)).toEqual(task);
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    expect(await database.db.select().from(gitCommitOperations)).toEqual([operation]);
    expect(await database.db.select().from(gitWriteClaims)).toEqual([claim]);
  } finally {
    await database?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
