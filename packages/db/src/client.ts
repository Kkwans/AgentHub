import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';

import * as schema from './schema.js';
import { acquirePgliteRuntimeOwnership } from './pglite-runtime-ownership.js';
import {
  acquirePostgresRuntimeOwnership,
  RuntimeOwnershipError,
  type RuntimeOwnershipGuard,
} from './runtime-ownership.js';

export type PgliteAgentHubDatabase = PgliteDatabase<typeof schema>;
export type PostgresAgentHubDatabase = NodePgDatabase<typeof schema>;
export type AgentHubDatabase = PgliteAgentHubDatabase | PostgresAgentHubDatabase;

export interface DatabaseClient<TDatabase extends AgentHubDatabase = AgentHubDatabase> {
  readonly mode: 'pglite' | 'postgresql';
  readonly db: TDatabase;
  readonly runtimeOwnership?: RuntimeOwnershipGuard;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  databaseUrl?: string | undefined;
  runtimeOwnership?: boolean | undefined;
  dataDir?: string | undefined;
  migrationsFolder?: string | undefined;
}

const defaultMigrationsFolder = resolve(import.meta.dirname, '../drizzle');

// A failed close does not prove that database work has stopped. Keep healthy
// ownership rather than allowing another runtime to recover underneath it.
async function closeBeforeReleasingOwnership(
  close: () => Promise<unknown>,
  ownership: RuntimeOwnershipGuard | undefined,
): Promise<void> {
  try {
    await close();
  } catch (error) {
    if (ownership) {
      let lost = false;
      try {
        ownership.assertHeld();
      } catch {
        lost = true;
      }
      if (lost) {
        try {
          await ownership.release();
        } catch {
          /* Preserve the close failure. */
        }
      }
    }
    throw error;
  }
  await ownership?.release();
}

export async function createPgliteDatabase(
  options: Omit<DatabaseOptions, 'databaseUrl'> = {},
): Promise<DatabaseClient<PgliteAgentHubDatabase>> {
  const requestedDir = options.dataDir ?? resolve(process.cwd(), '.agenthub/data/pgdata');
  const ownership = options.runtimeOwnership
    ? await acquirePgliteRuntimeOwnership(requestedDir)
    : undefined;
  const dataDir = ownership?.dataDir ?? requestedDir;
  let client: PGlite | undefined;
  try {
    ownership?.guard.assertHeld();
    if (dataDir !== 'memory://') await mkdir(dirname(dataDir), { recursive: true });
    client = new PGlite(dataDir);
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, {
      migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder,
    });
    ownership?.guard.assertHeld();
    const activeClient = client;
    let closing: Promise<void> | undefined;
    return {
      mode: 'pglite',
      db,
      ...(ownership ? { runtimeOwnership: ownership.guard } : {}),
      close() {
        closing ??= closeBeforeReleasingOwnership(() => activeClient.close(), ownership?.guard);
        return closing;
      },
    };
  } catch (error) {
    try {
      await closeBeforeReleasingOwnership(async () => client?.close(), ownership?.guard);
    } catch {
      /* Preserve initialization failure; failed cleanup retains healthy ownership. */
    }
    throw error;
  }
}

export async function createPostgresDatabase(
  databaseUrl: string,
  options: Pick<DatabaseOptions, 'migrationsFolder' | 'runtimeOwnership'> = {},
): Promise<DatabaseClient<PostgresAgentHubDatabase>> {
  let runtimeOwnership: RuntimeOwnershipGuard | undefined;
  if (options.runtimeOwnership) {
    try {
      runtimeOwnership = await acquirePostgresRuntimeOwnership(
        new pg.Client({
          connectionString: databaseUrl,
          connectionTimeoutMillis: 10_000,
          query_timeout: 10_000,
        }),
      );
    } catch (error) {
      // URL parsing/driver construction can throw before connect; never expose DSNs.
      throw error instanceof RuntimeOwnershipError
        ? error
        : new RuntimeOwnershipError('RUNTIME_OWNERSHIP_UNAVAILABLE');
    }
  }
  let pool: pg.Pool | undefined;
  try {
    runtimeOwnership?.assertHeld();
    pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    const db = drizzleNodePg(pool, { schema });
    await migrateNodePg(db, {
      migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder,
    });
    runtimeOwnership?.assertHeld();
    const activePool = pool;
    let closing: Promise<void> | undefined;
    return {
      mode: 'postgresql',
      db,
      ...(runtimeOwnership ? { runtimeOwnership } : {}),
      close() {
        closing ??= closeBeforeReleasingOwnership(() => activePool.end(), runtimeOwnership);
        return closing;
      },
    };
  } catch (error) {
    try {
      await closeBeforeReleasingOwnership(async () => pool?.end(), runtimeOwnership);
    } catch {
      /* Preserve initialization failure; failed cleanup retains healthy ownership. */
    }
    throw error;
  }
}

export async function createDatabase(options: DatabaseOptions = {}): Promise<DatabaseClient> {
  if (options.databaseUrl) return createPostgresDatabase(options.databaseUrl, options);
  return createPgliteDatabase(options);
}
