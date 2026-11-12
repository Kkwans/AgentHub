export const recoveryPrefix = 'agenthub:task-creation:v1:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type RecoveryStage = 'CREATE_PENDING' | 'TASK_CREATED' | 'START_PENDING';
export type CreationMarker = {
  version: 1;
  scope: string;
  projectId: string;
  operationId: string;
  stage: RecoveryStage;
  taskId?: string | undefined;
};
export type RecoveryRecord = { key: string; marker?: CreationMarker | undefined };
export function newCreationOperationId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // AgentHub also supports HTTP LAN deployments, where randomUUID may be absent.
  // getRandomValues is permitted there; never fall back to Math.random.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function browserCreationScope(
  mode: string | undefined,
  user: { id: string } | null,
): string | null {
  if (mode === 'local_trusted') return 'local-trusted';
  if (mode === 'token' && user && uuid.test(user.id)) return `account:${user.id.toLowerCase()}`;
  return null;
}
export function scopePrefix(scope: string, projectId: string): string {
  return `${recoveryPrefix}${encodeURIComponent(scope)}:${projectId.toLowerCase()}:`;
}
export function markerKey(marker: CreationMarker): string {
  return `${scopePrefix(marker.scope, marker.projectId)}${marker.operationId.toLowerCase()}`;
}
export function readRecoveryRecords(
  storage: Storage,
  scope: string,
  projectId: string,
): RecoveryRecord[] {
  const prefix = scopePrefix(scope, projectId);
  const records: RecoveryRecord[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    let marker: CreationMarker | undefined;
    const stored = storage.getItem(key);
    try {
      const value = JSON.parse(stored ?? '') as CreationMarker;
      if (
        !value ||
        value.version !== 1 ||
        value.scope !== scope ||
        value.projectId !== projectId.toLowerCase() ||
        !uuid.test(value.projectId) ||
        !uuid.test(value.operationId) ||
        !['CREATE_PENDING', 'TASK_CREATED', 'START_PENDING'].includes(value.stage) ||
        (value.taskId !== undefined && !uuid.test(value.taskId)) ||
        (value.stage !== 'CREATE_PENDING' && !value.taskId) ||
        Object.keys(value).some(
          (field) =>
            !['version', 'scope', 'projectId', 'operationId', 'stage', 'taskId'].includes(field),
        ) ||
        markerKey(value) !== key
      )
        throw new Error('invalid marker');
      marker = value;
    } catch {
      /* Keep corrupt markers visible; never erase them automatically. */
    }
    records.push({ key, marker });
  }
  return records;
}
export function saveMarker(storage: Storage, marker: CreationMarker): void {
  if (
    marker.version !== 1 ||
    !uuid.test(marker.projectId) ||
    !uuid.test(marker.operationId) ||
    !(
      marker.scope === 'local-trusted' ||
      (marker.scope.startsWith('account:') && uuid.test(marker.scope.slice(8)))
    ) ||
    !['CREATE_PENDING', 'TASK_CREATED', 'START_PENDING'].includes(marker.stage) ||
    (marker.taskId !== undefined && !uuid.test(marker.taskId)) ||
    (marker.stage !== 'CREATE_PENDING' && !marker.taskId)
  )
    throw new Error('恢复记录身份无法确认');

  // Explicit allowlist: never serialize a draft, Prompt variable, or credential.
  const value = JSON.stringify({
    version: 1,
    scope: marker.scope,
    projectId: marker.projectId.toLowerCase(),
    operationId: marker.operationId.toLowerCase(),
    stage: marker.stage,
    ...(marker.taskId ? { taskId: marker.taskId.toLowerCase() } : {}),
  });
  storage.setItem(markerKey(marker), value);
  if (storage.getItem(markerKey(marker)) !== value) throw new Error('恢复记录写入无法确认');
}
export type RecoveredTask = {
  operationId: string;
  projectId: string;
  taskId: string;
  status: string;
  sessionId: string | null;
};
export function parseRecoveredTask(value: unknown, marker: CreationMarker): RecoveredTask {
  const data = value as RecoveredTask | null;
  if (
    !data ||
    typeof data.operationId !== 'string' ||
    data.operationId.toLowerCase() !== marker.operationId.toLowerCase() ||
    typeof data.projectId !== 'string' ||
    data.projectId.toLowerCase() !== marker.projectId ||
    !uuid.test(data.taskId) ||
    (marker.taskId && data.taskId.toLowerCase() !== marker.taskId.toLowerCase()) ||
    !['BACKLOG', 'READY', 'IN_PROGRESS', 'WAITING_REVIEW', 'DONE', 'BLOCKED', 'CANCELED'].includes(
      data.status,
    ) ||
    !(data.sessionId === null || (typeof data.sessionId === 'string' && uuid.test(data.sessionId)))
  )
    throw new Error('恢复结果与原操作不一致，请核对任务列表。');
  return data;
}
