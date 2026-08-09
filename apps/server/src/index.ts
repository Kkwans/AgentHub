import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

import {
  AgentRepository,
  ApprovalRepository,
  createDatabase,
  EventRepository,
  ExecutionTargetRepository,
  GitSnapshotRepository,
  MessageRepository,
  ProjectRepository,
  RunRepository,
  SessionRepository,
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

export interface RunningServer {
  readonly server: Server;
  readonly broker: TopicBroker;
  readonly database: DatabaseClient;
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

  const logger = pino({ level: environment.LOG_LEVEL ?? 'info' });
  const database = await createDatabase({
    databaseUrl: environment.DATABASE_URL,
    dataDir: environment.AGENTHUB_DATA_DIR,
  });
  const eventRepository = new EventRepository(database.db);
  const executionTargetRepository = new ExecutionTargetRepository(database.db);
  const agentRepository = new AgentRepository(database.db);
  const projectRepository = new ProjectRepository(database.db);
  const sessionRepository = new SessionRepository(database.db);
  const runRepository = new RunRepository(database.db);
  const messageRepository = new MessageRepository(database.db);
  const approvalRepository = new ApprovalRepository(database.db);
  const gitSnapshotRepository = new GitSnapshotRepository(database.db);
  const docker = new DockerControlService(undefined, executionTargetRepository);
  const executionTargets = new ExecutionTargetService(executionTargetRepository, docker);
  const projects = new ProjectService(projectRepository, executionTargetRepository);
  const git = new GitService(projectRepository, gitSnapshotRepository);
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
  const brokerRef: { current?: TopicBroker } = {};
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
  );
  const recovery = await sessions.recoverAfterRestart();
  const app = createApp({
    logger,
    eventSource: eventRepository,
    health: async () => ({ database: database.mode }),
    executionTargets,
    agents,
    sessions,
    projects,
    git,
  });
  const server = createServer(app);
  const broker = new TopicBroker(server, eventRepository);
  brokerRef.current = broker;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  logger.info({ host, port, database: database.mode, recovery }, 'AgentHub server started');

  return {
    server,
    broker,
    database,
    close: async () => {
      await sessions.shutdown();
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
