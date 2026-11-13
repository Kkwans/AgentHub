import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { api, type PromptRecord } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';
import { authSession } from '../../../lib/auth-api';

type Payload = {
  targetType: string;
  targetId: string;
  slot: string;
  promptId: string;
  selectorType: string;
  label?: string;
  versionId?: string;
  priority: number;
};
type Owner = {
  promptId: string;
  promptName: string;
  auth: string;
  route: string;
  scope: string;
  generation: number;
};
export type BindingOperation = {
  auth: string;
  authEpoch: number;
  id: number;
  promptName: string;
  targetName: string;
  payload: Payload;
  phase: 'pending' | 'saved' | 'unknown' | 'rejected';
  message: string;
  bindingId?: string;
};
export function usePromptBindingDraft(
  selected: PromptRecord | undefined,
  available: PromptRecord[] | undefined,
  scope: string,
  prepare: () => Payload,
  targetName = '绑定目标',
) {
  const client = useQueryClient();
  const location = useLocation();
  const mode = useAuthMode();
  const user = useAuthUser();
  const auth = `${mode ?? 'unknown'}:${user?.id ?? ''}`;
  const route = `${location.key}:${location.pathname}:${location.search}`;
  const current = useRef({ auth, route, scope, selected, available, prepare, targetName });
  current.current = { auth, route, scope, selected, available, prepare, targetName };
  const [bindingOpen, setOpen] = useState(false);
  const [operations, setOperations] = useState<BindingOperation[]>([]);
  const [error, setError] = useState<{ owner: Owner; value: Error }>();
  const owner = useRef<Owner | undefined>(undefined);
  const generation = useRef(0);
  const sequence = useRef(0);
  const lock = useRef<BindingOperation | undefined>(undefined);
  const live = useRef(false);
  const revoked = useRef(false);
  const authEpoch = useRef(0);
  const valid = (target: Owner) =>
    live.current &&
    !revoked.current &&
    owner.current === target &&
    target.generation === generation.current &&
    target.auth === current.current.auth &&
    target.route === current.current.route &&
    target.scope === current.current.scope &&
    target.promptId === current.current.selected?.id &&
    current.current.available?.some((prompt) => prompt.id === target.promptId);
  const setBindingOpen = (open: boolean) => {
    generation.current += 1;
    owner.current =
      open && selected
        ? {
            promptId: selected.id,
            promptName: selected.name,
            auth,
            route,
            scope,
            generation: generation.current,
          }
        : undefined;
    setError(undefined);
    setOpen(open);
  };
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current += 1;
      owner.current = undefined;
    };
  }, []);
  useEffect(() => {
    authEpoch.current += 1;
    revoked.current = false;
    lock.current = undefined;
    setOperations([]);
    setBindingOpen(false);
    const unsubscribe = authSession.onAuthorizationRequired(() => {
      authEpoch.current += 1;
      revoked.current = true;
      lock.current = undefined;
      setOperations([]);
      setBindingOpen(false);
    });
    return () => {
      authEpoch.current += 1;
      unsubscribe();
    };
    // Only authentication changes reset operation ownership, not draft renders.
  }, [auth]);
  useEffect(() => {
    if (owner.current && !valid(owner.current)) setBindingOpen(false);
    // A close/reopen has its own synchronous generation; this handles navigation.
  }, [route, scope, selected?.id, available]);
  const mutateAsync = async () => {
    const target = owner.current;
    if (!target || !valid(target)) throw new Error('原 Prompt 已变化，请重新打开绑定表单');
    if (lock.current) throw new Error('原绑定操作尚未确认，请勿重复创建');
    let payload: Payload;
    try {
      payload = { ...current.current.prepare() };
      if (payload.promptId !== target.promptId)
        throw new Error('原 Prompt 已变化，请重新打开绑定表单');
    } catch (cause) {
      const value = cause instanceof Error ? cause : new Error('绑定参数尚未确认');
      setError({ owner: target, value });
      throw value;
    }
    const submittedAuthEpoch = authEpoch.current;
    const operation: BindingOperation = {
      id: ++sequence.current,
      auth: target.auth,
      authEpoch: submittedAuthEpoch,
      promptName: target.promptName,
      targetName: current.current.targetName,
      payload,
      phase: 'pending',
      message:
        '正在保存绑定，请勿重复创建。关闭不会取消请求；离开或刷新会丢失本页保护，请先核对结果。',
    };
    lock.current = operation;
    setError(undefined);
    setOperations((items) => [...items, operation]);
    const authorized = () =>
      live.current &&
      !revoked.current &&
      submittedAuthEpoch === authEpoch.current &&
      target.auth === current.current.auth;
    const publish = (next: BindingOperation) => {
      if (!authorized()) return;
      if (lock.current?.id === operation.id)
        lock.current = next.phase === 'unknown' ? next : undefined;
      setOperations((items) => items.map((item) => (item.id === operation.id ? next : item)));
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
      ) {
        throw new Error('服务返回无法核对，保存结果尚未确认');
      }
      publish({ ...operation, phase: 'saved', bindingId: saved.id, message: '已保存原绑定。' });
      if (authorized())
        void client.invalidateQueries({ queryKey: ['prompt-bindings', payload.promptId] });
      if (valid(target)) setBindingOpen(false);
      return response;
    } catch (cause) {
      const value = cause instanceof Error ? cause : new Error('保存结果尚未确认');
      // These service checks run before repository insertion. Other errors may
      // follow a committed insert; never infer non-write from a generic status.
      const rejected =
        value instanceof ApiError &&
        ((value.status === 404 &&
          [
            'PROMPT_NOT_FOUND',
            'PROMPT_BINDING_TARGET_NOT_FOUND',
            'PROMPT_LABEL_NOT_FOUND',
            'PROMPT_VERSION_NOT_FOUND',
          ].includes(value.code)) ||
          (value.status === 400 && value.code === 'PROMPT_BINDING_SELECTOR_INVALID'));
      publish({
        ...operation,
        phase: rejected ? 'rejected' : 'unknown',
        message: rejected
          ? `未保存：${value.message}`
          : '保存结果未确认。请人工核对原绑定，勿重复创建；离开或刷新页面不会保留此保护。',
      });
      if (valid(target))
        setError({
          owner: target,
          value: rejected ? value : new Error('保存结果未确认，请人工核对原绑定，勿重复创建。'),
        });
      throw value;
    }
  };
  const visibleOperations = operations.filter(
    (item) => !revoked.current && item.auth === auth && item.authEpoch === authEpoch.current,
  );
  return {
    bindingOpen: bindingOpen && Boolean(owner.current && valid(owner.current)),
    setBindingOpen,
    bindingOperations: visibleOperations,
    bindingBlocked: visibleOperations.some(
      (item) => item.phase === 'pending' || item.phase === 'unknown',
    ),
    dismissBindingOperation: (id: number) =>
      setOperations((items) =>
        items.filter(
          (item) => item.id !== id || item.phase === 'pending' || item.phase === 'unknown',
        ),
      ),
    createBinding: {
      mutateAsync,
      mutate: () => {
        void mutateAsync().catch(() => undefined);
      },
      isPending: visibleOperations.some((item) => item.phase === 'pending'),
      error: error && valid(error.owner) ? error.value : null,
    },
  };
}
