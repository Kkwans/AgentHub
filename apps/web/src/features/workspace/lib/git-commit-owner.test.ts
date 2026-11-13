import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-error';
import { createGitCommitOwner, type GitCommitInput } from './git-commit-owner';

const input = (): GitCommitInput => ({
  projectId: 'project-a',
  paths: ['src/a.ts'],
  message: '原说明',
});
const receipt = { sha: 'a'.repeat(40) };
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const activeOwner = () => {
  const owner = createGitCommitOwner();
  owner.activate();
  return owner;
};

describe('跨消费者 Git 操作 owner 核心（尚未接入 UI）', () => {
  it('没有授权和无效输入不调用 transport', async () => {
    const owner = createGitCommitOwner();
    const send = vi.fn();
    await expect(owner.submit(input(), send)).rejects.toThrow('授权');
    owner.activate();
    await expect(owner.submit({ ...input(), paths: [] }, send)).rejects.toThrow('缺少');
    expect(send).not.toHaveBeenCalled();
  });
  it('同项目同步锁，其他项目独立；消费者消失后结果仍保存', async () => {
    const owner = activeOwner();
    const request = deferred();
    const send = vi.fn(() => request.promise);
    const unsubscribe = owner.subscribe(vi.fn());
    const first = owner.submit(input(), send);
    unsubscribe();
    await expect(owner.submit(input(), send)).rejects.toThrow('禁止重复');
    await owner.submit({ ...input(), projectId: 'project-b' }, async () => receipt);
    expect(owner.isLocked('project-a')).toBe(true);
    expect(owner.isLocked('project-b')).toBe(false);
    request.resolve(receipt);
    await first;
    expect(send).toHaveBeenCalledTimes(1);
    expect(owner.getSnapshot().map((item) => item.phase)).toEqual(['committed', 'committed']);
  });
  it('冻结原 project/paths/message，后续修改原对象不改变已发操作', async () => {
    const owner = activeOwner();
    const request = deferred();
    const original = { projectId: 'a', paths: ['one'], message: ' original ' };
    const send = vi.fn(() => request.promise);
    const pending = owner.submit(original, send);
    original.projectId = 'b';
    original.paths.push('two');
    original.message = 'later';
    expect(owner.getSnapshot()[0]?.input).toEqual({
      projectId: 'a',
      paths: ['one'],
      message: 'original',
    });
    expect(Object.isFrozen(owner.getSnapshot()[0]?.input.paths)).toBe(true);
    request.resolve(receipt);
    await pending;
  });
  it.each([
    new ApiError('HTTP_ERROR', '断线', 0),
    new ApiError('HTTP_ERROR', '代理', 502),
    new ApiError('GIT_COMMIT_FAILED', 'hook', 400),
    new ApiError('OTHER', '拒绝', 400),
    new Error('同步错误'),
  ])('不确定错误持续阻止新提交且不可 dismiss：%s', async (cause) => {
    const owner = activeOwner();
    const send = vi.fn(() => {
      throw cause;
    });
    const result = await owner.submit(input(), send);
    expect(result?.phase).toBe('unknown');
    expect(owner.isLocked('project-a')).toBe(true);
    expect(owner.dismiss(result!.id)).toBe(false);
    await expect(owner.submit({ ...input(), message: '新说明' }, send)).rejects.toThrow('禁止重复');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([null, undefined, {}, { sha: 'fake' }, { sha: '' }])(
    '畸形成功保留未知锁：%s',
    async (value) => {
      const owner = activeOwner();
      expect((await owner.submit(input(), async () => value))?.phase).toBe('unknown');
      expect(owner.isLocked('project-a')).toBe(true);
    },
  );
  it('唯一已审查前置拒绝释放锁，旧记录 dismiss 不影响新 pending', async () => {
    const owner = activeOwner();
    const rejected = await owner.submit(input(), async () => {
      throw new ApiError('GIT_COMMIT_PATHS_REQUIRED', '无路径', 400);
    });
    expect(rejected?.phase).toBe('rejected');
    const request = deferred();
    const pending = owner.submit(input(), () => request.promise);
    expect(owner.dismiss(rejected!.id)).toBe(true);
    expect(owner.isLocked('project-a')).toBe(true);
    request.resolve(receipt);
    await pending;
  });
  it.each(['resolve', 'reject'] as const)(
    '撤权再激活 ABA，旧%s不污染新操作、不调用刷新',
    async (method) => {
      const owner = activeOwner();
      const old = deferred();
      const fresh = deferred();
      const refresh = vi.fn();
      const previous = owner.submit(input(), () => old.promise, refresh);
      owner.revoke();
      expect(owner.getSnapshot()).toEqual([]);
      owner.activate();
      const next = owner.submit(input(), () => fresh.promise, refresh);
      old[method](method === 'resolve' ? receipt : new Error('旧失败'));
      expect(await previous).toBeUndefined();
      expect(owner.getSnapshot()).toHaveLength(1);
      expect(owner.getSnapshot()[0]?.phase).toBe('pending');
      expect(refresh).not.toHaveBeenCalled();
      fresh.resolve(receipt);
      await next;
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );
  it('同步订阅撤权发生在发送前时，不会继续 POST', async () => {
    const owner = activeOwner();
    const send = vi.fn();
    owner.subscribe(() => {
      if (owner.getSnapshot().some((item) => item.phase === 'pending')) owner.revoke();
    });
    expect(await owner.submit(input(), send)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
  it('缓存刷新抛错不把有效回执降级为未知，也不重发', async () => {
    const owner = activeOwner();
    const send = vi.fn(async () => receipt);
    await expect(
      owner.submit(input(), send, () => {
        throw new Error('刷新失败');
      }),
    ).rejects.toThrow('刷新失败');
    expect(owner.getSnapshot()[0]?.phase).toBe('committed');
    expect(owner.isLocked('project-a')).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('支持完整 SHA256 回执；快照只在变化时更换', async () => {
    const owner = activeOwner();
    const before = owner.getSnapshot();
    expect(owner.getSnapshot()).toBe(before);
    const result = await owner.submit(input(), async () => ({ sha: 'b'.repeat(64) }));
    expect(result?.phase).toBe('committed');
    expect(owner.getSnapshot()).not.toBe(before);
    expect(Object.isFrozen(owner.getSnapshot())).toBe(true);
  });
});

it.each(['committed', 'unknown', 'rejected'] as const)(
  '发布%s终态时同步撤权/ABA不把旧结果返给consumer',
  async (phase) => {
    const owner = activeOwner();
    const refresh = vi.fn();
    owner.subscribe(() => {
      if (owner.getSnapshot().some((record) => record.phase === phase)) {
        owner.revoke();
        owner.activate();
      }
    });
    const result = await owner.submit(
      input(),
      async () => {
        if (phase === 'unknown') throw new Error('断线');
        if (phase === 'rejected') throw new ApiError('GIT_COMMIT_PATHS_REQUIRED', '无路径', 400);
        return receipt;
      },
      refresh,
    );
    expect(result).toBeUndefined();
    expect(owner.getSnapshot()).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  },
);
it('刷新钩子同步撤权后不向consumer返回旧结果', async () => {
  const owner = activeOwner();
  expect(
    await owner.submit(
      input(),
      async () => receipt,
      () => owner.revoke(),
    ),
  ).toBeUndefined();
});

it('异步刷新错误有消费者且不降级已提交记录', async () => {
  const owner = activeOwner();
  await expect(
    owner.submit(
      input(),
      async () => receipt,
      async () => {
        throw new Error('异步刷新失败');
      },
    ),
  ).rejects.toThrow('异步刷新失败');
  expect(owner.getSnapshot()[0]?.phase).toBe('committed');
});
it('异步刷新期间撤权，不将旧刷新错误传给新身份', async () => {
  const owner = activeOwner();
  const refresh = deferred();
  const pending = owner.submit(
    input(),
    async () => receipt,
    async () => {
      await refresh.promise;
    },
  );
  await Promise.resolve();
  owner.revoke();
  owner.activate();
  refresh.reject(new Error('旧刷新失败'));
  expect(await pending).toBeUndefined();
  expect(owner.getSnapshot()).toEqual([]);
});
