import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import type { AgentHubDatabase } from './client.js';
import { DatabaseInvariantError } from './repositories.js';
import { appSettings, gitCommitOperations, gitWriteClaims, worktreeExecutions } from './schema.js';

export const GIT_COORDINATION_DOMAIN_SETTING_KEY = 'git.coordination-domain.v1';
export interface GitCoordinationDomain {
  readonly id: string;
  readonly executionDeviceId: `db-domain:${string}`;
  readonly repositoryKey: `git-domain:${string}`;
}

function parseDomain(value: unknown): GitCoordinationDomain {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !('version' in value) ||
    value.version !== 1 ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.id)
  )
    throw new DatabaseInvariantError('GIT_DOMAIN_INVALID', 'Git 协调域设置损坏，禁止重建或写入');
  return Object.freeze({
    id: value.id,
    executionDeviceId: `db-domain:${value.id}`,
    repositoryKey: `git-domain:${value.id}`,
  });
}

/**
 * Dormant startup foundation. This is a logical database-wide serialization
 * domain, NOT evidence of physical device identity or filesystem ownership.
 * Call before enabling writers. No settings repair, claim expiry or migration
 * of old UNKNOWN records is performed. A database copy retains its domain;
 * different databases cannot coordinate writes to the same physical checkout.
 */
export async function getOrCreateGitCoordinationDomain(
  db: AgentHubDatabase,
): Promise<GitCoordinationDomain> {
  return db.transaction(async (tx) => {
    // Short startup-only lock prevents settings/ledger writes between the
    // missing-domain check and insertion. PostgreSQL transaction-scoped locks
    // also serialize independent processes; ON CONFLICT preserves the winner.
    await tx.execute(
      sql`LOCK TABLE app_settings, git_commit_operations, git_write_claims, worktree_executions IN SHARE ROW EXCLUSIVE MODE`,
    );
    // Legacy worktree quarantine predates the durable Git ledger. An empty
    // ledger cannot prove that these writes did not execute. Check before even
    // minting a domain, and never synthesize a claim or guessed ownership.
    // Conservatively also refuse a second factory during new in-flight work;
    // distinguishing it requires a separately verified durable correspondence.
    const [unresolvedWorktree] = await tx
      .select({ id: worktreeExecutions.id })
      .from(worktreeExecutions)
      .where(
        or(
          inArray(worktreeExecutions.status, ['SETTING_UP', 'MERGING']),
          eq(worktreeExecutions.errorCode, 'WORKTREE_GIT_OUTCOME_UNKNOWN'),
        ),
      )
      .limit(1);
    if (unresolvedWorktree)
      throw new DatabaseInvariantError(
        'GIT_LEGACY_WORKTREE_UNRESOLVED',
        '存在未确认的 Worktree Git 写入，禁止初始化协调域或放行写入',
      );
    let [setting] = await tx
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, GIT_COORDINATION_DOMAIN_SETTING_KEY));
    if (!setting) {
      const [operation] = await tx
        .select({ id: gitCommitOperations.operationId })
        .from(gitCommitOperations)
        .limit(1);
      const [claim] = await tx
        .select({ key: gitWriteClaims.repositoryKey })
        .from(gitWriteClaims)
        .limit(1);
      if (operation || claim)
        throw new DatabaseInvariantError(
          'GIT_DOMAIN_MISSING',
          '已有 Git 台账但缺少协调域，禁止生成新域',
        );
      await tx
        .insert(appSettings)
        .values({
          key: GIT_COORDINATION_DOMAIN_SETTING_KEY,
          valueJson: { version: 1, id: randomUUID() },
        })
        .onConflictDoNothing({ target: appSettings.key });
      [setting] = await tx
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, GIT_COORDINATION_DOMAIN_SETTING_KEY));
    }
    const domain = parseDomain(setting?.valueJson);
    const ownerMatch = and(
      eq(gitWriteClaims.ownerScope, gitCommitOperations.ownerScope),
      eq(gitWriteClaims.operationId, gitCommitOperations.operationId),
    );
    const identityMismatch = or(
      ne(gitWriteClaims.repositoryKey, domain.repositoryKey),
      ne(gitCommitOperations.repositoryKey, domain.repositoryKey),
      ne(gitCommitOperations.executionDeviceId, domain.executionDeviceId),
      ne(gitWriteClaims.dispatchToken, gitCommitOperations.dispatchToken),
      ne(gitWriteClaims.workerId, gitCommitOperations.workerId),
      ne(gitWriteClaims.phase, gitCommitOperations.phase),
    );
    const activePhases = ['RECEIVED', 'DISPATCHED', 'UNKNOWN'];
    const [mismatchedOperation] = await tx
      .select({ id: gitCommitOperations.operationId })
      .from(gitCommitOperations)
      .leftJoin(gitWriteClaims, ownerMatch)
      .where(
        and(
          inArray(gitCommitOperations.phase, activePhases),
          or(isNull(gitWriteClaims.repositoryKey), identityMismatch),
        ),
      )
      .limit(1);
    const [mismatchedClaim] = await tx
      .select({ key: gitWriteClaims.repositoryKey })
      .from(gitWriteClaims)
      .leftJoin(gitCommitOperations, ownerMatch)
      .where(
        or(
          isNull(gitCommitOperations.operationId),
          notInArray(gitCommitOperations.phase, activePhases),
          identityMismatch,
        ),
      )
      .limit(1);
    if (mismatchedOperation || mismatchedClaim)
      throw new DatabaseInvariantError(
        'GIT_DOMAIN_MISMATCH',
        'Git 活动台账与协调域不匹配，禁止绕过旧操作',
      );
    return domain;
  });
}
