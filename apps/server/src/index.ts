import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

import { createDatabase, EventRepository, type DatabaseClient } from '@agenthub/db';
import pino from 'pino';

import { createApp } from './app.js';
import { AppError } from './errors.js';
import { TopicBroker } from './websocket.js';

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
  const app = createApp({
    logger,
    eventSource: eventRepository,
    health: async () => ({ database: database.mode }),
  });
  const server = createServer(app);
  const broker = new TopicBroker(server, eventRepository);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  logger.info({ host, port, database: database.mode }, 'AgentHub server started');

  return {
    server,
    broker,
    database,
    close: async () => {
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
