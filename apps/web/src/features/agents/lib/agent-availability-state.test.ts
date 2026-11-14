// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import {
  availabilityKey,
  mergeAvailability,
  parseAvailability,
  readMarker,
  refreshMarker,
  resetAvailabilityForTests,
  settleMarker,
  writeMarker,
} from './agent-availability-state';
afterEach(resetAvailabilityForTests);
const key = availabilityKey('owner', 'agent', 'target');
it('whitelists persisted metadata and distinguishes owner/Agent/target', () => {
  writeMarker(key, { phase: 'pending', revision: 4, target: false, prompt: 'secret' } as never);
  expect(JSON.parse(localStorage.getItem('agenthub.agent-availability.v1:' + key)!)).toEqual({
    phase: 'pending',
    revision: 4,
    target: false,
  });
  expect(readMarker(availabilityKey('other', 'agent', 'target'))).toBeUndefined();
  expect(readMarker(availabilityKey('owner', 'other', 'target'))).toBeUndefined();
  expect(readMarker(availabilityKey('owner', 'agent', 'other'))).toBeUndefined();
});
it('external settled cannot confirm our unresolved attempt or become a new unresolved floor', () => {
  writeMarker(key, { phase: 'unknown', revision: 1, target: false });
  localStorage.setItem(
    'agenthub.agent-availability.v1:' + key,
    JSON.stringify({ phase: 'settled', revision: 3, target: true }),
  );
  expect(refreshMarker(key)).toEqual({ phase: 'unknown', revision: 1, target: false });
});
it('same revision other target cannot be settled or cleaned up', () => {
  const old = { phase: 'pending', revision: 1, target: false } as const;
  writeMarker(key, old);
  localStorage.setItem(
    'agenthub.agent-availability.v1:' + key,
    JSON.stringify({ phase: 'pending', revision: 1, target: true }),
  );
  expect(settleMarker(key, old, { ...old, phase: 'unknown' })).toBe(false);
});
it('older availability never regresses and equal-version disagreement is rejected', () => {
  const current = { id: 'agent', targetId: 'target', enabled: false, enabledRevision: 3 };
  expect(mergeAvailability(current, { ...current, enabled: true, enabledRevision: 2 })).toBe(
    current,
  );
  expect(() => mergeAvailability(current, { ...current, enabled: true })).toThrow();
});
it.each([undefined, -1, 0.5, 2147483648])(
  'rejects missing/invalid revision %s',
  (enabledRevision) => {
    expect(() =>
      parseAvailability(
        { id: 'agent', targetId: 'target', enabled: true, enabledRevision },
        'agent',
        'target',
      ),
    ).toThrow();
  },
);
