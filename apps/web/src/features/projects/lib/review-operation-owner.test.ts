import { describe, expect, it } from 'vitest';
import {
  createReviewOperationOwner,
  hasReviewOperationLock,
  type ReviewOwnerView,
} from './review-operation-owner';
import type { ReviewOperationSnapshot } from '../components/review-operation';
const identity = { projectId: 'p1', taskId: 't1' };
const view: ReviewOwnerView = {
  ...identity,
  routeKey: '/projects/p1/work?task=t1',
  viewport: 'phone',
  visible: true,
};
const snapshot = (
  operationId: string,
  phase: ReviewOperationSnapshot['phase'],
  extra = {},
): ReviewOperationSnapshot => ({
  ...identity,
  operationId,
  phase,
  message: 'operation state',
  ...extra,
});
function setup() {
  const owner = createReviewOperationOwner();
  owner.setScope('account:user-a');
  owner.setView(view);
  return owner;
}
describe('review operation owner', () => {
  it('requires explicit auth scope and rejects late callbacks after logout/login even to same account', () => {
    const owner = createReviewOperationOwner();
    const anonymous = owner.bind(identity);
    anonymous.onOperationChange(snapshot('a', 'pending'));
    expect(owner.getSnapshot()).toEqual([]);
    expect(anonymous.canAutoNavigate()).toBe(false);
    owner.setScope('account:user-a');
    owner.setView(view);
    const old = owner.bind(identity);
    old.onOperationChange(snapshot('a', 'pending'));
    owner.setScope(null);
    owner.setScope('account:user-a');
    owner.setView(view);
    old.onOperationChange(snapshot('a', 'resolved', { resultHref: '/workspace/old' }));
    expect(owner.getSnapshot()).toEqual([]);
    expect(old.canAutoNavigate()).toBe(false);
    owner.bind(identity).onOperationChange(snapshot('new', 'pending'));
    expect(hasReviewOperationLock(owner.getSnapshot())).toBe(true);
  });
  it('keeps independent operation tokens locked and rejects identity mismatches', () => {
    const owner = setup();
    const contract = owner.bind(identity);
    contract.onOperationChange(snapshot('a', 'pending'));
    contract.onOperationChange(snapshot('b', 'pending'));
    contract.onOperationChange(snapshot('a', 'resolved', { resultHref: '/workspace/a' }));
    expect(hasReviewOperationLock(owner.getSnapshot())).toBe(true);
    contract.onOperationChange(snapshot('b', 'resolved', { taskId: 'foreign' }));
    expect(hasReviewOperationLock(owner.getSnapshot())).toBe(true);
    contract.onOperationChange(snapshot('b', 'unknown'));
    contract.onOperationChange(snapshot('b', 'checking'));
    contract.onOperationChange(snapshot('b', 'unknown'));
    expect(hasReviewOperationLock(owner.getSnapshot(), 'p1', 't1')).toBe(true);
    expect(hasReviewOperationLock(owner.getSnapshot(), 'p2')).toBe(false);
    contract.onOperationChange(snapshot('b', 'retryable'));
    expect(hasReviewOperationLock(owner.getSnapshot())).toBe(false);
    contract.onOperationChange(snapshot('a', 'unknown'));
    expect(hasReviewOperationLock(owner.getSnapshot())).toBe(false);
  });
  it('retains verified results when route-owned subscribers detach and late responses arrive', () => {
    const owner = setup();
    const contract = owner.bind(identity);
    const unsubscribe = owner.subscribe(() => undefined);
    contract.onOperationChange(snapshot('a', 'pending'));
    unsubscribe();
    owner.setView(null);
    contract.onOperationChange(snapshot('a', 'resolved', { resultHref: '/workspace/result' }));
    expect(owner.getSnapshot()[0]).toMatchObject({
      resultHref: '/workspace/result',
      operationId: 'a',
    });
    expect(contract.canAutoNavigate()).toBe(false);
  });
  it.each(['hidden', 'route', 'task', 'viewport'] as const)(
    'never re-enables a captured navigation gate after %s changes and returns',
    (change) => {
      const owner = setup();
      const old = owner.bind(identity);
      expect(old.canAutoNavigate()).toBe(true);
      owner.setView(
        change === 'hidden'
          ? { ...view, visible: false }
          : change === 'route'
            ? { ...view, routeKey: '/projects/p1/overview' }
            : change === 'task'
              ? { ...view, taskId: 't2' }
              : { ...view, viewport: 'wide' },
      );
      owner.setView(view);
      expect(old.canAutoNavigate()).toBe(false);
      expect(owner.bind(identity).canAutoNavigate()).toBe(true);
    },
  );
  it('keeps the gate valid for identical render contexts and retains snapshots immutably', () => {
    const owner = setup();
    const c = owner.bind(identity);
    owner.setView({ ...view });
    expect(c.canAutoNavigate()).toBe(true);
    c.onOperationChange(snapshot('a', 'pending'));
    const before = owner.getSnapshot();
    c.onOperationChange(snapshot('a', 'resolved', { resultHref: '/workspace/a' }));
    expect(before[0]?.phase).toBe('pending');
    expect(Object.isFrozen(owner.getSnapshot())).toBe(true);
    expect(Object.isFrozen(owner.getSnapshot()[0])).toBe(true);
  });
  it('does not expose external result URLs or accept unregistered terminal operations', () => {
    const owner = setup();
    const c = owner.bind(identity);
    c.onOperationChange(snapshot('unregistered', 'resolved', { resultHref: '/workspace/no' }));
    expect(owner.getSnapshot()).toEqual([]);
    c.onOperationChange(snapshot('a', 'pending'));
    c.onOperationChange(snapshot('a', 'unknown', { resultHref: '/workspace/no' }));
    expect(owner.getSnapshot()[0]?.resultHref).toBeUndefined();
    c.onOperationChange(snapshot('a', 'resolved', { resultHref: 'https://external.test' }));
    expect(owner.getSnapshot()[0]?.resultHref).toBeUndefined();
  });
});

it('dismisses only terminal results and tombstones old tokens without releasing newer locks', () => {
  const owner = setup();
  const contract = owner.bind(identity);
  contract.onOperationChange(snapshot('old', 'pending'));
  expect(owner.dismiss(identity, 'old')).toBe(false);
  contract.onOperationChange(snapshot('old', 'unknown'));
  expect(owner.dismiss(identity, 'old')).toBe(false);
  contract.onOperationChange(snapshot('old', 'checking'));
  expect(owner.dismiss(identity, 'old')).toBe(false);
  contract.onOperationChange(snapshot('old', 'resolved', { resultHref: '/workspace/old' }));
  contract.onOperationChange(snapshot('new', 'pending'));
  expect(owner.dismiss({ ...identity, taskId: 'foreign' }, 'old')).toBe(false);
  expect(owner.dismiss(identity, 'old')).toBe(true);
  contract.onOperationChange(snapshot('old', 'pending'));
  contract.onOperationChange(snapshot('old', 'resolved', { resultHref: '/workspace/old' }));
  expect(owner.getSnapshot().map((record) => record.operationId)).toEqual(['new']);
  expect(hasReviewOperationLock(owner.getSnapshot())).toBe(true);
});

it.each([
  ['phone', 'tablet'],
  ['tablet', 'wide'],
] as const)('跨%s→%s再返回不会恢复原导航门', (from, to) => {
  const owner = setup();
  owner.setView({ ...view, viewport: from });
  const original = owner.bind(identity);
  expect(original.canAutoNavigate()).toBe(true);
  owner.setView({ ...view, viewport: to });
  owner.setView({ ...view, viewport: from });
  expect(original.canAutoNavigate()).toBe(false);
  expect(owner.bind(identity).canAutoNavigate()).toBe(true);
});
