import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AhButton } from '@agenthub/ui';
import { useAuthMode, useAuthUser } from '../../../components/AccessGate';
import { api, type AgentRecord } from '../../../lib/api';
import {
  availabilityEpoch,
  availabilityKey,
  mergeAvailability,
  parseAvailability,
  readMarker,
  refreshMarker,
  subscribeAvailability,
  writeMarker,
  settleMarker,
  finishOwnedPending,
  type Availability,
  type Marker,
} from '../lib/agent-availability-state';
import styles from '../pages/AgentDetailPage.module.css';

export function AgentAvailability({
  agent,
  onObserved,
}: {
  agent: AgentRecord;
  onObserved: (value: Availability) => void;
}) {
  const mode = useAuthMode();
  const user = useAuthUser();
  const scope = mode === 'local_trusted' ? 'local-trusted' : (user?.id ?? '');
  return (
    <AvailabilityControl
      key={availabilityKey(scope, agent.id, agent.targetId)}
      agent={agent}
      scope={scope}
      onObserved={onObserved}
    />
  );
}
function AvailabilityControl({
  agent,
  scope,
  onObserved,
}: {
  agent: AgentRecord;
  scope: string;
  onObserved: (value: Availability) => void;
}) {
  const client = useQueryClient();
  const key = availabilityKey(scope, agent.id, agent.targetId);
  const epoch = useSyncExternalStore(subscribeAvailability, availabilityEpoch);
  const born = useRef(epoch);
  const live = useRef(false);
  const busyRef = useRef(false);
  const owned = useRef<Marker | null>(null);
  const query = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [observed, setObserved] = useState<Availability>();
  const [, repaint] = useState(0);
  useSyncExternalStore(subscribeAvailability, () => {
    try {
      return readMarker(key);
    } catch {
      return undefined;
    }
  });
  let marker: Marker | undefined;
  let storageError = false;
  try {
    marker = readMarker(key);
  } catch {
    storageError = true;
  }
  let base: Availability | undefined;
  try {
    base = parseAvailability(agent, agent.id, agent.targetId);
    if (observed) base = mergeAvailability(base, observed);
  } catch {
    base = undefined;
  }
  const revoked = epoch !== born.current;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      query.current?.abort();
      try {
        const pending = owned.current;
        if (pending) settleMarker(key, pending, { ...pending, phase: 'unknown' });
      } catch {
        /* Durable pending restores as unknown after reload. */
      } finally {
        if (owned.current) finishOwnedPending(key, owned.current);
      }
    };
  }, [key]);
  useEffect(() => {
    if (revoked) query.current?.abort();
  }, [revoked]);
  const active = (captured: number) =>
    live.current && availabilityEpoch() === captured && born.current === captured;
  const publish = async (value: Availability, captured: number) => {
    await Promise.all([
      client.cancelQueries({ queryKey: ['agents'] }, { revert: false }),
      client.cancelQueries({ queryKey: ['agent-eligibility'] }, { revert: false }),
    ]);
    if (!active(captured)) return;
    client.setQueriesData<AgentRecord[]>({ queryKey: ['agents'] }, (rows) =>
      rows?.map((row) => {
        if (row.id !== value.id || row.targetId !== value.targetId) return row;
        const revision = row.enabledRevision;
        if (typeof revision === 'number' && revision > value.enabledRevision) return row;
        return { ...row, enabled: value.enabled, enabledRevision: value.enabledRevision };
      }),
    );
    // Eligibility carries no revision: invalidate rather than invent current eligibility.
    await client.invalidateQueries({ queryKey: ['agent-eligibility'], refetchType: 'none' });
    if (active(captured)) {
      setObserved((previous) => (previous ? mergeAvailability(previous, value) : value));
      onObserved(value);
    }
  };
  const check = async () => {
    if (busyRef.current || revoked || !scope) return;
    busyRef.current = true;
    setBusy(true);
    setMessage('');
    const captured = availabilityEpoch();
    const controller = new AbortController();
    query.current?.abort();
    query.current = controller;
    try {
      refreshMarker(key);
      const rows = await api.get<unknown>('/agents', { signal: controller.signal });
      if (!active(captured)) return;
      if (!Array.isArray(rows)) throw new Error('invalid list');
      const matches = rows.filter((row) => row && typeof row === 'object' && row.id === agent.id);
      if (matches.length !== 1) throw new Error('invalid identity');
      const value = parseAvailability(matches[0], agent.id, agent.targetId);
      if (base && value.enabledRevision < base.enabledRevision) throw new Error('stale revision');
      if (base) mergeAvailability(base, value);
      await publish(value, captured);
      if (active(captured)) setMessage('已读取当前状态；这不证明原请求成功，未重新提交。');
    } catch {
      if (active(captured)) setMessage('核对失败或记录不可读；未发送启停请求。');
    } finally {
      if (active(captured)) {
        busyRef.current = false;
        setBusy(false);
        repaint((n) => n + 1);
      }
    }
  };
  const change = async (newIntent = false) => {
    if (!base || busyRef.current || revoked || !scope || base.enabledRevision >= 2_147_483_647)
      return;
    const captured = availabilityEpoch();
    let previous: Marker | undefined;
    try {
      previous = refreshMarker(key);
    } catch {
      setMessage('无法读取保护记录，本次未发送。');
      return;
    }
    if (
      previous?.phase === 'pending' ||
      (previous?.phase === 'settled' && base.enabledRevision < previous.revision)
    )
      return;
    if (
      previous?.phase === 'unknown' &&
      (!newIntent || !observed || observed.enabledRevision <= previous.revision)
    )
      return;
    const submitted = { enabled: !base.enabled, expectedRevision: base.enabledRevision };
    const pending: Marker = {
      phase: 'pending',
      revision: submitted.expectedRevision,
      target: submitted.enabled,
    };
    try {
      writeMarker(key, pending);
      owned.current = pending;
    } catch {
      setMessage('无法保存保护记录，本次未发送。');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await api.patch<unknown>(
        '/agents/' + encodeURIComponent(agent.id) + '/availability',
        submitted,
      );
      const value = parseAvailability(result, agent.id, agent.targetId);
      if (
        value.enabled !== submitted.enabled ||
        value.enabledRevision !== submitted.expectedRevision + 1
      )
        throw new Error('unconfirmed response');
      if (!active(captured) || readMarker(key) !== pending) return;
      if (
        !settleMarker(key, pending, {
          phase: 'settled',
          revision: value.enabledRevision,
          target: value.enabled,
        })
      ) {
        refreshMarker(key);
        setMessage('当前保护记录已变化，未覆盖较新操作；请只读核对。');
        return;
      }
      owned.current = null;
      try {
        await publish(value, captured);
        if (active(captured)) setMessage('本次启停设置已保存。');
      } catch {
        if (active(captured)) setMessage('本次启停设置已保存，但页面状态未同步；请只读核对。');
      }
    } catch {
      try {
        if (active(captured) && readMarker(key) === pending)
          settleMarker(key, pending, { ...pending, phase: 'unknown' });
      } catch {
        /* Durable pending restores as unknown. */
      }
      if (active(captured)) setMessage('启停结果未知，请只读核对；不会自动重试。');
    } finally {
      finishOwnedPending(key, pending);
      if (owned.current === pending) owned.current = null;
      if (active(captured)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const unknown = marker?.phase === 'unknown';
  const stale = marker?.phase === 'settled' && (!base || base.enabledRevision < marker.revision);
  const canNew =
    marker?.phase === 'unknown' && observed && observed.enabledRevision > marker.revision;
  return (
    <section className={styles.panel} aria-label="Agent 启停设置">
      <h2>接收新工作</h2>
      <p>禁用会阻止之后的新工作准入，不取消已准入或正在运行的工作；启用不代表连接检查通过。</p>
      <p>
        当前设置：{base ? (base.enabled ? '已启用' : '已禁用') : '待核对'}
        {base ? ' · 版本 ' + base.enabledRevision : ''}
      </p>
      {marker && marker.phase !== 'settled' ? (
        <p>
          原操作：版本 {marker.revision}，请求{marker.target ? '启用' : '禁用'}。结果
          {marker.phase === 'pending' ? '等待中' : '未知'}。
        </p>
      ) : null}
      {revoked ? <p role="alert">授权已变化，请重新进入后核对。</p> : null}
      {storageError ? <p role="alert">保护记录无法读取，不能提交启停设置。</p> : null}
      <div className={styles.actions}>
        <AhButton
          variant="default"
          disabled={
            !base ||
            stale ||
            busy ||
            revoked ||
            storageError ||
            marker?.phase === 'pending' ||
            unknown ||
            !scope ||
            base.enabledRevision >= 2_147_483_647
          }
          onClick={() => void change()}
        >
          {base?.enabled ? '禁用新工作' : '启用新工作'}
        </AhButton>
        <AhButton
          variant="default"
          disabled={busy || revoked || marker?.phase === 'pending' || !scope}
          onClick={() => void check()}
        >
          核对启停状态
        </AhButton>
        {canNew ? (
          <AhButton
            variant="default"
            disabled={busy || revoked || !base || base.enabledRevision >= 2_147_483_647}
            onClick={() => void change(true)}
          >
            基于当前版本{base?.enabled ? '禁用' : '启用'}（新操作）
          </AhButton>
        ) : null}
      </div>
      {unknown ? (
        <p>当前状态不是原请求的成功证明。只有核对到更高版本，才能明确发起新操作。</p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
