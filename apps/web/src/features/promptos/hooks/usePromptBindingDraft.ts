import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import type { PromptRecord } from '../../../lib/api';
import { useBindingOperations } from '../components/PromptBindingOperationProvider';
import type { BindingPayload } from '../lib/binding-operation-owner';
export type { BindingOperation } from '../lib/binding-operation-owner';
type Owner = {
  promptId: string;
  promptName: string;
  auth: string;
  route: string;
  scope: string;
  generation: number;
  operationOwner: ReturnType<typeof useBindingOperations>['owner'];
  epoch: number;
};
export function usePromptBindingDraft(
  selected: PromptRecord | undefined,
  available: PromptRecord[] | undefined,
  scope: string,
  prepare: () => BindingPayload,
  targetName = '绑定目标',
) {
  const { owner: operationsOwner, operations } = useBindingOperations();
  const location = useLocation();
  const mode = useAuthMode();
  const user = useAuthUser();
  const auth = `${mode ?? 'unknown'}:${user?.id ?? ''}`;
  const route = `${location.key}:${location.pathname}:${location.search}`;
  const current = useRef({
    auth,
    route,
    scope,
    selected,
    available,
    prepare,
    targetName,
    operationsOwner,
  });
  current.current = {
    auth,
    route,
    scope,
    selected,
    available,
    prepare,
    targetName,
    operationsOwner,
  };
  const [bindingOpen, setOpen] = useState(false);
  const [error, setError] = useState<{ owner: Owner; value: Error }>();
  const owner = useRef<Owner | undefined>(undefined);
  const generation = useRef(0);
  const live = useRef(false);
  const valid = (target: Owner) =>
    live.current &&
    owner.current === target &&
    target.generation === generation.current &&
    target.operationOwner === current.current.operationsOwner &&
    target.operationOwner?.isAuthorized() &&
    target.epoch === target.operationOwner.getEpoch() &&
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
            operationOwner: operationsOwner,
            epoch: operationsOwner?.getEpoch() ?? -1,
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
    if (owner.current && !valid(owner.current)) setBindingOpen(false);
  }, [route, scope, selected?.id, available, operationsOwner]);
  const mutateAsync = async () => {
    if (!operationsOwner) throw new Error('缺少绑定操作 Provider，不能创建绑定');
    const target = owner.current;
    if (!target || !valid(target)) throw new Error('原 Prompt 或授权已变化，请重新打开绑定表单');
    try {
      const payload = { ...current.current.prepare() };
      if (payload.promptId !== target.promptId)
        throw new Error('原 Prompt 已变化，请重新打开绑定表单');
      setError(undefined);
      const response = await operationsOwner.submit({
        payload,
        auth: target.auth,
        promptName: target.promptName,
        targetName: current.current.targetName,
      });
      if (valid(target)) setBindingOpen(false);
      return response;
    } catch (cause) {
      const value = cause instanceof Error ? cause : new Error('保存结果尚未确认');
      if (valid(target)) setError({ owner: target, value });
      throw value;
    }
  };
  return {
    bindingOpen: bindingOpen && Boolean(owner.current && valid(owner.current)),
    setBindingOpen,
    bindingOperations: operations,
    bindingBlocked:
      !operationsOwner ||
      !operationsOwner.isAuthorized() ||
      operations.some((item) => item.phase === 'pending' || item.phase === 'unknown'),
    dismissBindingOperation: (id: number) => operationsOwner?.dismiss(id),
    createBinding: {
      mutateAsync,
      mutate: () => {
        void mutateAsync().catch(() => undefined);
      },
      isPending: operations.some((item) => item.phase === 'pending'),
      error: error && valid(error.owner) ? error.value : null,
    },
  };
}
