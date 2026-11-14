import {
  ProcessSupervisorError,
  ResourceCleanupUnconfirmedError,
  type AgentProfile,
  type ProcessResult,
} from '@agenthub/agent-core';
import { expect, it, vi } from 'vitest';
import { DockerOpenClawExecLauncher } from './docker-openclaw-exec.js';
import type { DockerControlService } from '../docker/docker-control.js';
import { AppError } from '../errors.js';
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
  config: {},
};
const result: ProcessResult = {
  exitCode: 0,
  signal: null,
  stdout: 'Usage: openclaw agent [options] --json',
  stderr: '',
  truncated: false,
  timedOut: false,
  canceled: false,
  durationMs: 1,
};
function fixture() {
  const command = vi.fn(async () => result);
  const launcher = new DockerOpenClawExecLauncher({
    execAgentCommand: command,
  } as unknown as DockerControlService);
  return { launcher, command };
}
it.each(['generic', 'supervisor'] as const)(
  '%s termination unknown is never downgraded or retried',
  async (kind) => {
    const f = fixture();
    const failure =
      kind === 'generic'
        ? new ResourceCleanupUnconfirmedError({ cause: new Error('private raw output') })
        : new ProcessSupervisorError('PROCESS_TERMINATION_TIMEOUT', 'private raw output');
    f.command.mockRejectedValue(failure);
    const error = await f.launcher.probe(profile, '/fixture').catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ResourceCleanupUnconfirmedError);
    expect((error as Error).message).not.toContain('private');
    expect(f.command).toHaveBeenCalledOnce();
  },
);
it.each([{ timedOut: true }, { canceled: true }, { signal: 'SIGTERM' as const }])(
  'abrupt CLI result %j is not proof of container termination',
  async (flags) => {
    const f = fixture();
    f.command.mockResolvedValue({ ...result, ...flags, stdout: 'private raw output' });
    await expect(f.launcher.probe(profile, '/fixture')).rejects.toBeInstanceOf(
      ResourceCleanupUnconfirmedError,
    );
    expect(f.command).toHaveBeenCalledOnce();
  },
);
it('second compatibility probe abrupt result is also unknown', async () => {
  const f = fixture();
  f.command
    .mockResolvedValueOnce({ ...result, exitCode: 1, stdout: '' })
    .mockResolvedValueOnce({ ...result, canceled: true });
  await expect(f.launcher.probe(profile, '/fixture')).rejects.toBeInstanceOf(
    ResourceCleanupUnconfirmedError,
  );
  expect(f.command).toHaveBeenCalledTimes(2);
});
it.each([
  new Error('ordinary failure'),
  Object.assign(new Error('not supervisor class'), { code: 'PROCESS_TERMINATION_TIMEOUT' }),
  new ProcessSupervisorError('SPAWN_FAILED', 'spawn rejected'),
])('ordinary failure is not promoted by text/code alone', async (failure) => {
  const f = fixture();
  f.command.mockRejectedValue(failure);
  await expect(f.launcher.probe(profile, '/fixture')).resolves.toMatchObject({ available: false });
  expect(f.command).toHaveBeenCalledOnce();
});
it('normal completed unsupported command may try legacy syntax', async () => {
  const f = fixture();
  f.command
    .mockResolvedValueOnce({ ...result, exitCode: 1, stdout: 'unknown command' })
    .mockResolvedValueOnce({ ...result, stdout: 'Usage: openclaw agent exec [options]' });
  await expect(f.launcher.probe(profile, '/fixture')).resolves.toMatchObject({ available: true });
  expect(f.command).toHaveBeenCalledTimes(2);
});
it('normal completed primary command requires no compatibility probe', async () => {
  const f = fixture();
  await expect(f.launcher.probe(profile, '/fixture')).resolves.toMatchObject({ available: true });
  expect(f.command).toHaveBeenCalledOnce();
});
it('existing AppError admission failure preserves original contract', async () => {
  const f = fixture();
  const failure = new AppError(409, 'CONTAINER_REPLACED', 'fixture');
  f.command.mockRejectedValue(failure);
  await expect(f.launcher.probe(profile, '/fixture')).rejects.toBe(failure);
  expect(f.command).toHaveBeenCalledOnce();
});
