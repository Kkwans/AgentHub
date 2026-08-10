import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPgliteDatabase,
  type DatabaseClient,
  type PgliteAgentHubDatabase,
} from './client.js';
import {
  ApprovalRepository,
  EventRepository,
  PromptRepository,
  WorktreeExecutionRepository,
} from './repositories.js';
import {
  agentRuns,
  agentSessions,
  agents,
  approvalRequests,
  executionTargets,
  projects,
  promptLabels,
  promptVersions,
  runEvents,
  tasks,
} from './schema.js';

interface SeededRun {
  targetId: string;
  projectId: string;
  agentId: string;
  sessionId: string;
  runId: string;
}

describe('数据库不变量', () => {
  let client: DatabaseClient<PgliteAgentHubDatabase>;

  beforeAll(async () => {
    client = await createPgliteDatabase({ dataDir: 'memory://' });
  });

  afterAll(async () => {
    await client.close();
  });

  async function seedRun(): Promise<SeededRun> {
    const targetId = randomUUID();
    const projectId = randomUUID();
    const agentId = randomUUID();
    const sessionId = randomUUID();
    const runId = randomUUID();

    await client.db.insert(executionTargets).values({
      id: targetId,
      name: '当前 NAS',
      kind: 'LOCAL_HOST',
      hostname: 'agenthub-test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    await client.db.insert(projects).values({
      id: projectId,
      name: '测试项目',
      targetId,
      rootPath: '/tmp/project',
      realRootPath: '/tmp/project',
      repoKind: 'GIT',
      status: 'ACTIVE',
    });
    await client.db.insert(agents).values({
      id: agentId,
      targetId,
      name: 'Fake Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      status: 'READY',
    });
    await client.db.insert(agentSessions).values({
      id: sessionId,
      projectId,
      agentId,
      title: '测试 Session',
      cwd: '/tmp/project',
      status: 'READY',
    });
    await client.db.insert(agentRuns).values({ id: runId, sessionId, status: 'RUNNING' });

    return { targetId, projectId, agentId, sessionId, runId };
  }

  it('启动迁移会创建全部 MVP 表', async () => {
    const result = await client.db.execute<{ table_name: string }>(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
    `);
    const names = new Set(result.rows.map((row) => row.table_name));

    expect(names.size).toBeGreaterThanOrEqual(20);
    expect(names.has('projects')).toBe(true);
    expect(names.has('agent_runs')).toBe(true);
    expect(names.has('prompt_versions')).toBe(true);
    expect(names.has('remote_nodes')).toBe(true);
    expect(names.has('remote_node_registration_tokens')).toBe(true);
  });

  it('阻止更新 Prompt Version，并事务移动 Label', async () => {
    const repository = new PromptRepository(client.db);
    const prompt = await repository.createPrompt({
      key: 'review',
      name: '代码审查',
      kind: 'SYSTEM',
      type: 'TEXT',
    });
    const version1 = await repository.createVersion({
      promptId: prompt.id,
      version: 1,
      content: { text: '版本一' },
      source: 'USER',
      contentHash: 'hash-1',
      createdBy: 'test',
    });
    const version2 = await repository.createVersion({
      promptId: prompt.id,
      version: 2,
      content: { text: '版本二' },
      source: 'USER',
      contentHash: 'hash-2',
      createdBy: 'test',
    });

    await expect(
      client.db
        .update(promptVersions)
        .set({ contentJson: { text: '非法更新' } })
        .where(eq(promptVersions.id, version1.id)),
    ).rejects.toThrow();
    const [unchangedVersion] = await client.db
      .select({ contentJson: promptVersions.contentJson })
      .from(promptVersions)
      .where(eq(promptVersions.id, version1.id));
    expect(unchangedVersion?.contentJson).toEqual({ text: '版本一' });

    await repository.moveLabel(prompt.id, 'production', version1.id);
    await repository.moveLabel(prompt.id, 'production', version2.id);
    const [label] = await client.db
      .select()
      .from(promptLabels)
      .where(eq(promptLabels.label, 'production'));
    expect(label?.versionId).toBe(version2.id);

    const other = await repository.createPrompt({
      key: 'other',
      name: '其他 Prompt',
      kind: 'SYSTEM',
      type: 'TEXT',
    });
    const otherVersion = await repository.createVersion({
      promptId: other.id,
      version: 1,
      content: { text: '其他' },
      source: 'USER',
      contentHash: 'hash-other',
      createdBy: 'test',
    });
    await expect(
      repository.moveLabel(prompt.id, 'production', otherVersion.id),
    ).rejects.toMatchObject({
      code: 'PROMPT_VERSION_NOT_IN_PROMPT',
    });
    const [unchanged] = await client.db
      .select()
      .from(promptLabels)
      .where(eq(promptLabels.label, 'production'));
    expect(unchanged?.versionId).toBe(version2.id);
  });

  it('Approval 只解析一次', async () => {
    const { sessionId, runId } = await seedRun();
    const approvalId = randomUUID();
    await client.db.insert(approvalRequests).values({
      id: approvalId,
      sessionId,
      runId,
      externalId: 'permission-1',
      kind: 'TOOL_PERMISSION',
      status: 'PENDING',
      title: '允许执行测试命令吗？',
    });

    const repository = new ApprovalRepository(client.db);
    const first = await repository.resolveExactlyOnce(approvalId, 'APPROVED', {
      optionId: 'allow',
    });
    const duplicate = await repository.resolveExactlyOnce(approvalId, 'REJECTED', {
      optionId: 'reject',
    });

    expect(first.changed).toBe(true);
    expect(duplicate.changed).toBe(false);
    expect(duplicate.approval.status).toBe('APPROVED');
    expect(duplicate.approval.responseJson).toEqual({ optionId: 'allow' });
  });

  it('Session seq 单调递增并拒绝重复序号', async () => {
    const { sessionId, runId } = await seedRun();
    const repository = new EventRepository(client.db);

    const first = await repository.append({
      sessionId,
      runId,
      type: 'assistant.message.delta',
      payload: { text: '你' },
    });
    const second = await repository.append({
      sessionId,
      runId,
      type: 'assistant.message.completed',
      payload: { text: '你好' },
    });

    expect([first.seq, second.seq]).toEqual([1, 2]);
    await expect(
      client.db.insert(runEvents).values({
        id: randomUUID(),
        sessionId,
        runId,
        seq: 2,
        type: 'duplicate',
      }),
    ).rejects.toThrow();

    const [session] = await client.db
      .select({ lastSeq: agentSessions.lastSeq })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId));
    expect(session?.lastSeq).toBe(2);
  });

  it('Worktree Execution 持久化队列并限制每 Project 单活跃项', async () => {
    const { projectId, agentId } = await seedRun();
    const firstTaskId = randomUUID();
    const secondTaskId = randomUUID();
    await client.db.insert(tasks).values([
      {
        id: firstTaskId,
        projectId,
        title: '第一项',
        status: 'IN_PROGRESS',
      },
      {
        id: secondTaskId,
        projectId,
        title: '第二项',
        status: 'IN_PROGRESS',
      },
    ]);
    const repository = new WorktreeExecutionRepository(client.db);
    const first = await repository.create({
      id: randomUUID(),
      taskId: firstTaskId,
      projectId,
      agentId,
      status: 'QUEUED',
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: `agenthub/task-${firstTaskId.slice(0, 8)}`,
    });
    const second = await repository.create({
      id: randomUUID(),
      taskId: secondTaskId,
      projectId,
      agentId,
      status: 'QUEUED',
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      taskBranch: `agenthub/task-${secondTaskId.slice(0, 8)}`,
    });

    await expect(
      repository.create({
        id: randomUUID(),
        taskId: firstTaskId,
        projectId,
        agentId,
        status: 'QUEUED',
        baseBranch: 'main',
        baseSha: 'a'.repeat(40),
        taskBranch: `agenthub/retry-${firstTaskId.slice(0, 8)}`,
      }),
    ).rejects.toThrow();

    expect((await repository.claimNext(projectId))?.id).toBe(first.id);
    expect(await repository.claimNext(projectId)).toBeUndefined();
    expect((await repository.get(second.id))?.status).toBe('QUEUED');
    await expect(repository.transition(first.id, 'DONE')).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
    await repository.transition(first.id, 'RUNNING');
    await repository.transition(first.id, 'REVIEW');
    await repository.transition(first.id, 'MERGING');
    await repository.transition(first.id, 'DONE');
    expect((await repository.claimNext(projectId))?.id).toBe(second.id);
  });
});
