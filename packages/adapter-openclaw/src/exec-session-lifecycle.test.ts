import {
  FakeAgentAdapter,
  ResourceCleanupUnconfirmedError,
  type AgentProfile,
  type ProcessResult,
} from '@agenthub/agent-core';
import { expect, it, vi } from 'vitest';
import { OpenClawAdapter, type OpenClawExecProcess } from './index.js';
const result: ProcessResult = {
  exitCode: 0,
  signal: null,
  stdout: '',
  stderr: '',
  truncated: false,
  timedOut: false,
  canceled: true,
  durationMs: 1,
};
const profile = {
  id: 'fixture',
  agentKind: 'OPENCLAW',
  adapterKind: 'OPENCLAW_GATEWAY',
  targetKind: 'LOCAL_HOST',
  launchSpec: { kind: 'HOST_PROCESS', executable: '/not-executed', args: [] },
  config: {},
  name: 'Fixture',
} as AgentProfile;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function fixture(launch: () => Promise<OpenClawExecProcess>) {
  const adapter = new OpenClawAdapter({
    primary: new FakeAgentAdapter(),
    preferExec: true,
    exec: { probe: vi.fn(), launch: vi.fn(launch) },
  });
  return adapter.createSession({
    sessionId: 'session',
    projectId: 'project',
    profile,
    cwd: '/not-executed',
  });
}
async function events(session: Awaited<ReturnType<typeof fixture>>) {
  const values = [];
  for await (const event of session.events()) values.push(event.type);
  return values;
}
it('close waits for late launch and termination; concurrent send cannot launch twice', async () => {
  const launched = deferred<OpenClawExecProcess>();
  const canceled = deferred<ProcessResult>();
  const launch = vi.fn(() => launched.promise);
  const cancel = vi.fn(() => canceled.promise);
  const session = await fixture(launch);
  const sending = session.sendTurn({ runId: 'r1', text: 'fixture' });
  const rejected = expect(sending).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
  await expect(session.sendTurn({ runId: 'r2', text: 'fixture' })).rejects.toMatchObject({
    code: 'RUN_ALREADY_ACTIVE',
  });
  const close = session.close();
  expect(session.close()).toBe(close);
  const done = vi.fn();
  void close.then(done);
  launched.resolve({ cancel, wait: vi.fn() });
  await rejected;
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  expect(done).not.toHaveBeenCalled();
  expect(launch).toHaveBeenCalledOnce();
  canceled.resolve(result);
  await close;
  expect(await events(session)).toEqual(['session.created', 'session.closed']);
  await expect(session.sendTurn({ runId: 'r3', text: 'fixture' })).rejects.toMatchObject({
    code: 'SESSION_CLOSED',
  });
});
it.each(['late', 'active'] as const)(
  '%s process cancel rejection keeps repeated close rejected without closed/cancelled events',
  async (phase) => {
    const launched = deferred<OpenClawExecProcess>();
    const cancel = vi.fn().mockRejectedValue(new Error('fixture rejection'));
    const session = await fixture(() => launched.promise);
    const send = session.sendTurn({ runId: 'r', text: 'fixture' });
    const process = { cancel, wait: () => new Promise<ProcessResult>(() => {}) };
    if (phase === 'active') {
      launched.resolve(process);
      await send;
    }
    await Promise.resolve();
    const close = session.close();
    const rejection = expect(close).rejects.toMatchObject({
      code: 'OPENCLAW_EXEC_CLEANUP_UNCONFIRMED',
    });
    if (phase === 'late') {
      const sendFailure = expect(send).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
      launched.resolve(process);
      await sendFailure;
    }
    await rejection;
    expect(session.close()).toBe(close);
    await expect(session.close()).rejects.toMatchObject({
      code: 'OPENCLAW_EXEC_CLEANUP_UNCONFIRMED',
    });
    expect(cancel).toHaveBeenCalledOnce();
    const observed = await events(session);
    expect(observed).not.toContain('session.closed');
    expect(observed).not.toContain('run.cancelled');
  },
);
it.each([false, true])(
  'pending launch rejection genericUnknown=%s is not confused with a returned process',
  async (unknown) => {
    const launched = deferred<OpenClawExecProcess>();
    const session = await fixture(() => launched.promise);
    const send = session.sendTurn({ runId: 'r', text: 'fixture' });
    const sendFailure = expect(send).rejects.toBeDefined();
    await Promise.resolve();
    const close = session.close();
    const stopped = unknown
      ? expect(close).rejects.toMatchObject({ code: 'OPENCLAW_EXEC_CLEANUP_UNCONFIRMED' })
      : expect(close).resolves.toBeUndefined();
    launched.reject(
      unknown ? new ResourceCleanupUnconfirmedError() : new Error('launch rejected before process'),
    );
    await sendFailure;
    await stopped;
    expect(session.close()).toBe(close);
    expect(await events(session)).toEqual(
      unknown ? ['session.created'] : ['session.created', 'session.closed'],
    );
  },
);
it('process kill reports transport failure, never authoritative run.cancelled', async () => {
  const exited = deferred<ProcessResult>();
  const process = { wait: () => exited.promise, cancel: vi.fn(async () => result) };
  const session = await fixture(async () => process);
  await session.sendTurn({ runId: 'r', text: 'fixture' });
  const iterator = session.events()[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.next();
  exited.resolve(result);
  expect((await iterator.next()).value).toMatchObject({
    type: 'run.failed',
    payload: { code: 'OPENCLAW_EXEC_TERMINATED' },
  });
  await session.close();
  expect((await iterator.next()).value.type).toBe('session.closed');
});
it('wait rejection retains process for close and explicit cancel shares termination with close', async () => {
  const canceled = deferred<ProcessResult>();
  const cancel = vi.fn(() => canceled.promise);
  const session = await fixture(async () => ({
    wait: async () => {
      throw new Error('wait unknown');
    },
    cancel,
  }));
  await session.sendTurn({ runId: 'r', text: 'fixture' });
  const iterator = session.events()[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.next();
  expect((await iterator.next()).value.type).toBe('run.failed');
  const cancelling = session.cancel('r');
  const closing = session.close();
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  canceled.resolve(result);
  await Promise.all([cancelling, closing]);
  expect(cancel).toHaveBeenCalledOnce();
});

it('close before scheduled launcher admission invokes no process at all', async () => {
  const launch = vi.fn();
  const session = await fixture(launch);
  const send = session.sendTurn({ runId: 'r', text: 'fixture' });
  const rejected = expect(send).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
  const close = session.close();
  expect(session.close()).toBe(close);
  await rejected;
  await close;
  expect(launch).not.toHaveBeenCalled();
  expect(await events(session)).toEqual(['session.created', 'session.closed']);
});

it('resolved launch racing deferred close still retains late process ownership', async () => {
  const launched = deferred<OpenClawExecProcess>();
  const cancel = vi.fn(async () => result);
  const session = await fixture(() => launched.promise);
  const send = session.sendTurn({ runId: 'r', text: 'fixture' });
  const failed = expect(send).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
  await Promise.resolve();
  launched.resolve({ cancel, wait: vi.fn() });
  const close = session.close();
  await failed;
  await close;
  expect(cancel).toHaveBeenCalledOnce();
  expect(await events(session)).toEqual(['session.created', 'session.closed']);
});

it('generic launch cleanup uncertainty blocks another launch before close', async () => {
  const launch = vi.fn().mockRejectedValue(new ResourceCleanupUnconfirmedError());
  const session = await fixture(launch);
  await expect(session.sendTurn({ runId: 'r', text: 'fixture' })).rejects.toBeInstanceOf(
    ResourceCleanupUnconfirmedError,
  );
  await expect(session.sendTurn({ runId: 'again', text: 'fixture' })).rejects.toMatchObject({
    code: 'OPENCLAW_EXEC_CLEANUP_UNCONFIRMED',
  });
  expect(launch).toHaveBeenCalledOnce();
  await expect(session.close()).rejects.toMatchObject({
    code: 'OPENCLAW_EXEC_CLEANUP_UNCONFIRMED',
  });
});

it.each([undefined, null, false, ''])(
  'falsey cancel rejection %s remains sticky',
  async (failure) => {
    const cancel = vi.fn().mockRejectedValue(failure);
    const session = await fixture(async () => ({
      cancel,
      wait: () => new Promise<ProcessResult>(() => {}),
    }));
    await session.sendTurn({ runId: 'r', text: 'fixture' });
    await expect(session.cancel('r')).rejects.toBe(failure);
    const close = session.close();
    await expect(close).rejects.toMatchObject({ code: 'OPENCLAW_EXEC_CLEANUP_UNCONFIRMED' });
    expect(session.close()).toBe(close);
    await expect(session.close()).rejects.toMatchObject({
      code: 'OPENCLAW_EXEC_CLEANUP_UNCONFIRMED',
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(await events(session)).toEqual(['session.created', 'run.started']);
  },
);
