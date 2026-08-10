import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AgentRepository,
  ApiTokenRepository,
  ApprovalRepository,
  createDatabase,
  EventRepository,
  ExecutionTargetRepository,
  GitSnapshotRepository,
  GoalRepository,
  MessageRepository,
  ProjectRepository,
  PromptRepository,
  RemoteNodeRepository,
  RunRepository,
  SessionRepository,
  SkillRepository,
  TaskRepository,
  WorktreeExecutionRepository,
  type DatabaseClient,
} from '@agenthub/db';
import pino from 'pino';

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
import { SessionService } from './sessions/session-service.js';
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

  const authMode = resolveAuthMode(host, environment.AGENTHUB_AUTH_MODE);
  const configuredWebDist = environment.AGENTHUB_WEB_DIST;
  const webDist = configuredWebDist
    ? resolve(configuredWebDist)
    : resolve(import.meta.dirname, '../../web/dist');
  const webAvailable = existsSync(resolve(webDist, 'index.html'));

  const logger = pino({
    level: environment.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'request.headers.authorization',
        'headers.authorization',
        '*.token',
        '*.password',
        '*.secret',
      ],
      censor: '[REDACTED]',
    },
  });
  const database = await createDatabase({
    databaseUrl: environment.DATABASE_URL,
    dataDir: environment.AGENTHUB_DATA_DIR,
  });
  const apiTokenRepository = new ApiTokenRepository(database.db);
  const auth = new AuthService(apiTokenRepository, authMode, environment.AGENTHUB_BOOTSTRAP_TOKEN);
  try {
    await auth.assertConfigured();
  } catch (error) {
    await database.close();
    throw error;
  }
  const eventRepository = new EventRepository(database.db);
  const executionTargetRepository = new ExecutionTargetRepository(database.db);
  const brokerRef: { current?: TopicBroker } = {};
  const agentRepository = new AgentRepository(database.db);
  const projectRepository = new ProjectRepository(database.db);
  const sessionRepository = new SessionRepository(database.db);
  const runRepository = new RunRepository(database.db);
  const messageRepository = new MessageRepository(database.db);
  const approvalRepository = new ApprovalRepository(database.db);
  const gitSnapshotRepository = new GitSnapshotRepository(database.db);
  const promptRepository = new PromptRepository(database.db);
  const skillRepository = new SkillRepository(database.db);
  const goalRepository = new GoalRepository(database.db);
  const taskRepository = new TaskRepository(database.db);
  const worktreeExecutionRepository = new WorktreeExecutionRepository(database.db);
  const remoteNodeRepository = new RemoteNodeRepository(database.db);
  const docker = new DockerControlService(undefined, executionTargetRepository);
  const executionTargets = new ExecutionTargetService(executionTargetRepository, docker);
  const projects = new ProjectService(projectRepository, executionTargetRepository);
  const git = new GitService(projectRepository, gitSnapshotRepository);
  const terminal = new TerminalService(projectRepository, {
    publish: (topic, event) => brokerRef.current?.publish(topic, event),
  });
  const promptos = new PromptService(promptRepository, skillRepository, projectRepository);
  const acpLauncher = new RoutedAcpProcessLauncher(
    new HostAcpProcessLauncher(),
    new DockerAcpProcessLauncher(docker),
  );
  const openClawExec = new DockerOpenClawExecLauncher(docker);
  const agents = new AgentService(
    agentRepository,
    executionTargetRepository,
    acpLauncher,
    (adapterKind, launcher) => {
      const primary = new AcpAdapter({ launcher });
      return adapterKind === 'OPENCLAW_GATEWAY'
        ? new OpenClawAdapter({ primary, exec: openClawExec })
        : primary;
    },
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
  );
  const tasks = new TaskService(goalRepository, taskRepository, projectRepository, sessions);
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
  );
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
  const remoteNodes = new RemoteNodeService(remoteNodeRepository, {
    publish: (topic, event) => brokerRef.current?.publish(topic, event),
  });
  const recovery = {
    sessions: await sessions.recoverAfterRestart(),
    worktrees: await worktrees.recoverAfterRestart(),
  };
  const app = createApp({
    logger,
    eventSource: eventRepository,
    health: async () => ({ database: database.mode, web: webAvailable }),
    executionTargets,
    agents,
    sessions,
    projects,
    git,
    terminal,
    promptos,
    tasks,
    dashboard,
    auth,
    worktrees,
    remoteNodes,
    ...(webAvailable ? { webDist } : {}),
  });
  const server = createServer(app);
  const broker = new TopicBroker(server, eventRepository, auth);
  const remoteNodeGateway = new RemoteNodeGateway(server, remoteNodes);
  brokerRef.current = broker;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
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
    close: async () => {
      await terminal.shutdown();
      await worktrees.shutdown();
      await sessions.shutdown();
      await remoteNodeGateway.close();
      await broker.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await database.close();
    },
  };
}

async function main(): Promise<void> {
  const running = await startServer();
  const shutdown = () => {
    void running.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { createApp, AppError, TopicBroker };
