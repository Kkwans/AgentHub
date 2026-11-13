import { PromptBindingOperationProvider } from '../components/PromptBindingOperationProvider';
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import type * as ApiModule from '../../../lib/api';
import { usePromptLibrary, type PromptBindingTargetType } from './usePromptLibrary';
vi.mock('../../../lib/api', async (original) => ({
  ...(await original<typeof ApiModule>()),
  api: {
    get: vi.fn(async () => []),
    post: vi.fn(async (_path, payload) => ({ id: 'saved', enabled: true, ...payload })),
    patch: vi.fn(),
  },
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.clearAllMocks();
});
const sources = [
  ['PROJECT', 'projects'],
  ['AGENT', 'agents'],
  ['TASK', 'tasks'],
] as const;
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  client.setQueryData(
    ['prompts', 'all'],
    [{ id: 'p1', name: 'Prompt', kind: 'TASK', type: 'TEXT', key: 'test' }],
  );
  client.setQueryData(['prompt-labels', 'p1'], [{ label: 'latest', version: 1 }]);
  client.setQueryData(['prompt-versions', 'p1'], []);
  client.setQueryData(['prompt-bindings', 'p1'], []);
  for (const [, key] of sources)
    client.setQueryData(
      [key],
      [
        { id: 'original', name: '原目标', title: '原目标' },
        { id: 'other', name: '另一目标', title: '另一目标' },
      ],
    );
  const hook = renderHook(usePromptLibrary, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PromptBindingOperationProvider>{children}</PromptBindingOperationProvider>
        </MemoryRouter>
      </QueryClientProvider>
    ),
  });
  return { ...hook, client };
}
async function choose(result: ReturnType<typeof mount>['result'], type: PromptBindingTargetType) {
  act(() => {
    result.current.setBindingTargetType(type);
    result.current.setBindingTargetId('original');
    result.current.setBindingSelectorValue('latest');
  });
  await waitFor(() => expect(result.current.bindingTargetState).toBe('ready'));
  act(() => result.current.setBindingOpen(true));
}
it.each(sources)(
  '%s不自动选目标，当前cache error/fetching/paused立即拒绝旧render提交',
  async (type, key) => {
    const { result, client } = mount();
    expect(result.current.bindingTargetId).toBe('');
    await choose(result, type);
    for (const mode of ['error', 'fetching', 'paused'] as const) {
      const submit = result.current.createBinding.mutateAsync;
      const query = client.getQueryCache().find({ queryKey: [key], exact: true })!;
      await act(async () => {
        query.setState({
          status: mode === 'error' ? 'error' : 'success',
          fetchStatus: mode === 'error' ? 'idle' : mode,
          error: mode === 'error' ? new Error('offline') : null,
        });
        await expect(submit()).rejects.toThrow('尚未确认');
      });
      expect(result.current.bindingTargetId).toBe('original');
      expect(api.post).not.toHaveBeenCalled();
    }
    await act(async () => {
      client
        .getQueryCache()
        .find({ queryKey: [key], exact: true })!
        .setState({ status: 'success', fetchStatus: 'idle', error: null });
    });
    await waitFor(() => expect(result.current.bindingTargetState).toBe('ready'));
    expect(result.current.bindingTargetId).toBe('original');
    await act(async () => {
      await result.current.createBinding.mutateAsync();
    });
    expect(api.post).toHaveBeenCalledWith('/prompt-bindings', {
      targetType: type,
      targetId: 'original',
      slot: 'SYSTEM',
      promptId: 'p1',
      selectorType: 'LABEL',
      label: 'latest',
      priority: 0,
    });
  },
);
it.each(sources)(
  '%s成功删除原ID不改选首项，mutation拒绝后显式重选保留payload',
  async (type, key) => {
    const { result, client } = mount();
    await choose(result, type);
    const submit = result.current.createBinding.mutateAsync;
    await act(async () => {
      client.setQueryData([key], [{ id: 'other', name: '另一目标', title: '另一目标' }]);
      await expect(submit()).rejects.toThrow('原目标已不在最新列表');
    });
    expect(result.current.bindingTargetId).toBe('original');
    await waitFor(() => expect(result.current.bindingTargetState).toBe('missing'));
    expect(api.post).not.toHaveBeenCalled();
    await act(async () => {
      client.setQueryData([key], []);
    });
    await waitFor(() => expect(result.current.bindingTargetState).toBe('missing'));
    expect(result.current.bindingTargetId).toBe('original');
    await act(async () => {
      client.setQueryData([key], [{ id: 'other', name: '另一目标', title: '另一目标' }]);
    });
    act(() => result.current.setBindingTargetId('other'));
    await act(async () => {
      await result.current.createBinding.mutateAsync();
    });
    expect(api.post).toHaveBeenCalledWith(
      '/prompt-bindings',
      expect.objectContaining({
        targetType: type,
        targetId: 'other',
        selectorType: 'LABEL',
        label: 'latest',
      }),
    );
  },
);
it.each(sources)('%s初次pending/error/成功空分开且直接mutation拒绝', async (type, key) => {
  const { result, client } = mount();
  act(() => result.current.setBindingTargetType(type));
  await act(async () => {
    client
      .getQueryCache()
      .find({ queryKey: [key], exact: true })!
      .setState({ status: 'pending', data: undefined, fetchStatus: 'fetching' });
  });
  await waitFor(() => expect(result.current.bindingTargetState).toBe('loading'));
  await act(async () => {
    client
      .getQueryCache()
      .find({ queryKey: [key], exact: true })!
      .setState({ status: 'error', error: new Error('offline'), fetchStatus: 'idle' });
  });
  await waitFor(() => expect(result.current.bindingTargetState).toBe('error'));
  await act(async () => {
    client.setQueryData([key], []);
  });
  await waitFor(() => expect(result.current.bindingTargetState).toBe('empty'));
  act(() => result.current.setBindingOpen(true));
  await act(async () => {
    await expect(result.current.createBinding.mutateAsync()).rejects.toThrow('不能为空');
  });
  expect(api.post).not.toHaveBeenCalled();
});

it.each(['same-prompt', 'different-prompt'] as const)(
  'pending绑定关闭重开 %s：旧成功不应关闭新弹层且只刷新原Prompt',
  async (destination) => {
    const { result, client } = mount();
    client.setQueryData(
      ['prompts', 'all'],
      [
        { id: 'p1', name: 'Prompt', kind: 'TASK', type: 'TEXT', key: 'test' },
        { id: 'p2', name: 'Prompt 2', kind: 'TASK', type: 'TEXT', key: 'test-2' },
      ],
    );
    client.setQueryData(['prompt-labels', 'p2'], [{ label: 'latest', version: 1 }]);
    client.setQueryData(['prompt-versions', 'p2'], []);
    client.setQueryData(['prompt-bindings', 'p2'], []);
    let resolve!: (value: unknown) => void;
    vi.mocked(api.post).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await choose(result, 'PROJECT');
    act(() => result.current.setBindingOpen(true));
    let submitted!: Promise<unknown>;
    act(() => {
      submitted = result.current.createBinding.mutateAsync();
    });
    await waitFor(() => expect(result.current.createBinding.isPending).toBe(true));
    expect(api.post).toHaveBeenCalledWith(
      '/prompt-bindings',
      expect.objectContaining({ promptId: 'p1' }),
    );
    act(() => result.current.setBindingOpen(false));
    if (destination === 'different-prompt') {
      act(() => result.current.setSelectedId('p2'));
      await waitFor(() => expect(result.current.selected?.id).toBe('p2'));
    }
    act(() => result.current.setBindingOpen(true));
    expect(result.current.bindingOpen).toBe(true);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await act(async () => {
      resolve({
        id: 'saved-binding',
        enabled: true,
        ...(vi.mocked(api.post).mock.calls[0]?.[1] as Record<string, unknown>),
      });
      await submitted;
    });
    // Soft assertions retain evidence of both the close and wrong-cache failure.
    expect.soft(result.current.bindingOpen).toBe(true);
    expect.soft(invalidate).toHaveBeenCalledWith({ queryKey: ['prompt-bindings', 'p1'] });
    expect.soft(invalidate).not.toHaveBeenCalledWith({ queryKey: ['prompt-bindings', 'p2'] });
  },
);

it('打开Prompt A后数据删除A时不得向fallback Prompt B提交', async () => {
  const { result, client } = mount();
  client.setQueryData(['prompt-labels', 'p2'], [{ label: 'latest', version: 1 }]);
  client.setQueryData(['prompt-versions', 'p2'], []);
  client.setQueryData(['prompt-bindings', 'p2'], []);
  await choose(result, 'PROJECT');
  act(() => result.current.setBindingOpen(true));
  expect(result.current.selected?.id).toBe('p1');
  act(() =>
    client.setQueryData(
      ['prompts', 'all'],
      [{ id: 'p2', name: 'Prompt 2', kind: 'TASK', type: 'TEXT', key: 'test-2' }],
    ),
  );
  await waitFor(() => expect(result.current.selected?.id).toBe('p2'));
  await waitFor(() => expect(result.current.bindingSelectorValue).toBe('latest'));
  await act(async () => {
    await expect.soft(result.current.createBinding.mutateAsync()).rejects.toThrow();
  });
  expect.soft(api.post).not.toHaveBeenCalled();
});

it('同tick原Prompt cache删除时旧render提交也不能POST', async () => {
  const { result, client } = mount();
  await choose(result, 'PROJECT');
  const submit = result.current.createBinding.mutateAsync;
  await act(async () => {
    client.setQueryData(['prompts', 'all'], []);
    await expect(submit()).rejects.toThrow('原 Prompt');
  });
  expect(api.post).not.toHaveBeenCalled();
});

vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'local_trusted',
  useAuthUser: () => null,
}));
