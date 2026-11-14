import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLiveSelection } from './live-config.js';
import { readProbeCommand, runProtocolProbe } from './protocol-probe.js';

const selection = readLiveSelection(process.env);
const enabled = selection?.suite === 'preflight';
(enabled ? describe : describe.skip)('显式本机 ACP 协议探针（不验证真实任务或认证）', () => {
  it('initialize 后严格退出，无 Session、prompt、容器或宿主环境继承', async () => {
    const command = readProbeCommand(process.env);
    if (selection!.credentialPath)
      throw new Error('LIVE_CONFIG_INVALID: isolated protocol probe does not consume credentials');
    const root = await mkdtemp(join(tmpdir(), 'agenthub-protocol-probe-'));
    const home = join(root, 'home');
    const cwd = join(root, 'work');
    await mkdir(home);
    await mkdir(cwd);
    // On unknown cleanup preserve the isolated directory for investigation, never claim clean teardown.
    const evidence = await runProtocolProbe(selection!.provider, command, home, cwd);
    await rm(root, { recursive: true, force: true });
    expect(evidence.outcome, 'Protocol-only evidence unconfirmed').toBe('PASSED');
  });
});
