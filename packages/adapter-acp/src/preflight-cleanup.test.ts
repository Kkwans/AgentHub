import { PassThrough, Writable } from 'node:stream';
import type { AgentProfile, ProcessResult } from '@agenthub/agent-core';
import { afterEach, expect, it, vi } from 'vitest';
import { AcpAdapter } from './acp-adapter.js';
import type { AcpProcessLauncher } from './process-launcher.js';

const profile: AgentProfile = {
  id: 'strict-preflight',
  name: 'Fixture',
  agentKind: 'CUSTOM_ACP',
  adapterKind: 'ACP_STDIO',
  targetKind: 'LOCAL_HOST',
  launchSpec: { kind: 'HOST_PROCESS', executable: process.execPath, args: [] },
  config: { preflightCwd: process.cwd(), preflightSession: false, preflightStrictCleanup: true },
};
const streams: Array<{ destroy(): void }> = [];
afterEach(() => {
  streams.splice(0).forEach((stream) => stream.destroy());
});

function fixture(initializeFails = false, cancelFails = true, sessionFails = false) {
  const cancelError = Object.assign(new Error('private cancellation diagnostics'), {
    code: 'PROCESS_TERMINATION_TIMEOUT',
  });
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
  const requests: string[] = [];
  const launch = vi.fn<AcpProcessLauncher['launch']>(async () => {
    const stdout = new PassThrough();
    let pending = '';
    const stdin = new Writable({
      write(chunk, _encoding, callback) {
        pending += String(chunk);
        let index: number;
        while ((index = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, index);
          pending = pending.slice(index + 1);
          if (!line.trim()) continue;
          const message = JSON.parse(line) as { id?: string | number; method?: string };
          if (message.id !== undefined) {
            requests.push(message.method ?? '');
            stdout.write(
              JSON.stringify(
                initializeFails || (sessionFails && message.method === 'session/new')
                  ? {
                      jsonrpc: '2.0',
                      id: message.id,
                      error: {
                        code: -32603,
                        message:
                          message.method === 'initialize'
                            ? 'private initialize diagnostics'
                            : 'private session diagnostics',
                      },
                    }
                  : {
                      jsonrpc: '2.0',
                      id: message.id,
                      result: {
                        protocolVersion: 1,
                        agentCapabilities: {},
                        agentInfo: { name: 'fixture', version: '1.0.0' },
                      },
                    },
              ) + '\n',
            );
          }
        }
        callback();
      },
    });
    streams.push(stdout, stdin);
    return { stdin, stdout, cancel, wait: async () => result };
  });
  return {
    adapter: new AcpAdapter({ launcher: { launch } }),
    launch,
    cancel,
    cancelError,
    requests,
  };
}

it('strict successful initialize cannot report READY when process termination is unconfirmed; invalidates cached capabilities', async () => {
  const f = fixture();
  await expect(f.adapter.preflight(profile)).rejects.toMatchObject({
    code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED',
    cause: f.cancelError,
  });
  expect(f.requests).toEqual(['initialize']);
  await expect(f.adapter.getCapabilities(profile)).rejects.toMatchObject({
    code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED',
  });
  expect(f.launch).toHaveBeenCalledTimes(2);
  expect(f.cancel).toHaveBeenCalledTimes(2);
});

it('strict initialize failure preserves original and cleanup causes without exposing them as the public message', async () => {
  const f = fixture(true);
  const error = await f.adapter.preflight(profile).catch((value: unknown) => value);
  expect(error).toMatchObject({
    code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED',
    cause: expect.any(AggregateError),
  });
  const actual = error as Error & { cause: AggregateError };
  expect(actual.message).not.toContain('private');
  expect(actual.cause.errors).toHaveLength(2);
  expect(actual.cause.errors[0]).toMatchObject({ message: 'private initialize diagnostics' });
  expect(actual.cause.errors[1]).toBe(f.cancelError);
  expect(f.cancel).toHaveBeenCalledOnce();
});

it('confirmed cleanup retains READY and skips session/new, while legacy direct adapter contract remains unchanged', async () => {
  const strict = fixture(false, false);
  await expect(strict.adapter.preflight(profile)).resolves.toMatchObject({ status: 'READY' });
  expect(strict.requests).toEqual(['initialize']);
  const legacy = fixture();
  await expect(
    legacy.adapter.preflight({
      ...profile,
      config: { ...profile.config, preflightStrictCleanup: false },
    }),
  ).resolves.toMatchObject({ status: 'READY' });
});

it('strict smoke failure and cleanup failure retain both causes without returning a normal failure report', async () => {
  const f = fixture(false, true, true);
  const error = await f.adapter
    .preflight({ ...profile, config: { ...profile.config, preflightSession: true } })
    .catch((value: unknown) => value);
  expect(error).toMatchObject({
    code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED',
    cause: expect.any(AggregateError),
  });
  const causes = (error as Error & { cause: AggregateError }).cause.errors;
  expect(causes[0]).toMatchObject({ message: 'private session diagnostics' });
  expect(causes[1]).toMatchObject({
    code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED',
    cause: f.cancelError,
  });
  expect(f.requests).toEqual(['initialize', 'session/new']);
});

it('strict initialization rejection with confirmed cleanup remains an ordinary sanitized BROKEN report', async () => {
  const f = fixture(true, false);
  const report = await f.adapter.preflight(profile);
  expect(report.status).toBe('BROKEN');
  expect(JSON.stringify(report)).not.toContain('private');
  expect(f.cancel).toHaveBeenCalledOnce();
});
