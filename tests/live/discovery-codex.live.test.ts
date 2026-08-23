import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
        AGENTHUB_ACP_PROMPT_TIMEOUT_MS: '300000',
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

      const codexProcessPid = await findCurrentCodexProcess();
      process.kill(-codexProcessPid, 'SIGTERM');
      const disconnected = await waitForValue(async () => {
        const current = await apiRequest<{ status: string }>(apiRoot, `/sessions/${session.id}`);
        return current.status === 'DISCONNECTED' ? current : undefined;
      }, 60_000);
      expect(disconnected.status).toBe('DISCONNECTED');

      const resumed = await apiRequest<{ status: string }>(
        apiRoot,
        `/sessions/${session.id}/resume`,
        { method: 'POST' },
      );
      expect(resumed.status).toBe('READY');
      const resumedRun = await apiRequest<{ id: string }>(apiRoot, `/sessions/${session.id}/runs`, {
        method: 'POST',
        body: { text: '只回复 DISCOVERY_RESUME_OK，不调用任何工具。' },
      });
      const resumedCompleted = await waitForValue(async () => {
        const runs = await apiRequest<
          Array<{ id: string; status: string; errorCode: string | null }>
        >(apiRoot, `/sessions/${session.id}/runs`);
        const current = runs.find((candidate) => candidate.id === resumedRun.id);
        if (current && ['FAILED', 'CANCELED'].includes(current.status)) {
          throw new Error(
            `Discovery Codex resume Run 提前终止：${current.status} ${current.errorCode ?? ''}`,
          );
        }
        return current?.status === 'COMPLETED' ? current : undefined;
      }, 180_000);
      expect(resumedCompleted.status).toBe('COMPLETED');
      const resumedMessages = await apiRequest<Array<{ role: string; text: string | null }>>(
        apiRoot,
        `/sessions/${session.id}/messages`,
      );
      expect(resumedMessages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'ASSISTANT',
            text: expect.stringMatching(/DISCOVERY_RESUME_OK/i),
          }),
        ]),
      );
      await apiRequest(apiRoot, `/sessions/${session.id}/close`, { method: 'POST' });
      const persisted = await apiRequest<{ status: string }>(apiRoot, `/sessions/${session.id}`);
      expect(persisted.status).toBe('CLOSED');
    } finally {
      await running?.close().catch(() => undefined);
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 360_000);

  it('真实 Codex 完成文件变更、Approval、Diff、Commit 与关闭持久化', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'agenthub-codex-workflow-live-'));
    const repoRoot = join(fixtureRoot, 'repository');
    const codexHome = join(fixtureRoot, 'codex-home');
    let running: RunningServer | undefined;

    try {
      await mkdir(repoRoot);
      await mkdir(codexHome);
      await symlink('/home/Kkwans/.codex/auth.json', join(codexHome, 'auth.json'));
      await execFile(gitExecutable, ['init', '-b', 'main'], { cwd: repoRoot });
      await execFile(gitExecutable, ['config', 'user.name', 'AgentHub Codex Workflow Live'], {
        cwd: repoRoot,
      });
      await execFile(gitExecutable, ['config', 'user.email', 'codex-workflow-live@example.invalid'], {
        cwd: repoRoot,
      });
      await writeFile(join(repoRoot, 'README.md'), '# AgentHub Codex workflow live fixture\n');
      await execFile(gitExecutable, ['add', 'README.md'], { cwd: repoRoot });
      await execFile(gitExecutable, ['commit', '-m', 'chore: initialize Codex workflow fixture'], {
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
        AGENTHUB_ACP_PROMPT_TIMEOUT_MS: '300000',
        CODEX_HOME: codexHome,
        LOG_LEVEL: 'silent',
      });
      const address = running.server.address();
      if (!address || typeof address === 'string') throw new Error('无法解析 Codex workflow live 端口');
      const apiRoot = `http://127.0.0.1:${address.port}/api/v1`;

      const target = await apiRequest<{ id: string }>(
        apiRoot,
        '/discovery/runtimes/host%3Alocal/adopt',
        { method: 'POST' },
      );
      const adopted = await apiRequest<{
        agent: { id: string; agentKind: string; status: string };
        preflight: { status: string };
      }>(apiRoot, '/discovery/agents/host%3Acodex/adopt', { method: 'POST' });
      expect(adopted.agent).toMatchObject({ agentKind: 'CODEX', status: 'READY' });
      expect(adopted.preflight.status).toBe('READY');

      const project = await apiRequest<{ id: string }>(apiRoot, '/projects', {
        method: 'POST',
        body: { name: 'Codex workflow live fixture', targetId: target.id, rootPath: repoRoot },
      });
      const session = await apiRequest<{ id: string }>(apiRoot, '/sessions', {
        method: 'POST',
        body: {
          projectId: project.id,
          agentId: adopted.agent.id,
          title: 'Codex workflow live Session',
          cwd: repoRoot,
          branch: 'main',
        },
      });
      const run = await apiRequest<{ id: string }>(apiRoot, `/sessions/${session.id}/runs`, {
        method: 'POST',
        body: {
          text:
            '请在当前 Git 仓库根目录创建 approval-live.txt，文件内容严格为 "AgentHub real Codex approval workflow\\n"。这是端到端测试：请先向用户发起文件写入或编辑权限请求，等待批准后再写入；不要修改其他文件。完成后仅回复 LIVE_CODEX_APPROVAL_DONE。',
        },
      });

      const pending = await waitForValue(async () => {
        const runs = await apiRequest<Array<{ id: string; status: string; errorCode: string | null }>>(
          apiRoot,
          `/sessions/${session.id}/runs`,
        );
        const current = runs.find((candidate) => candidate.id === run.id);
        if (current && ['FAILED', 'CANCELED'].includes(current.status)) {
          throw new Error(`真实 Codex workflow Run 提前终止：${current.status} ${current.errorCode ?? ''}`);
        }
        if (current?.status !== 'WAITING_APPROVAL') return undefined;
        const approvalResponse = await fetch(`${apiRoot}/approvals?sessionId=${session.id}`);
        const approvalEnvelope = (await approvalResponse.json()) as {
          data?: Array<{
            id: string;
            status: string;
            optionsJson: Array<{ id?: string; label?: string; kind?: string }>;
          }>;
        };
        const approvals = approvalEnvelope.data;
        if (!approvalResponse.ok) {
          throw new Error(`读取真实 Codex Approval 失败：${approvalResponse.status}`);
        }
        if (!Array.isArray(approvals)) {
          return undefined;
        }
        return approvals.find((approval) => approval.status === 'PENDING');
      }, 300_000);
      expect(pending.optionsJson.length).toBeGreaterThan(0);
      const allowed =
        pending.optionsJson.find((option) =>
          /allow|accept|once|always/i.test(`${option.id ?? ''} ${option.label ?? ''} ${option.kind ?? ''}`),
        ) ?? pending.optionsJson[0];
      if (!allowed?.id) throw new Error('真实 Codex Approval 没有可选 option id');
      await apiRequest(apiRoot, `/approvals/${pending.id}/resolve`, {
        method: 'POST',
        body: { optionId: allowed.id },
      });

      const completed = await waitForValue(async () => {
        const runs = await apiRequest<Array<{ id: string; status: string; errorCode: string | null }>>(
          apiRoot,
          `/sessions/${session.id}/runs`,
        );
        const current = runs.find((candidate) => candidate.id === run.id);
        if (current && ['FAILED', 'CANCELED'].includes(current.status)) {
          throw new Error(`真实 Codex workflow Run 提前终止：${current.status} ${current.errorCode ?? ''}`);
        }
        // Codex can split one edit into multiple permission requests (for
        // example, a file create followed by a content write). Resolve each
        // newly pending allow option while the same Run remains active.
        const approvalResponse = await fetch(`${apiRoot}/approvals?sessionId=${session.id}`);
        const approvalEnvelope = (await approvalResponse.json()) as {
          data?: Array<{
            id: string;
            status: string;
            optionsJson: Array<{ id?: string; label?: string; kind?: string }>;
          }>;
        };
        for (const approval of approvalEnvelope.data ?? []) {
          if (approval.status !== 'PENDING') continue;
          const allowed =
            approval.optionsJson.find((option) =>
              /allow|accept|once|always/i.test(
                `${option.id ?? ''} ${option.label ?? ''} ${option.kind ?? ''}`,
              ),
            ) ?? approval.optionsJson[0];
          if (allowed?.id) {
            await apiRequest(apiRoot, `/approvals/${approval.id}/resolve`, {
              method: 'POST',
              body: { optionId: allowed.id },
            });
          }
        }
        return current?.status === 'COMPLETED' ? current : undefined;
      }, 300_000);
      expect(completed.status).toBe('COMPLETED');
      const messages = await apiRequest<Array<{ role: string; text: string | null }>>(
        apiRoot,
        `/sessions/${session.id}/messages`,
      );
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'ASSISTANT', text: expect.stringMatching(/LIVE_CODEX_APPROVAL_DONE/i) }),
        ]),
      );

      const fileContent = await readFile(join(repoRoot, 'approval-live.txt'), 'utf8');
      expect(fileContent).toBe('AgentHub real Codex approval workflow\n');
      const status = await apiRequest<{ clean: boolean; entries: Array<{ path: string }> }>(
        apiRoot,
        `/projects/${project.id}/git/status`,
      );
      expect(status.entries.map((entry) => entry.path)).toContain('approval-live.txt');
      // Git does not include an untracked file in `git diff` until it receives
      // an intent-to-add index entry; this mirrors the Workspace file picker
      // before the selected-file commit action.
      await execFile(gitExecutable, ['-C', repoRoot, 'add', '-N', '--', 'approval-live.txt']);
      const diff = await apiRequest<{ patch: string }>(apiRoot, `/projects/${project.id}/git/diff`);
      expect(diff.patch).toContain('approval-live.txt');

      await apiRequest(apiRoot, `/projects/${project.id}/git/commit`, {
        method: 'POST',
        body: {
          message: 'test: 提交真实 Codex Approval 输出',
          mode: 'SELECTED',
          paths: ['approval-live.txt'],
        },
      });
      const commits = await apiRequest<Array<{ subject: string }>>(
        apiRoot,
        `/projects/${project.id}/git/commits?limit=10`,
      );
      expect(commits.some((commit) => commit.subject === 'test: 提交真实 Codex Approval 输出')).toBe(true);

      await apiRequest(apiRoot, `/sessions/${session.id}/close`, { method: 'POST' });
      const persisted = await apiRequest<{ status: string }>(apiRoot, `/sessions/${session.id}`);
      expect(persisted.status).toBe('CLOSED');
    } finally {
      await running?.close().catch(() => undefined);
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 600_000);
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

async function findCurrentCodexProcess(): Promise<number> {
  const { stdout } = await execFile('/usr/bin/ps', ['-eo', 'pid=,ppid=,args=']);
  const match = stdout
    .split('\n')
    .map((line) => line.trim())
    .map((line) => /^(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .find(
      (candidate) =>
        candidate && Number(candidate[2]) === process.pid && /codex/i.test(candidate[3] ?? ''),
    );
  if (!match) throw new Error(`没有找到当前 live 测试进程的 Codex 子进程，pid=${process.pid}`);
  return Number(match[1]);
}
