import { expect, it, vi, afterEach } from 'vitest';
import { api } from '../../../lib/api';
import { createBindingOperationOwner } from './binding-operation-owner';
vi.mock('../../../lib/api', () => ({ api: { post: vi.fn() } }));
afterEach(() => vi.clearAllMocks());
const payload = {
  promptId: 'p1',
  targetType: 'PROJECT',
  targetId: 't1',
  selectorType: 'VERSION',
  versionId: 'v1',
  slot: 'SYSTEM',
  priority: 0,
};
const input = { payload, auth: 'token:a', promptName: 'Prompt', targetName: 'Target' };
it('revoke→activate是新授权epoch，旧响应不能复活或解锁新请求', async () => {
  const invalidate = vi.fn();
  const owner = createBindingOperationOwner(invalidate);
  const responses: Array<(value: unknown) => void> = [];
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        responses.push(resolve);
      }),
  );
  owner.activate();
  const old = owner.submit(input);
  const firstEpoch = owner.getEpoch();
  owner.revoke();
  owner.activate();
  expect(owner.getEpoch()).toBeGreaterThan(firstEpoch);
  const newer = owner.submit(input);
  responses[0]!({ id: 'old', enabled: true, ...payload });
  await old;
  expect(invalidate).not.toHaveBeenCalled();
  expect(owner.getSnapshot().records).toHaveLength(1);
  expect(owner.getSnapshot().records[0]?.phase).toBe('pending');
  await expect(owner.submit(input)).rejects.toThrow('请勿重复');
  responses[1]!({ id: 'new', enabled: true, ...payload });
  await newer;
  expect(owner.getSnapshot().records[0]?.bindingId).toBe('new');
  expect(invalidate).toHaveBeenCalledExactlyOnceWith('p1');
});
it('快照、record与冻结payload只读，消费者不能篡改验证身份或锁', async () => {
  const owner = createBindingOperationOwner(vi.fn());
  let resolve!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  owner.activate();
  const pending = owner.submit(input);
  const snapshot = owner.getSnapshot();
  expect(owner.getSnapshot()).toBe(snapshot);
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.records)).toBe(true);
  expect(Object.isFrozen(snapshot.records[0])).toBe(true);
  expect(Object.isFrozen(snapshot.records[0]?.payload)).toBe(true);
  expect(() => Object.assign(snapshot.records[0]!.payload, { targetId: 'other' })).toThrow();
  owner.dismiss(snapshot.records[0]!.id);
  expect(owner.getSnapshot().records).toHaveLength(1);
  resolve({ id: 'saved', enabled: true, ...payload });
  await pending;
  expect(owner.getSnapshot().records[0]?.phase).toBe('saved');
});
