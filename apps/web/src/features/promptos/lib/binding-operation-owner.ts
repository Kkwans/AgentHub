import { api } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';
export type BindingPayload = Readonly<{
  targetType: string;
  targetId: string;
  slot: string;
  promptId: string;
  selectorType: string;
  label?: string;
  versionId?: string;
  priority: number;
}>;
export type BindingOperation = Readonly<{
  auth: string;
  authEpoch: number;
  id: number;
  promptName: string;
  targetName: string;
  payload: BindingPayload;
  phase: 'pending' | 'saved' | 'unknown' | 'rejected';
  message: string;
  bindingId?: string;
}>;

export type BindingOperationSnapshot = Readonly<{
  records: readonly BindingOperation[];
  authorized: boolean;
  epoch: number;
}>;
export function createBindingOperationOwner(invalidate: (promptId: string) => void) {
  let epoch = 0;
  let authorized = false;
  let sequence = 0;
  let records: readonly BindingOperation[] = Object.freeze([]);
  let snapshot: BindingOperationSnapshot = Object.freeze({ records, authorized, epoch });
  let lock: number | undefined;
  const listeners = new Set<() => void>();
  const publish = () => {
    records = Object.freeze(records.map((record) => Object.freeze(record)));
    snapshot = Object.freeze({ records, authorized, epoch });
    listeners.forEach((listener) => listener());
  };
  const revoke = () => {
    authorized = false;
    epoch += 1;
    records = [];
    lock = undefined;
    publish();
  };
  return {
    // A StrictMode setup grants a NEW capability epoch, never revives old calls.
    activate: () => {
      revoke();
      authorized = true;
      publish();
    },
    revoke,
    getEpoch: () => epoch,
    isAuthorized: () => authorized,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dismiss: (id: number) => {
      records = records.filter(
        (item) => item.id !== id || item.phase === 'pending' || item.phase === 'unknown',
      );
      publish();
    },
    submit: async (input: {
      payload: BindingPayload;
      promptName: string;
      targetName: string;
      auth: string;
    }) => {
      if (!authorized) throw new Error('授权已失效，不能创建绑定');
      if (lock !== undefined) throw new Error('原绑定操作尚未确认，请勿重复创建');
      const capturedEpoch = epoch;
      const payload = Object.freeze({ ...input.payload });
      const operation: BindingOperation = {
        id: ++sequence,
        auth: input.auth,
        authEpoch: capturedEpoch,
        promptName: input.promptName,
        targetName: input.targetName,
        payload,
        phase: 'pending',
        message: '正在保存绑定，请勿重复创建。关闭或内部跳转不会取消请求；刷新会丢失本次会话保护。',
      };
      lock = operation.id;
      records = [...records, operation];
      publish();
      const valid = () => authorized && epoch === capturedEpoch;
      const settle = (next: BindingOperation) => {
        if (!valid() || lock !== operation.id) return;
        lock = next.phase === 'unknown' ? next.id : undefined;
        records = records.map((item) => (item.id === next.id ? next : item));
        publish();
      };
      try {
        const response = await api.post<unknown>('/prompt-bindings', payload);
        const saved =
          response && typeof response === 'object'
            ? (response as Record<string, unknown>)
            : undefined;
        if (
          !saved ||
          saved.enabled !== true ||
          typeof saved.id !== 'string' ||
          !saved.id.trim() ||
          !Object.entries(payload).every(([key, value]) => saved[key] === value) ||
          (payload.selectorType === 'VERSION' ? saved.label != null : saved.versionId != null)
        )
          throw new Error('服务返回无法核对，保存结果尚未确认');
        settle({ ...operation, phase: 'saved', bindingId: saved.id, message: '已保存原绑定。' });
        if (valid()) invalidate(payload.promptId);
        return response;
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error('保存结果尚未确认');
        const rejected =
          error instanceof ApiError &&
          ((error.status === 404 &&
            [
              'PROMPT_NOT_FOUND',
              'PROMPT_BINDING_TARGET_NOT_FOUND',
              'PROMPT_LABEL_NOT_FOUND',
              'PROMPT_VERSION_NOT_FOUND',
            ].includes(error.code)) ||
            (error.status === 400 && error.code === 'PROMPT_BINDING_SELECTOR_INVALID'));
        const message = rejected
          ? `未保存：${error.message}`
          : '保存结果未确认。请人工核对原绑定，勿重复创建；内部跳转会保留保护，刷新或重新登录不提供去重保证。';
        settle({ ...operation, phase: rejected ? 'rejected' : 'unknown', message });
        throw new Error(message, { cause });
      }
    },
  };
}
export type BindingOperationOwner = ReturnType<typeof createBindingOperationOwner>;
