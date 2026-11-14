import {
  FakeAgentAdapter,
  ResourceCleanupUnconfirmedError,
  type AgentProfile,
  type PreflightReport,
} from '@agenthub/agent-core';
import { expect, it, vi } from 'vitest';
import { OpenClawAdapter } from './index.js';
const profile: AgentProfile = {
  id: 'probe',
  name: 'Fixture',
  agentKind: 'OPENCLAW',
  adapterKind: 'OPENCLAW_GATEWAY',
  targetKind: 'DOCKER_CONTAINER',
  launchSpec: {
    kind: 'DOCKER_EXEC',
    containerName: 'fixture',
    expectedContainerId: 'a'.repeat(64),
    command: 'openclaw',
    args: ['acp'],
    startPolicy: 'MANUAL',
    workspaceMappings: [],
  },
  config: { preflightCwd: '/fixture', preflightStrictCleanup: false },
};
const report = (status: PreflightReport['status']): PreflightReport => ({
  status,
  checkedAt: new Date(0).toISOString(),
  checks: [],
});
function fixture(preferExec = false) {
  const primary = new FakeAgentAdapter();
  const preflight = vi.spyOn(primary, 'preflight').mockResolvedValue(report('READY'));
  const capabilities = vi.spyOn(primary, 'getCapabilities');
  const exec = {
    probe: vi.fn(async () => ({ available: true, message: 'fixture' })),
    launch: vi.fn(),
  };
  return {
    adapter: new OpenClawAdapter({ primary, exec, preferExec }),
    preflight,
    capabilities,
    exec,
  };
}
it.each(['generic', 'ACP'] as const)(
  'capability %s cleanup unknown cannot fall back to EXEC',
  async (kind) => {
    const f = fixture();
    const failure =
      kind === 'generic'
        ? new ResourceCleanupUnconfirmedError({ cause: new Error('private') })
        : Object.assign(new Error('private ACP diagnostics'), {
            code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED',
          });
    f.preflight.mockRejectedValue(failure);
    const error = await f.adapter.getCapabilities(profile).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ResourceCleanupUnconfirmedError);
    expect((error as Error).message).not.toContain('private');
    expect(f.exec.probe).not.toHaveBeenCalled();
    expect(f.preflight.mock.calls[0]![0].config.preflightStrictCleanup).toBe(true);
    expect(f.preflight.mock.calls[0]![0]).not.toBe(profile);
    expect(profile.config.preflightStrictCleanup).toBe(false);
  },
);
it('confirmed primary failure may fall back; cached EXEC does not probe again', async () => {
  const f = fixture();
  f.preflight.mockResolvedValue(report('BROKEN'));
  await f.adapter.getCapabilities(profile);
  await f.adapter.getCapabilities(profile);
  expect(f.preflight).toHaveBeenCalledOnce();
  expect(f.exec.probe).toHaveBeenCalledOnce();
  expect(f.capabilities).not.toHaveBeenCalled();
});
it('cached ACP mode does not repeat composite preflight', async () => {
  const f = fixture();
  await f.adapter.getCapabilities(profile);
  await f.adapter.getCapabilities(profile);
  expect(f.preflight).toHaveBeenCalledOnce();
  expect(f.capabilities).toHaveBeenCalledTimes(2);
  expect(f.exec.probe).not.toHaveBeenCalled();
});
it('explicit EXEC preference reads fixed capabilities without a new probe', async () => {
  const f = fixture(true);
  await f.adapter.getCapabilities(profile);
  expect(f.preflight).not.toHaveBeenCalled();
  expect(f.exec.probe).not.toHaveBeenCalled();
});
it('ordinary preflight retains caller flag/default behavior and profile identity', async () => {
  const f = fixture();
  f.preflight.mockResolvedValue(report('BROKEN'));
  await f.adapter.preflight(profile);
  expect(f.preflight.mock.calls[0]![0]).toBe(profile);
  expect(f.preflight.mock.calls[0]![0].config.preflightStrictCleanup).toBe(false);
  expect(f.exec.probe).toHaveBeenCalledOnce();
});
it('ordinary preflight preserves legacy ACP error, capability does not inspect nested causes', async () => {
  const f = fixture();
  const legacy = Object.assign(new Error('legacy'), { code: 'ACP_PROCESS_CLEANUP_UNCONFIRMED' });
  f.preflight.mockRejectedValueOnce(legacy);
  await expect(f.adapter.preflight(profile)).rejects.toBe(legacy);
  const wrapped = new Error('ordinary wrapper', { cause: legacy });
  f.preflight.mockRejectedValueOnce(wrapped);
  await expect(f.adapter.getCapabilities(profile)).rejects.toBe(wrapped);
  expect(f.exec.probe).not.toHaveBeenCalled();
});
it('unknown EXEC probe remains generic instead of available:false capabilities', async () => {
  const f = fixture();
  f.preflight.mockResolvedValue(report('BROKEN'));
  const unknown = new ResourceCleanupUnconfirmedError();
  f.exec.probe.mockRejectedValue(unknown);
  await expect(f.adapter.getCapabilities(profile)).rejects.toBe(unknown);
});
