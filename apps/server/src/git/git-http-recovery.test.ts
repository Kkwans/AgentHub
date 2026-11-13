import { randomUUID } from 'node:crypto';
import { access, chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '@agenthub/agent-core';
import { ExecutionTargetRepository, ProjectRepository } from '@agenthub/db';
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
function address(running: RunningServer) {
  const bound = running.server.address();
  if (!bound || typeof bound === 'string') throw new Error('Expected TCP test server');
  return `http://127.0.0.1:${bound.port}`;
}
async function post(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

it('真实 index HTTP 回执在提交后断线，file PGlite重开后原scope查询且同ID不能提交后续变化', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'agenthub-http-recovery-'));
  const root = join(temporary, 'project');
  await mkdir(root);
  const environment = {
    AGENTHUB_HOST: '127.0.0.1',
    AGENTHUB_PORT: '0',
    AGENTHUB_AUTH_MODE: 'local_trusted',
    AGENTHUB_DATA_DIR: join(temporary, 'database'),
    AGENTHUB_WORKTREE_ROOT: join(temporary, 'worktrees'),
    AGENTHUB_WORKSPACE_ROOTS_JSON: JSON.stringify([temporary]),
    LOG_LEVEL: 'silent',
    AGENTHUB_WEB_DIST: join(temporary, 'no-web'),
  };
  let running: RunningServer | undefined;
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'HTTP Recovery Test']);
    await git(root, ['config', 'user.email', 'http-recovery@example.invalid']);
    await writeFile(join(root, 'one.txt'), 'initial\n');
    await git(root, ['add', 'one.txt']);
    await git(root, ['commit', '-m', 'initial']);
    const before = await git(root, ['rev-parse', 'HEAD']);
    running = await startServer(environment);
    expect(running.database.mode).toBe('pglite');
    const targets = new ExecutionTargetRepository(running.database.db);
    const projects = new ProjectRepository(running.database.db);
    const target = await targets.create({
      id: randomUUID(),
      name: 'temporary local',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'x64',
      status: 'READY',
    });
    const project = await projects.create({
      id: randomUUID(),
      targetId: target.id,
      name: 'temporary',
      rootPath: root,
      realRootPath: root,
      repoKind: 'GIT',
      status: 'ACTIVE',
    });
    const path = `/api/v1/projects/${project.id}/git/commit`;
    const input = {
      protocolVersion: 1,
      operationId: randomUUID(),
      expectedHead: before,
      mode: 'SELECTED',
      paths: ['one.txt'],
      message: 'actual committed write with lost HTTP body',
    };
    await writeFile(join(root, 'one.txt'), 'first write\n');
    let droppedSuccessfulResponse = false;
    // Intercept only transport finalization. Real routing, authentication,
    // coordinator, Git writes and durable settlement all run unchanged.
    running.server.prependListener('request', (request, response) => {
      if (request.url !== path || request.method !== 'POST') return;
      const originalEnd = response.end;
      response.end = ((...args: Parameters<typeof response.end>) => {
        if (response.statusCode === 201) {
          expect(response.headersSent).toBe(false);
          droppedSuccessfulResponse = true;
          response.destroy();
          return response;
        }
        return originalEnd.apply(response, args);
      }) as typeof response.end;
    });
    const lost = await new Promise<{ receivedResponse: boolean; code?: string | undefined }>(
      (resolve, reject) => {
        const request = httpRequest(`${address(running!)}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        });
        request.once('response', (response) => {
          response.resume();
          resolve({ receivedResponse: true });
        });
        request.once('error', (error: NodeJS.ErrnoException) =>
          resolve({ receivedResponse: false, code: error.code }),
        );
        request.setTimeout(10000, () => {
          request.destroy();
          reject(new Error('HTTP write timed out'));
        });
        request.end(JSON.stringify(input));
      },
    );
    expect(droppedSuccessfulResponse).toBe(true);
    expect(lost).toEqual({ receivedResponse: false, code: 'ECONNRESET' });
    const committed = await git(root, ['rev-parse', 'HEAD']);
    expect(committed).not.toBe(before);
    expect(await git(root, ['show', 'HEAD:one.txt'])).toBe('first write');
    await running.close();
    running = undefined;
    await writeFile(join(root, 'one.txt'), 'later unrelated draft\n');
    // Reopen the same on-disk database through full production startup, not just
    // a new service sharing one live connection. No browser or external agent.
    running = await startServer(environment);
    const base = address(running);
    const query = await fetch(`${base}${path}-operations/${input.operationId}`);
    expect(query.status).toBe(200);
    const receipt = (await query.json()).data;
    expect(receipt).toMatchObject({
      scope: 'local-trusted',
      operationId: input.operationId,
      projectId: project.id,
      phase: 'COMMAND_SUCCEEDED',
      commandExit: 0,
      observedAfterHead: committed,
    });
    for (const hidden of ['dispatchToken', 'workerId', 'canonicalCommonDir', 'worktreeIdentity'])
      expect(receipt).not.toHaveProperty(hidden);
    const replay = await post(`${base}${path}`, input);
    expect(replay.status).toBe(409);
    expect((await replay.json()).error.code).toBe('GIT_WRITE_OUTCOME_UNKNOWN');
    const legacy = await post(`${base}${path}`, {
      mode: 'SELECTED',
      paths: ['one.txt'],
      message: 'legacy retry',
    });
    expect(legacy.status).toBe(400);
    expect(await git(root, ['rev-parse', 'HEAD'])).toBe(committed);
    expect(await git(root, ['rev-list', '--count', 'HEAD'])).toBe('2');
    expect(await git(root, ['diff', '--cached'])).toBe('');
    expect(await git(root, ['diff', '--', 'one.txt'])).toContain('+later unrelated draft');
  } finally {
    await running?.close();
    await rm(temporary, { recursive: true, force: true });
  }
}, 30000);

it('真实 index 并发 Git claim 败方持久前置拒绝，同 ID 不重派发且新意图可提交', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'agenthub-http-claim-'));
  const root = join(temporary, 'project');
  const gate = join(temporary, 'hook-gate');
  await mkdir(root);
  await mkdir(gate);
  let running: RunningServer | undefined;
  let winnerRequest: Promise<Response> | undefined;
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'HTTP Claim Test']);
    await git(root, ['config', 'user.email', 'http-claim@example.invalid']);
    await writeFile(join(root, 'one.txt'), 'initial\n');
    await git(root, ['add', 'one.txt']);
    await git(root, ['commit', '-m', 'initial']);
    const before = await git(root, ['rev-parse', 'HEAD']);
    const hook = join(root, '.git', 'hooks', 'pre-commit');
    // A real Git hook holds the first writer after durable DISPATCHED, without
    // replacing the service/coordinator or relying on arbitrary request delays.
    await writeFile(
      hook,
      `#!/bin/sh
set -eu
gate=${JSON.stringify(gate)}
: > "$gate/entered"
i=0
while [ ! -f "$gate/release" ]; do
  i=$((i + 1))
  if [ "$i" -ge 100 ]; then exit 1; fi
  sleep 0.1
done
`,
    );
    await chmod(hook, 0o700);
    running = await startServer({
      AGENTHUB_HOST: '127.0.0.1',
      AGENTHUB_PORT: '0',
      AGENTHUB_AUTH_MODE: 'local_trusted',
      AGENTHUB_DATA_DIR: join(temporary, 'database'),
      AGENTHUB_WORKTREE_ROOT: join(temporary, 'worktrees'),
      AGENTHUB_WORKSPACE_ROOTS_JSON: JSON.stringify([temporary]),
      LOG_LEVEL: 'silent',
      AGENTHUB_WEB_DIST: join(temporary, 'no-web'),
    });
    const targets = new ExecutionTargetRepository(running.database.db);
    const projects = new ProjectRepository(running.database.db);
    const target = await targets.create({
      id: randomUUID(),
      name: 'temporary local',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'x64',
      status: 'READY',
    });
    const project = await projects.create({
      id: randomUUID(),
      targetId: target.id,
      name: 'temporary',
      rootPath: root,
      realRootPath: root,
      repoKind: 'GIT',
      status: 'ACTIVE',
    });
    const url = `${address(running)}/api/v1/projects/${project.id}/git/commit`;
    const winner = {
      protocolVersion: 1,
      operationId: randomUUID(),
      expectedHead: before,
      mode: 'SELECTED',
      paths: ['one.txt'],
      message: 'winner held in real hook',
    };
    const loser = { ...winner, operationId: randomUUID(), message: 'concurrent loser' };
    await writeFile(join(root, 'one.txt'), 'winning write\n');
    winnerRequest = post(url, winner);
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        await access(join(gate, 'entered'));
        break;
      } catch {
        if (Date.now() >= deadline) throw new Error('Real pre-commit hook did not enter');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    const pending = await fetch(`${url}-operations/${winner.operationId}`);
    expect((await pending.json()).data.phase).toBe('DISPATCHED');
    const rejected = await post(url, loser);
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).error.code).toBe('GIT_WRITE_PREWRITE_REJECTED');
    const query = await fetch(`${url}-operations/${loser.operationId}`);
    expect(query.status).toBe(200);
    expect((await query.json()).data).toMatchObject({
      scope: 'local-trusted',
      operationId: loser.operationId,
      phase: 'REJECTED_PREWRITE',
      errorCode: 'GIT_REPOSITORY_CLAIMED',
      commandExit: null,
    });
    expect(await git(root, ['rev-parse', 'HEAD'])).toBe(before);
    await writeFile(join(gate, 'release'), 'release');
    const winnerResponse = await winnerRequest;
    expect(winnerResponse.status).toBe(201);
    const committed = (await winnerResponse.json()).data.sha;
    expect(committed).not.toBe(before);
    expect(await git(root, ['rev-parse', 'HEAD'])).toBe(committed);
    await writeFile(join(root, 'one.txt'), 'new intentional draft\n');
    const replay = await post(url, loser);
    expect(replay.status).toBe(409);
    expect((await replay.json()).error.code).toBe('GIT_WRITE_PREWRITE_REJECTED');
    expect(await git(root, ['rev-parse', 'HEAD'])).toBe(committed);
    expect(await git(root, ['diff', '--cached'])).toBe('');
    expect(await git(root, ['diff', '--', 'one.txt'])).toContain('+new intentional draft');
    const fresh = await post(url, {
      ...loser,
      operationId: randomUUID(),
      expectedHead: committed,
      message: 'new explicit intent',
    });
    expect(fresh.status).toBe(201);
    expect(await git(root, ['show', 'HEAD:one.txt'])).toBe('new intentional draft');
    expect(await git(root, ['rev-list', '--count', 'HEAD'])).toBe('3');
    const stillRejected = await fetch(`${url}-operations/${loser.operationId}`);
    expect((await stillRejected.json()).data).toMatchObject({
      phase: 'REJECTED_PREWRITE',
      errorCode: 'GIT_REPOSITORY_CLAIMED',
      commandExit: null,
    });
  } finally {
    // Release even when an assertion fails so teardown never waits on the gate.
    await writeFile(join(gate, 'release'), 'cleanup');
    await winnerRequest?.catch(() => undefined);
    await running?.close();
    await rm(temporary, { recursive: true, force: true });
  }
}, 30000);
