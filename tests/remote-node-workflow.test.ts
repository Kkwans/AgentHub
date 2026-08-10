import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { AgentHubNodeCommandExecutor } from '../apps/node/src/command-executor.js';
import { RemoteNodeClient } from '../apps/node/src/node-client.js';
import { startServer, type RunningServer } from '../apps/server/src/index.js';
import { FakeAgentAdapter } from '../packages/agent-core/src/index.js';
import type { RemoteAgentInventoryEntry } from '../packages/shared/src/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);

describe('Remote Node Project → Agent → Approval 闭环', () => {
  let fixtureRoot: string;
  let projectRoot: string;
  let running: RunningServer;
  let apiRoot: string;
  let client: RemoteNodeClient;
  let clientRun: Promise<void>;

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'agenthub-remote-workflow-'));
    projectRoot = join(fixtureRoot, 'remote-project');
    await mkdir(projectRoot);
    await execFile('/usr/bin/git', ['init', '-b', 'main'], { cwd: projectRoot });
    await execFile('/usr/bin/git', ['config', 'user.name', 'Remote Fixture'], { cwd: projectRoot });
    await execFile('/usr/bin/git', ['config', 'user.email', 'remote@example.invalid'], {
      cwd: projectRoot,
    });
    await writeFile(join(projectRoot, 'README.md'), '# Remote Node fixture\n');
    await execFile('/usr/bin/git', ['add', 'README.md'], { cwd: projectRoot });
    await execFile('/usr/bin/git', ['commit', '-m', 'chore: 初始化远程 fixture'], {
      cwd: projectRoot,
    });

    running = await startServer({
      ...process.env,
      AGENTHUB_HOST: '127.0.0.1',
      AGENTHUB_PORT: '0',
      AGENTHUB_AUTH_MODE: 'local_trusted',
      AGENTHUB_DATA_DIR: join(fixtureRoot, 'pgdata'),
      AGENTHUB_WORKTREE_ROOT: join(fixtureRoot, 'worktrees'),
      LOG_LEVEL: 'silent',
    });
    const address = running.server.address();
    if (!address || typeof address === 'string') throw new Error('测试 Server 端口不可用');
    apiRoot = `http://127.0.0.1:${address.port}/api/v1`;

    const registration = await api<{ token: string }>('/remote-nodes/registration-tokens', {
      method: 'POST',
      body: { name: 'Remote workflow fixture', allowedRoots: [projectRoot] },
    });
    client = new RemoteNodeClient(
      {
        serverUrl: `ws://127.0.0.1:${address.port}/node/ws`,
        dataDir: join(fixtureRoot, 'node-identity'),
        name: 'Remote workflow fixture',
        roots: [projectRoot],
        registrationToken: registration.token,
      },
      new AgentHubNodeCommandExecutor(
        [projectRoot],
        new FakeAgentAdapter({ scenario: 'approval' }),
      ),
      async () => inventory(),
    );
    clientRun = client.run();
    await waitFor(
      async () => (await api<Array<{ status: string }>>('/remote-nodes'))[0]?.status === 'ONLINE',
    );
  }, 60_000);

  afterAll(async () => {
    client.stop();
    await clientRun;
    await running.close();
    await rm(fixtureRoot, { recursive: true, force: true });
  }, 60_000);

  it('远程 Project、只读文件、Agent preflight、Approval、cancel 与 close 全部可追踪', async () => {
    const [node] = await api<Array<{ id: string; targetId: string }>>('/remote-nodes');
    if (!node) throw new Error('Remote Node 不存在');
    const project = await api<{ id: string; repoKind: string; realRootPath: string }>('/projects', {
      method: 'POST',
      body: { name: 'Remote fixture', targetId: node.targetId, rootPath: projectRoot },
    });
    expect(project).toMatchObject({ repoKind: 'GIT', realRootPath: projectRoot });
    const tree = await api<Array<{ path: string }>>(`/projects/${project.id}/files?depth=1`);
    expect(tree.some((entry) => entry.path === 'README.md')).toBe(true);
    const file = await api<{ content: string; readOnly: boolean }>(
      `/projects/${project.id}/files/content?path=README.md`,
    );
    expect(file).toMatchObject({ content: '# Remote Node fixture\n', readOnly: true });
    expect(await readFile(join(projectRoot, 'README.md'), 'utf8')).toBe(file.content);

    const agent = await api<{ id: string }>('/agents', {
      method: 'POST',
      body: { name: 'Remote Codex', targetId: node.targetId, agentKind: 'CODEX' },
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
        title: 'Remote Approval fixture',
        cwd: projectRoot,
        branch: 'main',
      },
    });
    const firstRun = await api<{ id: string }>(`/sessions/${session.id}/runs`, {
      method: 'POST',
      body: { text: '请求一次远程 Approval' },
    });
    const approval = await waitForValue(
      async () =>
        (
          await api<Array<{ id: string; optionsJson: Array<{ id: string }> }>>(
            `/approvals?sessionId=${session.id}`,
          )
        )[0],
    );
    await api(`/approvals/${approval.id}/resolve`, {
      method: 'POST',
      body: { optionId: approval.optionsJson[0]!.id },
    });
    await waitForRun(session.id, firstRun.id, 'COMPLETED');

    const secondRun = await api<{ id: string }>(`/sessions/${session.id}/runs`, {
      method: 'POST',
      body: { text: '请求后取消' },
    });
    await waitForValue(
      async () => (await api<Array<{ id: string }>>(`/approvals?sessionId=${session.id}`))[0],
    );
    await api(`/sessions/${session.id}/runs/${secondRun.id}/cancel`, { method: 'POST' });
    await waitForRun(session.id, secondRun.id, 'CANCELED');
    await api(`/sessions/${session.id}/close`, { method: 'POST' });
    expect((await api<{ status: string }>(`/sessions/${session.id}`)).status).toBe('CLOSED');
  }, 60_000);

  async function waitForRun(sessionId: string, runId: string, status: string) {
    return waitForValue(async () =>
      (await api<Array<{ id: string; status: string }>>(`/sessions/${sessionId}/runs`)).find(
        (run) => run.id === runId && run.status === status,
      ),
    );
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
      error?: { code: string; message: string };
    };
    if (!response.ok || envelope.data === undefined) {
      throw new Error(
        `${options.method ?? 'GET'} ${path} 失败：${response.status} ${envelope.error?.code ?? ''} ${envelope.error?.message ?? ''}`,
      );
    }
    return envelope.data;
  }
});

function inventory(): RemoteAgentInventoryEntry[] {
  return [
    {
      key: 'codex',
      name: 'Codex',
      agentKind: 'CODEX',
      adapterKind: 'ACP_STDIO',
      status: 'AVAILABLE',
      capabilities: {
        sessions: true,
        streaming: true,
        approvals: true,
        files: true,
        terminal: true,
      },
    },
  ];
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
  await waitForValue(async () => ((await predicate()) ? true : undefined), timeoutMs);
}

async function waitForValue<T>(producer: () => Promise<T | undefined>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await producer();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('等待 Remote Node workflow 状态超时');
}
