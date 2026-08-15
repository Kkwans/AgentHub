import { existsSync } from 'node:fs';

import type { AgentKind } from '@agenthub/agent-core';
import type { AgentHubDatabase, AgentRepository } from '@agenthub/db';

import { AppError } from '../errors.js';
import type { AgentService } from '../agents/agent-service.js';
import type { RuntimeCandidate, RuntimeDiscoveryService } from './runtime-discovery.js';

export type AgentCandidateState =
  | 'READY'
  | 'AUTH_REQUIRED'
  | 'INSTALLED'
  | 'MISSING_DEPENDENCY'
  | 'STOPPED'
  | 'UNSUPPORTED'
  | 'BROKEN';

export interface AgentCandidate {
  candidateId: string;
  agentKind: AgentKind | 'UNKNOWN';
  displayName: string;
  targetCandidateId: string;
  targetId?: string;
  state: AgentCandidateState;
  adapterKind: 'ACP_STDIO' | 'OPENCLAW_GATEWAY' | 'OPENCLAW_EXEC';
  detectedVersion?: string;
  reasonCode?: string;
  registeredAgentId?: string;
  adoptable: boolean;
}

const HOST_AGENT_CATALOG: Array<{
  agentKind: AgentKind;
  name: string;
  diagnosticKey: 'codex' | 'opencode';
  adapterKind: 'ACP_STDIO';
}> = [
  { agentKind: 'CODEX', name: 'Codex', diagnosticKey: 'codex', adapterKind: 'ACP_STDIO' },
  { agentKind: 'OPENCODE', name: 'OpenCode', diagnosticKey: 'opencode', adapterKind: 'ACP_STDIO' },
];

const CONTAINER_AGENT_HINTS: Array<{
  agentKind: AgentKind;
  name: string;
  tokens: string[];
  adapterKind: 'ACP_STDIO' | 'OPENCLAW_GATEWAY';
}> = [
  { agentKind: 'CLAUDE_CODE', name: 'Claude Code', tokens: ['claude'], adapterKind: 'ACP_STDIO' },
  { agentKind: 'HERMES', name: 'Hermes', tokens: ['hermes'], adapterKind: 'ACP_STDIO' },
  {
    agentKind: 'OPENCLAW',
    name: 'OpenClaw',
    tokens: ['openclaw', 'claw'],
    adapterKind: 'OPENCLAW_GATEWAY',
  },
  { agentKind: 'CODEX', name: 'Codex', tokens: ['codex'], adapterKind: 'ACP_STDIO' },
  { agentKind: 'OPENCODE', name: 'OpenCode', tokens: ['opencode'], adapterKind: 'ACP_STDIO' },
];

export class AgentDiscoveryService {
  constructor(
    private readonly agentService: AgentService,
    private readonly agents: AgentRepository<AgentHubDatabase>,
    private readonly runtimes: RuntimeDiscoveryService,
    private readonly workspaceRoots: string[] = [],
  ) {}

  async list(): Promise<AgentCandidate[]> {
    const [diagnostics, registered, runtimes] = await Promise.all([
      this.agentService.hostDiagnostics(),
      this.agents.list(),
      this.runtimes.list(),
    ]);
    const candidates: AgentCandidate[] = [];
    const hostTarget = runtimes.find((runtime) => runtime.candidateId === 'host:local');
    for (const definition of HOST_AGENT_CATALOG) {
      const diagnostic = recordValue(diagnostics[definition.diagnosticKey]);
      const status = diagnosticStatus(diagnostic);
      const existing = registered.find(
        (agent) =>
          agent.targetId === hostTarget?.targetId && agent.agentKind === definition.agentKind,
      );
      candidates.push({
        candidateId: `host:${definition.agentKind.toLowerCase()}`,
        agentKind: definition.agentKind,
        displayName: definition.name,
        targetCandidateId: 'host:local',
        ...(hostTarget?.targetId ? { targetId: hostTarget.targetId } : {}),
        state: existing ? mapRegisteredState(existing.status) : status,
        adapterKind: definition.adapterKind,
        ...(typeof diagnostic?.version === 'string' ? { detectedVersion: diagnostic.version } : {}),
        ...(existing ? { registeredAgentId: existing.id } : {}),
        adoptable: !existing,
        ...(status === 'AUTH_REQUIRED' ? { reasonCode: 'AUTH_REQUIRED' } : {}),
      });
    }

    for (const runtime of runtimes.filter((item) => item.kind === 'DOCKER_CONTAINER')) {
      const matching = findContainerHint(runtime);
      if (!matching) {
        candidates.push({
          candidateId: `${runtime.candidateId}:unknown`,
          agentKind: 'UNKNOWN',
          displayName: `${runtime.displayName}（未识别 Agent）`,
          targetCandidateId: runtime.candidateId,
          ...(runtime.targetId ? { targetId: runtime.targetId } : {}),
          state: runtime.state === 'STOPPED' ? 'STOPPED' : 'UNSUPPORTED',
          adapterKind: 'ACP_STDIO',
          adoptable: false,
          reasonCode: 'AGENT_PROFILE_NOT_DETECTED',
        });
        continue;
      }
      const existing = registered.find(
        (agent) => agent.targetId === runtime.targetId && agent.agentKind === matching.agentKind,
      );
      candidates.push({
        candidateId: `${runtime.candidateId}:${matching.agentKind.toLowerCase()}`,
        agentKind: matching.agentKind,
        displayName: matching.name,
        targetCandidateId: runtime.candidateId,
        ...(runtime.targetId ? { targetId: runtime.targetId } : {}),
        state: existing
          ? mapRegisteredState(existing.status)
          : runtime.state === 'STOPPED'
            ? 'STOPPED'
            : 'INSTALLED',
        adapterKind: matching.adapterKind,
        ...(existing ? { registeredAgentId: existing.id } : {}),
        adoptable: Boolean(runtime.targetId) && !existing && runtime.state !== 'UNAVAILABLE',
        ...(runtime.state === 'STOPPED' ? { reasonCode: 'RUNTIME_STOPPED' } : {}),
      });
    }
    return candidates;
  }

  async rescan(): Promise<AgentCandidate[]> {
    await this.runtimes.rescan();
    return this.list();
  }

  async adopt(candidateId: string) {
    const candidate = (await this.list()).find((item) => item.candidateId === candidateId);
    if (!candidate) throw new AppError(404, 'AGENT_CANDIDATE_NOT_FOUND', 'Agent 候选不存在');
    if (candidate.agentKind === 'UNKNOWN') {
      throw new AppError(409, 'AGENT_PROFILE_NOT_DETECTED', '当前容器尚未识别出支持的 Agent');
    }
    if (candidate.registeredAgentId) return this.agents.get(candidate.registeredAgentId);
    const targetId =
      candidate.targetId ?? (await this.runtimes.adopt(candidate.targetCandidateId))?.id;
    if (!targetId) throw new AppError(409, 'RUNTIME_NOT_ADOPTED', '请先接管 Runtime');
    const agent = await this.agentService.register({
      name: candidate.displayName,
      targetId,
      agentKind: candidate.agentKind,
      config: { discoveredBy: 'agenthub-v06' },
    });
    const cwd = this.chooseCwd(candidate.targetCandidateId);
    try {
      const preflight = await this.agentService.preflight(agent.id, { cwd });
      return { agent: (await this.agents.get(agent.id)) ?? agent, preflight };
    } catch (error) {
      return {
        agent: (await this.agents.get(agent.id)) ?? agent,
        preflight: {
          status: mapPreflightFailure(error),
          reasonCode: error instanceof AppError ? error.code : 'PREFLIGHT_FAILED',
        },
      };
    }
  }

  private chooseCwd(candidateId: string): string {
    if (candidateId.startsWith('host:')) {
      const root = this.workspaceRoots.find((item) => existsSync(item));
      return root ?? process.cwd();
    }
    return this.workspaceRoots.find((item) => existsSync(item)) ?? process.cwd();
  }
}

function findContainerHint(runtime: RuntimeCandidate) {
  const haystack = `${runtime.displayName} ${runtime.image ?? ''}`.toLocaleLowerCase();
  return CONTAINER_AGENT_HINTS.find((hint) =>
    hint.tokens.some((token) => haystack.includes(token)),
  );
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function diagnosticStatus(value: Record<string, unknown> | undefined): AgentCandidateState {
  if (!value || value.status === 'MISSING') return 'MISSING_DEPENDENCY';
  const auth = typeof value.auth === 'string' ? value.auth.toLocaleLowerCase() : '';
  if (auth.includes('not logged') || auth.includes('unauthorized') || auth.includes('login')) {
    return 'AUTH_REQUIRED';
  }
  return 'INSTALLED';
}

function mapRegisteredState(status: string): AgentCandidateState {
  if (status === 'READY') return 'READY';
  if (status === 'AUTH_REQUIRED') return 'AUTH_REQUIRED';
  if (status === 'MISSING_DEPENDENCY') return 'MISSING_DEPENDENCY';
  if (status === 'BROKEN') return 'BROKEN';
  return 'INSTALLED';
}

function mapPreflightFailure(error: unknown): AgentCandidateState {
  if (error instanceof AppError) {
    if (error.code.includes('AUTH')) return 'AUTH_REQUIRED';
    if (error.code.includes('MISSING') || error.code.includes('COMMAND'))
      return 'MISSING_DEPENDENCY';
  }
  return 'BROKEN';
}
