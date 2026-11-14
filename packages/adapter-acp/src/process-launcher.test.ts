import type * as AgentCore from '@agenthub/agent-core';
import type { AgentProfile } from '@agenthub/agent-core';
import { spawnSupervisedProcess } from '@agenthub/agent-core';
import { describe, expect, it, vi } from 'vitest';
import { HostAcpProcessLauncher } from './process-launcher.js';

vi.mock('@agenthub/agent-core', async (original) => ({
  ...(await original<typeof AgentCore>()),
  spawnSupervisedProcess: vi.fn(),
}));
const profile: AgentProfile = {
  id: 'launch-gate',
  name: 'Fixture',
  agentKind: 'CUSTOM_ACP',
  adapterKind: 'ACP_STDIO',
  targetKind: 'LOCAL_HOST',
  launchSpec: { kind: 'HOST_PROCESS', executable: process.execPath, args: [] },
  config: {},
};

describe('host ACP final launch admission', () => {
  it('revocation during environment resolution prevents a late process spawn', async () => {
    vi.mocked(spawnSupervisedProcess).mockClear();
    let entered!: () => void, finish!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let allowed = true;
    const gate = vi.fn(() => {
      if (!allowed) throw new Error('ownership revoked');
    });
    const launcher = new HostAcpProcessLauncher({
      resolveEnvironment: async () => {
        entered();
        await barrier;
        return {};
      },
      assertCanLaunch: gate,
    });
    const pending = launcher.launch(profile, process.cwd());
    const rejected = expect(pending).rejects.toThrow('ownership revoked');
    await reached;
    expect(gate).not.toHaveBeenCalled();
    allowed = false;
    finish();
    await rejected;
    expect(gate).toHaveBeenCalledOnce();
    expect(spawnSupervisedProcess).not.toHaveBeenCalled();
  });

  it('checks admission immediately before spawn, after environment preparation', async () => {
    const order: string[] = [];
    vi.mocked(spawnSupervisedProcess).mockImplementationOnce(() => {
      order.push('spawn');
      throw new Error('fixture spawn stop');
    });
    const launcher = new HostAcpProcessLauncher({
      resolveEnvironment: async () => {
        order.push('environment');
        return {};
      },
      assertCanLaunch: () => {
        order.push('admission');
      },
    });
    await expect(launcher.launch(profile, process.cwd())).rejects.toThrow('fixture spawn stop');
    expect(order).toEqual(['environment', 'admission', 'spawn']);
  });
});
