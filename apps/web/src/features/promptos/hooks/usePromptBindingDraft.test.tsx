import {
  PromptBindingOperationProvider,
  useBindingOperations,
} from '../components/PromptBindingOperationProvider';
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api, type PromptRecord } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';
import { authSession } from '../../../lib/auth-api';
import { usePromptBindingDraft } from './usePromptBindingDraft';
const identity = vi.hoisted(() => ({ id: 'a', mode: 'token' as 'token' | undefined }));
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => identity.mode,
  useAuthUser: () => ({ id: identity.id }),
}));
vi.mock('../../../lib/api', () => ({ api: { post: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  identity.id = 'a';
  identity.mode = 'token';
});
const prompt = { id: 'p1', name: '原Prompt' } as PromptRecord;
const payload = {
  promptId: 'p1',
  targetType: 'PROJECT',
  targetId: 'target1',
  slot: 'SYSTEM',
  selectorType: 'VERSION',
  versionId: 'version1',
  priority: 0,
};
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  let resolve!: (value: unknown) => void;
  let reject!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
  const renders: Array<{ auth: string; count: number; open: boolean }> = [];
  const hook = renderHook(
    () => {
      const draft = usePromptBindingDraft(prompt, [prompt], 'all', () => payload);
      renders.push({
        auth: identity.id,
        count: draft.bindingOperations.length,
        open: draft.bindingOpen,
      });
      return { ...draft, navigate: useNavigate() };
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <StrictMode>
          <QueryClientProvider client={client}>
            <MemoryRouter>
              <PromptBindingOperationProvider>{children}</PromptBindingOperationProvider>
            </MemoryRouter>
          </QueryClientProvider>
        </StrictMode>
      ),
    },
  );
  act(() => hook.result.current.setBindingOpen(true));
  return {
    ...hook,
    renders,
    invalidate,
    resolve: (data: unknown) => resolve(data),
    reject: (error: unknown) => reject(error),
  };
}
async function start(state: ReturnType<typeof setup>) {
  let promise!: Promise<unknown>;
  act(() => {
    promise = state.result.current.createBinding.mutateAsync();
  });
  await waitFor(() => expect(state.result.current.createBinding.isPending).toBe(true));
  // Handle rejection immediately while retaining a resolved inspection promise.
  return {
    settled: promise.then(
      (value) => ({ value }),
      (error) => ({ error }),
    ),
  };
}
const saved = () => ({ id: 'binding1', enabled: true, ...payload });
it('StrictMode首次有效成功关闭原弹层并刷新原Prompt', async () => {
  const state = setup();
  const { settled } = await start(state);
  await act(async () => {
    state.resolve(saved());
    await settled;
  });
  expect(state.result.current.bindingOpen).toBe(false);
  expect(state.result.current.bindingOperations[0]).toMatchObject({
    phase: 'saved',
    bindingId: 'binding1',
  });
  expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ['prompt-bindings', 'p1'] });
});
it('同tick重复提交与pending关闭重开只发一次POST', async () => {
  const state = setup();
  const { settled } = await start(state);
  act(() => {
    state.result.current.setBindingOpen(false);
    state.result.current.setBindingOpen(true);
  });
  await act(async () => {
    await expect(state.result.current.createBinding.mutateAsync()).rejects.toThrow('请勿重复');
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () => {
    state.resolve(saved());
    await settled;
  });
  expect(state.result.current.bindingOpen).toBe(true);
  expect(state.result.current.bindingOperations[0]?.phase).toBe('saved');
});
it.each([
  {},
  { ...saved(), targetId: 'other' },
  { ...saved(), enabled: false },
  { ...saved(), label: 'conflicting-label' },
])('畸形/错身份成功响应锁unknown：%j', async (response) => {
  const state = setup();
  const { settled } = await start(state);
  await act(async () => {
    state.resolve(response);
    await settled;
  });
  expect(state.result.current.bindingOperations[0]?.phase).toBe('unknown');
  expect(state.result.current.bindingOpen).toBe(true);
  expect(state.invalidate).not.toHaveBeenCalled();
  act(() => {
    state.result.current.dismissBindingOperation(1);
    state.result.current.setBindingOpen(false);
    state.result.current.setBindingOpen(true);
  });
  expect(state.result.current.bindingBlocked).toBe(true);
  await act(async () => {
    await expect(state.result.current.createBinding.mutateAsync()).rejects.toThrow('请勿重复');
  });
  expect(api.post).toHaveBeenCalledTimes(1);
});
it.each([new Error('network'), new ApiError('HTTP_ERROR', 'failure', 500)])(
  '旧错误独立保留，重开draft不继承且unknown不解锁：%j',
  async (error) => {
    const state = setup();
    const { settled } = await start(state);
    act(() => {
      state.result.current.setBindingOpen(false);
      state.result.current.setBindingOpen(true);
    });
    await act(async () => {
      state.reject(error);
      await settled;
    });
    expect(state.result.current.createBinding.error).toBeNull();
    expect(state.result.current.bindingOperations[0]).toMatchObject({
      promptName: '原Prompt',
      phase: 'unknown',
      payload,
    });
    expect(state.result.current.bindingBlocked).toBe(true);
  },
);
it('明确插入前拒绝可释放锁，旧记录保留直到用户关闭', async () => {
  const state = setup();
  const { settled } = await start(state);
  await act(async () => {
    state.reject(new ApiError('PROMPT_BINDING_TARGET_NOT_FOUND', 'target gone', 404));
    await settled;
  });
  expect(state.result.current.bindingBlocked).toBe(false);
  expect(state.result.current.bindingOperations[0]?.phase).toBe('rejected');
  act(() => state.result.current.dismissBindingOperation(1));
  expect(state.result.current.bindingOperations).toEqual([]);
});
it.each(['revoked', 'aba', 'unmount'] as const)(
  '%s后旧成功不刷新缓存或恢复旧记录',
  async (mode) => {
    const state = setup();
    const { settled } = await start(state);
    if (mode === 'revoked') act(() => authSession.notifyAuthorizationRequired());
    if (mode === 'aba') {
      identity.id = 'b';
      state.rerender();
      identity.id = 'a';
      state.rerender();
    }
    if (mode === 'unmount') state.unmount();
    await act(async () => {
      state.resolve(saved());
      await settled;
    });
    expect(state.invalidate).not.toHaveBeenCalled();
    if (mode !== 'unmount') expect(state.result.current.bindingOperations).toEqual([]);
  },
);
it('route变化在提交前拒绝，pending离开再回不误关新弹层但仍记录原结果', async () => {
  const state = setup();
  act(() => state.result.current.navigate('/other'));
  await act(async () => {
    await expect(state.result.current.createBinding.mutateAsync()).rejects.toThrow('原 Prompt');
  });
  expect(api.post).not.toHaveBeenCalled();
  act(() => state.result.current.setBindingOpen(true));
  const { settled } = await start(state);
  act(() => state.result.current.navigate('/third'));
  act(() => state.result.current.navigate('/other'));
  act(() => state.result.current.setBindingOpen(true));
  await act(async () => {
    state.resolve(saved());
    await settled;
  });
  expect(state.result.current.bindingOpen).toBe(true);
  expect(state.result.current.bindingOperations[0]?.phase).toBe('saved');
});

it('同一同步事件连续两次提交仅首请求落POST且payload冻结', async () => {
  const state = setup();
  let first!: Promise<unknown>;
  let second!: Promise<unknown>;
  act(() => {
    first = state.result.current.createBinding.mutateAsync();
    second = state.result.current.createBinding.mutateAsync().catch((error) => error);
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(await second).toBeInstanceOf(Error);
  const original = { ...payload };
  payload.targetId = 'later-draft';
  try {
    expect(api.post).toHaveBeenCalledWith('/prompt-bindings', original);
    await act(async () => {
      state.resolve({ id: 'saved', enabled: true, ...original });
      await first;
    });
    expect(state.result.current.bindingOperations[0]?.payload).toEqual(original);
  } finally {
    payload.targetId = original.targetId;
  }
});

it('切换身份的首render不展示旧身份操作信息', async () => {
  const state = setup();
  const { settled } = await start(state);
  expect(state.result.current.bindingOperations).toHaveLength(1);
  identity.id = 'b';
  state.rerender();
  const newIdentityRenders = state.renders.filter((item) => item.auth === 'b');
  expect(newIdentityRenders.length).toBeGreaterThan(0);
  expect(newIdentityRenders.every((item) => item.count === 0 && !item.open)).toBe(true);
  await act(async () => {
    state.resolve(saved());
    await settled;
  });
  expect(state.invalidate).not.toHaveBeenCalled();
});

it.each(['pending', 'unknown'] as const)(
  '真实Routes卸载后%s原操作仍应阻止重复绑定',
  async (phase) => {
    const client = new QueryClient();
    let draft!: ReturnType<typeof usePromptBindingDraft>;
    let navigate!: ReturnType<typeof useNavigate>;
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    vi.mocked(api.post).mockImplementation(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    function Probe() {
      draft = usePromptBindingDraft(prompt, [prompt], 'all', () => payload);
      return null;
    }
    function RouteHarness() {
      navigate = useNavigate();
      return (
        <Routes>
          <Route path="/prompts" element={<Probe />} />
          <Route path="/other" element={<p>另一页</p>} />
        </Routes>
      );
    }
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/prompts']}>
          <PromptBindingOperationProvider>
            <RouteHarness />
          </PromptBindingOperationProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    act(() => draft.setBindingOpen(true));
    let settled!: Promise<unknown>;
    act(() => {
      settled = draft.createBinding.mutateAsync().catch((error) => error);
    });
    await waitFor(() => expect(draft.bindingBlocked).toBe(true));
    try {
      if (phase === 'unknown')
        await act(async () => {
          reject(new Error('connection lost'));
          await settled;
        });
      expect(draft.bindingOperations[0]?.phase).toBe(phase);
      act(() => navigate('/other'));
      act(() => navigate('/prompts'));
      expect(draft.bindingBlocked).toBe(true);
      expect(draft.bindingOperations[0]?.phase).toBe(phase);
    } finally {
      await act(async () => {
        resolve(saved());
        await settled;
      });
      client.clear();
    }
  },
);

it.each(['saved', 'rejected'] as const)(
  '没有Prompt consumer时%s完成，返回看原结果且仅成功刷新原cache',
  async (phase) => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    let draft!: ReturnType<typeof usePromptBindingDraft>;
    let navigate!: ReturnType<typeof useNavigate>;
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    let consumers = 0;
    let capturedOwner!: ReturnType<typeof useBindingOperations>['owner'];
    vi.mocked(api.post).mockImplementation(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    function Probe() {
      capturedOwner = useBindingOperations().owner;
      draft = usePromptBindingDraft(prompt, [prompt], 'all', () => payload);
      useEffect(() => {
        consumers += 1;
        return () => {
          consumers -= 1;
        };
      }, []);
      return null;
    }
    function Harness() {
      navigate = useNavigate();
      return (
        <Routes>
          <Route path="/prompts" element={<Probe />} />
          <Route path="/other" element={<p>其它页</p>} />
        </Routes>
      );
    }
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/prompts']}>
          <PromptBindingOperationProvider>
            <Harness />
          </PromptBindingOperationProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    act(() => draft.setBindingOpen(true));
    let settled!: Promise<unknown>;
    act(() => {
      settled = draft.createBinding.mutateAsync().catch((error) => error);
    });
    act(() => navigate('/other'));
    expect(consumers).toBe(0);
    await act(async () => {
      if (phase === 'saved') resolve(saved());
      else reject(new ApiError('PROMPT_BINDING_TARGET_NOT_FOUND', 'gone', 404));
      await settled;
    });
    expect(consumers).toBe(0);
    expect(capturedOwner?.getSnapshot().records[0]?.phase).toBe(phase);
    if (phase === 'saved')
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['prompt-bindings', 'p1'] });
    act(() => navigate('/prompts'));
    expect(consumers).toBe(1);
    expect(draft.bindingOperations[0]).toMatchObject({ phase, payload, promptName: '原Prompt' });
    expect(draft.bindingBlocked).toBe(false);
    expect(draft.bindingOpen).toBe(false);
    if (phase === 'saved')
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['prompt-bindings', 'p1'] });
    else expect(invalidate).not.toHaveBeenCalled();
  },
);
it('同一provider两个Prompt入口同步竞争只有一条POST', async () => {
  const client = new QueryClient();
  const drafts: Array<ReturnType<typeof usePromptBindingDraft>> = [];
  let resolve!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  );
  function Probe({ index }: { index: number }) {
    const selected = { ...prompt, id: `p${index + 1}` };
    drafts[index] = usePromptBindingDraft(selected, [selected], 'all', () => ({
      ...payload,
      promptId: selected.id,
    }));
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PromptBindingOperationProvider>
          <Probe index={0} />
          <Probe index={1} />
        </PromptBindingOperationProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  act(() => {
    drafts[0]!.setBindingOpen(true);
    drafts[1]!.setBindingOpen(true);
  });
  let first!: Promise<unknown>;
  let second!: Promise<unknown>;
  act(() => {
    first = drafts[0]!.createBinding.mutateAsync();
    second = drafts[1]!.createBinding.mutateAsync().catch((error) => error);
  });
  expect(await second).toBeInstanceOf(Error);
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve(saved());
    await first;
  });
  expect(drafts[1]!.bindingOpen).toBe(true);
  expect(drafts[1]!.bindingOperations[0]?.payload.promptId).toBe('p1');
});
it('缺Provider或未知认证不能创建独立写owner', async () => {
  const hook = renderHook(() => usePromptBindingDraft(prompt, [prompt], 'all', () => payload), {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  });
  act(() => hook.result.current.setBindingOpen(true));
  await expect(hook.result.current.createBinding.mutateAsync()).rejects.toThrow('缺少');
  expect(api.post).not.toHaveBeenCalled();
  hook.unmount();
  identity.mode = undefined;
  const state = setup();
  await expect(state.result.current.createBinding.mutateAsync()).rejects.toThrow('授权');
  expect(state.result.current.bindingBlocked).toBe(true);
  expect(api.post).not.toHaveBeenCalled();
});

it('StrictMode warm首次effect完成即unblocked，不依赖打开弹层重渲染', async () => {
  const client = new QueryClient();
  const hook = renderHook(() => usePromptBindingDraft(prompt, [prompt], 'all', () => payload), {
    wrapper: ({ children }) => (
      <StrictMode>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <PromptBindingOperationProvider>{children}</PromptBindingOperationProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>
    ),
  });
  expect(hook.result.current.bindingBlocked).toBe(false);
  expect(hook.result.current.bindingOpen).toBe(false);
});
