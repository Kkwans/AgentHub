import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { api, type PromptRecord, type PromptVersionRecord } from '../../../lib/api';
import { authSession } from '../../../lib/auth-api';

type Owner = {
  id: string;
  type: PromptRecord['type'];
  name: string;
  auth: string;
  route: string;
  scope: string;
  generation: number;
};
type UnknownOutcome = { checked?: PromptVersionRecord[] };
export function usePromptVersionDraft(
  selected: PromptRecord | undefined,
  available: PromptRecord[] | undefined,
  scope: string,
  selectionId: string,
) {
  const client = useQueryClient();
  const location = useLocation();
  const mode = useAuthMode();
  const user = useAuthUser();
  const auth = `${mode ?? 'unknown'}:${user?.id ?? ''}`;
  const route = `${location.key}:${location.pathname}:${location.search}`;
  const [versionOpen, setOpen] = useState(false);
  const [versionTarget, setTarget] = useState<Owner>();
  const [versionContent, setVersionContent] = useState('');
  const [versionVariables, setVersionVariables] = useState('{}');
  const [versionChangelog, setVersionChangelog] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [unknown, setUnknown] = useState<UnknownOutcome>();
  const owner = useRef<Owner | undefined>(undefined);
  const generation = useRef(0);
  const live = useRef(false);
  const revoked = useRef(false);
  const submitting = useRef(false);
  const creating = useRef(new Set<Owner>());
  const uncertain = useRef(new Map<string, UnknownOutcome>());
  const current = useRef({ auth, route, scope, selected, available, selectionId });
  current.current = { auth, route, scope, selected, available, selectionId };
  const currentOwner = (target: Owner) =>
    live.current &&
    !revoked.current &&
    owner.current === target &&
    target.auth === current.current.auth &&
    target.route === current.current.route &&
    target.scope === current.current.scope &&
    current.current.selected?.id === target.id &&
    (!current.current.selectionId || current.current.selectionId === target.id) &&
    current.current.available?.some((item) => item.id === target.id && item.type === target.type);
  const close = () => {
    if (owner.current && creating.current.has(owner.current))
      uncertain.current.set(owner.current.id, {});
    generation.current += 1;
    owner.current = undefined;
    submitting.current = false;
    setOpen(false);
    setBusy(false);
    setError(null);
  };
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      owner.current = undefined;
      generation.current += 1;
    };
  }, []);
  useEffect(() => {
    close();
    revoked.current = false;
    uncertain.current.clear();
    return authSession.onAuthorizationRequired(() => {
      revoked.current = true;
      close();
      uncertain.current.clear();
    });
  }, [auth]);
  useEffect(() => {
    if (owner.current && !currentOwner(owner.current)) close();
  }, [route, scope, selected?.id, selected?.type, available, selectionId]);
  const setVersionOpen = (open: boolean) => {
    if (!open) {
      close();
      return;
    }
    const state = current.current;
    const target = state.available?.find(
      (item) => item.id === state.selected?.id && (!selectionId || item.id === selectionId),
    );
    if (!live.current || revoked.current || !target) return;
    const next: Owner = {
      id: target.id,
      name: target.name,
      type: target.type,
      auth: state.auth,
      route: state.route,
      scope: state.scope,
      generation: ++generation.current,
    };
    owner.current = next;
    submitting.current = false;
    setTarget(next);
    setUnknown(uncertain.current.get(target.id));
    setError(null);
    setBusy(false);
    setOpen(true);
  };
  const markUnknown = (target: Owner) => {
    if (!live.current || revoked.current || target.auth !== current.current.auth) return;
    const outcome: UnknownOutcome = {};
    uncertain.current.set(target.id, outcome);
    const active = owner.current;
    if (active && active.id === target.id && active.auth === target.auth && currentOwner(active)) {
      setUnknown(outcome);
    }
  };
  const mutate = async () => {
    const target = versionTarget;
    if (!target || !currentOwner(target) || submitting.current || uncertain.current.has(target.id))
      return;
    let content: Record<string, unknown>;
    let variables: Record<string, unknown>;
    try {
      variables = JSON.parse(versionVariables || '{}') as Record<string, unknown>;
      content =
        target.type === 'CHAT'
          ? (JSON.parse(versionContent) as Record<string, unknown>)
          : { text: versionContent };
    } catch {
      setError(new Error('正文或变量不是有效 JSON，请检查后再提交。'));
      return;
    }
    const input = { content, variables, changelog: versionChangelog.trim() || undefined };
    creating.current.add(target);
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<PromptVersionRecord>(`/prompts/${target.id}/versions`, input);
      if (
        !result ||
        result.promptId !== target.id ||
        typeof result.id !== 'string' ||
        !result.id.trim() ||
        !Number.isInteger(result.version) ||
        result.version < 1
      ) {
        markUnknown(target);
        return;
      }
      if (!live.current || revoked.current || target.auth !== current.current.auth) return;
      void client.invalidateQueries({ queryKey: ['prompt-versions', target.id] });
      void client.invalidateQueries({ queryKey: ['prompt-labels', target.id] });
      if (!currentOwner(target)) return;
      creating.current.delete(target);
      close();
      setVersionContent('');
      setVersionVariables('{}');
      setVersionChangelog('');
    } catch {
      markUnknown(target);
    } finally {
      creating.current.delete(target);
      if (currentOwner(target)) {
        submitting.current = false;
        setBusy(false);
      }
    }
  };
  const checkVersionOutcome = async () => {
    const target = versionTarget;
    if (!target || !currentOwner(target) || submitting.current || !uncertain.current.has(target.id))
      return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const rows = await api.get<PromptVersionRecord[]>(`/prompts/${target.id}/versions`);
      if (
        !Array.isArray(rows) ||
        rows.some(
          (row) =>
            !row ||
            row.promptId !== target.id ||
            typeof row.id !== 'string' ||
            !row.id.trim() ||
            !Number.isInteger(row.version) ||
            row.version < 1,
        )
      )
        throw new Error('版本列表身份不匹配');
      if (!currentOwner(target)) return;
      const outcome = { checked: rows };
      uncertain.current.set(target.id, outcome);
      setUnknown(outcome);
    } catch {
      if (currentOwner(target))
        setError(new Error('无法确认此 Prompt 的版本列表，请稍后只读核对。'));
    } finally {
      if (currentOwner(target)) {
        submitting.current = false;
        setBusy(false);
      }
    }
  };
  const resumeVersionEditing = () => {
    const target = versionTarget;
    if (
      !target ||
      !currentOwner(target) ||
      submitting.current ||
      !uncertain.current.get(target.id)?.checked
    )
      return;
    uncertain.current.delete(target.id);
    setUnknown(undefined);
    setError(null);
  };
  return {
    versionOpen,
    setVersionOpen,
    versionTarget,
    versionContent,
    setVersionContent,
    versionVariables,
    setVersionVariables,
    versionChangelog,
    setVersionChangelog,
    versionCreate: { mutate, isPending: busy, error },
    versionOutcomeUnknown: unknown,
    checkVersionOutcome,
    resumeVersionEditing,
  };
}
