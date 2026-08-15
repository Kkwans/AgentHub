import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { startServer, type RunningServer } from '../../apps/server/src/index.js';

const enabled = process.env.AGENTHUB_E2E_LIVE === '1';
const liveDescribe = enabled ? describe : describe.skip;
const execFile = promisify(execFileCallback);
const gitExecutable = '/usr/bin/git';

liveDescribe('真实 Server discovery → Codex adopt 闭环', () => {
  it('自动发现并接管本机 Codex，再创建真实 Session', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'agenthub-discovery-codex-live-'));
    const repoRoot = join(fixtureRoot, 'repository');
    const codexHome = join(fixtureRoot, 'codex-home');
    let running: RunningServer | undefined;

    try {
      await mkdir(repoRoot);
      await mkdir(codexHome);
      // Reuse the existing ChatGPT login by reference only; Codex state writes
      // remain isolated in this disposable CODEX_HOME.
      await symlink('/home/Kkwans/.codex/auth.json', join(codexHome, 'auth.json'));
      await execFile(gitExecutable, ['init', '-b', 'main'], { cwd: repoRoot });
      await execFile(gitExecutable, ['config', 'user.name', 'AgentHub Discovery Live'], {
        cwd: repoRoot,
      });
      await execFile(gitExecutable, ['config', 'user.email', 'discovery-live@example.invalid'], {
        cwd: repoRoot,
      });
      await writeFile(join(repoRoot, 'README.md'), '# AgentHub discovery live fixture\n');
      await execFile(gitExecutable, ['add', 'README.md'], { cwd: repoRoot });
      await execFile(gitExecutable, ['commit', '-m', 'chore: initialize discovery fixture'], {
        cwd: repoRoot,
      });

      running = await startServer({
        ...process.env,
        AGENTHUB_HOST: '127.0.0.1',
        AGENTHUB_PORT: '0',
        AGENTHUB_AUTH_MODE: 'local_trusted',
        AGENTHUB_DATA_DIR: join(fixtureRoot, 'pgdata'),
        AGENTHUB_WORKTREE_ROOT: join(fixtureRoot, 'worktrees'),
        AGENTHUB_WORKSPACE_ROOTS_JSON: JSON.stringify([repoRoot]),
        CODEX_HOME: codexHome,
        LOG_LEVEL: 'silent',
      });
      const address = running.server.address();
      if (!address || typeof address === 'string') throw new Error('无法解析 discovery live 端口');
      const apiRoot = `http://127.0.0.1:${address.port}/api/v1`;

      const runtimes = await apiRequest<
        Array<{ candidateId: string; state: string; adoptable: boolean }>
      >(apiRoot, '/discovery/runtimes');
      const host = runtimes.find((candidate) => candidate.candidateId === 'host:local');
      expect(host).toMatchObject({ candidateId: 'host:local', state: 'READY', adoptable: true });

      const target = await apiRequest<{ id: string; kind: string }>(
        apiRoot,
        '/discovery/runtimes/host%3Alocal/adopt',
        { method: 'POST' },
      );
      expect(target.kind).toBe('LOCAL_HOST');

      const candidates = await apiRequest<
        Array<{
          candidateId: string;
          targetId?: string;
          state: string;
          adapterKind: string;
          adoptable: boolean;
        }>
      >(apiRoot, '/discovery/agents');
      const codex = candidates.find((candidate) => candidate.candidateId === 'host:codex');
      expect(codex).toMatchObject({
        candidateId: 'host:codex',
        targetId: target.id,
        adapterKind: 'ACP_STDIO',
        adoptable: true,
      });
      expect(['INSTALLED', 'READY']).toContain(codex?.state);

      const adopted = await apiRequest<{
        agent: { id: string; agentKind: string; status: string };
        preflight: { status: string };
      }>(apiRoot, '/discovery/agents/host%3Acodex/adopt', { method: 'POST' });
      expect(adopted.agent).toMatchObject({ agentKind: 'CODEX', status: 'READY' });
      expect(adopted.preflight.status).toBe('READY');

      const project = await apiRequest<{ id: string; repoKind: string }>(apiRoot, '/projects', {
        method: 'POST',
        body: { name: 'Discovery live fixture', targetId: target.id, rootPath: repoRoot },
      });
      expect(project.repoKind).toBe('GIT');
      const session = await apiRequest<{ id: string }>(apiRoot, '/sessions', {
        method: 'POST',
        body: {
          projectId: project.id,
          agentId: adopted.agent.id,
          title: 'Discovery Codex live Session',
          cwd: repoRoot,
          branch: 'main',
        },
      });
      const run = await apiRequest<{ id: string }>(apiRoot, `/sessions/${session.id}/runs`, {
        method: 'POST',
        body: { text: '只回复 DISCOVERY_OK，不调用任何工具。' },
      });
      const completed = await waitForValue(async () => {
        const runs = await apiRequest<
          Array<{ id: string; status: string; errorCode: string | null }>
        >(apiRoot, `/sessions/${session.id}/runs`);
        const current = runs.find((candidate) => candidate.id === run.id);
        if (current && ['FAILED', 'CANCELED'].includes(current.status)) {
          throw new Error(
            `Discovery Codex live Run 提前终止：${current.status} ${current.errorCode ?? ''}`,
          );
        }
        return current?.status === 'COMPLETED' ? current : undefined;
      }, 180_000);
      expect(completed.status).toBe('COMPLETED');
      const messages = await apiRequest<Array<{ role: string; text: string | null }>>(
        apiRoot,
        `/sessions/${session.id}/messages`,
      );
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'ASSISTANT',
            text: expect.stringMatching(/DISCOVERY_OK/i),
          }),
        ]),
      );

      await waitForValue(async () => {
        const current = await apiRequest<{ status: string }>(apiRoot, `/sessions/${session.id}`);
        return ['READY', 'CLOSED'].includes(current.status) ? current : undefined;
      }, 30_000);
      await apiRequest(apiRoot, `/sessions/${session.id}/close`, { method: 'POST' });
    } finally {
      await running?.close().catch(() => undefined);
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 360_000);
});

async function apiRequest<T>(
  apiRoot: string,
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

async function waitForValue<T>(
  producer: () => Promise<T | undefined>,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await producer();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('等待 discovery Codex live 状态超时');
}
