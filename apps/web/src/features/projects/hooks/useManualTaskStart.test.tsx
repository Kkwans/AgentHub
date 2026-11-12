// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, authSession } from '../../../lib/api';
import { useManualTaskStart } from './useManualTaskStart';
vi.mock('../../../lib/api', async () => ({
  api: { get: vi.fn(), post: vi.fn() },
  authSession: (await import('../../../lib/auth-api')).authSession,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const row = { id: 'task-a', projectId: 'project-a', status: 'BACKLOG' };
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function mount() {
  return renderHook(({ id, scope }) => useManualTaskStart(row.projectId, id, scope, vi.fn()), {
    initialProps: { id: row.id, scope: 'account:a' },
  });
}
function setup(status = 'BACKLOG') {
  vi.mocked(api.get).mockResolvedValue({ ...row, status });
  vi.mocked(api.post).mockImplementation(
    async (_path, input) => ({ ...row, status: (input as { status: string }).status }) as never,
  );
}
it.each(['BACKLOG', 'READY'])('%s遵循合法状态路径且不启动Agent', async (status) => {
  setup(status);
  const h = mount();
  await act(async () => {
    await h.result.current.begin();
  });
  expect(vi.mocked(api.post).mock.calls.map(([path, body]) => [path, body])).toEqual(
    (status === 'BACKLOG' ? ['READY', 'IN_PROGRESS'] : ['IN_PROGRESS']).map((next) => [
      '/tasks/task-a/transition',
      { status: next },
    ]),
  );
  expect(h.result.current.status).toBe('IN_PROGRESS');
  expect(h.result.current.message).toContain('没有启动 Agent');
});
it('同帧双击只执行一组状态写入', async () => {
  setup();
  const query = deferred();
  vi.mocked(api.get).mockReturnValueOnce(query.promise as never);
  const h = mount();
  let first!: Promise<void>, second!: Promise<void>;
  act(() => {
    first = h.result.current.begin();
    second = h.result.current.begin();
  });
  await act(async () => {
    query.resolve(row);
    await Promise.all([first, second]);
  });
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledTimes(2);
});
it.each(['READY', 'IN_PROGRESS'])('%s响应丢失停止后续写入，查询不自动重试', async (failedAt) => {
  setup();
  let actual = 'BACKLOG';
  vi.mocked(api.get).mockImplementation(async () => ({ ...row, status: actual }) as never);
  vi.mocked(api.post).mockImplementation(async (_path, input) => {
    actual = (input as { status: string }).status;
    if (actual === failedAt) throw new Error('response lost');
    return { ...row, status: actual } as never;
  });
  const h = mount();
  await act(async () => {
    await h.result.current.begin();
  });
  expect(h.result.current.unknown).toBe(true);
  const writes = vi.mocked(api.post).mock.calls.length;
  await act(async () => {
    await h.result.current.begin();
  });
  expect(api.post).toHaveBeenCalledTimes(writes);
  await act(async () => {
    await h.result.current.check();
  });
  expect(api.post).toHaveBeenCalledTimes(writes);
  if (failedAt === 'READY') {
    expect(h.result.current.unknown).toBe(true);
    expect(h.result.current.status).toBe('READY');
    vi.mocked(api.post).mockResolvedValue({ ...row, status: 'IN_PROGRESS' });
    await act(async () => {
      await h.result.current.begin();
    });
    expect(vi.mocked(api.post).mock.calls.at(-1)?.[1]).toEqual({ status: 'IN_PROGRESS' });
  } else expect(h.result.current.unknown).toBe(false);
});
it('查询BACKLOG不意味着旧请求结束，保持显式继续且不自动写', async () => {
  setup();
  vi.mocked(api.post).mockRejectedValueOnce(new Error('unknown'));
  const h = mount();
  await act(async () => {
    await h.result.current.begin();
  });
  await act(async () => {
    await h.result.current.check();
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(h.result.current.unknown).toBe(true);
  expect(h.result.current.message).toContain('查询不代表先前请求已结束');
});
it.each(['identity', 'status', 'session'])('异常%s响应不能继续第二步', async (kind) => {
  setup();
  vi.mocked(api.post).mockResolvedValue({
    ...row,
    status: 'READY',
    ...(kind === 'identity'
      ? { id: 'wrong' }
      : kind === 'status'
        ? { status: 'CANCELED' }
        : { sessionId: 'session' }),
  });
  const h = mount();
  await act(async () => {
    await h.result.current.begin();
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(h.result.current.unknown).toBe(true);
});
it.each(['CANCELED', 'DONE', 'IN_PROGRESS'])('当前%s只核对，不重复写', async (status) => {
  setup(status);
  const h = mount();
  await act(async () => {
    await h.result.current.begin();
  });
  expect(api.post).not.toHaveBeenCalled();
});
it('已有Agent归属不能误称为手工开始', async () => {
  setup();
  vi.mocked(api.get).mockResolvedValue({ ...row, assignedAgentId: 'agent' });
  const h = mount();
  await act(async () => {
    await h.result.current.begin();
  });
  expect(api.post).not.toHaveBeenCalled();
});
it.each(['switch', 'return', 'unmount'])(
  '导航%s后迟到的第一步不能续写或覆盖当前任务',
  async (mode) => {
    setup();
    const response = deferred();
    vi.mocked(api.post).mockReturnValueOnce(response.promise as never);
    const h = mount();
    let pending!: Promise<void>;
    await act(async () => {
      pending = h.result.current.begin();
    });
    if (mode === 'unmount') h.unmount();
    else {
      h.rerender({ id: 'task-b', scope: 'account:a' });
      if (mode === 'return') h.rerender({ id: row.id, scope: 'account:a' });
    }
    await act(async () => {
      response.resolve({ ...row, status: 'READY' });
      await pending;
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    if (mode === 'switch') expect(h.result.current.message).toBe('');
    if (mode === 'return') {
      expect(h.result.current.unknown).toBe(true);
      await act(async () => {
        await h.result.current.begin();
      });
      expect(api.post).toHaveBeenCalledTimes(1);
    }
  },
);
it('身份不匹配或查询失败不写入，保留查询入口', async () => {
  setup();
  vi.mocked(api.get).mockResolvedValue({ ...row, projectId: 'wrong' });
  const h = mount();
  await act(async () => {
    await h.result.current.begin();
  });
  expect(api.post).not.toHaveBeenCalled();
  expect(h.result.current.message).toContain('未提交状态变更');
});

it.each(['scope', 'revoke'] as const)('认证%s撤销后迟到查询不得继续POST', async (mode) => {
  setup();
  const query = deferred();
  vi.mocked(api.get).mockReturnValueOnce(query.promise as never);
  const h = mount();
  let pending!: Promise<void>;
  act(() => {
    pending = h.result.current.begin();
  });
  if (mode === 'scope') h.rerender({ id: row.id, scope: 'account:b' });
  else act(() => authSession.notifyAuthorizationRequired());
  await act(async () => {
    query.resolve(row);
    await pending;
  });
  expect(api.post).not.toHaveBeenCalled();
  if (mode === 'revoke') {
    expect(h.result.current.unavailable).toBe(true);
    await act(async () => {
      await h.result.current.begin();
    });
    expect(api.get).toHaveBeenCalledTimes(1);
  }
});
it('同挂载导航返回保留未知闸门，先核对再明确继续', async () => {
  setup();
  vi.mocked(api.post).mockRejectedValueOnce(new Error('unknown'));
  const h = mount();
  await act(async () => {
    await h.result.current.begin();
  });
  h.rerender({ id: 'task-b', scope: 'account:a' });
  h.rerender({ id: row.id, scope: 'account:a' });
  await act(async () => {
    await h.result.current.begin();
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () => {
    await h.result.current.check();
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(h.result.current.message).toContain('查询不代表先前请求已结束');
});

it('保留的旧回调也读取最新unknown闸门，不能在重渲染前重复写', async () => {
  setup();
  vi.mocked(api.post).mockRejectedValueOnce(new Error('unknown'));
  const h = mount();
  const begin = h.result.current.begin;
  await act(async () => {
    await begin();
    await begin();
  });
  expect(api.post).toHaveBeenCalledTimes(1);
});
it('授权撤销发生在READY响应前时，不续写IN_PROGRESS也不执行成功回调', async () => {
  setup();
  const response = deferred();
  vi.mocked(api.post).mockReturnValueOnce(response.promise as never);
  const changed = vi.fn();
  const h = renderHook(() => useManualTaskStart(row.projectId, row.id, 'account:a', changed));
  let pending!: Promise<void>;
  await act(async () => {
    pending = h.result.current.begin();
  });
  act(() => authSession.notifyAuthorizationRequired());
  await act(async () => {
    response.resolve({ ...row, status: 'READY' });
    await pending;
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(changed).not.toHaveBeenCalled();
});
