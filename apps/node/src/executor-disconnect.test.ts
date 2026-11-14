import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  FakeAgentAdapter,
  ResourceCleanupUnconfirmedError,
  type AgentSessionHandle,
  type NormalizedAgentEvent,
} from '@agenthub/agent-core';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentHubNodeCommandExecutor } from './command-executor.js';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function fixture(timeout = 1000) {
  const root = await mkdtemp(join(tmpdir(), 'node-disconnect-fixture-'));
  roots.push(root);
  const adapter = new FakeAgentAdapter({ scenario: 'idle' });
  const executor = new AgentHubNodeCommandExecutor([root], adapter, timeout);
  const payload = {
    agentId: randomUUID(),
    name: 'Fixture',
    agentKind: 'CODEX',
    cwd: root,
    sessionId: randomUUID(),
    projectId: randomUUID(),
  };
  return { root, adapter, executor, payload };
}
it('same-session reservation prevents concurrent acquisition and ordinary failure releases it', async () => {
  const f = await fixture();
  const entered = deferred<void>();
  const result = deferred<AgentSessionHandle>();
  const create = f.adapter.createSession.bind(f.adapter);
  const spy = vi.spyOn(f.adapter, 'createSession').mockImplementationOnce(async () => {
    entered.resolve();
    return result.promise;
  });
  const first = f.executor.execute('session.create', f.payload);
  const failure = expect(first).rejects.toThrow('fixture');
  await entered.promise;
  await expect(f.executor.execute('session.create', f.payload)).rejects.toMatchObject({
    code: 'REMOTE_SESSION_EXISTS',
  });
  expect(spy).toHaveBeenCalledOnce();
  result.reject(new Error('fixture ordinary failure'));
  await failure;
  spy.mockImplementation(create);
  await f.executor.execute('session.create', f.payload);
  expect(spy).toHaveBeenCalledTimes(2);
  await f.executor.disconnect();
});
it('disconnect waits for late create, closes it once and never activates it in the next epoch', async () => {
  const f = await fixture();
  const entered = deferred<void>();
  const release = deferred<void>();
  const create = f.adapter.createSession.bind(f.adapter);
  let close!: ReturnType<typeof vi.spyOn>;
  vi.spyOn(f.adapter, 'createSession').mockImplementationOnce(async (input) => {
    entered.resolve();
    await release.promise;
    const handle = await create(input);
    close = vi.spyOn(handle, 'close');
    return handle;
  });
  const sink = vi.fn();
  f.executor.setEventSink(sink);
  const pending = f.executor.execute('session.create', f.payload);
  const rejected = expect(pending).rejects.toMatchObject({ code: 'NODE_EXECUTOR_STOPPING' });
  await entered.promise;
  const stop = f.executor.disconnect();
  expect(f.executor.disconnect()).toBe(stop);
  const done = vi.fn();
  void stop.then(done);
  await new Promise((r) => setTimeout(r, 15));
  expect(done).not.toHaveBeenCalled();
  await expect(
    f.executor.execute('session.create', { ...f.payload, sessionId: randomUUID() }),
  ).rejects.toMatchObject({ code: 'NODE_EXECUTOR_STOPPING' });
  release.resolve();
  await rejected;
  await stop;
  expect(close).toHaveBeenCalledOnce();
  expect(sink).not.toHaveBeenCalled();
  await f.executor.beginConnection();
  await f.executor.execute('session.create', f.payload);
  await f.executor.disconnect();
});
it.each([undefined, new Error('fixture')])(
  'close rejection retains handle and sticky disconnect (%s)',
  async (failure) => {
    const f = await fixture();
    const create = f.adapter.createSession.bind(f.adapter);
    let originalClose!: () => Promise<void>;
    const close = vi.fn().mockRejectedValue(failure);
    vi.spyOn(f.adapter, 'createSession').mockImplementation(async (input) => {
      const handle = await create(input);
      originalClose = handle.close.bind(handle);
      handle.close = close;
      return handle;
    });
    await f.executor.execute('session.create', f.payload);
    const stop = f.executor.disconnect();
    await expect(stop).rejects.toBeInstanceOf(ResourceCleanupUnconfirmedError);
    expect(f.executor.disconnect()).toBe(stop);
    await expect(f.executor.beginConnection()).rejects.toBeInstanceOf(
      ResourceCleanupUnconfirmedError,
    );
    expect((f.executor as unknown as { sessions: Map<string, unknown> }).sessions.size).toBe(1);
    expect(close).toHaveBeenCalledOnce();
    await originalClose();
  },
);
it('pending strict preflight timeout is sticky, late READY cannot return success or reopen admission', async () => {
  const f = await fixture(30);
  const started = deferred<void>();
  const probe = deferred<Awaited<ReturnType<FakeAgentAdapter['preflight']>>>();
  const spy = vi.spyOn(f.adapter, 'preflight').mockImplementation(async () => {
    started.resolve();
    return probe.promise;
  });
  const pending = f.executor.execute('agent.preflight', f.payload);
  const failure = expect(pending).rejects.toMatchObject({ code: 'NODE_EXECUTOR_STOPPING' });
  await started.promise;
  expect(spy.mock.calls[0]![0].config.preflightStrictCleanup).toBe(true);
  const stop = f.executor.disconnect();
  await expect(stop).rejects.toBeInstanceOf(ResourceCleanupUnconfirmedError);
  probe.resolve({ status: 'READY', checkedAt: new Date().toISOString(), checks: [] });
  await failure;
  await expect(f.executor.beginConnection()).rejects.toBeInstanceOf(
    ResourceCleanupUnconfirmedError,
  );
  expect(f.executor.disconnect()).toBe(stop);
});
it.each(['agent.preflight', 'agent.capabilities', 'session.create'] as const)(
  '%s resource uncertainty forbids another invocation',
  async (command) => {
    const f = await fixture();
    const method =
      command === 'agent.preflight'
        ? 'preflight'
        : command === 'agent.capabilities'
          ? 'getCapabilities'
          : 'createSession';
    const spy = vi
      .spyOn(f.adapter, method)
      .mockRejectedValue(new ResourceCleanupUnconfirmedError());
    await expect(f.executor.execute(command, f.payload)).rejects.toBeInstanceOf(
      ResourceCleanupUnconfirmedError,
    );
    await expect(f.executor.execute(command, f.payload)).rejects.toMatchObject({
      code: 'NODE_EXECUTOR_STOPPING',
    });
    await expect(f.executor.disconnect()).rejects.toBeInstanceOf(ResourceCleanupUnconfirmedError);
    expect(spy).toHaveBeenCalledOnce();
  },
);

it('old epoch events cannot leak into the replacement connection or remove its handle', async () => {
  const f = await fixture();
  const late = deferred<NormalizedAgentEvent>();
  const create = f.adapter.createSession.bind(f.adapter);
  vi.spyOn(f.adapter, 'createSession').mockImplementationOnce(async (input) => {
    const handle = await create(input);
    handle.events = () => ({
      async *[Symbol.asyncIterator]() {
        yield await late.promise;
      },
    });
    return handle;
  });
  await f.executor.execute('session.create', f.payload);
  await f.executor.disconnect();
  await f.executor.beginConnection();
  const sink = vi.fn();
  f.executor.setEventSink(sink);
  await f.executor.execute('session.create', f.payload);
  late.resolve({
    eventId: 'old',
    sessionId: f.payload.sessionId,
    seq: 1,
    emittedAt: new Date().toISOString(),
    adapterKind: 'FAKE',
    type: 'assistant.message.completed',
    payload: { marker: 'old-epoch' },
  });
  await new Promise((r) => setTimeout(r, 10));
  expect(sink.mock.calls.some((call) => call[1].payload?.marker === 'old-epoch')).toBe(false);
  expect(
    (f.executor as unknown as { sessions: Map<string, unknown> }).sessions.has(f.payload.sessionId),
  ).toBe(true);
  await f.executor.disconnect();
});
