import {
  clearGitCommitMarker,
  readGitCommitRecovery,
  type GitRecoveryStorage,
} from './git-commit-recovery';

export type GitRecoveryQueryOutcome = Readonly<{
  operationId?: string;
  state: 'completed' | 'rejected' | 'pending' | 'unknown' | 'unavailable' | 'invalid';
}>;
export type GitRecoveryQueryResult =
  | { revoked: true }
  | { revoked: false; locked: boolean; outcomes: readonly GitRecoveryQueryOutcome[] };
const sha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

// Dormant read-only driver. The caller binds get() to the authenticated API and
// isCurrent() to its auth epoch. It NEVER sends a POST, retries a write, or uses
// a changed HEAD/message to infer success. Both the authenticated request
// context and its server-returned scope must match the original marker.
export async function queryGitCommitRecovery(input: {
  storage: GitRecoveryStorage;
  scope: string;
  projectId: string;
  isCurrent: () => boolean;
  get: (path: string) => Promise<unknown>;
}): Promise<GitRecoveryQueryResult> {
  if (!input.isCurrent()) return { revoked: true };
  const initial = readGitCommitRecovery(input.storage, input.scope, input.projectId);
  const outcomes: GitRecoveryQueryOutcome[] = [];
  for (const record of initial.records) {
    if (!input.isCurrent()) return { revoked: true };
    const marker = record.marker;
    if (!marker) {
      outcomes.push({ state: 'invalid' });
      continue;
    }
    let response: unknown;
    try {
      response = await input.get(
        `/projects/${marker.projectId}/git/commit-operations/${marker.operationId}`,
      );
    } catch {
      if (!input.isCurrent()) return { revoked: true };
      // Includes 404 and auth/network failures: absence is not non-execution.
      outcomes.push({ operationId: marker.operationId, state: 'unavailable' });
      continue;
    }
    if (!input.isCurrent()) return { revoked: true };
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      outcomes.push({ operationId: marker.operationId, state: 'invalid' });
      continue;
    }
    const data = response as Record<string, unknown>;
    if (
      data.scope !== marker.scope ||
      data.operationId !== marker.operationId ||
      data.projectId !== marker.projectId ||
      data.protocolVersion !== 1 ||
      typeof data.requestHash !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(data.requestHash)
    ) {
      outcomes.push({ operationId: marker.operationId, state: 'invalid' });
      continue;
    }
    const evidence = data.resultEvidence;
    const success =
      data.phase === 'COMMAND_SUCCEEDED' &&
      data.commandExit === 0 &&
      (data.observedAfterHead === null ||
        (typeof data.observedAfterHead === 'string' && sha.test(data.observedAfterHead))) &&
      evidence &&
      typeof evidence === 'object' &&
      !Array.isArray(evidence) &&
      (evidence as Record<string, unknown>).kind === 'COMMAND_EXIT_ZERO' &&
      (evidence as Record<string, unknown>).headAttribution === 'OBSERVED_ONLY';
    const rejected =
      data.phase === 'REJECTED_PREWRITE' &&
      data.commandExit === null &&
      typeof data.errorCode === 'string' &&
      data.errorCode.length > 0;
    if (success || rejected) {
      if (!input.isCurrent()) return { revoked: true };
      clearGitCommitMarker(input.storage, marker, {
        scope: marker.scope,
        projectId: marker.projectId,
        operationId: marker.operationId,
        phase: data.phase,
      });
      outcomes.push({ operationId: marker.operationId, state: success ? 'completed' : 'rejected' });
    } else if (data.phase === 'RECEIVED' || data.phase === 'DISPATCHED') {
      outcomes.push({ operationId: marker.operationId, state: 'pending' });
    } else if (data.phase === 'UNKNOWN') {
      outcomes.push({ operationId: marker.operationId, state: 'unknown' });
    } else outcomes.push({ operationId: marker.operationId, state: 'invalid' });
  }
  if (!input.isCurrent()) return { revoked: true };
  const final = readGitCommitRecovery(input.storage, input.scope, input.projectId);
  if (!input.isCurrent()) return { revoked: true };
  return { revoked: false, locked: final.locked, outcomes: Object.freeze(outcomes) };
}
