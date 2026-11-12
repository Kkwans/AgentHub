import { createLegacyTask } from './migration-test-helpers.js';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { createPgliteDatabase } from './client.js';
import {
  AgentRepository,
  WorktreeExecutionRepository,
  ExecutionTargetRepository,
  ProjectRepository,
  PromptRepository,
  TaskRepository,
} from './repositories.js';

it('从0005升级保留既有任务，操作账本与重放跨关闭重开持久化，重复迁移无副作用', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agenthub-operation-migration-'));
  const oldMigrations = join(temp, 'old-migrations');
  const migrationRoot = resolve(import.meta.dirname, '../drizzle');
  const journal = JSON.parse(await readFile(join(migrationRoot, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const previous = { ...journal, entries: journal.entries.filter((entry) => entry.idx < 6) };
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
    const original = await createLegacyTask(
      database.db,
      randomUUID(),
      project.id,
      '原始任务',
      '旧正文😀不丢失',
    );
    const oldPrompts = new PromptRepository(database.db);
    const prompt = await oldPrompts.createPrompt({
      projectId: project.id,
      key: 'migration/old',
      name: '旧资产',
      kind: 'TASK',
      type: 'TEXT',
    });
    const version = await oldPrompts.createVersion({
      promptId: prompt.id,
      version: 1,
      content: { text: '旧Prompt原文😀' },
      source: 'USER',
      contentHash: 'b'.repeat(64),
      createdBy: 'migration-test',
    });
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    let tasks = new TaskRepository(database.db);
    expect(await tasks.get(original.id)).toEqual({ ...original, promptVariablesJson: {} });
    expect(await new PromptRepository(database.db).getPrompt(prompt.id)).toEqual(prompt);
    expect(await new PromptRepository(database.db).getVersionById(prompt.id, version.id)).toEqual(
      version,
    );
    const operation = {
      ownerScope: 'account:test',
      operationId: randomUUID(),
      requestHash: 'a'.repeat(64),
    };
    const input = {
      id: randomUUID(),
      projectId: project.id,
      title: '持久操作',
      status: 'BACKLOG',
      promptVariablesJson: { nested: { name: '跨重开😀', empty: null }, flags: [false, 0] },
    };
    const created = await tasks.createIdempotent(input, operation);
    const agent = await new AgentRepository(database.db).create({
      id: randomUUID(),
      targetId: target.id,
      name: '持久执行Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    await tasks.transition(created.id, 'READY');
    const execution = await new WorktreeExecutionRepository(database.db).enqueue({
      id: randomUUID(),
      taskId: created.id,
      projectId: project.id,
      agentId: agent.id,
      assignedAgentId: agent.id,
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: 'test/persisted',
      configJson: { promptVariables: input.promptVariablesJson },
    });

    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    tasks = new TaskRepository(database.db);
    expect(
      (await tasks.getCreationOperation(operation.ownerScope, operation.operationId))?.taskId,
    ).toBe(created.id);
    expect((await tasks.createIdempotent({ ...input, id: randomUUID() }, operation)).id).toBe(
      created.id,
    );
    expect(await tasks.list()).toHaveLength(2);
    expect((await tasks.get(created.id))?.promptVariablesJson).toEqual(input.promptVariablesJson);
    expect(
      (await new WorktreeExecutionRepository(database.db).get(execution.execution.id))?.configJson
        .promptVariables,
    ).toEqual(input.promptVariablesJson);
    expect(await tasks.get(original.id)).toEqual({ ...original, promptVariablesJson: {} });
    expect(await new PromptRepository(database.db).getPrompt(prompt.id)).toEqual(prompt);
    expect(await new PromptRepository(database.db).getVersionById(prompt.id, version.id)).toEqual(
      version,
    );
  } finally {
    await database?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
