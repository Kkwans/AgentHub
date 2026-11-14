import { PassThrough } from 'node:stream';
import {
  ResourceCleanupUnconfirmedError,
  type AgentProfile,
  type ProcessResult,
} from '@agenthub/agent-core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AcpAdapter } from './acp-adapter.js';

const control = vi.hoisted(() => ({
  failureMethod: '',
  unsupported: false,
  setupFails: false,
  waitFails: false,
  failure: new Error('private provider setup diagnostic'),
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
      if (control.setupFails) throw control.failure;
      return {
        agent: {
          request: async (method: string) => {
            if (method === control.failureMethod) throw control.failure;
            if (method === 'initialize')
              return {
                protocolVersion: 1,
                agentCapabilities: control.unsupported
                  ? {}
                  : { loadSession: true, sessionCapabilities: { resume: {} } },
              };
            return {
              sessionId: 'external-fixture',
              modes: {
                currentModeId: 'default',
                availableModes: [{ id: 'readonly', name: 'Read only' }],
              },
            };
          },
        },
        close: control.close,
      };
    },
  }),
}));
const profile: AgentProfile = {
  id: 'prehandle',
  name: 'Fixture',
  agentKind: 'CUSTOM_ACP',
  adapterKind: 'ACP_STDIO',
  targetKind: 'LOCAL_HOST',
  launchSpec: { kind: 'HOST_PROCESS', executable: process.execPath, args: [] },
  // No strict flag: the lifecycle API itself must guarantee pre-handle cleanup.
  config: { preflightStrictCleanup: false },
};
const streams: PassThrough[] = [];
beforeEach(() => {
  control.failureMethod = '';
  control.unsupported = false;
  control.setupFails = false;
  control.waitFails = false;
  control.close.mockReset();
});
afterEach(() => streams.splice(0).forEach((stream) => stream.destroy()));
function fixture(cancelFails: boolean) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  streams.push(stdin, stdout);
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
  const cancellation = new Error('private termination diagnostics');
  const cancel = vi.fn(async () => {
    if (cancelFails) throw cancellation;
    return result;
  });
  const launch = vi.fn(async () => ({
    stdin,
    stdout,
    cancel,
    wait: () => {
      if (control.waitFails) throw control.failure;
      return new Promise<ProcessResult>(() => {});
    },
  }));
  return { adapter: new AcpAdapter({ launcher: { launch } }), cancel, launch };
}
const input = {
  sessionId: 'internal',
  projectId: 'project',
  cwd: '/tmp',
  profile,
  externalSessionId: 'existing',
};

it.each(['create', 'load', 'resume'] as const)(
  '%s initialize failure cleanup unknown is generic even with strict flag off',
  async (kind) => {
    control.failureMethod = 'initialize';
    const f = fixture(true);
    const operation =
      kind === 'create'
        ? f.adapter.createSession(input)
        : kind === 'load'
          ? f.adapter.loadSession(input)
          : f.adapter.resumeSession(input);
    const error = await operation.catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ResourceCleanupUnconfirmedError);
    expect(error).toMatchObject({
      code: 'RESOURCE_CLEANUP_UNCONFIRMED',
      cause: expect.objectContaining({ code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED' }),
    });
    expect((error as Error).message).not.toContain('private');
    expect(f.cancel).toHaveBeenCalledOnce();
  },
);
it.each(['session/new', 'session/load', 'session/resume', 'session/set_mode'])(
  '%s failure retains original cause when cleanup is unknown',
  async (method) => {
    control.failureMethod = method;
    const f = fixture(true);
    const operation =
      method === 'session/load'
        ? f.adapter.loadSession(input)
        : method === 'session/resume'
          ? f.adapter.resumeSession(input)
          : f.adapter.createSession({
              ...input,
              ...(method === 'session/set_mode' ? { mode: 'readonly' } : {}),
            });
    const error = await operation.catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ResourceCleanupUnconfirmedError);
    expect((error as Error & { cause: AggregateError }).cause.errors[0]).toBe(control.failure);
    expect(f.cancel).toHaveBeenCalledOnce();
  },
);
it.each(['load', 'resume'] as const)(
  '%s unsupported capability does not skip strict cleanup',
  async (kind) => {
    control.unsupported = true;
    const f = fixture(true);
    await expect(
      kind === 'load' ? f.adapter.loadSession(input) : f.adapter.resumeSession(input),
    ).rejects.toBeInstanceOf(ResourceCleanupUnconfirmedError);
    expect(f.cancel).toHaveBeenCalledOnce();
  },
);
it.each(['setup', 'handle-construction'] as const)(
  '%s failure after spawn still attempts strict cleanup',
  async (kind) => {
    control.setupFails = kind === 'setup';
    control.waitFails = kind === 'handle-construction';
    const f = fixture(true);
    await expect(f.adapter.createSession(input)).rejects.toBeInstanceOf(
      ResourceCleanupUnconfirmedError,
    );
    expect(f.cancel).toHaveBeenCalledOnce();
  },
);
it('confirmed process cleanup preserves ordinary initialization failure, not generic unknown', async () => {
  control.failureMethod = 'session/new';
  const f = fixture(false);
  await expect(f.adapter.createSession(input)).rejects.toBe(control.failure);
  expect(f.cancel).toHaveBeenCalledOnce();
});
it('capability discovery forces strict cleanup and surfaces generic unknown without caching success', async () => {
  const f = fixture(true);
  await expect(f.adapter.getCapabilities(profile)).rejects.toBeInstanceOf(
    ResourceCleanupUnconfirmedError,
  );
  await expect(f.adapter.getCapabilities(profile)).rejects.toBeInstanceOf(
    ResourceCleanupUnconfirmedError,
  );
  expect(f.launch).toHaveBeenCalledTimes(2);
  expect(f.cancel).toHaveBeenCalledTimes(2);
  expect(profile.config.preflightStrictCleanup).toBe(false);
});
it('confirmed capability discovery remains cached without launching another process', async () => {
  const f = fixture(false);
  await f.adapter.getCapabilities(profile);
  await f.adapter.getCapabilities(profile);
  expect(f.launch).toHaveBeenCalledOnce();
  expect(f.cancel).toHaveBeenCalledOnce();
});
