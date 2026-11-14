import { AgentAvailability } from '../components/AgentAvailability';
import { AgentConnectionCheck } from '../components/AgentConnectionCheck';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AhButton, AhInput, AhLoadingState, AhStatusPill } from '@agenthub/ui';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { api, authSession, type AgentRecord, type ExecutionTargetRecord } from '../../../lib/api';
import { displayDate } from '../../shared/page-primitives';
import { agentKindLabel, capabilitiesFor, executionTargetKindLabel } from '../agent-presentation';
import styles from './AgentDetailPage.module.css';

const stateLabels: Record<string, string> = {
  UNVERIFIED: '尚未检查',
  READY: '最近检查就绪',
  STOPPED: '已停止',
  MISSING: '缺少依赖',
  BROKEN: '检查异常',
  AUTH_REQUIRED: '需要授权',
  WORKSPACE_UNMAPPED: '工作目录未映射',
  CONTAINER_REPLACED: '容器身份已变化',
  UNSUPPORTED_VERSION: '版本不受支持',
  UNSUPPORTED: '不支持',
};
type Defaults = Pick<AgentRecord, 'defaultModel' | 'defaultMode'>;
const normalized = (value: string) => value.trim() || null;
const same = (a: Defaults, b: Defaults) =>
  a.defaultModel === b.defaultModel && a.defaultMode === b.defaultMode;
function parseAgent(value: unknown, id: string): AgentRecord {
  const a = value as AgentRecord | null;
  if (
    !a ||
    a.id !== id ||
    typeof a.targetId !== 'string' ||
    !a.targetId ||
    typeof a.name !== 'string' ||
    !a.name ||
    typeof a.agentKind !== 'string' ||
    typeof a.adapterKind !== 'string' ||
    typeof a.status !== 'string' ||
    typeof a.enabled !== 'boolean' ||
    !(a.defaultModel === null || typeof a.defaultModel === 'string') ||
    !(a.defaultMode === null || typeof a.defaultMode === 'string') ||
    !a.capabilitiesJson ||
    typeof a.capabilitiesJson !== 'object' ||
    Array.isArray(a.capabilitiesJson) ||
    !(a.lastPreflightAt === null || typeof a.lastPreflightAt === 'string')
  ) {
    throw new Error('Agent 响应身份或字段无法确认，请重新读取。');
  }
  return a;
}
async function readAgent(id: string) {
  const list = await api.get<unknown>('/agents');
  if (!Array.isArray(list)) throw new Error('Agent 列表格式无法确认。');
  const matches = list.filter((item) => item && typeof item === 'object' && item.id === id);
  if (!matches.length) throw new Error('Agent 不存在或已不再可见。');
  if (matches.length !== 1) throw new Error('Agent 身份重复，无法安全读取。');
  return parseAgent(matches[0], id);
}

export function AgentDetailPage() {
  const { agentId = '' } = useParams();
  const mode = useAuthMode();
  const user = useAuthUser();
  return <AgentDetail key={`${agentId}:${mode}:${user?.id ?? ''}`} agentId={agentId} />;
}

function AgentDetail({ agentId }: { agentId: string }) {
  const client = useQueryClient();
  const live = useRef(false);
  const generation = useRef(0);
  const locked = useRef(false);
  const uncertain = useRef(false);
  const [agent, setAgent] = useState<AgentRecord>();
  const [target, setTarget] = useState<ExecutionTargetRecord>();
  const [model, setModel] = useState('');
  const [mode, setMode] = useState('');
  const [busy, setBusy] = useState(true);
  const [revoked, setRevoked] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Defaults & { expectedTargetId: string }>();
  const [readback, setReadback] = useState<AgentRecord>();
  const [identityChanged, setIdentityChanged] = useState(false);
  const current = (token: number) => live.current && token === generation.current;
  const adopt = (value: AgentRecord) => {
    setAgent((previous) =>
      previous &&
      previous.id === value.id &&
      previous.targetId === value.targetId &&
      typeof previous.enabledRevision === 'number' &&
      previous.enabledRevision > (value.enabledRevision ?? -1)
        ? { ...value, enabled: previous.enabled, enabledRevision: previous.enabledRevision }
        : value,
    );
    setModel(value.defaultModel ?? '');
    setMode(value.defaultMode ?? '');
  };
  const load = async () => {
    if (!live.current || locked.current) return;
    locked.current = true;
    const token = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const found = await readAgent(agentId);
      if (!current(token)) return;
      adopt(found);
      // Informational metadata must not block editing this exact Agent's defaults.
      void api
        .get<ExecutionTargetRecord[]>('/execution-targets')
        .then((targets) => {
          if (current(token) && Array.isArray(targets))
            setTarget(
              targets.find(
                (item) =>
                  item &&
                  item.id === found.targetId &&
                  typeof item.name === 'string' &&
                  typeof item.kind === 'string',
              ),
            );
        })
        .catch(() => {
          /* Keep the exact target ID visible when metadata is unavailable. */
        });
    } catch (err) {
      if (current(token)) setError(err instanceof Error ? err.message : '读取 Agent 失败。');
    } finally {
      if (current(token)) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    live.current = true;
    locked.current = false;
    const unsubscribe = authSession.onAuthorizationRequired(() => {
      live.current = false;
      ++generation.current;
      setRevoked(true);
    });
    void load();
    return () => {
      live.current = false;
      ++generation.current;
      unsubscribe();
    };
    // This component is keyed by route and authenticated identity.
  }, []);
  const save = async () => {
    if (!live.current || locked.current || uncertain.current || !agent) return;
    locked.current = true;
    const token = ++generation.current;
    const submitted: Defaults = { defaultModel: normalized(model), defaultMode: normalized(mode) };
    const expectedTargetId = agent.targetId;
    setBusy(true);
    setError('');
    setNotice('');
    setReadback(undefined);
    try {
      const response = parseAgent(
        await api.patch<unknown>(`/agents/${encodeURIComponent(agentId)}`, submitted),
        agentId,
      );
      if (!current(token)) return;
      if (response.targetId !== expectedTargetId || !same(response, submitted))
        throw new Error('保存响应与提交不一致。');
      adopt(response);
      setNotice('默认设置已保存。仅影响后续会话的默认选择。');
      void client.invalidateQueries({ queryKey: ['agents'] });
    } catch {
      if (current(token)) {
        uncertain.current = true;
        setPending({ ...submitted, expectedTargetId });
        setError('保存结果尚未确认。请读取服务器当前值核对，不要直接重复保存。');
      }
    } finally {
      if (current(token)) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  const check = async () => {
    if (!live.current || locked.current || !pending || identityChanged) return;
    locked.current = true;
    const token = ++generation.current;
    setBusy(true);
    setError('');
    setReadback(undefined);
    try {
      const value = await readAgent(agentId);
      if (!current(token)) return;
      if (value.targetId !== pending.expectedTargetId) {
        setIdentityChanged(true);
        throw new Error(
          'Agent 执行环境身份已变化，请返回列表重新进入；本页不会采用此响应或重试保存。',
        );
      }
      setReadback(value);
    } catch (err) {
      if (current(token))
        setError(err instanceof Error ? err.message : '核对失败，请稍后重新读取。');
    } finally {
      if (current(token)) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  if (revoked) return <p role="alert">认证身份已失效，请重新登录后读取 Agent。</p>;
  return (
    <div className={`${styles.page} page-content page-shell`}>
      <Link to="/agents">返回 Agent 中心</Link>
      {!agent ? (
        <>
          {busy ? <AhLoadingState label="正在读取 Agent" /> : null}
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <AhButton variant="default" onClick={() => void load()}>
                重新读取
              </AhButton>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <header className={styles.identity}>
            <h1>{agent.name}</h1>
            <div className={styles.actions}>
              <AhStatusPill
                status={agent.status}
                label={stateLabels[agent.status] ?? '状态待确认'}
              />
              <span>
                {agentKindLabel(agent.agentKind)} · {agent.enabled ? '已启用' : '已停用'}
              </span>
            </div>
            <p className={styles.secondary}>
              {target?.id === agent.targetId ? target.name : '执行环境名称暂不可用'} ·{' '}
              {executionTargetKindLabel(target?.id === agent.targetId ? target.kind : undefined)}
            </p>
            <p className={styles.secondary}>全局状态不代表每个项目都可运行。</p>
          </header>
          <section className={styles.panel}>
            <h2>默认设置</h2>
            <p>
              仅用于后续会话的默认选择，不修改现有会话。模型和模式名称由供应商决定，保存不保证供应商支持。
            </p>
            <p>
              当前服务没有版本冲突保护；其他管理员可能同时修改，最后一次保存会覆盖同名默认字段。
            </p>
            <fieldset className={styles.fields} disabled={busy || Boolean(pending)}>
              <AhInput
                label="默认模型"
                value={model}
                maxLength={160}
                onChange={(event) => setModel(event.currentTarget.value)}
              />
              <AhInput
                label="默认模式"
                value={mode}
                maxLength={80}
                onChange={(event) => setMode(event.currentTarget.value)}
              />
              <small>留空并保存会清除该默认值，由后续会话选择。</small>
              <AhButton
                onClick={() => void save()}
                disabled={same(agent, {
                  defaultModel: normalized(model),
                  defaultMode: normalized(mode),
                })}
              >
                保存默认设置
              </AhButton>
            </fieldset>
            {busy ? (
              <p role="status">
                {pending
                  ? '正在读取服务器当前值。'
                  : '正在保存默认设置。离开页面不会撤回已发送的请求。'}
              </p>
            ) : null}
            {notice ? <p role="status">{notice}</p> : null}
            {error ? <p role="alert">{error}</p> : null}
            {pending ? (
              <section className={styles.recovery} aria-label="核对默认设置">
                <h3>保存结果待核对</h3>
                <p>
                  本次提交：模型 {pending.defaultModel ?? '未设置'}；模式{' '}
                  {pending.defaultMode ?? '未设置'}
                </p>
                <AhButton
                  variant="default"
                  disabled={busy || identityChanged}
                  onClick={() => void check()}
                >
                  读取服务器当前值
                </AhButton>
                {readback ? (
                  <>
                    <p>
                      服务器当前值：模型 {readback.defaultModel ?? '未设置'}；模式{' '}
                      {readback.defaultMode ?? '未设置'}
                    </p>
                    <p role="status">
                      {same(pending, readback)
                        ? '当前值与本次提交一致。'
                        : '当前值与本次提交不同，可能尚未保存或已被其他修改覆盖。'}
                    </p>
                    <AhButton
                      variant="default"
                      disabled={busy}
                      onClick={() => {
                        if (!live.current || locked.current) return;
                        adopt(readback);
                        uncertain.current = false;
                        setPending(undefined);
                        setReadback(undefined);
                        setError('');
                      }}
                    >
                      采用服务器值继续编辑
                    </AhButton>
                  </>
                ) : null}
                <Link to="/agents">放弃本页核对并返回列表</Link>
                <p>
                  离开不会撤回服务器请求。重新进入后请先核对当前值；本页不持久保存草稿或自动重试。
                </p>
              </section>
            ) : null}
          </section>
          <AgentAvailability
            agent={agent}
            onObserved={(value) => {
              setAgent((previous) => {
                if (
                  !previous ||
                  previous.id !== value.id ||
                  previous.targetId !== value.targetId ||
                  (previous.enabledRevision ?? -1) > value.enabledRevision
                )
                  return previous;
                return {
                  ...previous,
                  enabled: value.enabled,
                  enabledRevision: value.enabledRevision,
                };
              });
            }}
          />
          <AgentConnectionCheck
            key={`${agent.id}:${agent.targetId}`}
            agent={agent}
            target={target}
            disabled={busy || Boolean(pending)}
            readSaved={async () => {
              const token = generation.current;
              const saved = await readAgent(agentId);
              if (!current(token)) return;
              if (saved.targetId !== agent.targetId) throw new Error('identity changed');
              setAgent((previous) =>
                previous &&
                typeof previous.enabledRevision === 'number' &&
                previous.enabledRevision > (saved.enabledRevision ?? -1)
                  ? {
                      ...saved,
                      enabled: previous.enabled,
                      enabledRevision: previous.enabledRevision,
                    }
                  : saved,
              ); // Refresh evidence, never overwrite unsaved defaults.
            }}
          />
          <details className={styles.technical}>
            <summary>技术信息与能力报告</summary>
            <div className={styles.technicalBody}>
              <p>最近检查：{displayDate(agent.lastPreflightAt)}</p>
              <code className={styles.wrap}>
                Agent：{agent.id}
                <br />
                执行环境：{agent.targetId}
              </code>
              <p>这里不启动 Agent，也不修改执行环境。</p>
              <h3>已报告能力</h3>
              <p>{capabilitiesFor(agent).join(' · ') || '能力待确认'}</p>
              <p>
                能力来自已保存的检查报告，不是实时探测。当前检查未就绪时，旧能力可能已过期；最近检查时间不等于最近成功时间。
              </p>
              <Link to="/agents/diagnostics">服务器诊断（不是此 Agent 专属诊断）</Link>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
