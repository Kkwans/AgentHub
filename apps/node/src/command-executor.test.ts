import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FakeAgentAdapter, ResourceCleanupUnconfirmedError } from '@agenthub/agent-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentHubNodeCommandExecutor } from './command-executor.js';

describe('AgentHub Node 固定 RPC executor', () => {
  let fixtureRoot: string;
  let projectRoot: string;

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'agenthub-node-executor-'));
    projectRoot = join(fixtureRoot, 'project');
    await mkdir(projectRoot);
    await writeFile(join(projectRoot, 'hello.txt'), '远程只读文件\n');
  });

  afterAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('执行 Project preflight 与只读文件命令并阻止路径逃逸', async () => {
    const executor = new AgentHubNodeCommandExecutor([fixtureRoot], new FakeAgentAdapter());
    await expect(
      executor.execute('project.preflight', { rootPath: projectRoot }),
    ).resolves.toMatchObject({ status: 'READY', canonicalRoot: projectRoot });
    await expect(
      executor.execute('fs.list', { rootPath: projectRoot, requestedPath: '', depth: 1 }),
    ).resolves.toMatchObject({ entries: [expect.objectContaining({ path: 'hello.txt' })] });
    await expect(
      executor.execute('fs.read', { rootPath: projectRoot, requestedPath: 'hello.txt' }),
    ).resolves.toMatchObject({ content: '远程只读文件\n', readOnly: true });
    await expect(
      executor.execute('fs.read', { rootPath: projectRoot, requestedPath: '../hello.txt' }),
    ).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });

    const outside = await mkdtemp(join(tmpdir(), 'agenthub-node-executor-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(join(outside, 'secret.txt'), join(projectRoot, 'escape.txt'));
    await expect(
      executor.execute('fs.read', { rootPath: projectRoot, requestedPath: 'escape.txt' }),
    ).rejects.toMatchObject({ code: 'SYMLINK_ESCAPE' });
    await rm(outside, { recursive: true, force: true });
  });

  it('转发标准 Agent Session 事件且断连时关闭本地 handle', async () => {
    const executor = new AgentHubNodeCommandExecutor([fixtureRoot], new FakeAgentAdapter());
    const events: Array<Record<string, unknown>> = [];
    executor.setEventSink((_sessionId, event) => events.push(event));
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const runId = '22222222-2222-4222-8222-222222222222';
    await executor.execute('agent.preflight', agent(sessionId));
    await executor.execute('session.create', {
      ...agent(sessionId),
      sessionId,
      projectId: '33333333-3333-4333-8333-333333333333',
    });
    await executor.execute('session.run', { sessionId, runId, text: '测试远程事件' });
    await waitFor(() => events.some((event) => event.type === 'run.completed'));
    expect(events.some((event) => event.type === 'assistant.message.completed')).toBe(true);
    await executor.disconnect();
  });

  it('session.close失败保留原handle且封闭准入，disconnect不得翻成功', async () => {
    const adapter = new FakeAgentAdapter();
    const original = adapter.createSession.bind(adapter);
    const failure = new Error('fixture cleanup unknown');
    let originalClose!: () => Promise<void>;
    const close = vi.fn(async (): Promise<void> => {
      throw failure;
    });
    vi.spyOn(adapter, 'createSession').mockImplementation(async (input) => {
      const handle = await original(input);
      originalClose = handle.close.bind(handle);
      handle.close = close;
      return handle;
    });
    const executor = new AgentHubNodeCommandExecutor([fixtureRoot], adapter);
    const sessionId = '55555555-5555-4555-8555-555555555555';
    await executor.execute('session.create', {
      ...agent(sessionId),
      sessionId,
      projectId: '33333333-3333-4333-8333-333333333333',
    });
    await expect(executor.execute('session.close', { sessionId })).rejects.toBeInstanceOf(
      ResourceCleanupUnconfirmedError,
    );
    await expect(executor.execute('session.close', { sessionId })).rejects.toMatchObject({
      code: 'NODE_EXECUTOR_STOPPING',
    });
    expect(close).toHaveBeenCalledOnce();
    await expect(executor.disconnect()).rejects.toBeInstanceOf(ResourceCleanupUnconfirmedError);
    expect(close).toHaveBeenCalledOnce();
    await originalClose(); // fake fixture teardown only; production ledger remains failed.
  });

  function agent(_id: string) {
    return {
      agentId: '44444444-4444-4444-8444-444444444444',
      name: 'Remote Fake Codex',
      agentKind: 'CODEX',
      cwd: projectRoot,
    };
  }
});

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('等待 Node executor 事件超时');
}
