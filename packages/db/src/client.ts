import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';

import * as schema from './schema.js';

export type PgliteAgentHubDatabase = PgliteDatabase<typeof schema>;
export type PostgresAgentHubDatabase = NodePgDatabase<typeof schema>;
export type AgentHubDatabase = PgliteAgentHubDatabase | PostgresAgentHubDatabase;

export interface DatabaseClient<TDatabase extends AgentHubDatabase = AgentHubDatabase> {
  readonly mode: 'pglite' | 'postgresql';
  readonly db: TDatabase;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  databaseUrl?: string | undefined;
  dataDir?: string | undefined;
  migrationsFolder?: string | undefined;
}

const defaultMigrationsFolder = resolve(import.meta.dirname, '../drizzle');

export async function createPgliteDatabase(
  options: Omit<DatabaseOptions, 'databaseUrl'> = {},
): Promise<DatabaseClient<PgliteAgentHubDatabase>> {
  const dataDir = options.dataDir ?? resolve(process.cwd(), '.agenthub/data/pgdata');
  if (dataDir !== 'memory://') await mkdir(dirname(dataDir), { recursive: true });

  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, {
    migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder,
  });

  return {
    mode: 'pglite',
    db,
    close: async () => client.close(),
  };
}

export async function createPostgresDatabase(
  databaseUrl: string,
  options: Pick<DatabaseOptions, 'migrationsFolder'> = {},
): Promise<DatabaseClient<PostgresAgentHubDatabase>> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzleNodePg(pool, { schema });
  await migrateNodePg(db, {
    migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder,
  });

  return {
    mode: 'postgresql',
    db,
    close: async () => pool.end(),
  };
}

export async function createDatabase(options: DatabaseOptions = {}): Promise<DatabaseClient> {
  if (options.databaseUrl) return createPostgresDatabase(options.databaseUrl, options);
  return createPgliteDatabase(options);
}
