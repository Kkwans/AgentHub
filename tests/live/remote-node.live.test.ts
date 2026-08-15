import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentHubNodeCommandExecutor } from '../../apps/node/src/command-executor.js';
import { RemoteNodeClient } from '../../apps/node/src/node-client.js';
import { startServer, type RunningServer } from '../../apps/server/src/index.js';
import { AcpAdapter, HostAcpProcessLauncher } from '../../packages/adapter-acp/src/index.js';

const enabled = process.env.AGENTHUB_E2E_LIVE === '1';
const liveDescribe = enabled ? describe : describe.skip;
const execFile = promisify(execFileCallback);
const gitExecutable = '/usr/bin/git';

liveDescribe('Remote Node 真实 Codex 闭环', () => {
  let fixtureRoot = '';
  let projectRoot = '';
  let running: RunningServer | undefined;
  let client: RemoteNodeClient | undefined;
  let clientRun: Promise<void> | undefined;
  let apiRoot = '';
  let codexHome = '';

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'agenthub-remote-node-live-'));
    codexHome = join(fixtureRoot, 'codex-home');
    await mkdir(codexHome);
    await symlink('/home/Kkwans/.codex/auth.json', join(codexHome, 'auth.json'));
    projectRoot = join(fixtureRoot, 'project');
    await mkdir(projectRoot);
    await execFile(gitExecutable, ['init', '-b', 'main'], { cwd: projectRoot });
    await execFile(gitExecutable, ['config', 'user.name', 'AgentHub Remote Live'], {
      cwd: projectRoot,
    });
    await execFile(gitExecutable, ['config', 'user.email', 'remote-live@example.invalid'], {
      cwd: projectRoot,
    });
    await writeFile(join(projectRoot, 'README.md'), '# Remote Node live fixture\n');
    await execFile(gitExecutable, ['add', 'README.md'], { cwd: projectRoot });
    await execFile(gitExecutable, ['commit', '-m', 'chore: 初始化 Remote Node live fixture'], {
      cwd: projectRoot,
    });

    running = await startServer({
      ...process.env,
      AGENTHUB_HOST: '127.0.0.1',
      AGENTHUB_PORT: '0',
      AGENTHUB_AUTH_MODE: 'local_trusted',
      AGENTHUB_DATA_DIR: join(fixtureRoot, 'pgdata'),
      AGENTHUB_WORKTREE_ROOT: join(fixtureRoot, 'worktrees'),
      CODEX_HOME: codexHome,
      LOG_LEVEL: 'silent',
    });
    const address = running.server.address();
    if (!address || typeof address === 'string') throw new Error('无法解析 Remote Node live 端口');
    apiRoot = `http://127.0.0.1:${address.port}/api/v1`;

    const registration = await api<{ token: string }>('/remote-nodes/registration-tokens', {
      method: 'POST',
      body: {
        name: 'Remote Codex live',
        allowedRoots: [projectRoot],
        expiresInMinutes: 15,
      },
    });
    client = new RemoteNodeClient(
      {
        serverUrl: `ws://127.0.0.1:${address.port}/node/ws`,
        dataDir: join(fixtureRoot, 'identity'),
        name: 'Remote Codex live',
        roots: [projectRoot],
        registrationToken: registration.token,
      },
      new AgentHubNodeCommandExecutor(
        [projectRoot],
        new AcpAdapter({
          launcher: new HostAcpProcessLauncher({
            resolveEnvironment: async () => ({ ...process.env, CODEX_HOME: codexHome }),
          }),
        }),
      ),
    );
    clientRun = client.run();
    await waitForValue(
      async () =>
        (await api<Array<{ status: string }>>('/remote-nodes'))[0]?.status === 'ONLINE'
          ? true
          : undefined,
      30_000,
    );
  }, 60_000);

  afterAll(async () => {
    client?.stop();
    await clientRun;
    await running?.close();
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  }, 60_000);

  it('Central Server 经 outbound Node 创建真实 Codex Session 并接收流式终态', async () => {
    const [node] = await api<
      Array<{
        id: string;
        targetId: string;
        inventoryJson: Array<{ agentKind: string; status: string }>;
      }>
    >('/remote-nodes');
    if (!node) throw new Error('Remote Node live 未注册');
    expect(node.inventoryJson).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentKind: 'CODEX', status: 'AVAILABLE' }),
      ]),
    );

    const project = await api<{ id: string; repoKind: string }>('/projects', {
      method: 'POST',
      body: { name: 'Remote live fixture', targetId: node.targetId, rootPath: projectRoot },
    });
    expect(project.repoKind).toBe('GIT');
    const agent = await api<{ id: string }>('/agents', {
      method: 'POST',
      body: { name: 'Remote Codex live', targetId: node.targetId, agentKind: 'CODEX' },
    });
    const preflight = await api<{ status: string }>(`/agents/${agent.id}/preflight`, {
      method: 'POST',
      body: { cwd: projectRoot, smokeSession: false },
    });
    expect(preflight.status).toBe('READY');

    const session = await api<{ id: string }>('/sessions', {
      method: 'POST',
      body: {
        projectId: project.id,
        agentId: agent.id,
        title: 'Remote Codex live Session',
        cwd: projectRoot,
        branch: 'main',
      },
    });
    const run = await api<{ id: string }>(`/sessions/${session.id}/runs`, {
      method: 'POST',
      body: { text: '只回复 REMOTE_OK，不调用任何工具。' },
    });
    const completed = await waitForRun(session.id, run.id, 180_000);
    expect(completed.status).toBe('COMPLETED');
    const messages = await api<Array<{ role: string; text: string | null }>>(
      `/sessions/${session.id}/messages`,
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'ASSISTANT', text: expect.stringMatching(/REMOTE_OK/i) }),
      ]),
    );
    // The terminal run event and the session READY transition are persisted
    // independently. Wait for the session state to converge before closing;
    // otherwise a valid completed run can race the close guard.
    await waitForValue(async () => {
      const current = await api<{ status: string }>(`/sessions/${session.id}`);
      return ['READY', 'CLOSED'].includes(current.status) ? current : undefined;
    }, 30_000);
    await api(`/sessions/${session.id}/close`, { method: 'POST' });
  }, 240_000);

  async function waitForRun(sessionId: string, runId: string, timeoutMs: number) {
    const resolvedApprovals = new Set<string>();
    return waitForValue(async () => {
      const approvals = await api<
        Array<{
          id: string;
          status: string;
          optionsJson: Array<{ id: string; kind?: string; label?: string }>;
        }>
      >(`/approvals?sessionId=${sessionId}`);
      for (const approval of approvals) {
        if (approval.status !== 'PENDING' || resolvedApprovals.has(approval.id)) continue;
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
      const found = (
        await api<Array<{ id: string; status: string; errorCode: string | null }>>(
          `/sessions/${sessionId}/runs`,
        )
      ).find((candidate) => candidate.id === runId);
      if (found && ['FAILED', 'CANCELED'].includes(found.status)) {
        throw new Error(`Remote Codex live Run 提前终止：${found.status} ${found.errorCode ?? ''}`);
      }
      return found?.status === 'COMPLETED' ? found : undefined;
    }, timeoutMs);
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

async function waitForValue<T>(producer: () => Promise<T | undefined>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await producer();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('等待 Remote Node live 状态超时');
}
