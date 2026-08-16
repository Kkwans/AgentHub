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

function createRemoteNodeService(
  nodes: Array<{
    id: string;
    targetId: string;
    name: string;
    status: string;
    allowedRootsJson: string[];
    inventoryJson: Array<Record<string, unknown>>;
  }>,
) {
  return { list: vi.fn(async () => nodes) };
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
  remoteNodes?: Array<{
    id: string;
    targetId: string;
    name: string;
    status: string;
    allowedRootsJson: string[];
    inventoryJson: Array<Record<string, unknown>>;
  }>;
}) {
  const agentService = createAgentService(options);
  const agents = createAgentRepository(options.agents);
  const runtimes = createRuntimeService(options.runtimes);
  const remoteNodes = createRemoteNodeService(options.remoteNodes ?? []);
  const service = new DiscoveryService(
    agentService,
    agents as never,
    runtimes as never,
    [workspaceRoot],
    remoteNodes as never,
  );
  return { service, agentService, agents, runtimes, remoteNodes };
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
          adoptable: false,
          reasonCode: 'AGENT_DEPENDENCY_MISSING',
        }),
      ]),
    );
  });

  it('does not offer adoption for a host Agent whose fixed dependency is missing', async () => {
    const { service, agentService } = createService({
      runtimes: [hostRuntime()],
      diagnostics: { codex: { status: 'MISSING' }, opencode: { status: 'MISSING' } },
    });

    const candidates = await service.list();
    expect(candidates.filter((candidate) => candidate.targetCandidateId === 'host:local')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: 'host:codex',
          state: 'MISSING_DEPENDENCY',
          adoptable: false,
          reasonCode: 'AGENT_DEPENDENCY_MISSING',
        }),
      ]),
    );
    await expect(service.adopt('host:codex')).rejects.toMatchObject({
      code: 'AGENT_CANDIDATE_NOT_ADOPTABLE',
    });
    expect(agentService.register).not.toHaveBeenCalled();
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

  it('maps Remote Node inventory to deduplicated Agent candidates with offline state', async () => {
    const online = {
      id: '11111111-1111-4111-8111-111111111111',
      targetId: 'target-remote-online',
      name: '远程开发机',
      status: 'ONLINE',
      allowedRootsJson: ['/srv/projects'],
      inventoryJson: [
        {
          key: 'codex',
          name: 'Codex',
          agentKind: 'CODEX',
          adapterKind: 'ACP_STDIO',
          status: 'AVAILABLE',
          detectedVersion: '0.146.0',
          capabilities: {
            sessions: true,
            streaming: true,
            approvals: true,
            files: true,
            terminal: true,
          },
        },
        {
          key: 'hermes',
          name: 'Hermes',
          agentKind: 'HERMES',
          adapterKind: 'ACP_STDIO',
          status: 'MISSING',
          capabilities: {
            sessions: true,
            streaming: true,
            approvals: true,
            files: true,
            terminal: true,
          },
        },
      ],
    };
    const offline = {
      ...online,
      id: '22222222-2222-4222-8222-222222222222',
      targetId: 'target-remote-offline',
      name: '离线开发机',
      status: 'OFFLINE',
      inventoryJson: online.inventoryJson.slice(0, 1),
    };
    const { service } = createService({
      runtimes: [hostRuntime()],
      remoteNodes: [online, offline],
      agents: [
        {
          id: 'agent-remote-existing',
          targetId: 'target-remote-online',
          agentKind: 'CODEX',
          status: 'READY',
        },
      ],
    });

    const candidates = await service.list();
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: 'remote:11111111-1111-4111-8111-111111111111:codex',
          displayName: 'Codex（远程开发机）',
          state: 'READY',
          detectedVersion: '0.146.0',
          registeredAgentId: 'agent-remote-existing',
          adoptable: false,
        }),
        expect.objectContaining({
          candidateId: 'remote:11111111-1111-4111-8111-111111111111:hermes',
          state: 'MISSING_DEPENDENCY',
          reasonCode: 'REMOTE_AGENT_MISSING',
          adoptable: false,
        }),
        expect.objectContaining({
          candidateId: 'remote:22222222-2222-4222-8222-222222222222:codex',
          state: 'STOPPED',
          reasonCode: 'REMOTE_NODE_OFFLINE',
          adoptable: false,
        }),
      ]),
    );
  });

  it('adopts a Remote Node inventory entry with its key and remote workspace root', async () => {
    const node = {
      id: '33333333-3333-4333-8333-333333333333',
      targetId: 'target-remote',
      name: '远程 Codex',
      status: 'ONLINE',
      allowedRootsJson: ['/srv/agenthub/projects'],
      inventoryJson: [
        {
          key: 'codex-arm64',
          name: 'Codex ARM64',
          agentKind: 'CODEX',
          adapterKind: 'ACP_STDIO',
          status: 'AVAILABLE',
          capabilities: {
            sessions: true,
            streaming: true,
            approvals: true,
            files: true,
            terminal: true,
          },
        },
      ],
    };
    const agents = createAgentRepository();
    const preflight = vi.fn(async (_id: string, _input: { cwd: string }) => ({
      status: 'READY',
      checkedAt: new Date().toISOString(),
      checks: [],
    }));
    const agentService = createAgentService({
      preflight,
      register: async (input) => {
        const record = { id: 'agent-remote', ...input, status: 'UNVERIFIED' };
        agents.add(record);
        return record;
      },
    });
    const runtimes = createRuntimeService([hostRuntime()]);
    const remoteNodes = createRemoteNodeService([node]);
    const service = new DiscoveryService(
      agentService,
      agents as never,
      runtimes as never,
      [workspaceRoot],
      remoteNodes as never,
    );

    const result = await service.adopt('remote:33333333-3333-4333-8333-333333333333:codex-arm64');
    expect(result).toMatchObject({ preflight: { status: 'READY' } });
    expect(agentService.register).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'target-remote',
        agentKind: 'CODEX',
        config: { discoveredBy: 'agenthub-v06', remoteInventoryKey: 'codex-arm64' },
      }),
    );
    expect(preflight).toHaveBeenCalledWith('agent-remote', { cwd: '/srv/agenthub/projects' });
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
