import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { createDatabase } from '../../packages/db/src/index.ts';
import { sql } from '../../packages/db/node_modules/drizzle-orm/index.js';

/**
 * Controlled Project data reset.
 *
 * The default mode is a read-only inventory. `--execute` is intentionally
 * required before either the database transaction or managed-directory move
 * can happen. Stop only the AgentHub service and take the generated backup
 * before invoking it; source repositories are never selected by this script.
 */

const DATA_DIR = process.env.AGENTHUB_DATA_DIR ?? resolve(process.cwd(), '.agenthub/data/pgdata');
const DATABASE_URL = process.env.DATABASE_URL;
const WORKTREE_ROOT = process.env.AGENTHUB_WORKTREE_ROOT
  ? resolve(process.env.AGENTHUB_WORKTREE_ROOT)
  : DATA_DIR === 'memory://'
    ? undefined
    : resolve(dirname(DATA_DIR), 'worktrees');
const ARTIFACT_ROOT = process.env.AGENTHUB_ARTIFACT_ROOT
  ? resolve(process.env.AGENTHUB_ARTIFACT_ROOT)
  : DATA_DIR === 'memory://'
    ? undefined
    : resolve(dirname(DATA_DIR), 'artifacts');
const execute = process.argv.slice(2).includes('--execute');
const timestamp = new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, '')
  .slice(0, 14);
const backupRoot = resolve(
  process.env.AGENTHUB_RESET_BACKUP_DIR ??
    (DATA_DIR === 'memory://'
      ? join(process.cwd(), '.agenthub', 'reset-backups')
      : join(dirname(DATA_DIR), 'reset-backups')),
  `project-data-${timestamp}`,
);

const projectScopedTables = [
  'projects',
  'agent_sessions',
  'agent_runs',
  'messages',
  'run_events',
  'approval_requests',
  'approval_delivery_outbox',
  'artifacts',
  'git_snapshots',
  'goals',
  'tasks',
  'worktree_executions',
  'session_continuations',
  'prompts',
  'prompt_versions',
  'prompt_labels',
  'prompt_bindings',
  'skills',
  'skill_bindings',
] as const;

type Row = Record<string, unknown>;

async function main(): Promise<void> {
  if (DATA_DIR !== 'memory://') assertManagedPath(DATA_DIR, backupRoot);
  for (const root of [WORKTREE_ROOT, ARTIFACT_ROOT]) {
    if (root) assertManagedPath(root, backupRoot);
  }
  const database = await createDatabase({
    ...(DATABASE_URL ? { databaseUrl: DATABASE_URL } : {}),
    // `createDatabase` gives DATABASE_URL precedence, so passing dataDir here
    // is safe for PostgreSQL and is required to make an explicit memory://
    // dry-run actually use an ephemeral PGlite instance.
    dataDir: DATA_DIR,
  });
  try {
    const projects = await rows<{
      id: string;
      name: string;
      root_path: string;
      real_root_path: string;
    }>(
      database.db,
      'select id, name, root_path, real_root_path from projects order by created_at, id',
    );
    const counts = await collectCounts(database.db);
    const managedRoots = [WORKTREE_ROOT, ARTIFACT_ROOT].filter(
      (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
    );
    await assertManagedRootsSafe(
      managedRoots,
      DATA_DIR === 'memory://' ? undefined : DATA_DIR,
      backupRoot,
      projects,
    );
    const managedFiles = await collectManagedFiles(managedRoots);
    const report = {
      mode: execute ? 'EXECUTE' : 'DRY_RUN',
      generatedAt: new Date().toISOString(),
      database: {
        mode: database.mode,
        dataDir: DATA_DIR === 'memory://' ? 'memory://' : DATA_DIR,
        databaseUrlConfigured: Boolean(DATABASE_URL),
      },
      projects,
      counts,
      managedRoots,
      managedFiles,
      backupRoot: execute ? backupRoot : undefined,
      warnings: [
        '执行前必须停止 AgentHub service；脚本不会停止或重启任何服务。',
        '脚本不会读取、移动或删除 Project root 中的源码仓库。',
        ...(DATA_DIR === 'memory://' && execute
          ? ['memory:// 数据库没有可持久化备份，禁止执行生产清空。']
          : []),
      ],
    };

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!execute) return;
    if (DATA_DIR === 'memory://') {
      throw new Error('RESET_REQUIRES_PERSISTENT_DATABASE: memory:// 仅允许 dry-run');
    }
    await executeReset(database.db, report, managedRoots);
  } finally {
    await database.close();
  }
}

async function collectCounts(database: unknown): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of projectScopedTables) {
    const records = await rows<{ count: number | string }>(
      database,
      `select count(*)::int as count from "${table}"`,
    );
    result[table] = Number(records[0]?.count ?? 0);
  }
  return result;
}

async function executeReset(
  database: unknown,
  report: {
    projects: Array<{ id: string }>;
    managedFiles: Array<{ root: string; path: string; size: number; sha256: string }>;
  },
  managedRoots: string[],
): Promise<void> {
  await mkdir(backupRoot, { recursive: false });
  const reportPath = join(backupRoot, 'reset-report.json');
  await writeFile(
    reportPath,
    JSON.stringify({ ...report, executedAt: new Date().toISOString() }, null, 2),
  );

  const databaseBackup = join(backupRoot, DATABASE_URL ? 'database.dump' : 'database');
  if (DATABASE_URL) {
    throw new Error(
      'RESET_POSTGRES_BACKUP_REQUIRED: 请先使用 pg_dump 生成 database.dump，并在 AGENTHUB_RESET_BACKUP_DIR 中提供完整备份后重试',
    );
  }
  await cp(DATA_DIR, databaseBackup, { recursive: true, errorOnExist: true });

  const moved: Array<{ active: string; backup: string }> = [];
  try {
    for (const root of managedRoots) {
      if (!(await pathExists(root))) continue;
      assertManagedPath(root, backupRoot);
      const destination = join(backupRoot, 'managed', relative(dirname(root), root));
      await mkdir(dirname(destination), { recursive: true });
      await rename(root, destination);
      await mkdir(root, { recursive: true });
      moved.push({ active: root, backup: destination });
    }
    await databaseTransaction(
      database,
      report.projects.map((project) => project.id),
    );
  } catch (error) {
    for (const item of moved.reverse()) {
      await rm(item.active, { recursive: true, force: true }).catch(() => undefined);
      await rename(item.backup, item.active).catch(() => undefined);
    }
    throw error;
  }
  process.stdout.write(`Project 数据清空完成；备份目录：${backupRoot}\n`);
}

async function databaseTransaction(database: unknown, projectIds: string[]): Promise<void> {
  if (!projectIds.length) return;
  const list = uuidList(projectIds);
  const statements = [
    `delete from session_continuations where source_session_id in (select id from agent_sessions where project_id in ${list}) or target_session_id in (select id from agent_sessions where project_id in ${list})`,
    `delete from approval_delivery_outbox where session_id in (select id from agent_sessions where project_id in ${list})`,
    `delete from artifacts where run_id in (select id from agent_runs where session_id in (select id from agent_sessions where project_id in ${list}))`,
    `delete from approval_requests where session_id in (select id from agent_sessions where project_id in ${list})`,
    `delete from messages where session_id in (select id from agent_sessions where project_id in ${list})`,
    `delete from run_events where session_id in (select id from agent_sessions where project_id in ${list})`,
    `delete from git_snapshots where project_id in ${list}`,
    `delete from agent_runs where session_id in (select id from agent_sessions where project_id in ${list})`,
    `delete from worktree_executions where project_id in ${list}`,
    `delete from skill_bindings where skill_id in (select id from skills where project_id in ${list}) or (target_type = 'PROJECT' and target_id in ${list}) or (target_type = 'TASK' and target_id in (select id from tasks where project_id in ${list}))`,
    `delete from prompt_bindings where prompt_id in (select id from prompts where project_id in ${list}) or (target_type = 'PROJECT' and target_id in ${list}) or (target_type = 'TASK' and target_id in (select id from tasks where project_id in ${list}))`,
    `delete from prompt_labels where prompt_id in (select id from prompts where project_id in ${list})`,
    `delete from prompt_versions where prompt_id in (select id from prompts where project_id in ${list})`,
    `delete from prompts where project_id in ${list}`,
    `delete from skills where project_id in ${list}`,
    `delete from tasks where project_id in ${list}`,
    `delete from goals where project_id in ${list}`,
    `delete from agent_sessions where project_id in ${list}`,
    `delete from projects where id in ${list}`,
  ];
  await (
    database as {
      transaction: (callback: (transaction: unknown) => Promise<void>) => Promise<void>;
    }
  ).transaction(async (transaction) => {
    for (const statement of statements) {
      await (transaction as { execute: (query: unknown) => Promise<unknown> }).execute(
        sql.raw(statement),
      );
    }
  });
}

async function rows<T extends Row>(database: unknown, query: string): Promise<T[]> {
  const result = await (database as { execute: (query: unknown) => Promise<unknown> }).execute(
    sql.raw(query),
  );
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray(result.rows)) {
    return result.rows as T[];
  }
  return [];
}

async function collectManagedFiles(roots: string[]) {
  const result: Array<{ root: string; path: string; size: number; sha256: string }> = [];
  for (const root of roots) {
    if (!(await pathExists(root))) continue;
    await walk(root, root, result);
  }
  return result;
}

async function walk(
  root: string,
  current: string,
  result: Array<{ root: string; path: string; size: number; sha256: string }>,
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(root, path, result);
      continue;
    }
    if (!entry.isFile()) continue;
    const metadata = await stat(path);
    const digest = createHash('sha256');
    const content = await readFile(path);
    digest.update(content);
    result.push({
      root,
      path: relative(root, path),
      size: metadata.size,
      sha256: digest.digest('hex'),
    });
  }
}

function uuidList(values: string[]): string {
  return `(${values.map((value) => `'${value.replaceAll("'", "''")}'`).join(',')})`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function assertManagedPath(path: string, backup: string): void {
  const normalized = resolve(path);
  if (normalized === '/' || dirname(normalized) === '/') {
    throw new Error(`RESET_PATH_TOO_BROAD: ${normalized}`);
  }
  const backupPath = resolve(backup);
  if (pathsOverlap(normalized, backupPath)) throw new Error('RESET_BACKUP_INSIDE_MANAGED_ROOT');
}

async function assertManagedRootsSafe(
  managedRoots: string[],
  dataDir: string | undefined,
  backup: string,
  projects: Array<{ root_path: string; real_root_path: string }>,
): Promise<void> {
  const candidates = [
    ...(dataDir ? [{ label: 'database', path: dataDir }] : []),
    ...managedRoots.map((path) => ({ label: 'managed', path })),
    { label: 'backup', path: backup },
  ];
  const canonical = await Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      path: await canonicalPath(candidate.path),
    })),
  );
  for (let index = 0; index < canonical.length; index += 1) {
    for (let next = index + 1; next < canonical.length; next += 1) {
      if (pathsOverlap(canonical[index]!.path, canonical[next]!.path)) {
        throw new Error(
          `RESET_PATH_OVERLAP: ${canonical[index]!.label} ${canonical[index]!.path} 与 ${canonical[next]!.label} ${canonical[next]!.path} 重叠`,
        );
      }
    }
  }
  const projectRoots = await Promise.all(
    projects.map(async (project) => canonicalPath(project.real_root_path || project.root_path)),
  );
  for (const projectRoot of projectRoots) {
    for (const root of canonical.filter(
      (candidate) =>
        candidate.label === 'database' ||
        candidate.label === 'managed' ||
        candidate.label === 'backup',
    )) {
      if (pathsOverlap(projectRoot, root.path)) {
        throw new Error(
          `RESET_SOURCE_REPO_OVERLAP: ${root.label} ${root.path} 与 Project 源码根 ${projectRoot} 重叠`,
        );
      }
    }
  }
}

async function canonicalPath(path: string): Promise<string> {
  const normalized = resolve(path);
  try {
    return await realpath(normalized);
  } catch {
    const parent = await realpath(dirname(normalized)).catch(() => dirname(normalized));
    return join(parent, basename(normalized));
  }
}

function pathsOverlap(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return a === b || a.startsWith(`${b}${sep}`) || b.startsWith(`${a}${sep}`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Project 数据重置失败：${message}\n`);
  process.exitCode = 1;
});
