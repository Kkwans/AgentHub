import { expect, it, vi } from 'vitest';
import type { AgentProfile } from '@agenthub/agent-core';
import { RemoteAgentAdapter } from './remote-agent-adapter.js';
import { RemoteNodeRpcError, type RemoteNodeGateway } from './remote-node-gateway.js';
const profile = {
  id: 'agent',
  name: 'fixture',
  agentKind: 'CODEX',
  adapterKind: 'ACP_STDIO',
  targetKind: 'REMOTE_NODE',
  config: {},
  launchSpec: { kind: 'REMOTE_AGENT', nodeId: 'node', inventoryKey: 'fixture' },
} as AgentProfile;
async function fixture(close: () => Promise<Record<string, unknown>>) {
  const unsubscribe = vi.fn();
  const request = vi.fn(async (_node: string, command: string) =>
    command === 'session.create' ? {} : close(),
  );
  const gateway = {
    request,
    subscribeSession: vi.fn(() => unsubscribe),
  } as unknown as RemoteNodeGateway;
  const handle = await new RemoteAgentAdapter(gateway).createSession({
    profile,
    sessionId: 'session',
    projectId: 'project',
    cwd: '/fixture',
  });
  request.mockClear();
  return { handle, request, unsubscribe };
}
it.each([undefined, null, false, new RemoteNodeRpcError('REMOTE_NODE_RPC_TIMEOUT', 'fixture')])(
  'remote close preserves rejection %s across concurrent/repeated calls',
  async (failure) => {
    let reject!: (error: unknown) => void;
    const f = await fixture(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    const end = f.handle.events()[Symbol.asyncIterator]().next();
    const first = f.handle.close();
    const rejection = expect(first).rejects.toBe(failure);
    expect(f.handle.close()).toBe(first);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledOnce());
    reject(failure);
    await rejection;
    expect(f.handle.close()).toBe(first);
    await expect(f.handle.close()).rejects.toBe(failure);
    expect(f.request).toHaveBeenCalledOnce();
    expect(f.unsubscribe).toHaveBeenCalledOnce();
    expect(await end).toMatchObject({ done: true });
  },
);
it('successful close and synchronous RPC re-entry use one published promise', async () => {
  let nested: Promise<void> | undefined;
  const f = await fixture(async () => {
    nested = f.handle.close();
    return {};
  });
  const first = f.handle.close();
  await first;
  expect(nested).toBe(first);
  expect(f.handle.close()).toBe(first);
  await f.handle.close();
  expect(f.request).toHaveBeenCalledOnce();
  expect(f.unsubscribe).toHaveBeenCalledOnce();
});
