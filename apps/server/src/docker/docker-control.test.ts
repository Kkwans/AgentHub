import { mkdtemp, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AppError } from '../errors.js';
import {
  DockerControlService,
  mapWorkspacePath,
  type DockerCommandRunner,
  type DockerContainerState,
  type DockerTarget,
} from './docker-control.js';

const containerId = 'a'.repeat(64);

function processResult(stdout = '', exitCode = 0) {
  return {
    exitCode,
    signal: null,
    stdout,
    stderr: '',
    truncated: false,
    timedOut: false,
    canceled: false,
    durationMs: 1,
  } as const;
}

class FakeDockerRunner implements DockerCommandRunner {
  readonly calls: string[][] = [];
  state: DockerContainerState;

  constructor(running: boolean, actualId = containerId) {
    this.state = {
      id: actualId,
      name: 'agent-container',
      status: running ? 'running' : 'exited',
      running,
      mounts: [],
    };
  }

  async run(args: string[]) {
    this.calls.push(args);
    if (args[0] === 'inspect') return processResult(JSON.stringify(this.state));
    if (args[0] === 'start') {
      this.state = { ...this.state, status: 'running', running: true };
      return processResult(containerId);
    }
    if (args[0] === 'stop') {
      this.state = { ...this.state, status: 'exited', running: false };
      return processResult(containerId);
    }
    if (args[0] === 'exec') return processResult('ok');
    return processResult('', 1);
  }
}

function target(overrides: Partial<DockerTarget> = {}): DockerTarget {
  return {
    id: 'target-1',
    containerName: 'agent-container',
    expectedContainerId: containerId,
    startPolicy: 'MANUAL',
    workspaceMappings: [],
    ...overrides,
  };
}

describe('Docker Control Service', () => {
  it('拒绝 container ID 被替换的同名容器', async () => {
    const runner = new FakeDockerRunner(true, 'b'.repeat(64));
    const service = new DockerControlService(runner);

    await expect(service.inspect(target())).rejects.toMatchObject({ code: 'CONTAINER_REPLACED' });
  });

  it('区分手动启动与按需启动', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agenthub-docker-'));
    const runner = new FakeDockerRunner(false);
    runner.state.mounts = [
      { Type: 'bind', Source: directory, Destination: '/workspace', RW: true },
    ];
    const service = new DockerControlService(runner);
    const mapped = target({
      startPolicy: 'ON_DEMAND',
      workspaceMappings: [{ hostRoot: directory, containerRoot: '/workspace' }],
    });

    expect(await service.prepareForRun(mapped, directory)).toBe('/workspace');
    expect(runner.calls.some((call) => call[0] === 'start')).toBe(true);

    runner.state = { ...runner.state, status: 'exited', running: false };
    await expect(
      service.prepareForRun({ ...mapped, startPolicy: 'MANUAL' }, directory),
    ).rejects.toMatchObject({ code: 'DOCKER_CONTAINER_STOPPED' });
  });

  it('活动 Session 阻止停止容器', async () => {
    const runner = new FakeDockerRunner(true);
    const service = new DockerControlService(runner, { hasActiveSessions: async () => true });

    await expect(service.stop(target())).rejects.toMatchObject({
      code: 'DOCKER_TARGET_HAS_ACTIVE_SESSIONS',
    });
    expect(runner.calls.some((call) => call[0] === 'stop')).toBe(false);
  });

  it('只执行固定 Agent argv 并使用映射 cwd', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agenthub-docker-'));
    const project = join(directory, 'project');
    await mkdir(project);
    const runner = new FakeDockerRunner(true);
    runner.state.mounts = [
      { Type: 'bind', Source: directory, Destination: '/workspace', RW: true },
    ];
    const service = new DockerControlService(runner);
    const result = await service.execAgentCommand(
      target({ workspaceMappings: [{ hostRoot: directory, containerRoot: '/workspace' }] }),
      { command: 'hermes', args: ['acp', '--check', '$(touch /tmp/no)'] },
      project,
    );

    expect(result.stdout).toBe('ok');
    expect(runner.calls.at(-1)).toEqual([
      'exec',
      '-i',
      '-w',
      '/workspace/project',
      containerId,
      'hermes',
      'acp',
      '--check',
      '$(touch /tmp/no)',
    ]);
  });
});

describe('Docker workspace mapping', () => {
  it('按最长 realpath 前缀计算映射', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agenthub-mapping-'));
    const nestedRoot = join(directory, 'nested');
    const cwd = join(nestedRoot, 'project');
    await mkdir(cwd, { recursive: true });

    const mapped = await mapWorkspacePath(cwd, [
      { hostRoot: directory, containerRoot: '/broad' },
      { hostRoot: nestedRoot, containerRoot: '/specific' },
    ]);
    expect(mapped).toBe('/specific/project');
    expect(await realpath(cwd)).toBe(cwd);
  });

  it('未映射路径返回 undefined', async () => {
    const first = await mkdtemp(join(tmpdir(), 'agenthub-first-'));
    const second = await mkdtemp(join(tmpdir(), 'agenthub-second-'));
    expect(
      await mapWorkspacePath(first, [{ hostRoot: second, containerRoot: '/workspace' }]),
    ).toBeUndefined();
  });

  it('拒绝相对 cwd', async () => {
    await expect(mapWorkspacePath('relative', [])).rejects.toBeInstanceOf(AppError);
  });
});
