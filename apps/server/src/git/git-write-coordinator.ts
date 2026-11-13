import { createHash, randomUUID } from 'node:crypto';
import type { AgentHubDatabase, GitCommitOperationRepository } from '@agenthub/db';

import type { GitWriteResource } from './git-write-resource.js';
export type { GitWriteResource } from './git-write-resource.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
function validHead(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && sha.test(value));
}
export interface GitWriteInput {
  ownerScope: string;
  operationId: string;
  projectId: string;
  protocolVersion: 1;
  payload: Record<string, unknown>;
  expectedHead: string | null;
}
type Repository = Pick<
  GitCommitOperationRepository<AgentHubDatabase>,
  'get' | 'reserve' | 'markDispatched' | 'rejectPrewrite' | 'markUnknown' | 'recordCommandSucceeded'
>;
export class GitWriteCoordinatorError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

// Accept JSON only, snapshot before any await, and bind object keys canonically.
// No silent omission of undefined/functions or conversion of nonfinite numbers.
function canonical(value: unknown, parents = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || parents.has(value))
    throw new GitWriteCoordinatorError('GIT_OPERATION_INVALID');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)
    throw new GitWriteCoordinatorError('GIT_OPERATION_INVALID');
  parents.add(value);
  const result = Array.isArray(value)
    ? `[${Array.from(value, (entry) => canonical(entry, parents)).join(',')}]`
    : `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], parents)}`,
        )
        .join(',')}}`;
  parents.delete(value);
  return result;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Dormant foundation: NOT a safety guarantee until every managed Git write path
// uses this coordinator. Does not exclude external terminals, agents or Git hooks.
// Resolver and ownerScope must be derived/authorized by the server, not the client.
// Returned records are INTERNAL: do not serialize their resource paths to HTTP.
export class GitWriteCoordinator {
  constructor(
    private readonly repository: Repository,
    private readonly resolve: (projectId: string) => Promise<GitWriteResource>,
    private readonly workerId: string = randomUUID(),
  ) {}

  async execute(
    input: GitWriteInput,
    write: (
      resource: Readonly<GitWriteResource>,
      payload: Readonly<Record<string, unknown>>,
    ) => Promise<{ commandExit: 0; observedAfterHead: string | null }>,
  ) {
    const normalized = JSON.parse(canonical(input)) as GitWriteInput;
    if (
      typeof normalized.projectId !== 'string' ||
      !uuid.test(normalized.projectId) ||
      typeof normalized.operationId !== 'string' ||
      !uuid.test(normalized.operationId)
    )
      throw new GitWriteCoordinatorError('GIT_OPERATION_INVALID');
    normalized.projectId = normalized.projectId.toLowerCase();
    normalized.operationId = normalized.operationId.toLowerCase();
    if (typeof normalized.expectedHead === 'string')
      normalized.expectedHead = normalized.expectedHead.toLowerCase();
    const frozen = freeze(normalized);
    if (
      frozen.protocolVersion !== 1 ||
      typeof frozen.ownerScope !== 'string' ||
      !frozen.ownerScope.trim() ||
      !frozen.projectId?.trim() ||
      !frozen.operationId?.trim() ||
      typeof frozen.payload?.operationKind !== 'string' ||
      !frozen.payload.operationKind.trim() ||
      !validHead(frozen.expectedHead)
    )
      throw new GitWriteCoordinatorError('GIT_OPERATION_INVALID');
    const requestHash = createHash('sha256').update(canonical(frozen)).digest('hex');
    const existing = await this.repository.get(
      frozen.ownerScope,
      frozen.operationId,
      frozen.projectId,
    );
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new GitWriteCoordinatorError('GIT_OPERATION_CONFLICT');
      return { operation: existing, replayed: true };
    }
    const resource = freeze({ ...(await this.resolve(frozen.projectId)) });
    if (resource.projectId !== frozen.projectId)
      throw new GitWriteCoordinatorError('GIT_RESOURCE_CHANGED');
    const { operation, created } = await this.repository.reserve({
      projectId: resource.projectId,
      targetId: resource.targetId,
      executionDeviceId: resource.executionDeviceId,
      repositoryKey: resource.repositoryKey,
      canonicalCommonDir: resource.canonicalCommonDir,
      worktreeIdentity: resource.worktreeIdentity,
      ownerScope: frozen.ownerScope,
      operationId: frozen.operationId,
      protocolVersion: frozen.protocolVersion,
      requestHash,
      payloadJson: frozen.payload,
      expectedHead: frozen.expectedHead,
      dispatchToken: randomUUID(),
      workerId: this.workerId,
    });
    if (!created) return { operation, replayed: true };
    const identity = {
      ownerScope: operation.ownerScope,
      operationId: operation.operationId,
      dispatchToken: operation.dispatchToken,
    };
    let current: GitWriteResource;
    try {
      current = freeze({ ...(await this.resolve(frozen.projectId)) });
      const keys = [
        'projectId',
        'targetId',
        'executionDeviceId',
        'repositoryKey',
        'canonicalCommonDir',
        'worktreeIdentity',
      ] as const;
      if (keys.some((key) => resource[key] !== current[key]))
        throw new GitWriteCoordinatorError('GIT_RESOURCE_CHANGED');
      if (current.head !== frozen.expectedHead)
        throw new GitWriteCoordinatorError('GIT_HEAD_CHANGED');
    } catch (error) {
      const code = error instanceof GitWriteCoordinatorError ? error.code : 'GIT_PREWRITE_FAILED';
      if (!(await this.repository.rejectPrewrite(identity, code)))
        throw new GitWriteCoordinatorError('GIT_SETTLEMENT_UNCERTAIN');
      throw error;
    }
    // A lost CAS response grants NO execution permission, even if DB committed it.
    if (!(await this.repository.markDispatched(identity)))
      throw new GitWriteCoordinatorError('GIT_DISPATCH_NOT_GRANTED');
    let evidence: { commandExit: 0; observedAfterHead: string | null };
    try {
      evidence = await write(current, frozen.payload);
      if (evidence.commandExit !== 0 || !validHead(evidence.observedAfterHead))
        throw new GitWriteCoordinatorError('GIT_EVIDENCE_INVALID');
    } catch (error) {
      // Callback may have performed ANY write; never call it again, or free claim.
      if (!(await this.repository.markUnknown(identity, 'GIT_WRITE_OUTCOME_UNKNOWN')))
        throw new GitWriteCoordinatorError('GIT_SETTLEMENT_UNCERTAIN');
      throw error;
    }
    // Do not catch a settlement failure as a callback failure. Durable DISPATCHED
    // remains quarantined, or success is already durable after a dropped response.
    const settled = await this.repository.recordCommandSucceeded(identity, evidence);
    if (!settled) throw new GitWriteCoordinatorError('GIT_SETTLEMENT_UNCERTAIN');
    return { operation: settled, replayed: false };
  }
}
