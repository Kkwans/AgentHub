import { createShutdownHandler } from './shutdown-handler.js';
import { RuntimeOperations } from './runtime-operations.js';
import { RuntimeLifecycle } from './runtime-lifecycle.js';
import { initializeManagedGitRuntime } from './git/managed-git-runtime.js';
import { recoverRuntimeAfterRestart } from './startup-recovery.js';
import { logRedaction } from './log-redaction.js';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AgentRepository,
  ApiTokenRepository,
  ApprovalRepository,
  createDatabase,
  EventRepository,
  ExecutionTargetRepository,
  GitSnapshotRepository,
  GitCommitOperationRepository,
  GoalRepository,
  LocalAuthRepository,
  MessageRepository,
  ProjectRepository,
  PromptRepository,
  RemoteNodeRepository,
  RunRepository,
  SessionRepository,
  SessionContinuationRepository,
  SkillRepository,
  TaskRepository,
  TaskStartAttemptRepository,
  WorktreeExecutionRepository,
  type DatabaseClient,
} from '@agenthub/db';
import pino from 'pino';
import type { AgentProfile } from '@agenthub/agent-core';

import { createApp } from './app.js';
import { AppError } from './errors.js';
import { TopicBroker } from './websocket.js';
import { DockerControlService } from './docker/docker-control.js';
import { ExecutionTargetService } from './docker/execution-target-service.js';
import { AcpAdapter, HostAcpProcessLauncher } from '@agenthub/adapter-acp';
import { OpenClawAdapter } from '@agenthub/adapter-openclaw';
import { AgentService } from './agents/agent-service.js';
import {
  DockerAcpProcessLauncher,
  RoutedAcpProcessLauncher,
} from './agents/docker-acp-launcher.js';
import { DockerOpenClawExecLauncher } from './agents/docker-openclaw-exec.js';
import {
  resolveApprovalDeliveryTimeout,
  resolveCancelConvergenceTimeout,
  SessionService,
} from './sessions/session-service.js';
import { ProjectService } from './projects/project-service.js';
import { GitService } from './git/git-service.js';
import { TerminalService } from './terminal/terminal-service.js';
import { PromptService } from './promptos/prompt-service.js';
import { TaskService } from './tasks/task-service.js';
import { DashboardService } from './dashboard/dashboard-service.js';
import { AuthService, resolveAuthMode } from './auth/auth-service.js';
import { WorktreeGitService } from './worktrees/worktree-git-service.js';
import { WorktreeTaskService } from './worktrees/worktree-task-service.js';
import { RemoteNodeService } from './remote-nodes/remote-node-service.js';
import { RemoteNodeGateway } from './remote-nodes/remote-node-gateway.js';
import { RemoteNodeOperations } from './remote-nodes/remote-node-operations.js';
import { RemoteAgentAdapter } from './remote-nodes/remote-agent-adapter.js';
import { WebSocketUpgradeRouter } from './websocket-upgrade.js';
import { RuntimeDiscoveryService } from './discovery/runtime-discovery.js';
import { AgentDiscoveryService } from './discovery/agent-discovery.js';
import { FilesystemService } from './filesystem/filesystem-service.js';

/**
 * Codex 0.147.0 may prefer the Responses WebSocket transport for the
 * ChatGPT provider. That transport is unreliable behind the NAS egress
 * proxy, while the same authenticated account works over HTTPS/SSE. The
 * ACP adapter accepts this JSON through CODEX_CONFIG, so keep the workaround
 * scoped to AgentHub's Codex child and do not mutate the user's Codex config.
 */
function createCodexHttpProviderConfig(proxy: string): string {
  return JSON.stringify({
    // Codex 0.147.0 accepts http_proxy in its runtime config and applies it
    // before constructing the Rust HTTP client. Keep the value scoped to the
    // ACP child so AgentHub itself and Docker Agents do not inherit it.
    http_proxy: proxy,
    model_provider: 'openai_http',
    model_providers: {
      openai_http: {
        name: 'AgentHub Codex HTTPS',
        base_url: 'https://chatgpt.com/backend-api/codex',
        wire_api: 'responses',
        requires_openai_auth: true,
        supports_websockets: false,
      },
    },
  });
}

export interface RunningServer {
  readonly server: Server;
  readonly broker: TopicBroker;
  readonly database: DatabaseClient;
  readonly remoteNodes: RemoteNodeGateway;
  close(): Promise<void>;
}

export async function startServer(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<RunningServer> {
  const host = environment.AGENTHUB_HOST ?? '127.0.0.1';
  const port = Number(environment.AGENTHUB_PORT ?? 3210);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new AppError(500, 'INVALID_SERVER_PORT', 'AGENTHUB_PORT 必须是合法端口');
  }
  const cancelTimeoutRaw = environment.AGENTHUB_RUN_CANCEL_TIMEOUT_MS;
  const cancelConvergenceTimeoutMs = resolveCancelConvergenceTimeout(
    cancelTimeoutRaw === undefined ? undefined : Number(cancelTimeoutRaw),
  );
  const approvalDeliveryTimeoutRaw = environment.AGENTHUB_APPROVAL_DELIVERY_TIMEOUT_MS;
  const approvalDeliveryTimeoutMs = resolveApprovalDeliveryTimeout(
    approvalDeliveryTimeoutRaw === undefined ? undefined : Number(approvalDeliveryTimeoutRaw),
  );
  const acpPromptTimeoutRaw = environment.AGENTHUB_ACP_PROMPT_TIMEOUT_MS;
  const acpPromptTimeoutMs = resolveAcpPromptTimeout(
    acpPromptTimeoutRaw === undefined ? undefined : Number(acpPromptTimeoutRaw),
  );

  const authMode = resolveAuthMode(host, environment.AGENTHUB_AUTH_MODE);
  const configuredWebDist = environment.AGENTHUB_WEB_DIST;
  const webDist = configuredWebDist
    ? resolve(configuredWebDist)
    : resolve(import.meta.dirname, '../../web/dist');
  const webAvailable = existsSync(resolve(webDist, 'index.html'));

  const logger = pino({
    level: environment.LOG_LEVEL ?? 'info',
    redact: logRedaction,
  });
  const database = await createDatabase({
    databaseUrl: environment.DATABASE_URL,
    dataDir: environment.AGENTHUB_DATA_DIR,
    runtimeOwnership: true,
  });
  let lifecycle: RuntimeLifecycle;
  try {
    lifecycle = new RuntimeLifecycle(database, () =>
      logger.error('运行实例归属失效，服务已停止接受操作；清理失败需人工核对'),
    );
  } catch (error) {
    await database.close();
    throw error;
  }
  try {
    const apiTokenRepository = new ApiTokenRepository(database.db);
    const localAuthRepository = new LocalAuthRepository(database.db);
    const auth = new AuthService(
      apiTokenRepository,
      localAuthRepository,
      authMode,
      environment.AGENTHUB_BOOTSTRAP_TOKEN,
      environment.AGENTHUB_SECURE_TRANSPORT === 'true',
    );
    await auth.assertConfigured();
    lifecycle.assertHeld();
    const eventRepository = new EventRepository(database.db);
    const executionTargetRepository = new ExecutionTargetRepository(database.db);
    const brokerRef: { current?: TopicBroker } = {};
    const server = createServer();
    const stopHttp = () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING')
            reject(error);
          else resolve();
        });
        server.closeAllConnections();
      });
    lifecycle.addStop(stopHttp);
    const upgradeRouter = new WebSocketUpgradeRouter(server);
    lifecycle.addStop(() => upgradeRouter.close());
    const agentRepository = new AgentRepository(database.db);
    const projectRepository = new ProjectRepository(database.db);
    const sessionRepository = new SessionRepository(database.db);
    const sessionContinuationRepository = new SessionContinuationRepository(database.db);
    const runRepository = new RunRepository(database.db);
    const messageRepository = new MessageRepository(database.db);
    const approvalRepository = new ApprovalRepository(database.db);
    const gitSnapshotRepository = new GitSnapshotRepository(database.db);
    const promptRepository = new PromptRepository(database.db);
    const skillRepository = new SkillRepository(database.db);
    const goalRepository = new GoalRepository(database.db);
    const taskRepository = new TaskRepository(database.db);
    const taskStartAttempts = new TaskStartAttemptRepository(database.db);
    const worktreeExecutionRepository = new WorktreeExecutionRepository(database.db);
    const remoteNodeRepository = new RemoteNodeRepository(database.db);
    const remoteNodes = new RemoteNodeService(remoteNodeRepository, {
      publish: (topic, event) => brokerRef.current?.publish(topic, event),
    });
    const remoteNodeGateway = new RemoteNodeGateway(upgradeRouter, remoteNodes);
    lifecycle.addStop(() => remoteNodeGateway.close());
    const remoteNodeOperations = new RemoteNodeOperations(remoteNodeRepository, remoteNodeGateway);
    const remoteAgentAdapter = new RemoteAgentAdapter(remoteNodeGateway);
    const docker = new DockerControlService(undefined, executionTargetRepository);
    const executionTargets = new ExecutionTargetService(executionTargetRepository, docker);
    const workspaceRoots = resolveWorkspaceRoots(environment);
    const projects = new ProjectService(
      projectRepository,
      executionTargetRepository,
      remoteNodeOperations,
      workspaceRoots,
    );
    const runtimeDiscovery = new RuntimeDiscoveryService(
      executionTargetRepository,
      executionTargets,
      {
        workspaceRoots,
      },
    );
    const filesystem = new FilesystemService(
      executionTargetRepository,
      workspaceRoots,
      remoteNodeOperations,
    );
    const managedGitRuntime = await initializeManagedGitRuntime(
      {
        db: database.db,
        projects: projectRepository,
        targets: executionTargetRepository,
      },
      (code) => logger.warn({ code }, '托管 Git 写入已隔离，只读恢复仍可用'),
    );
    lifecycle.assertHeld();
    const git = new GitService(
      projectRepository,
      gitSnapshotRepository,
      executionTargetRepository,
      new GitCommitOperationRepository(database.db),
      managedGitRuntime,
    );
    const terminal = new TerminalService(projectRepository, {
      publish: (topic, event) => brokerRef.current?.publish(topic, event),
    });
    lifecycle.addStop(() => terminal.shutdown());
    const promptos = new PromptService(promptRepository, skillRepository, projectRepository);
    const resolveEnvironment = async () => ({ ...process.env, ...environment });
    const resolveHostAgentEnvironment = async (profile: AgentProfile) => {
      const resolved = await resolveEnvironment();
      const proxy = environment.AGENTHUB_CODEX_PROXY_URL?.trim();
      if (profile.agentKind !== 'CODEX' || !proxy) return resolved;
      // Keep the NAS egress proxy scoped to the Codex ACP child. OpenClaw,
      // server-side requests, and unrelated host Agents retain their own env.
      return {
        ...resolved,
        CODEX_CONFIG: createCodexHttpProviderConfig(proxy),
        HTTP_PROXY: proxy,
        HTTPS_PROXY: proxy,
        ALL_PROXY: proxy,
        http_proxy: proxy,
        https_proxy: proxy,
        all_proxy: proxy,
      };
    };
    const hostAgentIdentity = resolveHostAgentIdentity(environment);
    const acpLauncher = new RoutedAcpProcessLauncher(
      new HostAcpProcessLauncher({
        assertCanLaunch: () => lifecycle.assertHeld(),
        resolveEnvironment: resolveHostAgentEnvironment,
        ...(hostAgentIdentity ? { runAs: hostAgentIdentity } : {}),
      }),
      new DockerAcpProcessLauncher(docker),
    );
    const openClawExec = new DockerOpenClawExecLauncher(docker);
    const preferOpenClawExec =
      environment.AGENTHUB_OPENCLAW_TRANSPORT?.trim().toLowerCase() === 'exec';
    const agents = new AgentService(
      agentRepository,
      executionTargetRepository,
      acpLauncher,
      (adapterKind, launcher) => {
        const primary = new AcpAdapter({
          launcher,
          promptTimeoutMs: acpPromptTimeoutMs,
          // OpenClaw's Gateway-backed ACP can publish an upstream error without
          // resolving session/prompt. Keep that path bounded while retaining a
          // longer window for local coding Agents.
          ...(adapterKind === 'OPENCLAW_GATEWAY' ? { promptTimeoutMs: 30_000 } : {}),
        });
        return adapterKind === 'OPENCLAW_GATEWAY'
          ? new OpenClawAdapter({
              primary,
              exec: openClawExec,
              ...(preferOpenClawExec ? { preferExec: true } : {}),
            })
          : primary;
      },
      remoteAgentAdapter,
      resolveEnvironment,
      () => lifecycle.assertHeld(),
    );
    lifecycle.addStop(() => agents.shutdownConnectionChecks());
    const agentDiscovery = new AgentDiscoveryService(
      agents,
      agentRepository,
      runtimeDiscovery,
      workspaceRoots,
      remoteNodeRepository,
    );
    const sessions = new SessionService(
      sessionRepository,
      runRepository,
      messageRepository,
      eventRepository,
      approvalRepository,
      projectRepository,
      agents,
      { publish: (topic, event) => brokerRef.current?.publish(topic, event) },
      git,
      promptos,
      { cancelConvergenceTimeoutMs, approvalDeliveryTimeoutMs },
      sessionContinuationRepository,
      taskStartAttempts,
    );
    lifecycle.addStop(() => sessions.shutdown());
    const tasks = new TaskService(
      goalRepository,
      taskRepository,
      projectRepository,
      sessions,
      promptos,
      taskStartAttempts,
    );
    const dataPath = environment.AGENTHUB_DATA_DIR
      ? resolve(environment.AGENTHUB_DATA_DIR)
      : resolve(process.cwd(), '.agenthub/data/pgdata');
    const worktreeRoot = environment.AGENTHUB_WORKTREE_ROOT
      ? resolve(environment.AGENTHUB_WORKTREE_ROOT)
      : resolve(dirname(dataPath), 'worktrees');
    const worktrees = new WorktreeTaskService(
      worktreeExecutionRepository,
      taskRepository,
      projectRepository,
      agentRepository,
      executionTargetRepository,
      sessions,
      new WorktreeGitService(worktreeRoot),
      { publish: (topic, event) => brokerRef.current?.publish(topic, event) },
      managedGitRuntime,
    );
    lifecycle.addStop(() => worktrees.shutdown());
    lifecycle.assertHeld();
    sessions.setTaskLifecycleObserver({
      onRunCompleted: async (taskId, runId) => {
        if (!(await worktrees.onRunCompleted(taskId, runId))) {
          await tasks.onRunCompleted(taskId, runId);
        }
      },
      onRunStopped: async (taskId, runId, reason) => {
        if (!(await worktrees.onRunStopped(taskId, runId, reason))) {
          await tasks.onRunStopped(taskId, runId);
        }
      },
      onRunWaitingForInput: (taskId, runId) => worktrees.onRunWaitingForInput(taskId, runId),
      onRunResumed: (taskId, runId) => worktrees.onRunResumed(taskId, runId),
    });
    const dashboard = new DashboardService(
      sessionRepository,
      taskRepository,
      runRepository,
      approvalRepository,
      agentRepository,
    );
    const recovery = await recoverRuntimeAfterRestart({
      sessions,
      worktrees,
      tasks,
      runs: runRepository,
    });
    lifecycle.assertHeld();
    const operations = new RuntimeOperations(() => lifecycle.assertHeld());
    lifecycle.addStop(() => operations.close());
    const app = createApp({
      runtimeOperations: operations,
      logger,
      eventSource: operations.wrap(eventRepository),
      health: operations.wrapFunction(async () => ({ database: database.mode, web: webAvailable })),
      executionTargets: operations.wrap(executionTargets),
      agents: operations.wrap(agents),
      sessions: operations.wrap(sessions),
      projects: operations.wrap(projects),
      git: operations.wrap(git),
      terminal: operations.wrap(terminal),
      promptos: operations.wrap(promptos),
      tasks: operations.wrap(tasks),
      dashboard: operations.wrap(dashboard),
      auth: operations.wrap(auth),
      worktrees: operations.wrap(worktrees),
      remoteNodes: operations.wrap(remoteNodes),
      runtimeDiscovery: operations.wrap(runtimeDiscovery),
      agentDiscovery: operations.wrap(agentDiscovery),
      filesystem: operations.wrap(filesystem),
      secureTransport: environment.AGENTHUB_SECURE_TRANSPORT === 'true',
      ...(webAvailable ? { webDist } : {}),
    });
    server.on('request', (request, response) => {
      try {
        lifecycle.assertHeld();
      } catch {
        response.writeHead(503, { 'content-type': 'application/json', connection: 'close' });
        response.end(
          JSON.stringify({
            error: {
              code: 'RUNTIME_STOPPING',
              message: '服务正在停止，请核对原操作，不要重复提交。',
            },
          }),
        );
        return;
      }
      app(request, response);
    });
    const broker = new TopicBroker(upgradeRouter, eventRepository, auth);
    brokerRef.current = broker;
    lifecycle.addStop(() => broker.close());
    lifecycle.assertHeld();

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    try {
      lifecycle.assertHeld();
    } catch (error) {
      // listen may finish after an ownership-loss shutdown began during DNS/bind.
      await stopHttp();
      throw error;
    }
    logger.info(
      { host, port, database: database.mode, web: webAvailable, recovery },
      'AgentHub server started',
    );
    worktrees.resumeQueued(recovery.worktrees.queuedProjects);

    return {
      server,
      broker,
      database,
      remoteNodes: remoteNodeGateway,
      close: () => lifecycle.close(),
    };
  } catch (error) {
    try {
      await lifecycle.close();
    } catch {
      logger.error('启动失败后的资源清理未完成，请人工核对原实例');
    }
    throw error;
  }
}

function resolveHostAgentIdentity(
  environment: NodeJS.ProcessEnv,
): { uid: number; gid: number } | undefined {
  // The central service needs root for the Docker socket, but host Agent
  // processes must write their session stores as the project owner.
  if (process.getuid?.() !== 0) return undefined;
  const uid = parseNonNegativeInteger(environment.AGENTHUB_PROJECT_OWNER_UID);
  const gid = parseNonNegativeInteger(environment.AGENTHUB_PROJECT_OWNER_GID);
  return uid === undefined || gid === undefined ? undefined : { uid, gid };
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 0xffff_ffff ? parsed : undefined;
}

function resolveAcpPromptTimeout(value: number | undefined): number {
  const resolved = value ?? 120_000;
  if (!Number.isInteger(resolved) || resolved < 10_000 || resolved > 600_000) {
    throw new AppError(
      500,
      'INVALID_ACP_PROMPT_TIMEOUT_MS',
      'ACP prompt timeout 必须是 10000-600000 的整数毫秒',
    );
  }
  return resolved;
}

function resolveWorkspaceRoots(environment: NodeJS.ProcessEnv): string[] {
  const configured = environment.AGENTHUB_WORKSPACE_ROOTS_JSON;
  if (configured) {
    try {
      const parsed: unknown = JSON.parse(configured);
      if (Array.isArray(parsed)) {
        const roots = parsed.filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0 && isAbsolute(value),
        );
        if (roots.length) return [...new Set(roots.map((root) => resolve(root)))];
      }
    } catch {
      // Fall back to safe local defaults; malformed optional configuration must not expose '/'.
    }
  }
  const defaults = ['/volume2/Project', process.cwd()];
  return [...new Set(defaults.filter((root) => existsSync(root)).map((root) => resolve(root)))];
}

async function main(): Promise<void> {
  const running = await startServer();
  const shutdown = createShutdownHandler(
    () => running.close(),
    () => process.exit(0),
    () => {
      console.error('服务清理尚未确认，保留运行归属并停止接单；请人工核对原操作。');
      process.exitCode = 1;
      // A file descriptor alone does not keep Node alive. Stay unavailable until
      // an operator has verified the external resources, rather than auto-release.
      setInterval(() => {}, 60_000);
    },
  );
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { createApp, AppError, TopicBroker };
