import { randomUUID } from 'node:crypto';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runProcess } from '@agenthub/agent-core';
import {
  agentRuns,
  agentSessions,
  agents,
  createPgliteDatabase,
  executionTargets,
  GitSnapshotRepository,
  ProjectRepository,
  projects,
} from '@agenthub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GitService } from './git-service.js';

describe('受限 Git Service', () => {
  let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
  let service: GitService;
  let projectId: string;
  let root: string;

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    root = await mkdtemp(join(tmpdir(), 'agenthub-git-'));
    await git(root, ['init']);
    await git(root, ['config', 'user.name', 'AgentHub Test']);
    await git(root, ['config', 'user.email', 'agenthub@example.invalid']);
    await writeFile(join(root, 'tracked.txt'), '初始\n');
    await writeFile(join(root, 'rename.txt'), '待重命名\n');
    await git(root, ['add', '--', 'tracked.txt', 'rename.txt']);
    await git(root, ['commit', '-m', '初始提交']);

    const targetId = randomUUID();
    projectId = randomUUID();
    await database.db.insert(executionTargets).values({
      id: targetId,
      name: '测试宿主机',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    await database.db.insert(projects).values({
      id: projectId,
      name: 'Git Fixture',
      targetId,
      rootPath: root,
      realRootPath: root,
      repoKind: 'GIT',
      status: 'ACTIVE',
    });
    service = new GitService(
      new ProjectRepository(database.db),
      new GitSnapshotRepository(database.db),
    );
  });

  afterAll(async () => {
    await database.close();
  });

  it('读取 status、diff、commits 与 branches', async () => {
    await writeFile(join(root, 'tracked.txt'), '已修改\n');
    const status = await service.status(projectId);
    const diff = await service.diff(projectId, { path: 'tracked.txt' });
    const whitespaceDiff = await service.diff(projectId, {
      path: 'tracked.txt',
      whitespace: 'ignore-all-space',
    });
    const commits = await service.commits(projectId);
    const branches = await service.branches(projectId);

    expect(status.clean).toBe(false);
    expect(status.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'tracked.txt', worktree: 'M' })]),
    );
    await git(root, ['add', '--', 'tracked.txt']);
    await writeFile(join(root, 'tracked.txt'), '已暂存后再次修改\n');
    const dualStatus = await service.status(projectId);
    const dualEntry = dualStatus.entries.find((entry) => entry.path === 'tracked.txt');
    expect(dualEntry).toMatchObject({
      index: 'M',
      worktree: 'M',
      stagedStats: { additions: 1, deletions: 1 },
      worktreeStats: { additions: 1, deletions: 1 },
    });
    expect(diff.patch).toContain('+已修改');
    expect(whitespaceDiff).toMatchObject({ staged: false, whitespace: 'ignore-all-space' });
    expect(commits[0]?.subject).toBe('初始提交');
    expect(branches.some((branch) => branch.current)).toBe(true);
  });

  it('selected-files commit 不混入其他已暂存文件', async () => {
    await git(root, ['add', '--', 'tracked.txt']);
    await writeFile(join(root, 'selected.txt'), '只提交我\n');
    const committed = await service.commit(projectId, {
      message: 'test(git): 只提交所选文件',
      mode: 'SELECTED',
      paths: ['selected.txt'],
    });
    const staged = await git(root, ['diff', '--cached', '--name-only']);
    const committedPaths = await git(root, ['show', '--format=', '--name-only', committed.sha!]);

    expect(staged.stdout.trim()).toBe('tracked.txt');
    expect(committedPaths.stdout.trim()).toBe('selected.txt');
  });

  it('拒绝 traversal 与 symlink escape pathspec', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'agenthub-git-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'secret\n');
    await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'));
    await expect(
      service.commit(projectId, {
        message: '非法提交',
        mode: 'SELECTED',
        paths: ['../secret.txt'],
      }),
    ).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
    await expect(service.diff(projectId, { path: 'escape.txt' })).rejects.toMatchObject({
      code: 'SYMLINK_ESCAPE',
    });
  });

  it('持久化 Run BEFORE/AFTER Git snapshot', async () => {
    const [project] = await database.db.select().from(projects).limit(1);
    if (!project) throw new Error('Project fixture 不存在');
    const agentId = randomUUID();
    const sessionId = randomUUID();
    const runId = randomUUID();
    await database.db.insert(agents).values({
      id: agentId,
      targetId: project.targetId,
      name: 'Snapshot Agent',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      status: 'READY',
    });
    await database.db.insert(agentSessions).values({
      id: sessionId,
      projectId,
      agentId,
      title: 'Snapshot Session',
      cwd: root,
      status: 'READY',
    });
    await database.db.insert(agentRuns).values({ id: runId, sessionId, status: 'RUNNING' });

    await service.capture(runId, projectId, root, 'BEFORE');
    await writeFile(join(root, 'after.txt'), 'after\n');
    await service.capture(runId, projectId, root, 'AFTER');
    const snapshots = await new GitSnapshotRepository(database.db).list(runId);
    expect(snapshots.map((snapshot) => snapshot.snapshotType)).toEqual(['BEFORE', 'AFTER']);
    expect(snapshots[1]?.statusJson).toMatchObject({ clean: false });
  });
});

async function git(cwd: string, args: string[]) {
  const result = await runProcess({
    executable: '/usr/bin/git',
    args: ['-C', cwd, ...args],
    timeoutMs: 10_000,
    maxOutputBytes: 1024 * 1024,
  });
  if (result.exitCode !== 0) throw new Error(`Git fixture 失败：${result.stderr}`);
  return result;
}
