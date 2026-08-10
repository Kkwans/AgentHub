import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type RunningServer } from '../../apps/server/src/index.js';

const enabled = process.env.AGENTHUB_E2E_LIVE === '1';
const liveDescribe = enabled ? describe : describe.skip;
const execFile = promisify(execFileCallback);
const gitExecutable = '/usr/bin/git';

liveDescribe('Worktree Task Runner 真实闭环', () => {
  let fixtureRoot = '';
  let repositoryRoot = '';
  let running: RunningServer | undefined;
  let apiRoot = '';

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'agenthub-worktree-live-'));
    repositoryRoot = join(fixtureRoot, 'repository');
    await mkdir(repositoryRoot, { recursive: true });
    await git(['init', '-b', 'main'], repositoryRoot);
    await git(['config', 'user.name', 'AgentHub Live Test'], repositoryRoot);
    await git(['config', 'user.email', 'agenthub-live@example.invalid'], repositoryRoot);
    await writeFile(join(repositoryRoot, 'README.md'), '# AgentHub Worktree live fixture\n');
    await git(['add', 'README.md'], repositoryRoot);
    await git(['commit', '-m', 'chore: 初始化 live fixture'], repositoryRoot);

    running = await startServer({
      ...process.env,
      AGENTHUB_HOST: '127.0.0.1',
      AGENTHUB_PORT: '0',
      AGENTHUB_AUTH_MODE: 'local_trusted',
      AGENTHUB_DATA_DIR: join(fixtureRoot, 'pgdata'),
      AGENTHUB_WORKTREE_ROOT: join(fixtureRoot, 'managed-worktrees'),
      LOG_LEVEL: 'silent',
    });
    const address = running.server.address();
    if (!address || typeof address === 'string') throw new Error('无法解析 live server 端口');
    apiRoot = `http://127.0.0.1:${address.port}/api/v1`;
  }, 60_000);

  afterAll(async () => {
    await running?.close();
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  }, 60_000);

  it('Codex 在 managed worktree 修改文件，经 Review Gate 后以 merge commit 合入 main', async () => {
    const target = await api<{ id: string }>('/execution-targets', {
      method: 'POST',
      body: {
        name: 'Worktree live host',
        kind: 'LOCAL_HOST',
        hostname: 'localhost',
        os: 'linux',
        arch: process.arch,
      },
    });
    const project = await api<{ id: string; repoKind: string }>('/projects', {
      method: 'POST',
      body: {
        name: 'Worktree live fixture',
        targetId: target.id,
        rootPath: repositoryRoot,
      },
    });
    expect(project.repoKind).toBe('GIT');

    const agent = await api<{ id: string }>('/agents', {
      method: 'POST',
      body: { name: 'Codex Worktree live', targetId: target.id, agentKind: 'CODEX' },
    });
    const preflight = await api<{ status: string }>('/agents/' + agent.id + '/preflight', {
      method: 'POST',
      body: { cwd: repositoryRoot, smokeSession: false },
    });
    expect(preflight.status).toBe('READY');

    const task = await api<{ id: string }>('/tasks', {
      method: 'POST',
      body: {
        projectId: project.id,
        title: '创建 Worktree live 验收文件',
        description:
          '创建 agenthub-worktree-live.txt，文件内容必须精确为 worktree live acceptance 加一个换行。不要修改其他文件。',
        acceptanceCriteria:
          'agenthub-worktree-live.txt 存在且内容精确匹配；完成必要检查后结束本轮。',
      },
    });
    await api(`/tasks/${task.id}/transition`, {
      method: 'POST',
      body: { status: 'READY' },
    });
    const queued = await api<{ execution: { id: string } }>(`/tasks/${task.id}/worktree/queue`, {
      method: 'POST',
      body: { agentId: agent.id },
    });

    const reviewExecution = await waitForReview(queued.execution.id, 180_000);
    expect(reviewExecution.status).toBe('REVIEW');
    expect(reviewExecution.worktreePath).toContain('managed-worktrees');
    const review = await api<{
      patch: string;
      entries: Array<{ path: string }>;
      taskBranch: string;
    }>(`/worktree-executions/${reviewExecution.id}/review`);
    expect(review.entries.some((entry) => entry.path === 'agenthub-worktree-live.txt')).toBe(true);
    expect(review.patch).toContain('worktree live acceptance');
    expect(review.taskBranch).toMatch(/^agenthub\/task-/);

    const merged = await api<{
      execution: { status: string; mergeCommitSha: string };
      merge: { mergeCommitSha: string };
    }>(`/worktree-executions/${reviewExecution.id}/merge`, {
      method: 'POST',
      body: { commitMessage: 'test(worktree): 完成真实隔离执行验收' },
    });
    expect(merged.execution.status).toBe('DONE');
    expect(merged.execution.mergeCommitSha).toBe(merged.merge.mergeCommitSha);
    expect(await readFile(join(repositoryRoot, 'agenthub-worktree-live.txt'), 'utf8')).toBe(
      'worktree live acceptance\n',
    );
    expect(
      (await git(['rev-list', '--parents', '-n', '1', 'HEAD'], repositoryRoot)).trim().split(/\s+/),
    ).toHaveLength(3);
    expect(await git(['worktree', 'list', '--porcelain'], repositoryRoot)).toContain(
      reviewExecution.worktreePath,
    );
  }, 240_000);

  async function waitForReview(
    executionId: string,
    timeoutMs: number,
  ): Promise<{ id: string; status: string; sessionId: string | null; worktreePath: string }> {
    const deadline = Date.now() + timeoutMs;
    const resolvedApprovals = new Set<string>();
    while (Date.now() < deadline) {
      const execution = await api<{
        id: string;
        status: string;
        sessionId: string | null;
        worktreePath: string;
        errorCode: string | null;
        errorMessage: string | null;
      }>(`/worktree-executions/${executionId}`);
      if (execution.status === 'REVIEW') return execution;
      if (['BLOCKED', 'CANCELED', 'DONE'].includes(execution.status)) {
        throw new Error(
          `Worktree live execution 提前终止：${execution.status} ${execution.errorCode ?? ''} ${execution.errorMessage ?? ''}`,
        );
      }
      if (execution.sessionId) {
        const approvals = await api<
          Array<{
            id: string;
            optionsJson: Array<{ id: string; kind?: string; label?: string }>;
          }>
        >(`/approvals?sessionId=${execution.sessionId}`);
        for (const approval of approvals) {
          if (resolvedApprovals.has(approval.id)) continue;
          const option =
            approval.optionsJson.find((candidate) => candidate.kind === 'allow_once') ??
            approval.optionsJson.find((candidate) => /allow|允许/i.test(candidate.label ?? ''));
          if (!option) throw new Error(`Approval ${approval.id} 没有单次允许选项`);
          await api(`/approvals/${approval.id}/resolve`, {
            method: 'POST',
            body: { optionId: option.id },
          });
          resolvedApprovals.add(approval.id);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`等待 Worktree Execution ${executionId} 进入 REVIEW 超时`);
  }

  async function api<T>(
    path: string,
    options: { method?: string; body?: Record<string, unknown> } = {},
  ): Promise<T> {
    const response = await fetch(apiRoot + path, {
      method: options.method ?? 'GET',
      headers: options.body ? { 'content-type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const envelope = (await response.json()) as {
      data?: T;
      error?: { code?: string; message?: string };
    };
    if (!response.ok || envelope.data === undefined) {
      throw new Error(
        `${options.method ?? 'GET'} ${path} 失败：${response.status} ${envelope.error?.code ?? ''} ${envelope.error?.message ?? ''}`,
      );
    }
    return envelope.data;
  }
});

async function git(args: string[], cwd: string): Promise<string> {
  const result = await execFile(gitExecutable, args, { cwd, timeout: 30_000 });
  return result.stdout;
}
