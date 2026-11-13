import {
  getOrCreateGitCoordinationDomain,
  DatabaseInvariantError,
  GitCommitOperationRepository,
  type AgentHubDatabase,
} from '@agenthub/db';
import { GitWriteCoordinator } from './git-write-coordinator.js';
import {
  createLocalGitWriteResourceResolver,
  type GitWriteResource,
} from './git-write-resource.js';
import { AppError } from '../errors.js';
import { ManagedGitWrites } from './managed-git-writes.js';

type ResolverInput = Parameters<typeof createLocalGitWriteResourceResolver>[0];
export interface ManagedGitRuntimeInput {
  db: AgentHubDatabase;
  projects: ResolverInput['projects'];
  targets: ResolverInput['targets'];
}

/** Construction only: no production activation until every managed writer is
 * wired. This is a DATABASE coordination domain, NOT a physical device identity.
 * Every local project/target/mount path shares one conservative durable claim.
 * Independent DBs, shells, agents, hooks and other external Git are not covered.
 * The DB helper fails closed on missing/corrupt/mismatched existing identity;
 * there is deliberately no per-boot fallback, environment or client override. */
export async function createManagedGitRuntime(
  input: ManagedGitRuntimeInput,
  // Server construction/test seam only. Never populate from an HTTP request.
  // Even an injected probe cannot choose a different lock domain.
  dependencies: {
    createResourceResolver?: (
      input: ResolverInput,
    ) => (projectId: string) => Promise<GitWriteResource>;
  } = {},
) {
  const domain = Object.freeze(await getOrCreateGitCoordinationDomain(input.db));
  const probe = (dependencies.createResourceResolver ?? createLocalGitWriteResourceResolver)({
    projects: input.projects,
    targets: input.targets,
    executionDeviceId: domain.executionDeviceId,
  });
  const resolve = async (projectId: string): Promise<GitWriteResource> => {
    const resource = await probe(projectId);
    return Object.freeze({
      ...resource,
      // All repositories in this DB intentionally serialize. realpath alone
      // cannot collapse bind-mount aliases or different container mount paths.
      executionDeviceId: domain.executionDeviceId,
      repositoryKey: domain.repositoryKey,
    });
  };
  const coordinator = new GitWriteCoordinator(new GitCommitOperationRepository(input.db), resolve);
  const writes = new ManagedGitWrites(coordinator);
  // For create, queue baseSha describes branch content, not necessarily HEAD of
  // the primary worktree. Callers must derive/freeze actual primary expectedHead.
  // A retry must reuse that original context, never refresh it into new intent.
  return { writes, resolve, domain };
}

/** Keep read-only application/recovery routes available when durable admission
 * cannot initialize. This is an explicit denied runtime, never an absent
 * dependency that would select legacy uncoordinated writers. No repair/retry. */
export async function initializeManagedGitRuntime(
  input: ManagedGitRuntimeInput,
  onUnavailable?: (code: string) => void,
): Promise<Pick<Awaited<ReturnType<typeof createManagedGitRuntime>>, 'writes' | 'resolve'>> {
  try {
    return await createManagedGitRuntime(input);
  } catch (error) {
    const knownCodes = new Set([
      'GIT_DOMAIN_INVALID',
      'GIT_DOMAIN_MISSING',
      'GIT_DOMAIN_MISMATCH',
      'GIT_LEGACY_WORKTREE_UNRESOLVED',
    ]);
    const code =
      error instanceof DatabaseInvariantError && knownCodes.has(error.code)
        ? error.code
        : 'GIT_COORDINATION_UNAVAILABLE';
    // Never pass the raw error (which may contain SQL, paths or credentials).
    // A logging failure must not disable read-only recovery either.
    try {
      onUnavailable?.(code);
    } catch {
      /* best-effort diagnostic only */
    }
    const deny = async (): Promise<never> => {
      throw new AppError(
        409,
        'WORKTREE_GIT_OUTCOME_UNKNOWN',
        'Git 协调状态尚未确认，已禁止写入；只读查询仍可使用',
      );
    };
    return Object.freeze({
      writes: new ManagedGitWrites({ execute: deny }),
      resolve: deny,
    });
  }
}
