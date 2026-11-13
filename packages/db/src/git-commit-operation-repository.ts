import { and, eq } from 'drizzle-orm';
import type { AgentHubDatabase } from './client.js';
import { DatabaseInvariantError } from './repositories.js';
import { gitCommitOperations, gitWriteClaims } from './schema.js';

export interface GitCommitOperationIdentity {
  ownerScope: string;
  operationId: string;
  dispatchToken: string;
}
export type ReserveGitCommitInput = Pick<
  typeof gitCommitOperations.$inferInsert,
  | 'ownerScope'
  | 'operationId'
  | 'projectId'
  | 'protocolVersion'
  | 'requestHash'
  | 'payloadJson'
  | 'targetId'
  | 'executionDeviceId'
  | 'repositoryKey'
  | 'canonicalCommonDir'
  | 'worktreeIdentity'
  | 'expectedHead'
  | 'dispatchToken'
  | 'workerId'
>;

// Dormant persistence foundation. No method invokes Git, retries a dispatched
// operation, expires a claim, or infers success from HEAD. Callers must derive
// owner and canonical repository identity on the server, never trust client IDs.
export class GitCommitOperationRepository<TDatabase extends AgentHubDatabase> {
  constructor(private readonly db: TDatabase) {}

  async get(ownerScope: string, operationId: string, projectId: string) {
    const [record] = await this.db
      .select()
      .from(gitCommitOperations)
      .where(
        and(
          eq(gitCommitOperations.ownerScope, ownerScope),
          eq(gitCommitOperations.operationId, operationId),
          eq(gitCommitOperations.projectId, projectId),
        ),
      )
      .limit(1);
    return record;
  }

  async reserve(input: ReserveGitCommitInput) {
    if (
      ![
        input.ownerScope,
        input.requestHash,
        input.repositoryKey,
        input.executionDeviceId,
        input.canonicalCommonDir,
        input.worktreeIdentity,
        input.workerId,
      ].every((value) => value?.trim())
    )
      throw new DatabaseInvariantError('GIT_OPERATION_INVALID', 'Git 操作缺少归属或资源标识');
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(gitCommitOperations)
        .values({ ...input, phase: 'RECEIVED' })
        .onConflictDoNothing({
          target: [gitCommitOperations.ownerScope, gitCommitOperations.operationId],
        })
        .returning();
      if (!created) {
        const [existing] = await tx
          .select()
          .from(gitCommitOperations)
          .where(
            and(
              eq(gitCommitOperations.ownerScope, input.ownerScope),
              eq(gitCommitOperations.operationId, input.operationId),
            ),
          )
          .limit(1);
        if (
          !existing ||
          existing.requestHash !== input.requestHash ||
          existing.projectId !== input.projectId
        )
          throw new DatabaseInvariantError('GIT_OPERATION_CONFLICT', '操作键已用于不同请求');
        return { operation: existing, created: false };
      }
      const [claim] = await tx
        .insert(gitWriteClaims)
        .values({
          repositoryKey: input.repositoryKey,
          ownerScope: input.ownerScope,
          operationId: input.operationId,
          dispatchToken: input.dispatchToken,
          workerId: input.workerId,
          phase: 'RECEIVED',
        })
        .onConflictDoNothing()
        .returning();
      if (!claim) {
        // This invocation received no dispatch authority. Persist that fact so
        // its browser marker can recover without treating an absent row as proof.
        // Keep the holder's claim untouched. A lost transaction response still
        // throws to the caller and must be recovered by this exact operation ID.
        const now = new Date();
        const [rejected] = await tx
          .update(gitCommitOperations)
          .set({
            phase: 'REJECTED_PREWRITE',
            errorCode: 'GIT_REPOSITORY_CLAIMED',
            commandExit: null,
            settledAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(gitCommitOperations.ownerScope, created.ownerScope),
              eq(gitCommitOperations.operationId, created.operationId),
              eq(gitCommitOperations.phase, 'RECEIVED'),
            ),
          )
          .returning();
        if (!rejected)
          throw new DatabaseInvariantError('GIT_OPERATION_CAS_FAILED', 'Git 拒绝记录更新失败');
        // created=false means no fresh dispatch grant, even though a terminal
        // recovery row was inserted by this call.
        return { operation: rejected, created: false };
      }
      return { operation: created, created: true };
    });
  }

  // Only the caller receiving this CAS result may start the first write command.
  // Receiving/replaying an existing DISPATCHED record is never dispatch authority.
  markDispatched(identity: GitCommitOperationIdentity) {
    return this.transition(identity, 'RECEIVED', 'DISPATCHED');
  }
  rejectPrewrite(identity: GitCommitOperationIdentity, errorCode: string) {
    return this.transition(identity, 'RECEIVED', 'REJECTED_PREWRITE', { errorCode });
  }
  markUnknown(identity: GitCommitOperationIdentity, errorCode: string) {
    return this.transition(identity, 'DISPATCHED', 'UNKNOWN', { errorCode });
  }
  recordCommandSucceeded(
    identity: GitCommitOperationIdentity,
    evidence: { observedAfterHead: string | null; commandExit: 0 },
  ) {
    if (evidence.commandExit !== 0)
      throw new DatabaseInvariantError('GIT_EVIDENCE_INVALID', '命令成功证据无效');
    return this.transition(identity, 'DISPATCHED', 'COMMAND_SUCCEEDED', {
      ...evidence,
      resultEvidenceJson: { kind: 'COMMAND_EXIT_ZERO', headAttribution: 'OBSERVED_ONLY' },
    });
  }

  private async transition(
    identity: GitCommitOperationIdentity,
    previous: 'RECEIVED' | 'DISPATCHED',
    next: 'DISPATCHED' | 'REJECTED_PREWRITE' | 'UNKNOWN' | 'COMMAND_SUCCEEDED',
    patch: Pick<
      typeof gitCommitOperations.$inferInsert,
      'errorCode' | 'observedAfterHead' | 'commandExit' | 'resultEvidenceJson'
    > = {},
  ) {
    return this.db.transaction(async (tx) => {
      // Every transition uses the same operation -> claim lock order. No Git
      // process is allowed inside this short transaction.
      const match = and(
        eq(gitCommitOperations.ownerScope, identity.ownerScope),
        eq(gitCommitOperations.operationId, identity.operationId),
        eq(gitCommitOperations.dispatchToken, identity.dispatchToken),
      );
      const [operation] = await tx
        .select()
        .from(gitCommitOperations)
        .where(match)
        .for('update')
        .limit(1);
      if (!operation || operation.phase !== previous) return undefined;
      const claimMatch = and(
        eq(gitWriteClaims.repositoryKey, operation.repositoryKey),
        eq(gitWriteClaims.ownerScope, identity.ownerScope),
        eq(gitWriteClaims.operationId, identity.operationId),
        eq(gitWriteClaims.dispatchToken, identity.dispatchToken),
        eq(gitWriteClaims.workerId, operation.workerId),
        eq(gitWriteClaims.phase, previous),
      );
      const [claim] = await tx
        .select()
        .from(gitWriteClaims)
        .where(claimMatch)
        .for('update')
        .limit(1);
      if (!claim) return undefined;
      const now = new Date();
      const [updated] = await tx
        .update(gitCommitOperations)
        .set({
          ...patch,
          phase: next,
          updatedAt: now,
          ...(next === 'DISPATCHED' ? { dispatchedAt: now } : { settledAt: now }),
        })
        .where(and(match, eq(gitCommitOperations.phase, previous)))
        .returning();
      if (!updated)
        throw new DatabaseInvariantError('GIT_OPERATION_CAS_FAILED', 'Git 操作状态更新失败');
      if (next === 'COMMAND_SUCCEEDED' || next === 'REJECTED_PREWRITE')
        await tx.delete(gitWriteClaims).where(claimMatch);
      else await tx.update(gitWriteClaims).set({ phase: next, updatedAt: now }).where(claimMatch);
      return updated;
    });
  }
}
