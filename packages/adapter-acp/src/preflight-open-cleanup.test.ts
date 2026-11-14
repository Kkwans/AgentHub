import { PassThrough } from 'node:stream';
import type { AgentProfile, ProcessResult } from '@agenthub/agent-core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AcpAdapter } from './acp-adapter.js';

const control = vi.hoisted(() => ({
  setupFails: false,
  setupError: new Error('private setup failure'),
  initializeError: new Error('private initialize failure'),
  closeError: new Error('private connection close failure'),
  close: vi.fn(),
}));
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
    connect() {
      if (control.setupFails) throw control.setupError;
      return {
        agent: {
          request: async () => {
            throw control.initializeError;
          },
        },
        close: control.close,
      };
    },
  }),
}));
const profile: AgentProfile = {
  id: 'open-cleanup',
  name: 'Fixture',
  agentKind: 'CUSTOM_ACP',
  adapterKind: 'ACP_STDIO',
  targetKind: 'LOCAL_HOST',
  launchSpec: { kind: 'HOST_PROCESS', executable: process.execPath, args: [] },
  config: { preflightStrictCleanup: true, preflightSession: false },
};
const streams: PassThrough[] = [];
beforeEach(() => {
  control.setupFails = false;
  control.close.mockReset().mockImplementation(() => {
    throw control.closeError;
  });
});
afterEach(() => streams.splice(0).forEach((stream) => stream.destroy()));
function fixture(cancelFails: boolean) {
  const cancelError = new Error('private process termination failure');
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
  const cancel = vi.fn(async () => {
    if (cancelFails) throw cancelError;
    return result;
  });
  const stdin = new PassThrough(),
    stdout = new PassThrough();
  streams.push(stdin, stdout);
  return {
    cancel,
    cancelError,
    adapter: new AcpAdapter({
      launcher: { launch: async () => ({ stdin, stdout, cancel, wait: async () => result }) },
    }),
  };
}
it('initialize and connection.close failures cannot skip process cancellation; retains all three causes if termination unknown', async () => {
  const f = fixture(true);
  const error = await f.adapter.preflight(profile).catch((value: unknown) => value);
  expect(f.cancel).toHaveBeenCalledOnce();
  expect(control.close).toHaveBeenCalledOnce();
  expect(error).toMatchObject({ code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED' });
  expect((error as Error & { cause: AggregateError }).cause.errors).toEqual([
    control.initializeError,
    control.closeError,
    f.cancelError,
  ]);
  expect((error as Error).message).not.toContain('private');
});
it('post-launch connection setup failure still attempts cancellation and exposes uncertainty rather than BROKEN', async () => {
  control.setupFails = true;
  const f = fixture(true);
  const error = await f.adapter.preflight(profile).catch((value: unknown) => value);
  expect(f.cancel).toHaveBeenCalledOnce();
  expect(control.close).not.toHaveBeenCalled();
  expect(error).toMatchObject({ code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED' });
  expect((error as Error & { cause: AggregateError }).cause.errors).toEqual([
    control.setupError,
    f.cancelError,
  ]);
});
it.each([false, true])(
  'confirmed termination after setup/close failure returns only sanitized BROKEN (setup=%s)',
  async (setupFails) => {
    control.setupFails = setupFails;
    const f = fixture(false);
    const report = await f.adapter.preflight(profile);
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(report.status).toBe('BROKEN');
    expect(JSON.stringify(report)).not.toContain('private');
  },
);
