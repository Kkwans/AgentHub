// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, authSession, type FileEntry } from '../../lib/api';
import { useProjectDirectoryLoader } from './useProjectDirectoryLoader';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it.each(['authorization', 'project', 'unmount'] as const)(
  'discards deferred cache writes after %s and requires fresh reads on revisit',
  async (reason) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    let finish!: (entries: FileEntry[]) => void;
    const get = vi
      .spyOn(api, 'get')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue([{ name: 'fresh', path: 'src/fresh', type: 'FILE' }]);
    const view = renderHook(({ id }) => useProjectDirectoryLoader(id, '/root'), {
      initialProps: { id: 'a' },
      wrapper,
    });
    let pending!: Promise<unknown>;
    act(() => {
      pending = view.result.current('src').catch(() => undefined);
    });
    if (reason === 'authorization') {
      act(() => authSession.notifyAuthorizationRequired());
      await expect(view.result.current('src')).rejects.toThrow('目录访问权限已失效');
    }
    if (reason === 'project') view.rerender({ id: 'b' });
    if (reason === 'unmount') view.unmount();
    await act(async () => {
      finish([{ name: 'secret-old', path: 'src/secret-old', type: 'FILE' }]);
      await pending;
    });
    expect(client.getQueriesData({ queryKey: ['files', 'a', '/root'] })).toEqual([]);
    if (reason !== 'unmount') view.unmount();
    const revisit = renderHook(() => useProjectDirectoryLoader('a', '/root'), { wrapper });
    let result: FileEntry[] = [];
    await act(async () => {
      result = await revisit.result.current('src');
    });
    expect(result[0]?.name).toBe('fresh');
    expect(get).toHaveBeenCalledTimes(2);
    client.clear();
  },
);
