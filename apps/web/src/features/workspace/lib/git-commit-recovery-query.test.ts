import { expect, it, vi } from 'vitest';
import {
  gitCommitMarkerKey,
  readGitCommitRecovery,
  saveGitCommitMarker,
} from './git-commit-recovery';
import { queryGitCommitRecovery } from './git-commit-recovery-query';
const marker = {
  scope: 'local-trusted',
  projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};
function fixture() {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  saveGitCommitMarker(storage, marker);
  const response = {
    scope: marker.scope,
    operationId: marker.operationId,
    projectId: marker.projectId,
    protocolVersion: 1,
    requestHash: 'a'.repeat(64),
    phase: 'COMMAND_SUCCEEDED',
    commandExit: 0,
    observedAfterHead: 'c'.repeat(40),
    resultEvidence: { kind: 'COMMAND_EXIT_ZERO', headAttribution: 'OBSERVED_ONLY' },
    errorCode: null,
  };
  const get = vi.fn(async (): Promise<unknown> => response);
  const input = { storage, ...marker, isCurrent: () => true, get };
  return { input, get, storage, values, response };
}
it('仅认证GET恢复命令成功证据，清原marker但不返回精确SHA或payload', async () => {
  const f = fixture();
  const result = await queryGitCommitRecovery(f.input);
  expect(f.get).toHaveBeenCalledExactlyOnceWith(
    `/projects/${marker.projectId}/git/commit-operations/${marker.operationId}`,
  );
  expect(result).toEqual({
    revoked: false,
    locked: false,
    outcomes: [{ operationId: marker.operationId, state: 'completed' }],
  });
  expect(JSON.stringify(result)).not.toContain(f.response.observedAfterHead);
});
it('匹配当前认证scope的持久前置拒绝允许清除', async () => {
  const f = fixture();
  f.get.mockResolvedValue({
    ...f.response,
    phase: 'REJECTED_PREWRITE',
    commandExit: null,
    errorCode: 'GIT_HEAD_CHANGED',
  });
  expect(await queryGitCommitRecovery(f.input)).toMatchObject({
    locked: false,
    outcomes: [{ state: 'rejected' }],
  });
});
it.each(['RECEIVED', 'DISPATCHED', 'UNKNOWN'])('%s不删除marker且绝不重发写请求', async (phase) => {
  const f = fixture();
  f.get.mockResolvedValue({ ...f.response, phase });
  expect(await queryGitCommitRecovery(f.input)).toMatchObject({
    locked: true,
    outcomes: [{ state: phase === 'UNKNOWN' ? 'unknown' : 'pending' }],
  });
  expect(f.storage.removeItem).not.toHaveBeenCalled();
});
it.each([404, 401, 403, 500])('HTTP %s不推断未执行，不清marker', async (status) => {
  const f = fixture();
  f.get.mockRejectedValue({ status });
  expect(await queryGitCommitRecovery(f.input)).toMatchObject({
    locked: true,
    outcomes: [{ state: 'unavailable' }],
  });
  expect(f.storage.removeItem).not.toHaveBeenCalled();
});
it.each([
  { scope: 'account:forged' },
  { scope: undefined },
  { operationId: marker.projectId },
  { projectId: marker.operationId },
  { protocolVersion: 2 },
  { requestHash: 'invalid' },
  { commandExit: 1 },
  { observedAfterHead: 'short' },
  { resultEvidence: { kind: 'HEAD_CHANGED' } },
  { phase: 'SUCCEEDED' },
])('错误身份/协议/证据不解锁 %j', async (patch) => {
  const f = fixture();
  f.get.mockResolvedValue({ ...f.response, ...patch });
  expect(await queryGitCommitRecovery(f.input)).toMatchObject({
    locked: true,
    outcomes: [{ state: 'invalid' }],
  });
  expect(f.storage.removeItem).not.toHaveBeenCalled();
});
it('已有撤权不读存储或发GET，GET在途撤权不清除或暴露返回内容', async () => {
  const f = fixture();
  expect(await queryGitCommitRecovery({ ...f.input, isCurrent: () => false })).toEqual({
    revoked: true,
  });
  expect(f.get).not.toHaveBeenCalled();
  let active = true;
  f.get.mockImplementation(async () => {
    active = false;
    return f.response;
  });
  expect(await queryGitCommitRecovery({ ...f.input, isCurrent: () => active })).toEqual({
    revoked: true,
  });
  expect(f.storage.removeItem).not.toHaveBeenCalled();
});
it('损坏marker不猜operationId，storage失败不是空恢复状态', async () => {
  const f = fixture();
  f.values.set(gitCommitMarkerKey(marker), '{broken');
  expect(await queryGitCommitRecovery(f.input)).toMatchObject({
    locked: true,
    outcomes: [{ state: 'invalid' }],
  });
  expect(f.get).not.toHaveBeenCalled();
  await expect(
    queryGitCommitRecovery({
      ...f.input,
      storage: {
        ...f.storage,
        get length(): number {
          throw new Error('SecurityError');
        },
      },
    }),
  ).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
});
it('恢复期间新增另一op marker不会被清除，最后仍禁写', async () => {
  const f = fixture();
  const other = { ...marker, operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
  f.get.mockImplementation(async () => {
    f.values.set(gitCommitMarkerKey(other), JSON.stringify({ version: 1, ...other }));
    return f.response;
  });
  expect(await queryGitCommitRecovery(f.input)).toMatchObject({ locked: true });
  expect(
    readGitCommitRecovery(f.storage, marker.scope, marker.projectId).records[0]?.marker
      ?.operationId,
  ).toBe(other.operationId);
});
