import { ApiError, api, authSession, type SessionRecord } from '../../../lib/api';

export type RenamePhase =
  'editing' | 'pending' | 'unknown' | 'conflict' | 'checking' | 'current' | 'success';
export type RenameState = {
  id: string;
  revision: number;
  draft: string;
  phase: RenamePhase;
  message: string;
  current?: SessionRecord;
};
const states = new Map<string, RenameState>();
const listeners = new Set<() => void>();
let epoch = 0;
let authorizationSubscribed = false;
function observeAuthorization() {
  if (authorizationSubscribed || typeof window === 'undefined') return;
  authorizationSubscribed = true;
  // The attempt registry outlives dialogs/routes, so its revocation listener must too.
  authSession.onAuthorizationRequired(revokeRenameIdentity);
}
export const renameEpoch = () => epoch;
export const subscribeRename = (listener: () => void) => {
  observeAuthorization();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const notify = () => {
  for (const listener of listeners) listener();
};
export function revokeRenameIdentity() {
  epoch++;
  for (const [key, state] of states) {
    if (['pending', 'checking'].includes(state.phase))
      states.set(key, { ...state, phase: 'unknown', message: '授权已变化，保存结果需重新核对。' });
  }
  notify();
}
export const getRename = (key: string) => states.get(key);
const put = (key: string, state: RenameState) => {
  states.set(key, state);
  notify();
};
export function validTitleRevision(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 2147483647;
}
export function beginRename(key: string, session: SessionRecord) {
  if (states.has(key)) return;
  if (!validTitleRevision(session.titleRevision)) return;
  put(key, {
    id: session.id,
    revision: session.titleRevision,
    draft: session.title,
    phase: 'editing',
    message: '',
  });
}
export function editRename(key: string, draft: string) {
  const state = states.get(key);
  if (state?.phase === 'editing') put(key, { ...state, draft, message: '' });
}
export function rebaseRename(key: string) {
  const state = states.get(key);
  if (!state || !['current', 'success'].includes(state.phase) || !state.current) return;
  put(key, { ...state, revision: state.current.titleRevision!, phase: 'editing', message: '' });
}
function validRecord(value: unknown, id: string): value is SessionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SessionRecord>;
  return (
    record.id === id &&
    typeof record.title === 'string' &&
    record.title.trim().length > 0 &&
    record.title.length <= 240 &&
    validTitleRevision(record.titleRevision)
  );
}
export async function saveRename(
  key: string,
  apply: (session: SessionRecord) => void | Promise<void>,
) {
  const state = states.get(key);
  if (!state || state.phase !== 'editing' || state.revision >= 2147483647) return;
  const requestEpoch = epoch;
  const title = state.draft.trim();
  if (!title || title.length > 240) {
    put(key, { ...state, message: '请输入 1–240 个字符的会话名称。' });
    return;
  }
  put(key, { ...state, phase: 'pending', message: '正在保存名称…' });
  try {
    const response: unknown = await api.patch(`/sessions/${state.id}/title`, {
      title,
      expectedRevision: state.revision,
    });
    if (requestEpoch !== epoch) return;
    if (
      !validRecord(response, state.id) ||
      response.titleRevision !== state.revision + 1 ||
      response.title !== title
    )
      throw new Error('Unconfirmed rename response');
    put(key, {
      ...state,
      phase: 'success',
      draft: title,
      current: response,
      message: '会话名称已更新。',
    });
    const published = states.get(key);
    try {
      await apply(response);
    } catch {
      // A cache failure cannot undo a confirmed server write or authorize replay.
      if (requestEpoch === epoch && states.get(key) === published)
        put(key, {
          ...state,
          phase: 'success',
          draft: title,
          current: response,
          message: '会话名称已保存，但本地列表暂未同步。',
        });
    }
  } catch (error) {
    if (requestEpoch !== epoch) return;
    const conflict =
      error instanceof ApiError && error.code === 'SESSION_TITLE_CONFLICT' && error.status === 409;
    put(key, {
      ...state,
      phase: conflict ? 'conflict' : 'unknown',
      message: conflict
        ? '名称已被其他修改更新，请先核对当前名称。'
        : '保存结果尚未确认。请核对当前名称，不要重复提交。',
    });
  }
}
export async function checkRename(
  key: string,
  apply: (session: SessionRecord) => void | Promise<void>,
) {
  const state = states.get(key);
  if (!state || !['unknown', 'conflict'].includes(state.phase)) return;
  const requestEpoch = epoch;
  put(key, { ...state, phase: 'checking', message: '正在读取当前名称…' });
  try {
    const response: unknown = await api.get(`/sessions/${state.id}`);
    if (requestEpoch !== epoch) return;
    if (!validRecord(response, state.id) || response.titleRevision! < state.revision)
      throw new Error('Invalid current title');
    if (response.titleRevision === state.revision) {
      put(key, {
        ...state,
        phase: 'unknown',
        message: '当前版本未变化，原请求仍可能在途。结果尚未确认，不能重复保存。',
      });
      return;
    }
    put(key, {
      ...state,
      phase: 'current',
      current: response,
      message: '当前名称已变化；无法确认是否由本次请求写入。原版本已失效，不会自动重试。',
    });
    const published = states.get(key);
    try {
      await apply(response);
    } catch {
      if (requestEpoch === epoch && states.get(key) === published)
        put(key, {
          ...state,
          phase: 'current',
          current: response,
          message: '已读取较新版本，但本地列表暂未同步；仍无法确认原请求归属。',
        });
    }
  } catch {
    if (requestEpoch !== epoch) return;
    put(key, {
      ...state,
      phase: state.phase,
      message: '暂时无法核对。原保存结果仍未确认，请稍后再次读取。',
    });
  }
}
/** Only metadata is merged; an older response cannot replace newer cached revisions or Run state. */
export function mergeSessionTitle(
  old: SessionRecord | undefined,
  incoming: SessionRecord,
): SessionRecord | undefined {
  if (!old || old.id !== incoming.id || !validTitleRevision(incoming.titleRevision)) return old;
  if (validTitleRevision(old.titleRevision) && old.titleRevision >= incoming.titleRevision!)
    return old;
  return { ...old, title: incoming.title, titleRevision: incoming.titleRevision };
}
