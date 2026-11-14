import { authSession, type AgentRecord } from '../../../lib/api';
export type Availability = Pick<AgentRecord, 'id' | 'targetId' | 'enabled'> & {
  enabledRevision: number;
};
export type Marker = {
  phase: 'pending' | 'unknown' | 'settled';
  revision: number;
  target: boolean;
};
const prefix = 'agenthub.agent-availability.v1:';
const records = new Map<string, Marker>();
const listeners = new Set<() => void>();
let epoch = 0;
let installed = false;
export const availabilityEpoch = () => epoch;
export const availabilityKey = (scope: string, id: string, targetId: string) =>
  JSON.stringify([scope, id, targetId]);
export function parseAvailability(value: unknown, id: string, targetId: string): Availability {
  const row = value as Availability | null;
  if (
    !row ||
    row.id !== id ||
    row.targetId !== targetId ||
    typeof row.enabled !== 'boolean' ||
    !Number.isInteger(row.enabledRevision) ||
    row.enabledRevision < 0 ||
    row.enabledRevision > 2_147_483_647
  )
    throw new Error('Agent 启停状态或身份无法确认。');
  return { id, targetId, enabled: row.enabled, enabledRevision: row.enabledRevision };
}
export function mergeAvailability<T extends Availability>(previous: T, incoming: Availability): T {
  if (
    previous.id !== incoming.id ||
    previous.targetId !== incoming.targetId ||
    previous.enabledRevision > incoming.enabledRevision
  )
    return previous;
  if (
    previous.enabledRevision === incoming.enabledRevision &&
    previous.enabled !== incoming.enabled
  )
    throw new Error('同一启停版本返回了不同状态。');
  return { ...previous, enabled: incoming.enabled, enabledRevision: incoming.enabledRevision };
}
export function readMarker(key: string): Marker | undefined {
  if (records.has(key)) return records.get(key);
  const raw = localStorage.getItem(prefix + key);
  if (!raw) return undefined;
  const value = JSON.parse(raw) as Marker;
  if (
    !value ||
    !['pending', 'unknown', 'settled'].includes(value.phase) ||
    !Number.isInteger(value.revision) ||
    value.revision < 0 ||
    value.revision > 2_147_483_647 ||
    typeof value.target !== 'boolean'
  )
    throw new Error('启停保护记录无法读取。');
  const restored: Marker = {
    phase: value.phase === 'pending' ? 'unknown' : value.phase,
    revision: value.revision,
    target: value.target,
  };
  records.set(key, restored);
  return restored;
}
export function refreshMarker(key: string) {
  const previous = records.get(key);
  records.delete(key);
  try {
    const restored = readMarker(key);
    if (previous && previous.phase !== 'settled') {
      // Never lower the unresolved revision floor or attribute another tab's success.
      records.set(
        key,
        restored && restored.phase !== 'settled' && restored.revision > previous.revision
          ? { ...restored, phase: 'unknown' }
          : previous,
      );
    }
    return records.get(key) ?? restored;
  } catch (error) {
    if (previous) records.set(key, previous);
    throw error;
  }
}
export function writeMarker(key: string, value: Marker) {
  const raw = JSON.stringify({
    phase: value.phase,
    revision: value.revision,
    target: value.target,
  });
  localStorage.setItem(prefix + key, raw);
  if (localStorage.getItem(prefix + key) !== raw) throw new Error('无法保存启停保护记录。');
  records.set(key, value);
  listeners.forEach((listener) => listener());
}
export function subscribeAvailability(listener: () => void) {
  if (!installed) {
    installed = true;
    authSession.onAuthorizationRequired(() => {
      epoch += 1;
      for (const [key, marker] of records)
        if (marker.phase === 'pending') records.set(key, { ...marker, phase: 'unknown' });
      listeners.forEach((notify) => notify());
    });
    window.addEventListener('storage', (event) => {
      if (!event.key?.startsWith(prefix)) return;
      try {
        refreshMarker(event.key.slice(prefix.length));
      } catch {
        /* Admission rereads and fails closed. */
      }
      listeners.forEach((notify) => notify());
    });
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function resetAvailabilityForTests() {
  records.clear();
  for (const key of Object.keys(localStorage))
    if (key.startsWith(prefix)) localStorage.removeItem(key);
}
/** A response/cleanup may only settle the still-owned durable attempt. Not a cross-tab lock. */
export function settleMarker(key: string, expected: Marker, next: Marker): boolean {
  const raw = localStorage.getItem(prefix + key);
  if (!raw) return false;
  const current = JSON.parse(raw) as Marker;
  if (
    !current ||
    current.revision !== expected.revision ||
    current.target !== expected.target ||
    !['pending', 'unknown'].includes(current.phase)
  )
    return false;
  const memory = records.get(key);
  if (memory && (memory.revision !== expected.revision || memory.target !== expected.target))
    return false;
  writeMarker(key, next);
  return true;
}
/** End local waiting without claiming or overwriting another tab's durable outcome. */
export function finishOwnedPending(key: string, expected: Marker) {
  const current = records.get(key);
  if (
    current?.phase === 'pending' &&
    current.revision === expected.revision &&
    current.target === expected.target
  ) {
    records.set(key, { ...current, phase: 'unknown' });
  }
  try {
    refreshMarker(key);
  } catch {
    /* Preserve memory unknown; next admission fails closed. */
  }
  listeners.forEach((notify) => notify());
}
