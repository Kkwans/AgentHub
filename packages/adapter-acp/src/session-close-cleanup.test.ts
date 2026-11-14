import { PassThrough } from 'node:stream';
import type { AgentProfile, NormalizedAgentEvent, ProcessResult } from '@agenthub/agent-core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AcpAdapter } from './acp-adapter.js';

const control = vi.hoisted(() => ({ close: vi.fn(), protocolClose: vi.fn() }));
vi.mock('@agentclientprotocol/sdk', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ndJsonStream: () => ({}),
  client: () => ({
    onRequest() {
      return this;
    },
    onNotification() {
      return this;
    },
    connect: () => ({
      agent: {
        notify: async () => undefined,
        request: async (method: string) => {
          if (method === 'initialize')
            return {
              protocolVersion: 1,
              agentCapabilities: { sessionCapabilities: { close: {} } },
            };
          if (method === 'session/new') return { sessionId: 'fixture-session' };
          if (method === 'session/close') return control.protocolClose();
          if (method === 'session/prompt') return new Promise(() => {});
          throw new Error('unexpected fixture request');
        },
      },
      close: control.close,
    }),
  }),
}));
const profile: AgentProfile = {
  id: 'close',
  name: 'Fixture',
  agentKind: 'CUSTOM_ACP',
  adapterKind: 'ACP_STDIO',
  targetKind: 'LOCAL_HOST',
  launchSpec: { kind: 'HOST_PROCESS', executable: process.execPath, args: [] },
  config: {},
};
const streams: PassThrough[] = [];
beforeEach(() => {
  control.close.mockReset();
  control.protocolClose.mockReset().mockResolvedValue({});
});
afterEach(() => streams.splice(0).forEach((stream) => stream.destroy()));
async function fixture(cancel: () => Promise<ProcessResult>, promptTimeoutMs = 300000) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  streams.push(stdin, stdout);
  const adapter = new AcpAdapter({
    promptTimeoutMs,
    launcher: {
      launch: async () => ({ stdin, stdout, wait: () => new Promise(() => {}), cancel }),
    },
  });
  return adapter.createSession({
    sessionId: 'internal',
    projectId: 'project',
    cwd: '/tmp',
    profile,
  });
}
async function events(handle: Awaited<ReturnType<typeof fixture>>) {
  const result: NormalizedAgentEvent[] = [];
  for await (const event of handle.events()) result.push(event);
  return result;
}
it('cancel unknown rejects sticky close, closes queue and never emits success', async () => {
  const cancel = vi
    .fn<() => Promise<ProcessResult>>()
    .mockRejectedValue(new Error('private cancel secret'));
  const handle = await fixture(cancel);
  const first = handle.close();
  expect(handle.close()).toBe(first);
  await expect(first).rejects.toMatchObject({ code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED' });
  expect(handle.close()).toBe(first);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect((await events(handle)).map((e) => e.type)).toEqual(['session.created']);
});
it('protocol and transport failures cannot skip cancellation and remain internal causes', async () => {
  control.protocolClose.mockRejectedValue(new Error('private protocol'));
  control.close.mockImplementation(() => {
    throw new Error('private transport');
  });
  const cancel = vi
    .fn<() => Promise<ProcessResult>>()
    .mockRejectedValue(new Error('private cancel'));
  const handle = await fixture(cancel);
  const error = (await handle.close().catch((failure: unknown) => failure)) as Error & {
    code: string;
    cause: AggregateError;
  };
  expect(error.code).toBe('ACP_PROCESS_CLEANUP_UNCONFIRMED');
  expect(error.message).not.toContain('private');
  expect(error.cause.errors).toHaveLength(3);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect((await events(handle)).some((e) => e.type === 'session.closed')).toBe(false);
});
it('confirmed process stop does not fabricate run cancellation; synchronous close reentry is shared', async () => {
  const cancel = vi.fn<() => Promise<ProcessResult>>().mockResolvedValue({
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    truncated: false,
    canceled: true,
    timedOut: false,
    durationMs: 1,
  });
  const handle = await fixture(cancel);
  let nested: Promise<void> | undefined;
  control.close.mockImplementation(() => {
    nested = handle.close();
  });
  const first = handle.close();
  await first;
  expect(nested).toBe(first);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect((await events(handle)).map((e) => e.type)).toEqual(['session.created', 'session.closed']);
});
it('confirmed termination still surfaces protocol close failure without raw public diagnostics', async () => {
  control.protocolClose.mockRejectedValue(new Error('private protocol'));
  const cancel = vi.fn<() => Promise<ProcessResult>>().mockResolvedValue({
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    truncated: false,
    canceled: true,
    timedOut: false,
    durationMs: 1,
  });
  const handle = await fixture(cancel);
  await expect(handle.close()).rejects.toMatchObject({
    code: 'ACP_SESSION_CLOSE_FAILED',
    message: 'ACP 会话关闭未完整确认',
  });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect((await events(handle)).map((e) => e.type)).toEqual(['session.created', 'session.closed']);
});

it('prompt timeout observes background cleanup rejection but keeps sticky failure for the owner', async () => {
  const cancel = vi
    .fn<() => Promise<ProcessResult>>()
    .mockRejectedValue(new Error('private timer cleanup'));
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const handle = await fixture(cancel, 5);
    await handle.sendTurn({ runId: 'timed-run', text: 'fixture' });
    // Drain proves the timer-triggered close ended its queue without an owner close call.
    const collected = await events(handle);
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
    expect(collected.map((e) => e.type)).toEqual(['session.created', 'run.started', 'run.failed']);
    expect(collected.at(-1)?.payload).toMatchObject({ code: 'ACP_PROMPT_TIMEOUT' });
    expect(collected.at(-1)?.payload.message).not.toContain('已关闭');
    const first = handle.close();
    expect(handle.close()).toBe(first);
    const error = await first.catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED' });
    await expect(handle.close()).rejects.toBe(error);
    expect(cancel).toHaveBeenCalledTimes(1);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
