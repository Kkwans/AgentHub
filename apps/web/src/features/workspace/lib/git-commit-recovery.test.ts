import { expect, it, vi } from 'vitest';
import {
  clearGitCommitMarker,
  gitCommitMarkerKey,
  readGitCommitRecovery,
  saveGitCommitMarker,
  type GitRecoveryIdentity,
  type GitRecoveryStorage,
} from './git-commit-recovery';
const identity: GitRecoveryIdentity = {
  scope: 'account:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};
const otherOperation = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function storage() {
  const values = new Map<string, string>();
  const adapter: GitRecoveryStorage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  return { adapter, values };
}
const proof = (phase = 'COMMAND_SUCCEEDED') => ({ ...identity, phase });
it('首次持久化只有四个身份字段且写后读回；项目有marker即锁定', () => {
  const { adapter, values } = storage();
  const marker = saveGitCommitMarker(adapter, {
    ...identity,
    message: '禁止保存',
    paths: ['secret'],
    token: '禁止保存',
  } as GitRecoveryIdentity);
  expect(Object.keys(marker)).toEqual(['version', 'scope', 'projectId', 'operationId']);
  expect(values.get(gitCommitMarkerKey(identity))).toBe(JSON.stringify(marker));
  expect(adapter.getItem).toHaveBeenCalledWith(gitCommitMarkerKey(identity));
  expect(readGitCommitRecovery(adapter, identity.scope, identity.projectId)).toEqual({
    records: [{ key: gitCommitMarkerKey(identity), marker }],
    locked: true,
  });
});
it('重开共享storage仍锁定；同op或换op都不能将恢复记录当成新派发许可', () => {
  const { adapter } = storage();
  saveGitCommitMarker(adapter, identity);
  expect(readGitCommitRecovery(adapter, identity.scope, identity.projectId).locked).toBe(true);
  expect(() => saveGitCommitMarker(adapter, identity)).toThrow();
  expect(() =>
    saveGitCommitMarker(adapter, { ...identity, operationId: otherOperation }),
  ).toThrow();
  expect(adapter.setItem).toHaveBeenCalledTimes(1);
});
it('UUID大小写归一到相同key，不产生别名绕锁', () => {
  const { adapter } = storage();
  const upper = {
    ...identity,
    scope: `account:${identity.scope.slice(8).toUpperCase()}`,
    projectId: identity.projectId.toUpperCase(),
    operationId: identity.operationId.toUpperCase(),
  };
  expect(saveGitCommitMarker(adapter, upper)).toEqual({ version: 1, ...identity });
  expect(() => saveGitCommitMarker(adapter, identity)).toThrow();
});
it.each(['unknown-scope', '', 'account:invalid'])('非法scope不读写storage：%s', (scope) => {
  const { adapter } = storage();
  expect(() => saveGitCommitMarker(adapter, { ...identity, scope })).toThrow();
  expect(adapter.setItem).not.toHaveBeenCalled();
  expect(adapter.getItem).not.toHaveBeenCalled();
});
it.each([
  '{broken',
  JSON.stringify({ version: 2, ...identity }),
  JSON.stringify({ version: 1, ...identity, payload: 'no' }),
  'x'.repeat(1025),
])('损坏/不兼容/额外字段/超长记录保留并锁定：%s', (raw) => {
  const { adapter, values } = storage();
  const key = gitCommitMarkerKey(identity);
  values.set(key, raw);
  expect(readGitCommitRecovery(adapter, identity.scope, identity.projectId)).toEqual({
    records: [{ key, marker: null }],
    locked: true,
  });
  expect(() =>
    saveGitCommitMarker(adapter, { ...identity, operationId: otherOperation }),
  ).toThrow();
  expect(() => clearGitCommitMarker(adapter, identity, proof())).toThrow();
  expect(values.get(key)).toBe(raw);
});
it('同project前缀下畸形operation key仍锁定，外scope内容绝不读取或返回', () => {
  const { adapter, values } = storage();
  const prefix = gitCommitMarkerKey(identity).slice(0, -36);
  values.set(`${prefix}invalid-operation`, '{}');
  const foreign = { ...identity, scope: 'local-trusted' };
  const foreignKey = gitCommitMarkerKey(foreign);
  values.set(foreignKey, '秘密内容');
  const state = readGitCommitRecovery(adapter, identity.scope, identity.projectId);
  expect(state.locked).toBe(true);
  expect(state.records).toHaveLength(1);
  expect(adapter.getItem).not.toHaveBeenCalledWith(foreignKey);
  expect(JSON.stringify(state)).not.toContain('秘密');
});
it.each(['RECEIVED', 'DISPATCHED', 'UNKNOWN', '404', 'NETWORK_ERROR', 'SUCCEEDED'])(
  '非精确server终态不清除：%s',
  (phase) => {
    const { adapter } = storage();
    saveGitCommitMarker(adapter, identity);
    expect(clearGitCommitMarker(adapter, identity, proof(phase))).toBe(false);
    expect(adapter.removeItem).not.toHaveBeenCalled();
    expect(readGitCommitRecovery(adapter, identity.scope, identity.projectId).locked).toBe(true);
  },
);
it.each(['COMMAND_SUCCEEDED', 'REJECTED_PREWRITE'])(
  '匹配owner/project/op终态只清该marker：%s',
  (phase) => {
    const { adapter, values } = storage();
    saveGitCommitMarker(adapter, identity);
    const second = { version: 1 as const, ...identity, operationId: otherOperation };
    values.set(gitCommitMarkerKey(second), JSON.stringify(second));
    expect(clearGitCommitMarker(adapter, identity, proof(phase))).toBe(true);
    const remaining = readGitCommitRecovery(adapter, identity.scope, identity.projectId);
    expect(remaining.locked).toBe(true);
    expect(remaining.records[0]?.marker).toEqual(second);
  },
);
it.each([
  { ...proof(), scope: 'local-trusted' },
  { ...proof(), projectId: otherOperation },
  { ...proof(), operationId: otherOperation },
  null,
  { status: 404 },
  { ...proof(), phase: { toString: (): string => 'COMMAND_SUCCEEDED' } },
])('错owner/project/op或畸形proof绝不清除', (result) => {
  const { adapter } = storage();
  saveGitCommitMarker(adapter, identity);
  expect(clearGitCommitMarker(adapter, identity, result)).toBe(false);
  expect(adapter.removeItem).not.toHaveBeenCalled();
});
it('storage不可用不是fresh unlock，写成功响应丢失仍恢复锁定', () => {
  const { adapter, values } = storage();
  const blocked = {
    ...adapter,
    get length() {
      return adapter.length;
    },
    getItem: () => {
      throw new Error('SecurityError');
    },
  };
  values.set(gitCommitMarkerKey(identity), '{}');
  expect(() => readGitCommitRecovery(blocked, identity.scope, identity.projectId)).toThrow();
  values.clear();
  const uncertain = {
    ...adapter,
    setItem: (key: string, value: string) => {
      values.set(key, value);
      throw new Error('响应丢失');
    },
  };
  expect(() => saveGitCommitMarker(uncertain, identity)).toThrow();
  expect(readGitCommitRecovery(adapter, identity.scope, identity.projectId).locked).toBe(true);
});
it('静默写失败、读回不符禁止dispatch，静默删除失败不能声称完成', () => {
  const { adapter } = storage();
  expect(() => saveGitCommitMarker({ ...adapter, setItem: () => undefined }, identity)).toThrow();
  saveGitCommitMarker(adapter, identity);
  expect(() =>
    clearGitCommitMarker({ ...adapter, removeItem: () => undefined }, identity, proof()),
  ).toThrow();
  expect(readGitCommitRecovery(adapter, identity.scope, identity.projectId).locked).toBe(true);
});
it('storage枚举变化/超界failclosed，不截断为无记录', () => {
  const { adapter } = storage();
  expect(() =>
    readGitCommitRecovery(
      { ...adapter, length: 1, key: () => null },
      identity.scope,
      identity.projectId,
    ),
  ).toThrow();
  expect(() =>
    readGitCommitRecovery({ ...adapter, length: 10_001 }, identity.scope, identity.projectId),
  ).toThrow();
});
it('每op独立key避免覆盖，检测到并发新增marker时保留两者且拒绝dispatch', () => {
  const { adapter, values } = storage();
  const other = { version: 1 as const, ...identity, operationId: otherOperation };
  const racing: GitRecoveryStorage = {
    get length() {
      return adapter.length;
    },
    key: adapter.key,
    getItem: adapter.getItem,
    removeItem: adapter.removeItem,
    setItem(key, value) {
      adapter.setItem(key, value);
      values.set(gitCommitMarkerKey(other), JSON.stringify(other));
    },
  };
  expect(() => saveGitCommitMarker(racing, identity)).toThrow();
  expect(values.size).toBe(2);
  expect(readGitCommitRecovery(adapter, identity.scope, identity.projectId).records).toHaveLength(
    2,
  );
});

it('空storage的读取权限失败不能被解释为无历史记录', () => {
  const { adapter } = storage();
  expect(() =>
    readGitCommitRecovery(
      {
        ...adapter,
        getItem: () => {
          throw new Error('denied');
        },
      },
      identity.scope,
      identity.projectId,
    ),
  ).toThrow();
});
it('同scope超长key拒绝而不是向consumer传递无界数据', () => {
  const { adapter, values } = storage();
  values.set(`${gitCommitMarkerKey(identity)}${'x'.repeat(512)}`, '{}');
  expect(() => readGitCommitRecovery(adapter, identity.scope, identity.projectId)).toThrow();
});
