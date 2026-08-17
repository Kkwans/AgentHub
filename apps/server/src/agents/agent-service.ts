import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';

import {
  AcpAdapter,
  resolvePinnedAcpAdapter,
  type AcpProcessLauncher,
} from '@agenthub/adapter-acp';
import type {
  AgentCapabilities,
  AgentKind,
  AgentProfile,
  AgentRuntimeAdapter,
  PreflightReport,
} from '@agenthub/agent-core';
import { runProcess } from '@agenthub/agent-core';
import type { AgentHubDatabase, AgentRepository, ExecutionTargetRepository } from '@agenthub/db';

import { AppError } from '../errors.js';

type AdapterKind = 'ACP_STDIO' | 'OPENCLAW_GATEWAY' | 'OPENCLAW_EXEC';

export interface RegisterAgentInput {
  name: string;
  targetId: string;
  agentKind: AgentKind;
  defaultModel?: string | undefined;
  defaultMode?: string | undefined;
  executable?: string | undefined;
  args?: string[] | undefined;
  config?: Record<string, unknown> | undefined;
}

export interface AgentPreflightInput {
  cwd: string;
  smokeSession?: boolean | undefined;
}

export interface AgentCatalogEntry {
  agentKind: AgentKind;
  name: string;
  recommendedTarget: 'LOCAL_HOST' | 'DOCKER_CONTAINER';
  adapterKind: AdapterKind;
  command: string;
  notes: string;
}

const BUILTIN_CATALOG: AgentCatalogEntry[] = [
  {
    agentKind: 'CODEX',
    name: 'Codex',
    recommendedTarget: 'LOCAL_HOST',
    adapterKind: 'ACP_STDIO',
    command: '@agentclientprotocol/codex-acp@1.1.14',
    notes: '使用 AgentHub 固定版本 adapter；宿主机 Codex 登录状态单独诊断。',
  },
  {
    agentKind: 'CLAUDE_CODE',
    name: 'Claude Code',
    recommendedTarget: 'DOCKER_CONTAINER',
    adapterKind: 'ACP_STDIO',
    command: 'claude-agent-acp',
    notes: '容器必须预装 @agentclientprotocol/claude-agent-acp@0.66.0。',
  },
  {
    agentKind: 'OPENCODE',
    name: 'OpenCode',
    recommendedTarget: 'LOCAL_HOST',
    adapterKind: 'ACP_STDIO',
    command: 'opencode acp',
    notes: '未安装时如实报告 MISSING。',
  },
  {
    agentKind: 'HERMES',
    name: 'Hermes',
    recommendedTarget: 'DOCKER_CONTAINER',
    adapterKind: 'ACP_STDIO',
    command: 'hermes acp',
    notes: 'Project 必须存在有效的 host/container workspace mapping。',
  },
  {
    agentKind: 'OPENCLAW',
    name: 'OpenClaw',
    recommendedTarget: 'DOCKER_CONTAINER',
    adapterKind: 'OPENCLAW_GATEWAY',
    command: 'openclaw acp',
    notes: '优先 Gateway-backed ACP；agent exec 仅作为单回合回退。',
  },
];

export class AgentService {
  constructor(
    private readonly agents: AgentRepository<AgentHubDatabase>,
    private readonly targets: ExecutionTargetRepository<AgentHubDatabase>,
    private readonly acpLauncher: AcpProcessLauncher,
    private readonly adapterFactory: (
      adapterKind: AdapterKind,
      launcher: AcpProcessLauncher,
    ) => AgentRuntimeAdapter = (_adapterKind, launcher) => new AcpAdapter({ launcher }),
    private readonly remoteAdapter?: AgentRuntimeAdapter,
    private readonly resolveEnvironment: () => Promise<NodeJS.ProcessEnv> = async () => process.env,
  ) {}

  list() {
    return this.agents.list();
  }

  catalog(): AgentCatalogEntry[] {
    return structuredClone(BUILTIN_CATALOG);
  }

  async register(input: RegisterAgentInput) {
    const target = await this.targets.get(input.targetId);
    if (!target) throw new AppError(404, 'EXECUTION_TARGET_NOT_FOUND', 'Execution Target 不存在');
    const launch = await resolveRegistrationLaunch(input, target);
    return this.agents.create({
      id: randomUUID(),
      targetId: input.targetId,
      name: input.name,
      agentKind: input.agentKind,
      adapterKind: launch.adapterKind,
      executable: launch.executable,
      argsJson: launch.args,
      configJson: { ...launch.config, ...input.config },
      defaultModel: input.defaultModel,
      defaultMode: input.defaultMode,
      status: 'UNVERIFIED',
    });
  }

  async updateDefaults(
    id: string,
    patch: {
      defaultModel?: string | null | undefined;
      defaultMode?: string | null | undefined;
    },
  ) {
    const agent = await this.agents.get(id);
    if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent 不存在');
    return this.agents.update(id, {
      ...(patch.defaultModel !== undefined ? { defaultModel: patch.defaultModel } : {}),
      ...(patch.defaultMode !== undefined ? { defaultMode: patch.defaultMode } : {}),
    });
  }

  async preflight(id: string, input: AgentPreflightInput): Promise<PreflightReport> {
    const agent = await this.agents.get(id);
    if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent 不存在');
    const target = await this.targets.get(agent.targetId);
    if (!target)
      throw new AppError(500, 'AGENT_TARGET_MISSING', 'Agent 的 Execution Target 不存在');
    const profile = toAgentProfile(agent, target, input);
    const adapter = this.adapterForTarget(target.kind, agent.adapterKind as AdapterKind);
    const report = await adapter.preflight(profile);
    const capabilities =
      report.status === 'READY' ? await adapter.getCapabilities(profile) : undefined;
    await this.agents.updatePreflight(id, {
      status: report.status,
      detectedVersion: report.detectedVersion ?? null,
      ...(capabilities
        ? { capabilitiesJson: capabilities as unknown as Record<string, unknown> }
        : {}),
    });
    return report;
  }

  async getProfile(id: string, cwd: string): Promise<AgentProfile> {
    const agent = await this.agents.get(id);
    if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent 不存在');
    const target = await this.targets.get(agent.targetId);
    if (!target)
      throw new AppError(500, 'AGENT_TARGET_MISSING', 'Agent 的 Execution Target 不存在');
    return toAgentProfile(agent, target, { cwd });
  }

  async resolveRuntime(
    id: string,
    cwd: string,
    expectedTargetId: string,
  ): Promise<{
    profile: AgentProfile;
    adapter: AgentRuntimeAdapter;
  }> {
    const agent = await this.agents.get(id);
    if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent 不存在');
    if (!agent.enabled || agent.status !== 'READY') {
      throw new AppError(409, 'AGENT_NOT_READY', '只有就绪且已启用的 Agent 可以创建或恢复 Session');
    }
    const agentTarget = await this.targets.get(agent.targetId);
    if (!agentTarget) {
      throw new AppError(500, 'AGENT_TARGET_MISSING', 'Agent 的 Execution Target 不存在');
    }
    if (agent.targetId !== expectedTargetId) {
      const projectTarget = await this.targets.get(expectedTargetId);
      if (!projectTarget || !canAgentReachProject(agentTarget, projectTarget, cwd)) {
        throw new AppError(
          409,
          'AGENT_PROJECT_TARGET_MISMATCH',
          'Agent 的执行环境无法访问当前 Project 工作区',
        );
      }
    }
    return {
      profile: toAgentProfile(agent, agentTarget, { cwd }),
      adapter: this.adapterForTarget(agentTarget.kind, agent.adapterKind as AdapterKind),
    };
  }

  private adapterForTarget(targetKind: string, adapterKind: AdapterKind): AgentRuntimeAdapter {
    if (targetKind === 'REMOTE_NODE') {
      if (!this.remoteAdapter) {
        throw new AppError(503, 'REMOTE_NODE_GATEWAY_UNAVAILABLE', 'Remote Node Gateway 不可用');
      }
      return this.remoteAdapter;
    }
    return this.adapterFactory(adapterKind, this.acpLauncher);
  }

  async hostDiagnostics(): Promise<Record<string, unknown>> {
    const environment = await this.resolveEnvironment();
    const codexExecutable = await findExecutable('codex', environment.PATH);
    const opencodeExecutable = await findExecutable('opencode', environment.PATH);
    const pinnedCodex = resolvePinnedAcpAdapter('CODEX');
    const codexAdapterAvailable = await isPinnedAdapterAvailable(pinnedCodex);
    const diagnostics: Record<string, unknown> = {
      node: { executable: process.execPath, version: process.version },
      codex: {
        status: codexAdapterAvailable ? 'INSTALLED' : 'MISSING',
        executable: codexExecutable ?? pinnedCodex.executable,
        ...(codexExecutable ? { runtimeExecutable: codexExecutable } : {}),
        adapterExecutable: pinnedCodex.args[0],
        pinnedPackage: pinnedCodex.packageName,
        pinnedVersion: pinnedCodex.version,
        ...(codexAdapterAvailable ? { version: pinnedCodex.version } : {}),
      },
      opencode: {
        status: opencodeExecutable ? 'INSTALLED' : 'MISSING',
        executable: opencodeExecutable,
      },
      pinnedAdapters: {
        codex: resolvePinnedAcpAdapter('CODEX').version,
        claudeCode: resolvePinnedAcpAdapter('CLAUDE_CODE').version,
      },
    };
    if (codexExecutable) {
      diagnostics.codex = {
        ...(diagnostics.codex as Record<string, unknown>),
        version: await readCommandLine(codexExecutable, ['--version'], environment),
        auth: await readCommandLine(codexExecutable, ['login', 'status'], environment),
      };
    }
    return diagnostics;
  }
}

async function resolveRegistrationLaunch(
  input: RegisterAgentInput,
  target: { kind: string; capabilitiesJson: Record<string, unknown> },
): Promise<{
  adapterKind: AdapterKind;
  executable: string;
  args: string[];
  config: Record<string, unknown>;
}> {
  if (input.agentKind === 'CUSTOM_ACP') {
    if (target.kind === 'REMOTE_NODE') {
      throw new AppError(
        409,
        'REMOTE_CUSTOM_AGENT_UNSUPPORTED',
        'Remote Node 只允许 inventory 中的固定 Agent Profile',
      );
    }
    if (!input.executable)
      throw new AppError(400, 'AGENT_EXECUTABLE_REQUIRED', 'Custom ACP Agent 必须提供 executable');
    if (target.kind === 'LOCAL_HOST' && !isAbsolute(input.executable)) {
      throw new AppError(400, 'AGENT_EXECUTABLE_NOT_ABSOLUTE', '宿主机 executable 必须是绝对路径');
    }
    return {
      adapterKind: 'ACP_STDIO',
      executable: input.executable,
      args: input.args ?? [],
      config: {},
    };
  }

  if (target.kind === 'LOCAL_HOST') {
    if (input.agentKind === 'CODEX') {
      const pinned = resolvePinnedAcpAdapter('CODEX');
      return {
        adapterKind: 'ACP_STDIO',
        executable: pinned.executable,
        args: pinned.args,
        config: {
          pinnedPackage: pinned.packageName,
          pinnedVersion: pinned.version,
          models: true,
          modes: true,
          reasoningEffort: true,
          files: true,
          terminal: true,
        },
      };
    }
    if (input.agentKind === 'CLAUDE_CODE') {
      const pinned = resolvePinnedAcpAdapter('CLAUDE_CODE');
      return {
        adapterKind: 'ACP_STDIO',
        executable: pinned.executable,
        args: pinned.args,
        config: {
          pinnedPackage: pinned.packageName,
          pinnedVersion: pinned.version,
          models: true,
          modes: true,
          files: true,
          terminal: true,
        },
      };
    }
    if (input.agentKind === 'OPENCODE') {
      return {
        adapterKind: 'ACP_STDIO',
        executable: (await findExecutable('opencode')) ?? '/usr/local/bin/opencode',
        args: ['acp'],
        config: { models: true, modes: true, files: true, terminal: true },
      };
    }
    throw new AppError(
      409,
      'AGENT_TARGET_KIND_UNSUPPORTED',
      `${input.agentKind} 的内置 Profile 需要 Docker Execution Target`,
    );
  }

  if (target.kind === 'REMOTE_NODE') {
    const inventory = Array.isArray(target.capabilitiesJson.inventory)
      ? target.capabilitiesJson.inventory
      : [];
    const requestedInventoryKey =
      typeof input.config?.remoteInventoryKey === 'string'
        ? input.config.remoteInventoryKey
        : undefined;
    const remote = inventory.find((candidate): candidate is Record<string, unknown> =>
      Boolean(
        candidate &&
        typeof candidate === 'object' &&
        (candidate as Record<string, unknown>).agentKind === input.agentKind &&
        (!requestedInventoryKey ||
          (candidate as Record<string, unknown>).key === requestedInventoryKey),
      ),
    );
    if (!remote || remote.status !== 'AVAILABLE' || typeof remote.key !== 'string') {
      throw new AppError(
        409,
        'REMOTE_AGENT_NOT_AVAILABLE',
        'Remote Node inventory 中没有可用的该类型 Agent',
      );
    }
    const adapterKind =
      remote.adapterKind === 'OPENCLAW_GATEWAY' ? 'OPENCLAW_GATEWAY' : 'ACP_STDIO';
    return {
      adapterKind,
      executable: `remote:${remote.key}`,
      args: [],
      config: { remoteInventoryKey: remote.key },
    };
  }

  if (target.kind !== 'DOCKER_CONTAINER') {
    throw new AppError(409, 'AGENT_TARGET_KIND_UNSUPPORTED', '不支持的 Agent Execution Target');
  }

  const definitions: Partial<
    Record<
      AgentKind,
      {
        adapterKind: AdapterKind;
        executable: string;
        args: string[];
        config: Record<string, unknown>;
      }
    >
  > = {
    CODEX: {
      adapterKind: 'ACP_STDIO',
      executable: 'codex-acp',
      args: [],
      config: { files: true, terminal: true, models: true, modes: true },
    },
    CLAUDE_CODE: {
      adapterKind: 'ACP_STDIO',
      executable: 'claude-agent-acp',
      args: [],
      config: {
        expectedPackage: '@agentclientprotocol/claude-agent-acp',
        expectedVersion: '0.66.0',
        files: true,
        terminal: true,
        models: true,
        modes: true,
      },
    },
    OPENCODE: {
      adapterKind: 'ACP_STDIO',
      executable: 'opencode',
      args: ['acp'],
      config: { files: true, terminal: true, models: true, modes: true },
    },
    HERMES: {
      adapterKind: 'ACP_STDIO',
      executable: 'hermes',
      args: ['acp'],
      config: { files: true, terminal: true, models: true },
    },
    OPENCLAW: {
      adapterKind: 'OPENCLAW_GATEWAY',
      executable: 'openclaw',
      args: ['acp'],
      config: {
        files: false,
        terminal: false,
        mcpStdio: false,
        mcpHttp: false,
        openClawFallback: { executable: 'openclaw', args: ['agent', 'exec'] },
      },
    },
  };
  const definition = definitions[input.agentKind];
  if (!definition) throw new AppError(400, 'AGENT_KIND_INVALID', '不支持的 Agent 类型');
  return definition;
}

function toAgentProfile(
  agent: {
    id: string;
    name: string;
    agentKind: string;
    adapterKind: string;
    executable: string | null;
    argsJson: string[];
    defaultModel: string | null;
    defaultMode: string | null;
    configJson: Record<string, unknown>;
  },
  target: {
    kind: string;
    containerName: string | null;
    expectedContainerId: string | null;
    startPolicy: string | null;
    workspaceMappingsJson: Array<{ hostRoot: string; containerRoot: string }>;
    connectionJson: Record<string, unknown>;
  },
  input: AgentPreflightInput,
): AgentProfile {
  if (!agent.executable) throw new AppError(500, 'AGENT_CONFIG_INVALID', 'Agent executable 未配置');
  const config = {
    ...agent.configJson,
    preflightCwd: input.cwd,
    preflightSession: input.smokeSession === true,
  };
  const common = {
    id: agent.id,
    name: agent.name,
    agentKind: agent.agentKind as AgentKind,
    adapterKind: agent.adapterKind,
    ...(agent.defaultModel ? { defaultModel: agent.defaultModel } : {}),
    ...(agent.defaultMode ? { defaultMode: agent.defaultMode } : {}),
    config,
  };
  if (target.kind === 'LOCAL_HOST') {
    return {
      ...common,
      targetKind: 'LOCAL_HOST',
      launchSpec: { kind: 'HOST_PROCESS', executable: agent.executable, args: agent.argsJson },
    };
  }
  if (target.kind === 'REMOTE_NODE') {
    const nodeId = target.connectionJson.nodeId;
    const inventoryKey = agent.configJson.remoteInventoryKey;
    if (typeof nodeId !== 'string' || typeof inventoryKey !== 'string') {
      throw new AppError(500, 'REMOTE_AGENT_CONFIG_INVALID', 'Remote Agent 配置不完整');
    }
    return {
      ...common,
      targetKind: 'REMOTE_NODE',
      launchSpec: { kind: 'REMOTE_AGENT', nodeId, inventoryKey },
    };
  }
  if (
    target.kind !== 'DOCKER_CONTAINER' ||
    !target.containerName ||
    !target.expectedContainerId ||
    (target.startPolicy !== 'MANUAL' && target.startPolicy !== 'ON_DEMAND')
  ) {
    throw new AppError(500, 'AGENT_TARGET_CONFIG_INVALID', 'Agent Execution Target 配置不完整');
  }
  return {
    ...common,
    targetKind: 'DOCKER_CONTAINER',
    launchSpec: {
      kind: 'DOCKER_EXEC',
      containerName: target.containerName,
      expectedContainerId: target.expectedContainerId,
      command: agent.executable,
      args: agent.argsJson,
      startPolicy: target.startPolicy,
      workspaceMappings: target.workspaceMappingsJson,
    },
  };
}

async function findExecutable(
  name: string,
  pathValue = process.env.PATH,
): Promise<string | undefined> {
  const paths = (pathValue ?? '').split(delimiter).filter(isAbsolute);
  for (const directory of paths) {
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH without invoking a shell.
    }
  }
  return undefined;
}

async function isPinnedAdapterAvailable(adapter: {
  executable: string;
  args: string[];
}): Promise<boolean> {
  if (!adapter.args[0]) return false;
  try {
    await access(adapter.executable, constants.X_OK);
    await access(adapter.args[0], constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function canAgentReachProject(
  agentTarget: {
    kind: string;
    workspaceMappingsJson: Array<{ hostRoot: string; containerRoot: string }>;
  },
  projectTarget: { kind: string },
  cwd: string,
): boolean {
  // A Docker Agent can serve a host Project only when the registered mapping
  // explicitly covers this canonical cwd. Other cross-target combinations
  // remain rejected so a registration cannot silently escape its boundary.
  return (
    agentTarget.kind === 'DOCKER_CONTAINER' &&
    projectTarget.kind === 'LOCAL_HOST' &&
    isPathCoveredByWorkspaceMapping(cwd, agentTarget.workspaceMappingsJson)
  );
}

function isPathCoveredByWorkspaceMapping(
  path: string,
  mappings: Array<{ hostRoot: string; containerRoot: string }>,
): boolean {
  const candidate = resolvePath(path);
  return mappings.some(({ hostRoot }) => {
    const root = resolvePath(hostRoot);
    const remainder = relative(root, candidate);
    return remainder === '' || (!remainder.startsWith(`..${sep}`) && remainder !== '..');
  });
}

async function readCommandLine(
  executable: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const result = await runProcess({
    executable,
    args,
    env: environment,
    timeoutMs: 10_000,
    maxOutputBytes: 64_000,
  });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return output || `exit ${String(result.exitCode)}`;
}

export function capabilitiesForRecord(
  value: Record<string, unknown>,
): AgentCapabilities | undefined {
  return value.sessions && value.prompts && value.interaction && value.workspace
    ? (value as unknown as AgentCapabilities)
    : undefined;
}
