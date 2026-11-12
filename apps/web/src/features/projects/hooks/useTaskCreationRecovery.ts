import { useEffect, useRef, useState } from 'react';
import { api, authSession } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';
import {
  markerKey,
  scopePrefix,
  newCreationOperationId,
  parseRecoveredTask,
  readRecoveryRecords,
  saveMarker,
  type CreationMarker,
  type RecoveredTask,
  type RecoveryRecord,
  type RecoveryStage,
} from '../lib/task-creation-recovery';

type Item = RecoveryRecord & { result?: RecoveredTask | undefined; error?: string | undefined };
export function useTaskCreationRecovery(projectId: string, scope: string | null) {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const own = useRef<string | undefined>(undefined);
  const live = useRef(true);
  const generation = useRef(0);
  const observed = useRef(new Map<string, string | null>());
  const assertCurrent = (marker?: CreationMarker) => {
    if (
      !live.current ||
      !scope ||
      (marker && (marker.scope !== scope || marker.projectId !== projectId.toLowerCase()))
    )
      throw new Error('恢复记录身份已变化');
  };
  const assertUnchanged = (marker: CreationMarker) => {
    assertCurrent(marker);
    const stored = readRecoveryRecords(window.localStorage, marker.scope, marker.projectId).find(
      (record) => record.key === markerKey(marker),
    )?.marker;
    if (!stored || stored.stage !== marker.stage || stored.taskId !== marker.taskId)
      throw new Error('恢复记录已变化');
  };
  const refresh = async () => {
    const current = ++generation.current;
    if (!live.current) return;
    if (!scope) {
      setError('当前认证身份无法安全恢复任务，请使用管理员账户登录。');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const records = readRecoveryRecords(window.localStorage, scope, projectId).filter(
        (record) => !record.marker || record.marker.operationId !== own.current,
      );
      observed.current = new Map(
        records.map((record) => [record.key, window.localStorage.getItem(record.key)]),
      );
      setItems(records);
      const next = await Promise.all(
        records.map(async (record): Promise<Item> => {
          if (!record.marker)
            return { ...record, error: '本机恢复记录已损坏，不能自动判断原请求结果。' };
          try {
            const result = parseRecoveredTask(
              await api.get<unknown>(
                `/tasks/creation-operations/${encodeURIComponent(record.marker.operationId)}`,
              ),
              record.marker,
            );
            return { ...record, result };
          } catch (failure) {
            return {
              ...record,
              error:
                failure instanceof ApiError && failure.status === 404
                  ? '尚无已提交结果，不代表原请求未执行。请稍后再次查询，勿重复新建。'
                  : '恢复结果无法确认。请再次查询或查看任务列表，不会自动创建或启动。',
            };
          }
        }),
      );
      if (live.current && generation.current === current) setItems(next);
    } catch {
      if (live.current && generation.current === current)
        setError('无法读取本机恢复记录，已暂停新建；请检查浏览器存储设置。');
    } finally {
      if (live.current && generation.current === current) setLoading(false);
    }
  };
  useEffect(() => {
    live.current = true;
    void refresh();
    const stop = authSession.onAuthorizationRequired(() => {
      live.current = false;
      generation.current++;
    });
    const changed = () => {
      void refresh();
    };
    window.addEventListener('storage', changed);
    return () => {
      live.current = false;
      generation.current++;
      stop();
      window.removeEventListener('storage', changed);
    };
    // This hook is remounted when project or authenticated scope changes.
  }, [projectId, scope]);
  return {
    items,
    error,
    loading,
    blocked: loading || Boolean(error) || items.length > 0 || !scope,
    refresh: () => {
      void refresh();
    },
    begin(): CreationMarker {
      if (!live.current || !scope) throw new Error('认证身份无法确认，未发送创建请求。');
      try {
        if (readRecoveryRecords(window.localStorage, scope, projectId).length) {
          void refresh();
          throw new Error('存在未决创建记录，请先核对原任务。');
        }
        const marker: CreationMarker = {
          version: 1,
          scope,
          projectId: projectId.toLowerCase(),
          operationId: newCreationOperationId(),
          stage: 'CREATE_PENDING',
        };
        saveMarker(window.localStorage, marker);
        own.current = marker.operationId;
        return marker;
      } catch {
        setError('无法安全保存创建恢复记录，未发送创建请求。请检查浏览器存储或核对未决记录。');
        throw new Error('恢复记录保存失败，创建请求尚未发送。');
      }
    },
    retainPending(marker: CreationMarker) {
      if (!live.current || scope !== marker.scope || marker.projectId !== projectId.toLowerCase())
        throw new Error('认证身份已变化，未发送重试请求。');
      try {
        const existing = readRecoveryRecords(
          window.localStorage,
          marker.scope,
          marker.projectId,
        ).find((record) => record.key === markerKey(marker));
        if (
          existing &&
          (!existing.marker || existing.marker.stage !== 'CREATE_PENDING' || existing.marker.taskId)
        )
          throw new Error('阶段无法确认');
        // An explicit same-key retry must restore its marker if it was removed.
        // It may never silently downgrade a more advanced/corrupt stored record.
        if (!existing) saveMarker(window.localStorage, marker);
      } catch {
        setError('无法确认或保存同编号重试记录，未发送重试请求；请查询原操作。');
        throw new Error('同编号重试恢复记录无法确认。');
      }
    },
    advance(marker: CreationMarker, stage: RecoveryStage, taskId: string): CreationMarker {
      const next = { ...marker, stage, taskId };
      try {
        assertUnchanged(marker);
        saveMarker(window.localStorage, next);
        return next;
      } catch {
        setError('任务进展的恢复记录保存失败，已停止后续启动；原操作编号仍可查询。');
        throw new Error('恢复记录保存失败，请查看原任务。');
      }
    },
    complete(marker: CreationMarker): boolean {
      try {
        assertUnchanged(marker);
        window.localStorage.removeItem(markerKey(marker));
        if (window.localStorage.getItem(markerKey(marker)) !== null) throw new Error();
        own.current = undefined;
        return true;
      } catch {
        setError('本机恢复记录未能移除；原任务仍保留，不会重复创建。');
        return false;
      }
    },
    reveal() {
      own.current = undefined;
      void refresh();
    },
    remove(key: string) {
      try {
        assertCurrent();
        if (
          !key.startsWith(scopePrefix(scope!, projectId)) ||
          !observed.current.has(key) ||
          observed.current.get(key) !== window.localStorage.getItem(key)
        )
          throw new Error('恢复记录已变化，请重新查询后核对');
        window.localStorage.removeItem(key);
        if (window.localStorage.getItem(key) !== null) throw new Error();
        void refresh();
      } catch {
        setError('本机记录移除失败，请检查浏览器存储设置。');
      }
    },
  };
}
export type TaskCreationRecovery = ReturnType<typeof useTaskCreationRecovery>;
