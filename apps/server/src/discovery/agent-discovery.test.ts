import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../errors.js';
import type { AgentService } from '../agents/agent-service.js';
import { AgentDiscoveryService as DiscoveryService } from './agent-discovery.js';
import type { RuntimeCandidate } from './runtime-discovery.js';

const hostTarget = {
  candidateId: 'host:local',
  kind: 'LOCAL_HOST' as const,
  displayName: '本机',
  state: 'READY' as const,
  targetId: 'target-host',
  workspaceMappings: [],
  adoptable: false,
};

const workspaceRoot = process.cwd();

function hostRuntime(): RuntimeCandidate {
  return { ...hostTarget };
}

function createAgentService(options: {
  diagnostics?: Record<string, unknown>;
  register?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  preflight?: (id: string, input: { cwd: string }) => Promise<Record<string, unknown>>;
}) {
  return {
    hostDiagnostics: vi.fn(async () => options.diagnostics ?? { codex: { status: 'INSTALLED' } }),
    register: vi.fn(
      options.register ?? (async (input) => ({ id: 'agent-new', ...input, status: 'UNVERIFIED' })),
    ),
    preflight: vi.fn(
      options.preflight ??
        (async () => ({
          status: 'READY',
          checkedAt: new Date().toISOString(),
          checks: [],
        })),
    ),
  } as unknown as AgentService;
}

function createRuntimeService(runtimes: RuntimeCandidate[]) {
  return {
    list: vi.fn(async () => runtimes),
    rescan: vi.fn(async () => runtimes),
    adopt: vi.fn(async () => ({ id: 'target-adopted' })),
  };
}

function createAgentRepository(initial: Record<string, unknown>[] = []) {
  const records = [...initial];
  return {
    list: vi.fn(async () => records),
    get: vi.fn(async (id: string) => records.find((record) => record.id === id)),
    add(record: Record<string, unknown>) {
      records.push(record);
    },
  };
}

function createService(options: {
  runtimes: RuntimeCandidate[];
  diagnostics?: Record<string, unknown>;
  agents?: Record<string, unknown>[];
  register?: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  preflight?: (id: string, input: { cwd: string }) => Promise<Record<string, unknown>>;
}) {
  const agentService = createAgentService(options);
  const agents = createAgentRepository(options.agents);
  const runtimes = createRuntimeService(options.runtimes);
  const service = new DiscoveryService(agentService, agents as never, runtimes as never, [
    workspaceRoot,
  ]);
  return { service, agentService, agents, runtimes };
}

describe('AgentDiscoveryService', () => {
  it('maps host diagnostics and registered states to user-facing candidate states', async () => {
    const registered = {
      id: 'agent-existing',
      targetId: 'target-host',
      agentKind: 'CODEX',
      status: 'MISSING',
    };
    const { service } = createService({
      runtimes: [hostRuntime()],
      diagnostics: {
        codex: { status: 'INSTALLED', version: '1.2.3' },
        opencode: { status: 'MISSING' },
      },
      agents: [registered],
    });

    const candidates = await service.list();
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: 'host:codex',
          state: 'MISSING_DEPENDENCY',
          detectedVersion: '1.2.3',
          registeredAgentId: 'agent-existing',
          adoptable: false,
        }),
        expect.objectContaining({
          candidateId: 'host:opencode',
          state: 'MISSING_DEPENDENCY',
          adoptable: true,
        }),
      ]),
    );
  });

  it('keeps stopped or unsupported container candidates visible but rejects adoption', async () => {
    const stopped: RuntimeCandidate = {
      candidateId: 'docker:stopped',
      kind: 'DOCKER_CONTAINER',
      displayName: 'Hermes',
      state: 'STOPPED',
      targetId: 'target-hermes',
      containerId: 'a'.repeat(64),
      workspaceMappings: [],
      adoptable: false,
    };
    const unknown: RuntimeCandidate = {
      candidateId: 'docker:unknown',
      kind: 'DOCKER_CONTAINER',
      displayName: 'unrelated',
      state: 'READY',
      targetId: 'target-unknown',
      containerId: 'b'.repeat(64),
      workspaceMappings: [],
      adoptable: false,
    };
    const { service, agentService } = createService({
      runtimes: [hostRuntime(), stopped, unknown],
    });

    const candidates = await service.list();
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: 'docker:stopped:hermes',
          state: 'STOPPED',
          adoptable: false,
          reasonCode: 'RUNTIME_STOPPED',
        }),
        expect.objectContaining({
          candidateId: 'docker:unknown:unknown',
          state: 'UNSUPPORTED',
          adoptable: false,
          reasonCode: 'AGENT_PROFILE_NOT_DETECTED',
        }),
      ]),
    );

    await expect(service.adopt('docker:stopped:hermes')).rejects.toMatchObject({
      code: 'AGENT_CANDIDATE_NOT_ADOPTABLE',
    });
    expect(agentService.register).not.toHaveBeenCalled();
  });

  it('adopts a discoverable Agent, runs preflight, and returns the refreshed record', async () => {
    const persisted = {
      id: 'agent-new',
      targetId: 'target-host',
      agentKind: 'CODEX',
      status: 'READY',
    };
    const agents = createAgentRepository();
    const agentService = createAgentService({
      register: async (input) => {
        agents.add(persisted);
        return { ...persisted, ...input };
      },
    });
    const runtimes = createRuntimeService([hostRuntime()]);
    const service = new DiscoveryService(agentService, agents as never, runtimes as never, [
      workspaceRoot,
    ]);

    const result = await service.adopt('host:codex');
    expect(result).toMatchObject({
      agent: persisted,
      preflight: { status: 'READY' },
    });
    expect(agentService.register).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Codex',
        targetId: 'target-host',
        agentKind: 'CODEX',
        config: { discoveredBy: 'agenthub-v06' },
      }),
    );
    expect(agentService.preflight).toHaveBeenCalledWith('agent-new', { cwd: workspaceRoot });
  });

  it('converts preflight authorization failures to a visible candidate state', async () => {
    const persisted = { id: 'agent-auth', targetId: 'target-host', agentKind: 'CODEX' };
    const agents = createAgentRepository();
    const agentService = createAgentService({
      register: async () => {
        agents.add(persisted);
        return persisted;
      },
      preflight: async () => {
        throw new AppError(409, 'AUTH_REQUIRED', 'Agent 需要授权');
      },
    });
    const runtimes = createRuntimeService([hostRuntime()]);
    const service = new DiscoveryService(agentService, agents as never, runtimes as never, [
      workspaceRoot,
    ]);

    const result = await service.adopt('host:codex');
    expect(result).toMatchObject({
      agent: persisted,
      preflight: { status: 'AUTH_REQUIRED', reasonCode: 'AUTH_REQUIRED' },
    });
  });

  it('keeps a stopped runtime visible when preflight races with container shutdown', async () => {
    const persisted = { id: 'agent-stopped', targetId: 'target-host', agentKind: 'CODEX' };
    const agents = createAgentRepository();
    const agentService = createAgentService({
      register: async () => {
        agents.add(persisted);
        return persisted;
      },
      preflight: async () => {
        throw new AppError(409, 'DOCKER_CONTAINER_STOPPED', 'Docker 容器已停止');
      },
    });
    const runtimes = createRuntimeService([hostRuntime()]);
    const service = new DiscoveryService(agentService, agents as never, runtimes as never, [
      workspaceRoot,
    ]);

    const result = await service.adopt('host:codex');
    expect(result).toBeDefined();
    if (!result || !('preflight' in result)) throw new Error('expected preflight result');
    expect(result.preflight).toMatchObject({
      status: 'STOPPED',
      reasonCode: 'DOCKER_CONTAINER_STOPPED',
    });
  });

  it('returns already registered candidates idempotently and rejects unknown IDs', async () => {
    const existing = {
      id: 'agent-existing',
      targetId: 'target-host',
      agentKind: 'CODEX',
      status: 'READY',
    };
    const { service, agentService } = createService({
      runtimes: [hostRuntime()],
      agents: [existing],
    });

    await expect(service.adopt('host:codex')).resolves.toEqual(existing);
    expect(agentService.register).not.toHaveBeenCalled();
    await expect(service.adopt('host:missing')).rejects.toMatchObject({
      code: 'AGENT_CANDIDATE_NOT_FOUND',
    });
  });
});
