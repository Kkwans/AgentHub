/** Dormant client marker foundation; no UI/transport wiring yet. These records
 * are recovery hints, not credentials, server proof, or a cross-tab write mutex. */
export type GitRecoveryStorage = Pick<
  Storage,
  'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'
>;
export type GitRecoveryIdentity = Readonly<{
  scope: string;
  projectId: string;
  operationId: string;
}>;
export type GitCommitMarker = GitRecoveryIdentity & Readonly<{ version: 1 }>;
export type GitRecoveryRecord = Readonly<{ key: string; marker: GitCommitMarker | null }>;
export type GitRecoveryState = Readonly<{ records: readonly GitRecoveryRecord[]; locked: boolean }>;
export const gitCommitRecoveryPrefix = 'agenthub:git-commit:v1:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_KEYS = 10_000;
const MAX_RECORDS = 128;
const MAX_VALUE = 1_024;
export class GitCommitRecoveryError extends Error {
  constructor(
    readonly code:
      | 'INVALID_IDENTITY'
      | 'STORAGE_UNAVAILABLE'
      | 'RECOVERY_REQUIRED'
      | 'STORAGE_CHANGED'
      | 'MARKER_INVALID',
  ) {
    super('Git 操作恢复状态无法安全确认，禁止开始新提交，请先核对原操作。');
    this.name = 'GitCommitRecoveryError';
  }
}
function scopeValue(scope: string): string {
  if (scope === 'local-trusted') return scope;
  if (typeof scope === 'string' && scope.startsWith('account:') && uuid.test(scope.slice(8)))
    return `account:${scope.slice(8).toLowerCase()}`;
  throw new GitCommitRecoveryError('INVALID_IDENTITY');
}
function identity(value: GitRecoveryIdentity): GitCommitMarker {
  if (
    !value ||
    typeof value.projectId !== 'string' ||
    typeof value.operationId !== 'string' ||
    !uuid.test(value.projectId) ||
    !uuid.test(value.operationId)
  )
    throw new GitCommitRecoveryError('INVALID_IDENTITY');
  return Object.freeze({
    version: 1,
    scope: scopeValue(value.scope),
    projectId: value.projectId.toLowerCase(),
    operationId: value.operationId.toLowerCase(),
  });
}
function projectPrefix(scope: string, projectId: string): string {
  if (typeof projectId !== 'string' || !uuid.test(projectId))
    throw new GitCommitRecoveryError('INVALID_IDENTITY');
  return `${gitCommitRecoveryPrefix}${encodeURIComponent(scopeValue(scope))}:${projectId.toLowerCase()}:`;
}
export function gitCommitMarkerKey(value: GitRecoveryIdentity): string {
  const marker = identity(value);
  return `${projectPrefix(marker.scope, marker.projectId)}${marker.operationId}`;
}
function storageCall<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof GitCommitRecoveryError) throw error;
    throw new GitCommitRecoveryError('STORAGE_UNAVAILABLE');
  }
}
function matchingKeys(storage: GitRecoveryStorage, prefix: string): string[] {
  const count = storage.length;
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_KEYS)
    throw new GitCommitRecoveryError('STORAGE_UNAVAILABLE');
  const keys: string[] = [];
  for (let index = 0; index < count; index++) {
    const key = storage.key(index);
    if (key === null) throw new GitCommitRecoveryError('STORAGE_CHANGED');
    if (key.startsWith(prefix)) {
      if (key.length > 512) throw new GitCommitRecoveryError('MARKER_INVALID');
      keys.push(key);
    }
  }
  if (keys.length > MAX_RECORDS || new Set(keys).size !== keys.length)
    throw new GitCommitRecoveryError('STORAGE_UNAVAILABLE');
  return keys.sort();
}
function parse(
  raw: string | null,
  key: string,
  scope: string,
  projectId: string,
): GitCommitMarker | null {
  if (!raw || raw.length > MAX_VALUE) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as GitCommitMarker;
    if (
      Object.keys(candidate).length !== 4 ||
      Object.keys(candidate).some(
        (name) => !['version', 'scope', 'projectId', 'operationId'].includes(name),
      ) ||
      candidate.version !== 1
    )
      return null;
    const normalized = identity(candidate);
    if (
      candidate.scope !== normalized.scope ||
      candidate.projectId !== normalized.projectId ||
      candidate.operationId !== normalized.operationId ||
      normalized.scope !== scope ||
      normalized.projectId !== projectId ||
      gitCommitMarkerKey(normalized) !== key
    )
      return null;
    return normalized;
  } catch {
    return null;
  }
}
/** Reread on storage events. Unreadable storage throws, corrupt same-project
 * keys stay locked. Foreign-scope values are never read or returned. */
export function readGitCommitRecovery(
  storage: GitRecoveryStorage,
  scope: string,
  projectId: string,
): GitRecoveryState {
  const canonicalScope = scopeValue(scope);
  const prefix = projectPrefix(canonicalScope, projectId);
  const canonicalProject = projectId.toLowerCase();
  return storageCall(() => {
    // Probe only this scope namespace even when no keys exist; an unreadable
    // storage adapter must not look like a fresh, unlocked project.
    storage.getItem(prefix);
    const keys = matchingKeys(storage, prefix);
    const records = keys.map((key) =>
      Object.freeze({
        key,
        marker: parse(storage.getItem(key), key, canonicalScope, canonicalProject),
      }),
    );
    if (JSON.stringify(keys) !== JSON.stringify(matchingKeys(storage, prefix)))
      throw new GitCommitRecoveryError('STORAGE_CHANGED');
    return Object.freeze({ records: Object.freeze(records), locked: records.length > 0 });
  });
}
/** Must complete successfully before first dispatch. An existing same-operation
 * marker requires server recovery, never permission to retry the POST. Separate
 * keys avoid lost updates, but simultaneous tabs can both pass the initial read;
 * the authoritative server claim must enforce repository-wide exclusion. */
export function saveGitCommitMarker(
  storage: GitRecoveryStorage,
  value: GitRecoveryIdentity,
): GitCommitMarker {
  const marker = identity(value);
  const key = gitCommitMarkerKey(marker);
  return storageCall(() => {
    if (readGitCommitRecovery(storage, marker.scope, marker.projectId).locked)
      throw new GitCommitRecoveryError('RECOVERY_REQUIRED');
    const serialized = JSON.stringify(marker); // Explicit four-field allowlist; no payload/credentials.
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) throw new GitCommitRecoveryError('STORAGE_CHANGED');
    const after = readGitCommitRecovery(storage, marker.scope, marker.projectId);
    if (after.records.length !== 1 || after.records[0]?.key !== key || !after.records[0].marker)
      throw new GitCommitRecoveryError('RECOVERY_REQUIRED');
    return marker;
  });
}
/** Caller must supply the authenticated server's terminal result, not a local
 * inference from HEAD/message/404. True means only this one marker was removed;
 * reread the project before any later operation. Unknown/network/404 never clear. */
export function clearGitCommitMarker(
  storage: GitRecoveryStorage,
  value: GitRecoveryIdentity,
  proof: unknown,
): boolean {
  const marker = identity(value);
  const key = gitCommitMarkerKey(marker);
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return false;
  const data = proof as Record<string, unknown>;
  if (
    data.scope !== marker.scope ||
    data.projectId !== marker.projectId ||
    data.operationId !== marker.operationId ||
    typeof data.phase !== 'string' ||
    !['COMMAND_SUCCEEDED', 'REJECTED_PREWRITE'].includes(data.phase)
  )
    return false;
  return storageCall(() => {
    const raw = storage.getItem(key);
    if (raw === null) return false;
    if (!parse(raw, key, marker.scope, marker.projectId))
      throw new GitCommitRecoveryError('MARKER_INVALID');
    storage.removeItem(key);
    if (storage.getItem(key) !== null) throw new GitCommitRecoveryError('STORAGE_CHANGED');
    return true;
  });
}
