import { api } from '../../../lib/api';

export const taskStartPhases = {
  RESERVED: '已预留，尚未标记外部调用',
  CREATE_ATTEMPTED: '已标记创建尝试，结果待核对',
  SESSION_READY: '会话已记录就绪，尚未移交运行',
  RUN_ADMITTED: '已移交运行，不代表任务完成',
  FAILED_KNOWN: '已记录确定失败，请核对原任务',
  UNKNOWN: '创建结果未知，请勿重复启动',
} as const;
export type TaskStartAttempt = {
  attemptId: string;
  taskId: string;
  sessionId: string;
  runId: string | null;
  kind: 'START' | 'REWORK';
  phase: keyof typeof taskStartPhases;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};
const id = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
export function parseTaskStartAttempts(value: unknown, taskId: string): TaskStartAttempt[] {
  if (!Array.isArray(value)) throw new Error('启动记录响应无法确认。');
  const seen = new Set<string>();
  return value
    .map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new Error('启动记录响应无法确认。');
      const row = item as Record<string, unknown>;
      if (
        !id(row.attemptId) ||
        seen.has(row.attemptId) ||
        row.taskId !== taskId ||
        !id(row.sessionId) ||
        !(row.runId === null || id(row.runId)) ||
        !(row.kind === 'START' || row.kind === 'REWORK') ||
        typeof row.phase !== 'string' ||
        !Object.hasOwn(taskStartPhases, row.phase) ||
        !(row.errorCode === null || id(row.errorCode)) ||
        !id(row.createdAt) ||
        !Number.isFinite(Date.parse(row.createdAt)) ||
        !id(row.updatedAt) ||
        !Number.isFinite(Date.parse(row.updatedAt))
      )
        throw new Error('启动记录身份或阶段无法确认。');
      seen.add(row.attemptId);
      // Copy only the public response fields; never render unexpected server payload.
      return {
        attemptId: row.attemptId,
        taskId,
        sessionId: row.sessionId,
        runId: row.runId,
        kind: row.kind,
        phase: row.phase,
        errorCode: row.errorCode,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      } as TaskStartAttempt;
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export async function readTaskStartAttempts(
  projectId: string,
  taskId: string,
  active: () => boolean,
) {
  const task = await api.get<{ id: string; projectId: string }>(
    `/tasks/${encodeURIComponent(taskId)}`,
  );
  if (!active()) throw new Error('查询上下文已变化。');
  if (task?.id !== taskId || task.projectId !== projectId) throw new Error('原任务身份无法确认。');
  const data = await api.get<unknown>(`/tasks/${encodeURIComponent(taskId)}/start-attempts`);
  if (!active()) throw new Error('查询上下文已变化。');
  return parseTaskStartAttempts(data, taskId);
}
