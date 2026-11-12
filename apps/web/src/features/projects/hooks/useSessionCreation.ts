import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthMode, useAuthUser, type AuthStatus } from '../../../components/AccessGate';
import { api, type AgentRecord, type ProjectRecord, type SessionRecord } from '../../../lib/api';
import { authSession } from '../../../lib/auth-api';

type Owner = { projectId: string; rootPath: string; auth: string; route: string };
type Operation = {
  owner: Owner;
  agentId: string;
  title: string;
  phase: 'pending' | 'unknown' | 'saved';
  session?: SessionRecord;
  failure?: string;
  checked?: SessionRecord[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keyFor = (owner: Owner) => JSON.stringify([owner.auth, owner.projectId]);
export function useSessionCreation(
  project: ProjectRecord,
  open: boolean,
  agents: AgentRecord[] | undefined,
) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const mode = useAuthMode();
  const user = useAuthUser();
  const identityValid =
    mode === 'local_trusted' ||
    (mode === 'token' && typeof user?.id === 'string' && Boolean(user.id.trim()));
  const auth = `${mode ?? 'unknown'}:${user?.id ?? ''}`;
  const route = `${location.key}:${location.pathname}:${location.search}`;
  const [title, setTitle] = useState('新 Session');
  const [agentId, setAgentId] = useState('');
  const [target, setTarget] = useState<Owner>();
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [, render] = useState(0);
  const owner = useRef<Owner | undefined>(undefined);
  const live = useRef(false);
  const revoked = useRef(false);
  const operations = useRef(new Map<string, Operation>());
  const checkingRequest = useRef<object | undefined>(undefined);
  const current = useRef({ auth, route, open, project, identityValid });
  current.current = { auth, route, open, project, identityValid };
  const sameAuth = (value: Owner) => {
    // React Query notifications may render after a settled mutation. Check the
    // gate's current cache too, so an already-changed account cannot win that race.
    const status = client.getQueryData<AuthStatus>(['auth-status']);
    const cachedAuth = status ? `${status.mode}:${status.user?.id ?? ''}` : current.current.auth;
    return (
      live.current &&
      current.current.identityValid &&
      !revoked.current &&
      current.current.auth === value.auth &&
      cachedAuth === value.auth &&
      (!status ||
        status.mode === 'local_trusted' ||
        (status.mode === 'token' &&
          status.authenticated &&
          typeof status.user?.id === 'string' &&
          Boolean(status.user.id.trim())))
    );
  };
  const owns = (value: Owner | undefined): value is Owner =>
    Boolean(
      value &&
      sameAuth(value) &&
      owner.current === value &&
      current.current.open &&
      current.current.route === value.route &&
      current.current.project.id === value.projectId &&
      current.current.project.rootPath === value.rootPath,
    );
  const refresh = (value: Owner) => {
    if (sameAuth(value)) render((n) => n + 1);
  };
  const abandon = () => {
    checkingRequest.current = undefined;
    owner.current = undefined;
    setTarget(undefined);
    setError(undefined);
    setChecking(false);
  };
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      owner.current = undefined;
    };
  }, []);
  useEffect(() => {
    revoked.current = false;
    return authSession.onAuthorizationRequired(() => {
      revoked.current = true;
      abandon();
    });
  }, [auth]);
  useEffect(() => {
    abandon();
    setTitle('新 Session');
    setAgentId('');
    if (!open || revoked.current) return;
    const next = { projectId: project.id, rootPath: project.rootPath, auth, route };
    const existing = operations.current.get(keyFor(next));
    if (existing) {
      setTitle(existing.title);
      setAgentId(existing.agentId);
    }
    owner.current = next;
    setTarget(next);
  }, [open, project.id, project.rootPath, auth, route]);
  useEffect(() => {
    if (owns(target) && !agentId)
      setAgentId(agents?.find((agent) => agent.status === 'READY')?.id ?? '');
  }, [agents, target, agentId]);
  const operation = target ? operations.current.get(keyFor(target)) : undefined;
  const create = async () => {
    // target belongs to this render: a stale handler must never submit a newer dialog's draft.
    if (
      !owns(target) ||
      operations.current.has(keyFor(target)) ||
      !title.trim() ||
      !agents?.some((agent) => agent.id === agentId && agent.status === 'READY')
    )
      return;
    const value: Operation = { owner: target, agentId, title: title.trim(), phase: 'pending' };
    operations.current.set(keyFor(target), value); // synchronous double-click fence
    setError(undefined);
    refresh(target);
    try {
      const session = await api.post<SessionRecord>('/sessions', {
        projectId: target.projectId,
        agentId: value.agentId,
        title: value.title,
        cwd: target.rootPath,
      });
      if (
        !session ||
        typeof session.id !== 'string' ||
        !uuid.test(session.id) ||
        session.projectId !== target.projectId ||
        session.agentId !== value.agentId
      )
        throw new Error('创建结果归属无法确认');
      value.phase = 'saved';
      value.session = session;
      if (sameAuth(target))
        void client.invalidateQueries({ queryKey: ['sessions', target.projectId] });
      if (owns(target)) navigate(`/workspace/${session.id}`);
    } catch (error) {
      value.phase = 'unknown';
      value.failure = error instanceof Error ? error.message : '创建请求未能确认。';
      // No automatic retry: a transport failure does not prove the server did not create it.
    } finally {
      refresh(target);
    }
  };
  const check = async () => {
    const captured = target;
    if (!owns(captured) || !operation || checkingRequest.current) return;
    const request = {};
    checkingRequest.current = request;
    delete operation.checked; // A failed refresh must not authorize recovery from an older list.
    setChecking(true);
    setError(undefined);
    try {
      const rows = await api.get<SessionRecord[]>(
        `/sessions?projectId=${encodeURIComponent(operation.owner.projectId)}`,
      );
      if (
        !Array.isArray(rows) ||
        rows.some(
          (row) =>
            !row ||
            typeof row.id !== 'string' ||
            !uuid.test(row.id) ||
            row.projectId !== operation.owner.projectId ||
            typeof row.agentId !== 'string' ||
            !uuid.test(row.agentId) ||
            typeof row.title !== 'string',
        )
      )
        throw new Error('会话列表归属无法确认');
      if (
        owns(captured) &&
        checkingRequest.current === request &&
        operations.current.get(keyFor(captured)) === operation
      ) {
        operation.checked = rows;
        refresh(captured);
      }
    } catch {
      if (owns(captured) && checkingRequest.current === request)
        setError('无法确认原项目的会话列表，请稍后再读取。');
    } finally {
      if (checkingRequest.current === request) {
        checkingRequest.current = undefined;
        if (owns(captured)) setChecking(false);
      }
    }
  };
  const resume = () => {
    if (
      !owns(target) ||
      !operation ||
      operation.phase !== 'unknown' ||
      !operation.checked ||
      checkingRequest.current
    )
      return;
    operations.current.delete(keyFor(target));
    setError(undefined);
    refresh(target);
  };
  const createAnother = () => {
    if (!owns(target) || operation?.phase !== 'saved') return;
    operations.current.delete(keyFor(target));
    setTitle('新 Session');
    setAgentId(agents?.find((agent) => agent.status === 'READY')?.id ?? '');
    setError(undefined);
    refresh(target);
  };
  return {
    createAnother,
    title,
    setTitle,
    agentId,
    setAgentId,
    create,
    abandon,
    operation,
    check,
    resume,
    checking,
    error,
    ready: owns(target),
  };
}
