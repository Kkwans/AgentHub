// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, authSession, type TaskRecord } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';
import { useExistingTaskStart } from './useExistingTaskStart';
let counter = 0;
function setup(status = 'READY') {
  const id = `start-test-${++counter}`;
  const options = {
    projectId: 'project',
    task: { id, projectId: 'project', status } as TaskRecord,
    scope: 'owner',
    agentId: 'agent',
    eligible: true,
    onChanged: vi.fn(),
    onStarted: vi.fn(),
  };
  const hook = renderHook(() => useExistingTaskStart(options));
  return { ...hook, options };
}
describe('existing task start recovery', () => {
  it('准备响应丢失不继续启动，卸载重入仍锁定', async () => {
    const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('lost'));
    const first = setup('BACKLOG');
    await act(() => first.result.current.begin());
    expect(first.result.current.state?.phase).toBe('unknown');
    expect(post).toHaveBeenCalledTimes(1);
    first.unmount();
    const second = renderHook(() => useExistingTaskStart(first.options));
    await act(() => second.result.current.begin());
    expect(post).toHaveBeenCalledTimes(1);
    post.mockRestore();
  });
  it('双击单次写，未知后READY和空历史不能解锁', async () => {
    let reject!: (error: Error) => void;
    const post = vi.spyOn(api, 'post').mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    const hook = setup();
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.begin();
      void hook.result.current.begin();
    });
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => {
      reject(new Error('lost'));
      await pending;
    });
    const get = vi
      .spyOn(api, 'get')
      .mockImplementation(async (url) => (url.includes('start-attempts') ? [] : hook.options.task));
    await act(() => hook.result.current.check());
    expect(hook.result.current.state?.phase).toBe('unknown');
    await act(() => hook.result.current.begin());
    expect(post).toHaveBeenCalledTimes(1);
    post.mockRestore();
    get.mockRestore();
  });
  it('明确调用前拒绝允许手动重试，不自动重试', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockRejectedValue(new ApiError('AGENT_NOT_READY', 'not ready', 409));
    const hook = setup();
    await act(() => hook.result.current.begin());
    expect(hook.result.current.state?.phase).toBe('retryable');
    expect(post).toHaveBeenCalledTimes(1);
    await act(() => hook.result.current.begin());
    expect(post).toHaveBeenCalledTimes(2);
    post.mockRestore();
  });
  it('不匹配成功响应保持未知，不导航', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ session: { id: 'other' } });
    const hook = setup();
    await act(() => hook.result.current.begin());
    expect(hook.result.current.state?.phase).toBe('unknown');
    expect(hook.options.onStarted).not.toHaveBeenCalled();
    post.mockRestore();
  });
  it('存储不可写时不发送请求', async () => {
    const hook = setup();
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    const post = vi.spyOn(api, 'post');
    await act(() => hook.result.current.begin());
    expect(post).not.toHaveBeenCalled();
    expect(hook.result.current.state?.message).toContain('未发送请求');
    storage.mockRestore();
    post.mockRestore();
  });
});

it('准备响应迟到时切换 Agent 不继续启动', async () => {
  let resolve!: (value: unknown) => void;
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const original = {
    projectId: 'late-project',
    task: {
      id: 'late-task',
      projectId: 'late-project',
      status: 'BACKLOG',
    } as TaskRecord,
    scope: 'late-owner',
    agentId: 'first',
    eligible: true,
    onChanged: vi.fn(),
    onStarted: vi.fn(),
  };
  const hook = renderHook((options) => useExistingTaskStart(options), {
    initialProps: original,
  });
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.begin();
  });
  hook.rerender({ ...original, agentId: 'second' });
  await act(async () => {
    resolve({ ...original.task, status: 'READY' });
    await pending;
  });
  expect(post).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state?.phase).toBe('unknown');
  expect(original.onStarted).not.toHaveBeenCalled();
  post.mockRestore();
});

it('刷新恢复持久 pending 为 unknown，零写入', async () => {
  const id = 'restored-task';
  localStorage.setItem(
    'agenthub.existing-task-start.v1:' + JSON.stringify(['restored-owner', 'project', id]),
    JSON.stringify({ phase: 'pending', stage: 'start' }),
  );
  const post = vi.spyOn(api, 'post');
  const hook = renderHook(() =>
    useExistingTaskStart({
      projectId: 'project',
      task: { id, projectId: 'project', status: 'READY' } as TaskRecord,
      scope: 'restored-owner',
      agentId: 'agent',
      eligible: true,
      onChanged: vi.fn(),
      onStarted: vi.fn(),
    }),
  );
  expect(hook.result.current.state?.phase).toBe('unknown');
  await act(() => hook.result.current.begin());
  expect(post).not.toHaveBeenCalled();
  post.mockRestore();
});

it('准备期间 Agent A→B→A 不恢复旧执行资格', async () => {
  let resolve!: (value: unknown) => void;
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const original = {
    projectId: 'aba-project',
    task: {
      id: 'aba-task',
      projectId: 'aba-project',
      status: 'BACKLOG',
    } as TaskRecord,
    scope: 'aba-owner',
    agentId: 'a',
    eligible: true,
    onChanged: vi.fn(),
    onStarted: vi.fn(),
  };
  const hook = renderHook((options) => useExistingTaskStart(options), {
    initialProps: original,
  });
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.begin();
  });
  hook.rerender({ ...original, agentId: 'b' });
  hook.rerender(original);
  await act(async () => {
    resolve({ ...original.task, status: 'READY' });
    await pending;
  });
  expect(post).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state?.phase).toBe('unknown');
  post.mockRestore();
});
it('确认成功不锁取消编辑，旧 READY 不重放；已绑定会话回到 BLOCKED 可显式新尝试', async () => {
  const original = {
    projectId: 'success-project',
    task: {
      id: 'success-task',
      projectId: 'success-project',
      status: 'READY',
      sessionId: null,
    } as TaskRecord,
    scope: 'success-owner',
    agentId: 'agent',
    eligible: true,
    onChanged: vi.fn(),
    onStarted: vi.fn(),
  };
  const session = {
    id: 'success-session',
    taskId: original.task.id,
    projectId: original.projectId,
  };
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    task: { ...original.task, sessionId: session.id },
    session,
    run: { id: 'run', sessionId: session.id },
  });
  const hook = renderHook((options) => useExistingTaskStart(options), {
    initialProps: original,
  });
  await act(() => hook.result.current.begin());
  expect(hook.result.current.locked).toBe(false);
  expect(hook.result.current.unavailable).toBe(true);
  await act(() => hook.result.current.begin());
  expect(post).toHaveBeenCalledTimes(1);
  hook.rerender({
    ...original,
    task: { ...original.task, status: 'BLOCKED', sessionId: session.id },
  });
  post.mockResolvedValueOnce({
    ...original.task,
    status: 'READY',
    sessionId: session.id,
  });
  await act(() => hook.result.current.begin());
  expect(post).toHaveBeenCalledTimes(3);
  post.mockRestore();
});

it('其他标签页写未知 marker 后本页不重放原 retryable', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValue(new ApiError('AGENT_NOT_READY', 'not ready', 409));
  const hook = setup();
  await act(() => hook.result.current.begin());
  localStorage.setItem(
    'agenthub.existing-task-start.v1:' +
      JSON.stringify([hook.options.scope, hook.options.projectId, hook.options.task.id]),
    JSON.stringify({ phase: 'unknown', stage: 'start' }),
  );
  await act(() => hook.result.current.begin());
  expect(post).toHaveBeenCalledTimes(1);
  post.mockRestore();
});

it('prepare 期间资格 true→false→true 不继续旧 start', async () => {
  let resolve!: (value: unknown) => void;
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const original = {
    projectId: 'elig-project',
    task: {
      id: 'elig-task',
      projectId: 'elig-project',
      status: 'BACKLOG',
    } as TaskRecord,
    scope: 'elig-owner',
    agentId: 'a',
    eligible: true,
    onChanged: vi.fn(),
    onStarted: vi.fn(),
  };
  const hook = renderHook((options) => useExistingTaskStart(options), {
    initialProps: original,
  });
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.begin();
  });
  hook.rerender({ ...original, eligible: false });
  hook.rerender(original);
  await act(async () => {
    resolve({ ...original.task, status: 'READY' });
    await pending;
  });
  expect(post).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state?.phase).toBe('unknown');
  post.mockRestore();
});

it('认证撤销后晚成功不导航，同身份重入保留未知锁', async () => {
  let resolve!: (value: unknown) => void;
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const hook = setup();
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.begin();
  });
  act(() => authSession.notifyAuthorizationRequired());
  const session = {
    id: 'auth-session',
    projectId: hook.options.projectId,
    taskId: hook.options.task.id,
  };
  await act(async () => {
    resolve({
      task: { ...hook.options.task, sessionId: session.id },
      session,
      run: { id: 'auth-run', sessionId: session.id },
    });
    await pending;
  });
  expect(hook.options.onStarted).not.toHaveBeenCalled();
  hook.unmount();
  const restored = renderHook(() => useExistingTaskStart(hook.options));
  await act(() => restored.result.current.begin());
  expect(post).toHaveBeenCalledTimes(1);
  expect(restored.result.current.state?.phase).toBe('unknown');
  post.mockRestore();
});
it('只读核对关联会话不能改写成功响应归属', async () => {
  const hook = setup();
  const session = {
    id: 'confirmed-session',
    projectId: hook.options.projectId,
    taskId: hook.options.task.id,
  };
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    task: { ...hook.options.task, sessionId: session.id },
    session,
    run: { id: 'confirmed-run', sessionId: session.id },
  });
  await act(() => hook.result.current.begin());
  const get = vi
    .spyOn(api, 'get')
    .mockImplementation(async (url) =>
      url.includes('start-attempts')
        ? []
        : { ...hook.options.task, sessionId: 'different-current-session' },
    );
  await act(() => hook.result.current.check());
  expect(hook.result.current.state?.phase).toBe('confirmed');
  expect(hook.result.current.state?.sessionId).toBe(session.id);
  expect(hook.result.current.state?.observedSessionId).toBe('different-current-session');
  expect(post).toHaveBeenCalledTimes(1);
  get.mockRestore();
  post.mockRestore();
});

it('只读核对 A→B→A 后迟到响应不覆盖原提示', async () => {
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('lost'));
  const original = {
    projectId: 'check-aba-project',
    task: {
      id: 'check-aba-task',
      projectId: 'check-aba-project',
      status: 'READY',
    } as TaskRecord,
    scope: 'check-aba-owner',
    agentId: 'a',
    eligible: true,
    onChanged: vi.fn(),
    onStarted: vi.fn(),
  };
  const hook = renderHook((options) => useExistingTaskStart(options), {
    initialProps: original,
  });
  await act(() => hook.result.current.begin());
  const message = hook.result.current.state?.message;
  let resolve!: (value: unknown) => void;
  const get = vi.spyOn(api, 'get').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.check();
  });
  hook.rerender({ ...original, agentId: 'b' });
  hook.rerender(original);
  await act(async () => {
    resolve({ ...original.task, sessionId: 'old-result' });
    await pending;
  });
  expect(get).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state?.message).toBe(message);
  expect(hook.result.current.state?.observedSessionId).toBeUndefined();
  get.mockRestore();
  post.mockRestore();
});

it('写前存储连续失败两次后恢复仍可明确启动一次，不把零请求变成永久未知', async () => {
  const hook = setup();
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValue(new Error('network lost after later explicit start'));
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage unavailable');
  });
  await act(() => hook.result.current.begin());
  expect(hook.result.current.state?.phase).toBe('retryable');
  expect(post).not.toHaveBeenCalled();
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('storage unavailable');
  });
  await act(() => hook.result.current.begin());
  expect(post).not.toHaveBeenCalled();
  get.mockRestore();
  set.mockRestore();
  await act(() => hook.result.current.begin());
  expect(post).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state?.phase).toBe('unknown');
  localStorage.clear();
  await act(() => hook.result.current.begin());
  expect(post).toHaveBeenCalledTimes(1);
  post.mockRestore();
});

it('坏存储恢复后发现外部 pending，保留未知锁而不是恢复本页旧 retryable', async () => {
  const hook = setup();
  const post = vi.spyOn(api, 'post');
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await act(() => hook.result.current.begin());
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await act(() => hook.result.current.begin());
  get.mockRestore();
  set.mockRestore();
  localStorage.setItem(
    'agenthub.existing-task-start.v1:' +
      JSON.stringify([hook.options.scope, hook.options.projectId, hook.options.task.id]),
    JSON.stringify({ phase: 'pending', stage: 'start' }),
  );
  await act(() => hook.result.current.begin());
  expect(post).not.toHaveBeenCalled();
  expect(hook.result.current.state?.phase).toBe('unknown');
  localStorage.clear();
  await act(() => hook.result.current.begin());
  expect(post).not.toHaveBeenCalled();
  post.mockRestore();
});

it('外部 retryable marker 不能解除本页真正未知请求', async () => {
  const hook = setup();
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('lost'));
  await act(() => hook.result.current.begin());
  localStorage.setItem(
    'agenthub.existing-task-start.v1:' +
      JSON.stringify([hook.options.scope, hook.options.projectId, hook.options.task.id]),
    JSON.stringify({ phase: 'retryable', stage: 'start' }),
  );
  await act(() => hook.result.current.begin());
  expect(post).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state?.phase).toBe('unknown');
  post.mockRestore();
});

it('读取存储失败时核对不能将旧 retryable 持久回写覆盖外部 pending', async () => {
  const hook = setup();
  const post = vi.spyOn(api, 'post');
  const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await act(() => hook.result.current.begin());
  set.mockRestore();
  const key =
    'agenthub.existing-task-start.v1:' +
    JSON.stringify([hook.options.scope, hook.options.projectId, hook.options.task.id]);
  localStorage.setItem(key, JSON.stringify({ phase: 'pending', stage: 'start' }));
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await act(() => hook.result.current.begin());
  const get = vi.spyOn(api, 'get').mockResolvedValue(hook.options.task);
  await act(() => hook.result.current.check());
  expect(get).not.toHaveBeenCalled();
  read.mockRestore();
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
    phase: 'pending',
  });
  await act(() => hook.result.current.begin());
  expect(post).not.toHaveBeenCalled();
  expect(hook.result.current.state?.phase).toBe('unknown');
  get.mockRestore();
  post.mockRestore();
});

it('A核对挂起不阻止B核对，A迟回不清B检查状态', async () => {
  const original = {
    projectId: 'parallel-check',
    task: {
      id: 'check-a',
      projectId: 'parallel-check',
      status: 'READY',
    } as TaskRecord,
    scope: 'parallel-owner',
    agentId: 'agent',
    eligible: true,
    onChanged: vi.fn(),
    onStarted: vi.fn(),
  };
  const other = { ...original, task: { ...original.task, id: 'check-b' } };
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('lost'));
  const hook = renderHook((options) => useExistingTaskStart(options), {
    initialProps: original,
  });
  await act(() => hook.result.current.begin());
  hook.rerender(other);
  await act(() => hook.result.current.begin());
  hook.rerender(original);
  let resolveA!: (value: unknown) => void;
  let resolveB!: (value: unknown) => void;
  const get = vi
    .spyOn(api, 'get')
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveA = done;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveB = done;
        }),
    )
    .mockImplementation(async (url) => (url.includes('start-attempts') ? [] : other.task));
  let a!: Promise<void>;
  let b!: Promise<void>;
  act(() => {
    a = hook.result.current.check();
  });
  hook.rerender(other);
  expect(hook.result.current.checking).toBe(false);
  act(() => {
    b = hook.result.current.check();
  });
  expect(get).toHaveBeenCalledTimes(2);
  await act(async () => {
    resolveA(original.task);
    await a;
  });
  expect(hook.result.current.checking).toBe(true);
  await act(async () => {
    resolveB(other.task);
    await b;
  });
  expect(hook.result.current.checking).toBe(false);
  expect(hook.result.current.state?.message).toContain('核对到原任务状态');
  get.mockRestore();
  post.mockRestore();
});

it('unknown存储读取故障恢复后可核对，始终不重投POST', async () => {
  const hook = setup();
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('lost'));
  await act(() => hook.result.current.begin());
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await act(() => hook.result.current.begin());
  expect(hook.result.current.state?.storageReadFailed).toBe(true);
  const get = vi
    .spyOn(api, 'get')
    .mockImplementation(async (url) => (url.includes('start-attempts') ? [] : hook.options.task));
  await act(() => hook.result.current.check());
  expect(get).not.toHaveBeenCalled();
  read.mockRestore();
  await act(() => hook.result.current.check());
  expect(get).toHaveBeenCalledTimes(3);
  expect(hook.result.current.state?.phase).toBe('unknown');
  expect(hook.result.current.state?.message).toContain('核对到原任务状态');
  await act(() => hook.result.current.begin());
  expect(post).toHaveBeenCalledTimes(1);
  get.mockRestore();
  post.mockRestore();
});

it('泛化VALIDATION_FAILED不能证明调用前拒绝，保持未知且不重投', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValue(new ApiError('VALIDATION_FAILED', 'validation failed', 400));
  const hook = setup();
  await act(() => hook.result.current.begin());
  expect(hook.result.current.state?.phase).toBe('unknown');
  await act(() => hook.result.current.begin());
  expect(post).toHaveBeenCalledTimes(1);
  post.mockRestore();
});

it('reset提示更新不覆盖不可读的外部 pending，恢复后仍禁止启动', async () => {
  const hook = setup();
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValue(new ApiError('AGENT_NOT_READY', 'not ready', 409));
  await act(() => hook.result.current.begin());
  const key =
    'agenthub.existing-task-start.v1:' +
    JSON.stringify([hook.options.scope, hook.options.projectId, hook.options.task.id]);
  localStorage.setItem(key, JSON.stringify({ phase: 'pending', stage: 'start' }));
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await act(() => hook.result.current.begin());
  act(() => hook.result.current.reset());
  read.mockRestore();
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
    phase: 'pending',
  });
  await act(() => hook.result.current.begin());
  expect(post).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state?.phase).toBe('unknown');
  post.mockRestore();
});
it.each(['success', 'failure'])('核对%s只改展示，不覆盖查询期间外部pending', async (outcome) => {
  const hook = setup();
  const post = vi
    .spyOn(api, 'post')
    .mockRejectedValue(new ApiError('AGENT_NOT_READY', 'not ready', 409));
  await act(() => hook.result.current.begin());
  const key =
    'agenthub.existing-task-start.v1:' +
    JSON.stringify([hook.options.scope, hook.options.projectId, hook.options.task.id]);
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const get = vi
    .spyOn(api, 'get')
    .mockImplementationOnce(
      () =>
        new Promise((done, fail) => {
          resolve = done;
          reject = fail;
        }),
    )
    .mockImplementation(async (url) => (url.includes('start-attempts') ? [] : hook.options.task));
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.check();
  });
  localStorage.setItem(key, JSON.stringify({ phase: 'pending', stage: 'start' }));
  await act(async () => {
    if (outcome === 'success') resolve(hook.options.task);
    else reject(new Error('get failed'));
    await pending;
  });
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
    phase: 'pending',
  });
  await act(() => hook.result.current.begin());
  expect(post).toHaveBeenCalledTimes(1);
  expect(hook.result.current.state?.phase).toBe('unknown');
  get.mockRestore();
  post.mockRestore();
});
