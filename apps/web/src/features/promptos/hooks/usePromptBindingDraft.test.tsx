// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api, type PromptRecord } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';
import { authSession } from '../../../lib/auth-api';
import { usePromptBindingDraft } from './usePromptBindingDraft';
const identity = vi.hoisted(() => ({ id: 'a' }));
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'token',
  useAuthUser: () => ({ id: identity.id }),
}));
vi.mock('../../../lib/api', () => ({ api: { post: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  identity.id = 'a';
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
            <MemoryRouter>{children}</MemoryRouter>
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
