import { describe, expect, it, vi } from 'vitest';

import type { DockerEngineClient } from './docker-engine-client.js';
import { RuntimeDiscoveryService } from './runtime-discovery.js';

describe('RuntimeDiscoveryService', () => {
  it('discovers the host and Docker containers without exposing registration fields', async () => {
    const hostRoot = process.cwd();
    const docker: DockerEngineClient = {
      listContainers: vi.fn(async () => [
        {
          id: 'a'.repeat(64),
          names: ['/claude-code'],
          image: 'claude-code:stable',
          state: 'running',
          status: 'Up 2 hours',
          labels: {},
        },
      ]),
      inspectContainer: vi.fn(async () => ({
        id: 'a'.repeat(64),
        name: 'claude-code',
        image: 'claude-code:stable',
        state: { status: 'running', running: true, health: 'healthy' },
        mounts: [
          {
            type: 'bind',
            source: hostRoot,
            destination: '/workspace/AgentHub',
            rw: true,
          },
          {
            type: 'bind',
            source: '/etc',
            destination: '/host-etc',
            rw: true,
          },
        ],
        labels: {},
      })),
    };
    const targetRepository = {
      list: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
    };
    const register = vi.fn(async (input: Record<string, unknown>) => ({
      id: 'target-1',
      ...input,
    }));
    const service = new RuntimeDiscoveryService(targetRepository as never, { register } as never, {
      docker,
      workspaceRoots: [hostRoot],
    });

    const candidates = await service.list();
    expect(candidates.map((candidate) => candidate.candidateId)).toEqual([
      'host:local',
      `docker:${'a'.repeat(64)}`,
    ]);
    expect(candidates[1]?.workspaceMappings).toEqual([
      { hostRoot, containerRoot: '/workspace/AgentHub' },
    ]);
    expect(candidates[1]).not.toHaveProperty('expectedContainerId');

    await service.adopt(`docker:${'a'.repeat(64)}`);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'DOCKER_CONTAINER',
        containerName: 'claude-code',
        expectedContainerId: 'a'.repeat(64),
        startPolicy: 'MANUAL',
      }),
    );
  });

  it('returns a diagnostic candidate when Docker Engine is unavailable', async () => {
    const docker: DockerEngineClient = {
      listContainers: vi.fn(async () => {
        throw new Error('socket unavailable');
      }),
      inspectContainer: vi.fn(),
    };
    const service = new RuntimeDiscoveryService(
      { list: vi.fn(async () => []) } as never,
      { register: vi.fn() } as never,
      { docker },
    );
    const candidates = await service.list();
    expect(candidates.at(-1)).toMatchObject({
      candidateId: 'docker:engine',
      state: 'UNAVAILABLE',
      adoptable: false,
    });
  });

  it('does not infer Docker workspace mappings when no allow-list root is configured', async () => {
    const docker: DockerEngineClient = {
      listContainers: vi.fn(async () => [
        {
          id: 'b'.repeat(64),
          names: ['/untrusted'],
          image: 'agent:latest',
          state: 'running',
          status: 'Up 1 minute',
          labels: {},
        },
      ]),
      inspectContainer: vi.fn(async () => ({
        id: 'b'.repeat(64),
        name: 'untrusted',
        image: 'agent:latest',
        state: { status: 'running', running: true },
        mounts: [
          {
            type: 'bind',
            source: process.cwd(),
            destination: '/workspace',
            rw: true,
          },
        ],
        labels: {},
      })),
    };
    const service = new RuntimeDiscoveryService(
      { list: vi.fn(async () => []), get: vi.fn(async () => undefined) } as never,
      { register: vi.fn() } as never,
      { docker },
    );

    const candidate = (await service.list()).find((item) => item.containerId === 'b'.repeat(64));
    expect(candidate?.workspaceMappings).toEqual([]);
  });
});
