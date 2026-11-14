import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AhButton, AhSelect } from '@agenthub/ui';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { api, authSession, type AgentRecord, type ExecutionTargetRecord } from '../../../lib/api';
import styles from '../pages/AgentDetailPage.module.css';

const statuses = [
  'READY',
  'STOPPED',
  'MISSING',
  'BROKEN',
  'AUTH_REQUIRED',
  'WORKSPACE_UNMAPPED',
  'CONTAINER_REPLACED',
  'UNSUPPORTED_VERSION',
  'UNSUPPORTED',
];
const labels: Record<string, string> = {
  READY: '连接检查通过',
  STOPPED: '已停止',
  MISSING: '缺少依赖',
  BROKEN: '检查异常',
  AUTH_REQUIRED: '需要授权',
  WORKSPACE_UNMAPPED: '目录未映射',
  CONTAINER_REPLACED: '环境身份已变化',
  UNSUPPORTED_VERSION: '版本不受支持',
  UNSUPPORTED: '不支持',
};
const checkLabels: Record<string, string> = {
  process: '检查进程',
  initialize: '协议连接',
  session: '测试会话',
};
const checkStates: Record<string, string> = {
  PASS: '通过',
  WARN: '需注意',
  FAIL: '未通过',
  SKIP: '未执行',
};
type Scope = { agentId: string; targetId: string; projectId: string; cwd: string };
type Report = Scope & {
  status: string;
  checkedAt: string;
  checks: Array<{ id: string; status: string }>;
};
export function parseConnectionReport(value: unknown, scope: Scope): Report {
  if (!value || typeof value !== 'object') throw new Error('invalid report');
  const r = value as Record<string, unknown>;
  if (
    Object.entries(scope).some(([key, expected]) => r[key] !== expected) ||
    r.smokeSession !== false ||
    !statuses.includes(String(r.status)) ||
    typeof r.checkedAt !== 'string' ||
    !Number.isFinite(Date.parse(r.checkedAt)) ||
    !Array.isArray(r.checks) ||
    r.checks.length > 3
  )
    throw new Error('unconfirmed report');
  const seen = new Set<string>();
  const checks = r.checks.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('invalid check');
    const c = value as Record<string, unknown>;
    if (
      typeof c.id !== 'string' ||
      !Object.hasOwn(checkLabels, c.id) ||
      seen.has(c.id) ||
      typeof c.status !== 'string' ||
      !Object.hasOwn(checkStates, c.status) ||
      (c.id === 'session' && c.status !== 'SKIP')
    )
      throw new Error('invalid check');
    seen.add(c.id);
    return { id: c.id, status: c.status };
  });
  if (
    r.status === 'READY' &&
    ![
      ['process', 'PASS'],
      ['initialize', 'PASS'],
      ['session', 'SKIP'],
    ].every(([id, status]) => checks.some((check) => check.id === id && check.status === status))
  )
    throw new Error('incomplete success evidence');
  return { ...scope, status: String(r.status), checkedAt: r.checkedAt, checks };
}
type Attempt = { scope: Scope; phase: 'pending' | 'unknown' | 'complete'; report?: Report };
// Route remount must not offer another launch while this tab has an unresolved check.
const attempts = new Map<string, Attempt>();
const listeners = new Set<() => void>();
function publish(key: string, value: Attempt) {
  attempts.set(key, value);
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

type ProjectChoice = {
  id: string;
  name: string;
  targetId: string;
  status: string;
  realRootPath: string;
};
export function AgentConnectionCheck({
  agent,
  target,
  disabled,
  readSaved,
}: {
  agent: AgentRecord;
  target?: ExecutionTargetRecord | undefined;
  disabled: boolean;
  readSaved: () => Promise<void>;
}) {
  const authMode = useAuthMode();
  const user = useAuthUser();
  const key = `${authMode}:${user?.id ?? ''}:${agent.id}`;
  const attempt = useSyncExternalStore(subscribe, () => attempts.get(key));
  const [projects, setProjects] = useState<ProjectChoice[]>([]);
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const eligible =
    agent.enabled &&
    agent.adapterKind === 'ACP_STDIO' &&
    target?.id === agent.targetId &&
    target.kind === 'LOCAL_HOST';
  useEffect(() => {
    alive.current = true;
    const token = ++generation.current;
    const unsubscribe = authSession.onAuthorizationRequired(() => {
      alive.current = false;
      ++generation.current;
    });
    if (eligible)
      void api
        .get<unknown>('/projects')
        .then((rows) => {
          if (!alive.current || token !== generation.current) return;
          if (!Array.isArray(rows)) throw new Error('invalid projects');
          setProjects(
            rows.filter((row): row is ProjectChoice =>
              Boolean(
                row &&
                typeof row === 'object' &&
                typeof row.id === 'string' &&
                typeof row.name === 'string' &&
                typeof row.realRootPath === 'string' &&
                row.status === 'ACTIVE' &&
                row.targetId === agent.targetId,
              ),
            ),
          );
        })
        .catch(() => {
          if (alive.current && token === generation.current)
            setError('无法读取匹配的已登记项目，请稍后重新进入。');
        });
    return () => {
      alive.current = false;
      ++generation.current;
      const owned = attempts.get(key);
      if (owned?.phase === 'pending') publish(key, { ...owned, phase: 'unknown' });
      unsubscribe();
    };
  }, [eligible, agent.targetId]);
  const project = projects.find((p) => p.id === projectId);
  const launch = async () => {
    if (!alive.current || disabled || !eligible || !project || attempts.has(key)) return;
    const scope = {
      agentId: agent.id,
      targetId: agent.targetId,
      projectId: project.id,
      cwd: project.realRootPath,
    };
    const token = generation.current;
    const owned: Attempt = { scope, phase: 'pending' };
    publish(key, owned);
    setError('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        api.post<unknown>(`/agents/${encodeURIComponent(agent.id)}/connection-check`, {
          projectId: project.id,
          expectedTargetId: agent.targetId,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 65_000);
        }),
      ]);
      if (!alive.current || token !== generation.current || attempts.get(key) !== owned) return;
      const report = parseConnectionReport(raw, scope);
      publish(key, { scope, phase: 'complete', report });
    } catch {
      if (attempts.get(key) === owned) publish(key, { scope, phase: 'unknown' });
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return (
    <section className={styles.connectionCheck} aria-label="Agent 连接检查">
      <h2>连接检查</h2>
      <p>显式启动本机 ACP 进程并初始化连接，更新最近检查状态；不创建测试会话、不发送任务。</p>
      {!eligible ? (
        <p className={styles.secondary}>
          仅支持已确认执行环境的、已启用的本机 ACP Agent。容器和远程检查暂不在此开放。
        </p>
      ) : (
        <>
          <AhSelect
            label="检查项目"
            placeholder="选择已登记项目"
            value={projectId || null}
            onChange={(value) => setProjectId(value ?? '')}
            disabled={disabled || Boolean(attempt)}
            data={projects.map((p) => ({ value: p.id, label: p.name }))}
          />
          {project ? (
            <p className={styles.secondary}>
              检查目录：<code className={styles.wrap}>{project.realRootPath}</code>
            </p>
          ) : (
            <p className={styles.secondary}>
              仅列出与此 Agent 同一执行环境的活动项目；目录由服务器重新核验。
            </p>
          )}
          <AhButton
            variant="default"
            disabled={disabled || !project || Boolean(attempt)}
            onClick={() => void launch()}
          >
            检查连接
          </AhButton>
        </>
      )}
      {attempt ? (
        <div className={styles.recovery}>
          <p role="status">
            {attempt.phase === 'pending'
              ? '正在检查。离开页面不会取消已发送的请求。'
              : attempt.phase === 'unknown'
                ? '检查结果待核对。请求可能仍在执行，本页不会重复启动。'
                : labels[attempt.report!.status]}
          </p>
          <p className={styles.secondary}>
            本次目录：<code className={styles.wrap}>{attempt.scope.cwd}</code>
          </p>
          {attempt.report ? (
            <>
              <p className={styles.secondary}>
                本次检查时间：{attempt.report.checkedAt}。这不是项目任务可运行的保证。
              </p>
              <ul>
                {attempt.report.checks.map((c) => (
                  <li key={c.id}>
                    {checkLabels[c.id]}：{checkStates[c.status]}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <AhButton
            variant="subtle"
            disabled={disabled || checking || attempt.phase === 'pending'}
            onClick={() => {
              if (!alive.current) return;
              const token = generation.current;
              setChecking(true);
              setError('');
              void readSaved()
                .catch(() => {
                  if (alive.current && token === generation.current)
                    setError('已保存状态读取失败。');
                })
                .finally(() => {
                  if (alive.current && token === generation.current) setChecking(false);
                });
            }}
          >
            读取已保存状态
          </AhButton>
          {attempt.phase === 'complete' && eligible && attempt.scope.targetId === agent.targetId ? (
            <AhButton
              variant="subtle"
              disabled={disabled || checking}
              onClick={() => {
                if (!alive.current || attempts.get(key) !== attempt) return;
                attempts.delete(key);
                listeners.forEach((fn) => fn());
              }}
            >
              准备新的检查
            </AhButton>
          ) : null}
          <p className={styles.secondary}>
            已保存状态不是原请求的成功凭据。当前页不自动重跑，也不提供烟测或修复命令。
          </p>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
