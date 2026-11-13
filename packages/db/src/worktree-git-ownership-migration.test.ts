import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { createPgliteDatabase } from './client.js';
import {
  AgentRepository,
  ExecutionTargetRepository,
  ProjectRepository,
  TaskRepository,
  WorktreeExecutionRepository,
} from './repositories.js';
import { worktreeExecutions } from './schema.js';

it('0012保持历史Worktree无owner，新enqueue完整ownership跨重开且拒绝半对字段', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agenthub-worktree-owner-migration-'));
  const previousFolder = join(temp, 'previous');
  const root = resolve(import.meta.dirname, '../drizzle');
  const journal = JSON.parse(await readFile(join(root, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const previous = { ...journal, entries: journal.entries.filter((entry) => entry.idx < 12) };
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
      name: '历史宿主',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    const project = await new ProjectRepository(database.db).create({
      id: randomUUID(),
      targetId: target.id,
      name: '历史Project',
      rootPath: '/tmp/worktree-ownership',
      realRootPath: '/tmp/worktree-ownership',
      repoKind: 'GIT',
      status: 'ACTIVE',
    });
    const agent = await new AgentRepository(database.db).create({
      id: randomUUID(),
      targetId: target.id,
      name: '测试Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    const task = await new TaskRepository(database.db).create({
      id: randomUUID(),
      projectId: project.id,
      title: '历史任务',
      status: 'DONE',
    });
    const oldId = randomUUID();
    await database.db.execute(
      sql`insert into worktree_executions (id,task_id,project_id,agent_id,status,base_branch,base_sha,task_branch) values (${oldId},${task.id},${project.id},${agent.id},'DONE','main',${'a'.repeat(40)},'historical-branch')`,
    );
    const {
      gitOwnerScope: omittedOwner,
      gitCreateOperationId: omittedOperation,
      ...oldColumns
    } = getTableColumns(worktreeExecutions);
    void omittedOwner;
    void omittedOperation;
    const [historical] = await database.db
      .select(oldColumns)
      .from(worktreeExecutions)
      .where(eq(worktreeExecutions.id, oldId));
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    const executions = new WorktreeExecutionRepository(database.db);
    expect(await executions.get(oldId)).toEqual({
      ...historical,
      gitOwnerScope: null,
      gitCreateOperationId: null,
    });
    expect(await new TaskRepository(database.db).get(task.id)).toEqual(task);
    const nextTask = await new TaskRepository(database.db).create({
      id: randomUUID(),
      projectId: project.id,
      title: '新任务',
      status: 'READY',
    });
    const gitOwnerScope = `browser:${randomUUID()}`;
    const gitCreateOperationId = randomUUID();
    const queued = await executions.enqueue({
      id: randomUUID(),
      taskId: nextTask.id,
      projectId: project.id,
      agentId: agent.id,
      assignedAgentId: agent.id,
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: 'new-owned-branch',
      gitOwnerScope,
      gitCreateOperationId,
    });
    expect(queued.execution.gitOwnerScope).toBe(gitOwnerScope);
    expect(queued.execution.gitCreateOperationId).toBe(gitCreateOperationId);
    const invalid = {
      id: randomUUID(),
      taskId: task.id,
      projectId: project.id,
      agentId: agent.id,
      status: 'DONE',
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: 'invalid-pair',
    };
    await expect(
      database.db.insert(worktreeExecutions).values({ ...invalid, gitOwnerScope }),
    ).rejects.toThrow();
    await expect(
      database.db.insert(worktreeExecutions).values({ ...invalid, gitCreateOperationId }),
    ).rejects.toThrow();
    expect(await executions.get(oldId)).toEqual({
      ...historical,
      gitOwnerScope: null,
      gitCreateOperationId: null,
    });
    await database.close();
    database = undefined;
    database = await createPgliteDatabase({ dataDir });
    const reopened = new WorktreeExecutionRepository(database.db);
    expect(await reopened.get(queued.execution.id)).toEqual(queued.execution);
    expect(await reopened.get(oldId)).toEqual({
      ...historical,
      gitOwnerScope: null,
      gitCreateOperationId: null,
    });
    expect(await new TaskRepository(database.db).get(task.id)).toEqual(task);
    expect(await database.db.select().from(worktreeExecutions)).toHaveLength(2);
  } finally {
    await database?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
