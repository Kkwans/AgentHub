import { randomUUID } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '@agenthub/agent-core';
import {
  AgentRepository,
  ExecutionTargetRepository,
  GitCommitOperationRepository,
  ProjectRepository,
  RunRepository,
  SessionRepository,
  TaskRepository,
  WorktreeExecutionRepository,
  deriveWorktreeMergeOperationId,
} from '@agenthub/db';
import { expect, it } from 'vitest';
import { startServer, type RunningServer } from '../index.js';

async function git(root: string, args: string[]) {
  const result = await runProcess({
    executable: '/usr/bin/git',
    args: ['-C', root, ...args],
    timeoutMs: 10000,
  });
  expect(result.exitCode, result.stderr).toBe(0);
  return result.stdout.trim();
}
async function initialize(root: string) {
  await mkdir(root);
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Worktree HTTP Test']);
  await git(root, ['config', 'user.email', 'worktree-http@example.invalid']);
  await writeFile(join(root, 'one.txt'), 'initial\n');
  await git(root, ['add', 'one.txt']);
  await git(root, ['commit', '-m', 'initial']);
  return git(root, ['rev-parse', 'HEAD']);
}
function origin(running: RunningServer) {
  const bound = running.server.address();
  if (!bound || typeof bound === 'string') throw new Error('Expected TCP server');
  return `http://127.0.0.1:${bound.port}/api/v1`;
}
async function post(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

it('真实 HTTP/Git Worktree 竞争败方显式重试只合并一次，旧键不能派发后续草稿', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agenthub-worktree-retry-http-'));
  const root = join(temp, 'project');
  const otherRoot = join(temp, 'other-project');
  const worktreeRoot = join(temp, 'worktrees');
  const worktree = join(worktreeRoot, 'review');
  const gate = join(temp, 'gate');
  await mkdir(gate);
  let running: RunningServer | undefined;
  let holderRequest: Promise<Response> | undefined;
  try {
    const base = await initialize(root);
    const otherBase = await initialize(otherRoot);
    await mkdir(worktreeRoot);
    await git(root, ['worktree', 'add', '-b', 'task/retry', worktree, 'main']);
    await writeFile(join(worktree, 'review.txt'), 'reviewed change\n');
    await writeFile(
      join(otherRoot, '.git', 'hooks', 'pre-commit'),
      `#!/bin/sh\nset -eu\ngate=${JSON.stringify(gate)}\n: > "$gate/entered"\ni=0\nwhile [ ! -f "$gate/release" ]; do\n i=$((i + 1))\n if [ "$i" -ge 200 ]; then exit 1; fi\n sleep 0.1\ndone\n`,
    );
    await chmod(join(otherRoot, '.git', 'hooks', 'pre-commit'), 0o700);
    const environment = {
      AGENTHUB_HOST: '127.0.0.1',
      AGENTHUB_PORT: '0',
      AGENTHUB_AUTH_MODE: 'local_trusted',
      AGENTHUB_DATA_DIR: join(temp, 'database'),
      AGENTHUB_WORKTREE_ROOT: worktreeRoot,
      AGENTHUB_WORKSPACE_ROOTS_JSON: JSON.stringify([temp]),
      LOG_LEVEL: 'silent',
      AGENTHUB_WEB_DIST: join(temp, 'no-web'),
    };
    running = await startServer(environment);
    expect(running.database.mode).toBe('pglite');
    const db = running.database.db;
    const target = await new ExecutionTargetRepository(db).create({
      id: randomUUID(),
      name: 'test',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'x64',
      status: 'READY',
    });
    const projects = new ProjectRepository(db);
    const project = await projects.create({
      id: randomUUID(),
      targetId: target.id,
      name: 'review',
      rootPath: root,
      realRootPath: root,
      repoKind: 'GIT',
      status: 'ACTIVE',
    });
    const other = await projects.create({
      id: randomUUID(),
      targetId: target.id,
      name: 'holder',
      rootPath: otherRoot,
      realRootPath: otherRoot,
      repoKind: 'GIT',
      status: 'ACTIVE',
    });
    // Seed only the completed Agent/review ownership chain. The test does not
    // claim an actual Agent run; HTTP, ledger, coordinator and all Git are real.
    const agent = await new AgentRepository(db).create({
      id: randomUUID(),
      targetId: target.id,
      name: 'review fixture',
      agentKind: 'CUSTOM_ACP',
      adapterKind: 'ACP_STDIO',
      executable: '/bin/false',
      status: 'READY',
    });
    const tasks = new TaskRepository(db);
    const task = await tasks.create({
      id: randomUUID(),
      projectId: project.id,
      title: 'real Git retry',
      status: 'IN_PROGRESS',
      assignedAgentId: agent.id,
    });
    const session = await new SessionRepository(db).create({
      id: randomUUID(),
      projectId: project.id,
      agentId: agent.id,
      taskId: task.id,
      title: 'review fixture',
      cwd: worktree,
      status: 'READY',
    });
    await tasks.update(task.id, { sessionId: session.id });
    const run = await new RunRepository(db).create({
      id: randomUUID(),
      sessionId: session.id,
      taskId: task.id,
      status: 'COMPLETED',
      dispatchState: 'ATTEMPTED',
    });
    await tasks.update(task.id, { finalRunId: run.id, status: 'WAITING_REVIEW' });
    const executions = new WorktreeExecutionRepository(db);
    const execution = await executions.create({
      id: randomUUID(),
      taskId: task.id,
      projectId: project.id,
      agentId: agent.id,
      sessionId: session.id,
      runId: run.id,
      status: 'REVIEW',
      baseBranch: 'main',
      baseSha: base,
      taskBranch: 'task/retry',
      worktreePath: worktree,
      gitOwnerScope: 'local-trusted',
      gitCreateOperationId: randomUUID(),
    });
    let url = `${origin(running)}/worktree-executions/${execution.id}`;
    const review = (await (await fetch(`${url}/review`)).json()).data;
    expect(review.mergeAdmission).toMatchObject({
      expectedRunId: run.id,
      retryEligible: false,
      mergeAllowed: true,
    });
    const original = {
      expectedRunId: run.id,
      expectedOperationId: review.mergeAdmission.expectedOperationId,
      commitMessage: 'reviewed real change',
    };
    const holderId = randomUUID();
    await writeFile(join(otherRoot, 'one.txt'), 'holder change\n');
    holderRequest = post(`${origin(running)}/projects/${other.id}/git/commit`, {
      protocolVersion: 1,
      operationId: holderId,
      expectedHead: otherBase,
      mode: 'SELECTED',
      paths: ['one.txt'],
      message: 'holder actual Git commit',
    });
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        await access(join(gate, 'entered'));
        break;
      } catch {
        if (Date.now() >= deadline) throw new Error('Real Git hook did not enter');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    const ledger = new GitCommitOperationRepository(db);
    expect((await ledger.get('local-trusted', holderId, other.id))?.phase).toBe('DISPATCHED');
    const failed = await post(`${url}/merge`, original);
    expect(failed.status).toBe(409);
    expect((await failed.json()).error.code).toBe('WORKTREE_GIT_PREWRITE_REJECTED');
    const rejection = await ledger.get('local-trusted', original.expectedOperationId, project.id);
    expect(rejection).toMatchObject({
      phase: 'REJECTED_PREWRITE',
      errorCode: 'GIT_REPOSITORY_CLAIMED',
      dispatchedAt: null,
      commandExit: null,
    });
    expect(await git(root, ['rev-parse', 'HEAD'])).toBe(base);
    expect(await git(worktree, ['rev-parse', 'HEAD'])).toBe(base);
    expect(await git(worktree, ['diff', '--cached'])).toBe('');
    await writeFile(join(gate, 'release'), 'release');
    expect((await holderRequest).status).toBe(201);
    const ready = (await (await fetch(`${url}/review`)).json()).data;
    expect(ready.mergeAdmission).toMatchObject({
      expectedOperationId: original.expectedOperationId,
      retryEligible: true,
      mergeAllowed: true,
    });
    const staleOrdinary = await post(`${url}/merge`, original);
    expect(staleOrdinary.status).toBe(409);
    expect((await staleOrdinary.json()).error.code).toBe('WORKTREE_EXECUTION_CHANGED');
    expect((await executions.get(execution.id))?.gitMergeGeneration).toBe(0);
    const retried = await post(`${url}/merge`, {
      ...original,
      retryOfOperationId: original.expectedOperationId,
    });
    const retryBody = await retried.json();
    expect(retried.status, JSON.stringify(retryBody)).toBe(200);
    expect(retryBody.data.execution).toMatchObject({ status: 'DONE', gitMergeGeneration: 1 });
    const head = await git(root, ['rev-parse', 'HEAD']);
    expect(head).toBe(retryBody.data.execution.mergeCommitSha);
    expect(await git(root, ['rev-list', '--count', 'HEAD'])).toBe('3');
    expect(await git(root, ['rev-list', '--count', '--merges', 'HEAD'])).toBe('1');
    expect(await readFile(join(root, 'review.txt'), 'utf8')).toBe('reviewed change\n');
    expect(await ledger.get('local-trusted', original.expectedOperationId, project.id)).toEqual(
      rejection,
    );
    expect(
      (
        await ledger.get(
          'local-trusted',
          deriveWorktreeMergeOperationId(execution.id, run.id, 1),
          project.id,
        )
      )?.phase,
    ).toBe('COMMAND_SUCCEEDED');
    await running.close();
    running = await startServer(environment);
    url = `${origin(running)}/worktree-executions/${execution.id}`;
    expect((await (await fetch(url)).json()).data).toMatchObject({
      status: 'DONE',
      gitMergeGeneration: 1,
    });
    expect(
      (
        await (
          await fetch(
            `${origin(running)}/projects/${project.id}/git/commit-operations/${original.expectedOperationId}`,
          )
        ).json()
      ).data,
    ).toMatchObject({ phase: 'REJECTED_PREWRITE', errorCode: 'GIT_REPOSITORY_CLAIMED' });
    await writeFile(join(worktree, 'review.txt'), 'later unapproved draft\n');
    for (const body of [
      original,
      { ...original, retryOfOperationId: original.expectedOperationId },
    ]) {
      expect((await post(`${url}/merge`, body)).status).toBe(409);
    }
    expect(await git(root, ['rev-parse', 'HEAD'])).toBe(head);
    expect(await git(root, ['rev-list', '--count', '--merges', 'HEAD'])).toBe('1');
    expect(await git(worktree, ['diff', '--', 'review.txt'])).toContain('+later unapproved draft');
    expect(await git(worktree, ['diff', '--cached'])).toBe('');
  } finally {
    await writeFile(join(gate, 'release'), 'cleanup');
    await holderRequest?.catch(() => undefined);
    await running?.close();
    await rm(temp, { recursive: true, force: true });
  }
}, 30000);
