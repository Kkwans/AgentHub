import { AgentAdmissionCoordinator } from './agent-admission-coordinator.js';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
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
import { isResourceCleanupUnconfirmed, runProcess } from '@agenthub/agent-core';
import type { AgentHubDatabase, AgentRepository, ExecutionTargetRepository } from '@agenthub/db';

import { AppError } from '../errors.js';

type AdapterKind = 'ACP_STDIO' | 'OPENCLAW_GATEWAY' | 'OPENCLAW_EXEC';

type AgentRecord = NonNullable<Awaited<ReturnType<AgentRepository<AgentHubDatabase>['get']>>>;
type TargetRecord = NonNullable<
  Awaited<ReturnType<ExecutionTargetRepository<AgentHubDatabase>['get']>>
>;
export type AgentEligibilityReason =
  | 'DISABLED'
  | 'NOT_READY'
  | 'TARGET_MISSING'
  | 'PROJECT_TARGET_MISSING'
  | 'PROJECT_INACTIVE'
  | 'INCOMPATIBLE_WORKSPACE'
  | 'REMOTE_GATEWAY_UNAVAILABLE';
export interface AgentEligibility {
  agentId: string;
  eligible: boolean;
  reason: AgentEligibilityReason | null;
  agentStatus: string;
  targetStatus: string | null;
}

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
  private checksAccepting = true;
  private readonly admissionPending = new Set<Promise<unknown>>();
  private readonly admission = new AgentAdmissionCoordinator(() =>
    this.assertAvailabilityRuntime(),
  );

  private assertAvailabilityRuntime() {
    this.assertRuntimeHeld();
    if (!this.checksAccepting)
      throw new AppError(503, 'AGENT_ADMISSION_STOPPING', '服务正在停止，不接受新的 Agent 操作');
  }

  private coordinate<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const pending = this.admission.run(id, async ({ assertRuntimeHeld }) => {
      // The operation owns any checkpoint needed immediately before its DB write.
      assertRuntimeHeld();
      return operation();
    });
    this.admissionPending.add(pending);
    void pending.then(
      () => this.admissionPending.delete(pending),
      () => this.admissionPending.delete(pending),
    );
    return pending;
  }

  /** A short enabled read is the new-work admission point, never a provider lifetime lock. */
  admitNewWork(id: string) {
    return this.coordinate(id, async () => {
      const agent = await this.agents.get(id);
      this.assertAvailabilityRuntime();
      if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent 不存在');
      if (!agent.enabled)
        throw new AppError(409, 'AGENT_DISABLED', 'Agent 已禁用，不能接受新的工作');
      return agent;
    });
  }

  setAvailability(id: string, input: { enabled: boolean; expectedRevision: number }) {
    return this.coordinate(id, async () => {
      this.assertAvailabilityRuntime();
      const updated = await this.agents.compareAndSetAvailability(
        id,
        input.enabled,
        input.expectedRevision,
      );
      if (updated) return updated;
      if (!(await this.agents.get(id))) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent 不存在');
      throw new AppError(
        409,
        'AGENT_AVAILABILITY_CONFLICT',
        'Agent 启停状态已变化，请核对当前状态',
      );
    });
  }

  private cleanupUnconfirmed = false;
  private checkShutdown?: Promise<void>;
  private readonly checksPending = new Map<string, Promise<void>>();

  private async withConnectionAdmission<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (!this.checksAccepting || this.cleanupUnconfirmed)
      throw new AppError(503, 'AGENT_CHECK_UNAVAILABLE', '检查资源尚未确认停止，暂不接受新的检查');
    if (this.checksPending.has(id))
      throw new AppError(409, 'AGENT_CHECK_IN_PROGRESS', '此 Agent 已有检查进行中，请核对原操作');
    let done!: () => void;
    this.checksPending.set(
      id,
      new Promise<void>((resolve) => {
        done = resolve;
      }),
    );
    try {
      return await operation();
    } catch (error) {
      if (
        isResourceCleanupUnconfirmed(error) ||
        (error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ACP_PROCESS_CLEANUP_UNCONFIRMED')
      )
        this.cleanupUnconfirmed = true;
      throw error;
    } finally {
      this.checksPending.delete(id);
      done();
    }
  }

  shutdownConnectionChecks(): Promise<void> {
    this.checkShutdown ??= this.stopConnectionChecks();
    return this.checkShutdown;
  }

  private async stopConnectionChecks(): Promise<void> {
    this.checksAccepting = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([
          ...this.checksPending.values(),
          Promise.allSettled([...this.admissionPending]),
        ]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('pending check')), 5_000);
        }),
      ]);
      if (this.cleanupUnconfirmed) throw new Error('cleanup unconfirmed');
    } catch {
      throw new AppError(
        503,
        'AGENT_CHECK_SHUTDOWN_UNCONFIRMED',
        '检查进程尚未确认停止，必须保留运行归属',
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private assertCheckAdmission(): void {
    this.assertRuntimeHeld();
    if (!this.checksAccepting || this.cleanupUnconfirmed)
      throw new AppError(503, 'AGENT_CHECK_UNAVAILABLE', '服务正在停止，未启动检查');
  }

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
    private readonly assertRuntimeHeld: () => void = () => undefined,
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

  /** Explicit, project-bound non-smoke check. Legacy route shape is preserved; shared cleanup, admission and saved-evidence safety are tightened. */
  async checkConnection(
    id: string,
    expectedTargetId: string,
    project: {
      id: string;
      targetId: string;
      status: string;
      rootPath: string;
      realRootPath: string;
    },
    assertCanLaunch: () => void = () => undefined,
  ) {
    return this.withConnectionAdmission(id, async () => {
      const agent = await this.admitNewWork(id);
      if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent 不存在');
      const target = await this.targets.get(agent.targetId);
      if (!agent.enabled || agent.adapterKind !== 'ACP_STDIO' || target?.kind !== 'LOCAL_HOST')
        throw new AppError(
          409,
          'CONNECTION_CHECK_UNSUPPORTED',
          '此检查仅支持已启用的本机 ACP Agent',
        );
      if (
        agent.targetId !== expectedTargetId ||
        project.targetId !== expectedTargetId ||
        project.status !== 'ACTIVE'
      )
        throw new AppError(
          409,
          'CONNECTION_CHECK_SCOPE_CHANGED',
          '项目或执行环境已变化，未启动检查',
        );
      let cwd: string;
      try {
        cwd = await realpath(project.rootPath);
        if (cwd !== project.realRootPath || !(await stat(cwd)).isDirectory())
          throw new Error('changed');
      } catch {
        throw new AppError(
          409,
          'CONNECTION_CHECK_DIRECTORY_CHANGED',
          '项目目录无法确认，未启动检查',
        );
      }
      const profile = toAgentProfile(agent, target, { cwd, smokeSession: false });
      const adapter = this.adapterForTarget(target.kind, 'ACP_STDIO');
      profile.config.preflightStrictCleanup = true;
      this.assertCheckAdmission();
      assertCanLaunch();
      const report = await adapter.preflight(profile);
      const capabilities =
        report.status === 'READY' ? await adapter.getCapabilities(profile) : undefined;
      await this.agents.updatePreflight(id, {
        status: report.status,
        detectedVersion: safeDetectedVersion(report.detectedVersion),
        ...(capabilities ? { capabilitiesJson: savedCapabilityFlags(capabilities) } : {}),
      });
      // Do not expose arbitrary provider messages, details, commands or configuration.
      return {
        agentId: id,
        targetId: expectedTargetId,
        projectId: project.id,
        cwd,
        smokeSession: false as const,
        status: report.status,
        checkedAt: report.checkedAt,
        checks: report.checks
          .filter((check) => ['process', 'initialize', 'session'].includes(check.id))
          .map((check) => ({ id: check.id, status: check.status })),
      };
    });
  }

  async preflight(id: string, input: AgentPreflightInput): Promise<PreflightReport> {
    return this.withConnectionAdmission(id, async () => {
      const agent = await this.admitNewWork(id);
      if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent 不存在');
      const target = await this.targets.get(agent.targetId);
      if (!target)
        throw new AppError(500, 'AGENT_TARGET_MISSING', 'Agent 的 Execution Target 不存在');
      const profile = toAgentProfile(agent, target, input);
      profile.config.preflightStrictCleanup = true;
      this.assertCheckAdmission();
      const adapter = this.adapterForTarget(target.kind, agent.adapterKind as AdapterKind);
      const report = await adapter.preflight(profile);
      const capabilities =
        report.status === 'READY' ? await adapter.getCapabilities(profile) : undefined;
      await this.agents.updatePreflight(id, {
        status: report.status,
        detectedVersion: safeDetectedVersion(report.detectedVersion),
        ...(capabilities ? { capabilitiesJson: savedCapabilityFlags(capabilities) } : {}),
      });
      const safeReport = { ...report };
      delete safeReport.detectedVersion;
      const detectedVersion = safeDetectedVersion(report.detectedVersion);
      return { ...safeReport, ...(detectedVersion ? { detectedVersion } : {}) };
    });
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
    return this.coordinate(id, () => this.resolveRuntimeAdmitted(id, cwd, expectedTargetId));
  }

  private async resolveRuntimeAdmitted(id: string, cwd: string, expectedTargetId: string) {
    const agent = await this.agents.get(id);
    if (!agent) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent 不存在');
    const agentTarget = await this.targets.get(agent.targetId);
    const projectTarget =
      agent.targetId === expectedTargetId ? agentTarget : await this.targets.get(expectedTargetId);
    this.assertAvailabilityRuntime();
    const reason = this.runtimeEligibilityReason(agent, agentTarget, projectTarget, cwd);
    if (reason === 'DISABLED' || reason === 'NOT_READY')
      throw new AppError(409, 'AGENT_NOT_READY', '只有就绪且已启用的 Agent 可以创建或恢复 Session');
    if (reason === 'TARGET_MISSING' || !agentTarget)
      throw new AppError(500, 'AGENT_TARGET_MISSING', 'Agent 的 Execution Target 不存在');
    if (reason === 'PROJECT_TARGET_MISSING' || reason === 'INCOMPATIBLE_WORKSPACE')
      throw new AppError(
        409,
        'AGENT_PROJECT_TARGET_MISMATCH',
        'Agent 的执行环境无法访问当前 Project 工作区',
      );
    if (reason === 'REMOTE_GATEWAY_UNAVAILABLE')
      throw new AppError(503, 'REMOTE_NODE_GATEWAY_UNAVAILABLE', 'Remote Node Gateway 不可用');
    return {
      profile: toAgentProfile(agent, agentTarget, { cwd }),
      adapter: this.adapterForTarget(agentTarget.kind, agent.adapterKind as AdapterKind),
    };
  }

  // Registration snapshot only: this deliberately does not create an adapter,
  // probe executable/login state, start a container, or update preflight data.
  async listProjectEligibility(project: {
    id: string;
    targetId: string;
    realRootPath: string;
    status: string;
  }) {
    const [agents, projectTarget] = await Promise.all([
      this.agents.list(),
      this.targets.get(project.targetId),
    ]);
    const targetCache = new Map<string, TargetRecord | undefined>([
      [project.targetId, projectTarget],
    ]);
    const entries: AgentEligibility[] = [];
    for (const agent of agents) {
      if (!targetCache.has(agent.targetId))
        targetCache.set(agent.targetId, await this.targets.get(agent.targetId));
      const target = targetCache.get(agent.targetId);
      const reason =
        project.status !== 'ACTIVE'
          ? 'PROJECT_INACTIVE'
          : this.runtimeEligibilityReason(agent, target, projectTarget, project.realRootPath);
      entries.push({
        agentId: agent.id,
        eligible: reason === null,
        reason,
        agentStatus: agent.status,
        targetStatus: target?.status ?? null,
      });
    }
    return {
      projectId: project.id,
      basis: 'REGISTERED_STATE' as const,
      livePreflight: false as const,
      agents: entries,
    };
  }

  private runtimeEligibilityReason(
    agent: AgentRecord,
    agentTarget: TargetRecord | undefined,
    projectTarget: TargetRecord | undefined,
    cwd: string,
  ): AgentEligibilityReason | null {
    if (!agent.enabled) return 'DISABLED';
    if (agent.status !== 'READY') return 'NOT_READY';
    if (!agentTarget) return 'TARGET_MISSING';
    if (!projectTarget) return 'PROJECT_TARGET_MISSING';
    if (
      agentTarget.id !== projectTarget.id &&
      !canAgentReachProject(agentTarget, projectTarget, cwd)
    )
      return 'INCOMPATIBLE_WORKSPACE';
    if (agentTarget.kind === 'REMOTE_NODE' && !this.remoteAdapter)
      return 'REMOTE_GATEWAY_UNAVAILABLE';
    return null;
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

/** Provider version is informational, never arbitrary diagnostic text. */
function safeDetectedVersion(value: unknown): string | null {
  return typeof value === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value) ? value : null;
}

/** Saved global evidence contains flags only, not provider/config text or option labels. */
function savedCapabilityFlags(value: AgentCapabilities): Record<string, unknown> {
  const keys = {
    sessions: ['create', 'load', 'resume', 'close'],
    prompts: ['text', 'images', 'resources'],
    interaction: ['streaming', 'approvals', 'questions', 'plan'],
    workspace: ['files', 'terminal', 'additionalRoots', 'mcpStdio', 'mcpHttp'],
    configuration: ['models', 'modes', 'reasoningEffort'],
    telemetry: ['tokenUsage', 'cost'],
  };
  return Object.fromEntries(
    Object.entries(keys).map(([group, fields]) => {
      const candidate = (value as unknown as Record<string, unknown>)[group];
      const source =
        candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>) : {};
      return [
        group,
        Object.fromEntries(
          fields
            .filter((field) => typeof source[field] === 'boolean')
            .map((field) => [field, source[field]]),
        ),
      ];
    }),
  );
}
