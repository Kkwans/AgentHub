// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { authSession } from '../../../lib/auth-api';
import { GitCommitOperationProvider, useGitCommitOperations } from './GitCommitOperationProvider';
import type { createGitCommitOwner } from '../lib/git-commit-owner';

const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const identity = vi.hoisted(() => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  mode: 'token' as string | undefined,
}));
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => identity.mode,
  useAuthUser: () => (identity.id ? { id: identity.id } : null),
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  identity.id = accountA;
  identity.mode = 'token';
});
const deferred = () => {
  let resolve!: (result: unknown) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
};
const success = { sha: 'a'.repeat(40) };
type Owner = ReturnType<typeof createGitCommitOwner>;
function mount(send: (input: unknown) => Promise<unknown>, strict = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  let owner: Owner | null = null;
  let navigate!: ReturnType<typeof useNavigate>;
  const errors: unknown[] = [];
  const results: unknown[] = [];
  function Page() {
    const projectId = useParams().projectId!;
    const operations = useGitCommitOperations();
    owner = operations.owner;
    return (
      <>
        <button
          onClick={() => {
            void operations.owner
              ?.submit({ projectId, paths: ['one.ts'], message: `提交 ${projectId}` }, send)
              .then((result) => results.push(result))
              .catch((error: unknown) => errors.push(error));
          }}
        >
          提交
        </button>
        <output aria-label="操作记录">
          {operations.operations
            .map((record) => `${record.input.projectId}:${record.phase}`)
            .join('|')}
        </output>
      </>
    );
  }
  function Navigation() {
    navigate = useNavigate();
    return null;
  }
  function Contents() {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/project/a']}>
          <Navigation />
          <GitCommitOperationProvider>
            <Routes>
              <Route path="project/:projectId" element={<Page />} />
              <Route path="away" element={<p>已离开</p>} />
            </Routes>
          </GitCommitOperationProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  const tree = () =>
    strict ? (
      <StrictMode>
        <Contents />
      </StrictMode>
    ) : (
      <Contents />
    );
  const view = render(tree());
  return {
    getOwner: () => owner!,
    go: (path: string) => act(() => navigate(path)),
    refresh: () => view.rerender(tree()),
    errors,
    results,
    view,
  };
}

it('路由消费者卸载后仍收集成功，返回显示原项目回执且未重发', async () => {
  const pending = deferred();
  const send = vi.fn(() => pending.promise);
  const app = mount(send);
  fireEvent.click(screen.getByRole('button', { name: '提交' }));
  const owner = app.getOwner();
  expect(owner.isLocked('a')).toBe(true);
  app.go('/away');
  expect(screen.queryByLabelText('操作记录')).not.toBeInTheDocument();
  await act(async () => pending.resolve(success));
  app.go('/project/a');
  expect(app.getOwner()).toBe(owner);
  expect(screen.getByLabelText('操作记录')).toHaveTextContent('a:committed');
  expect(send).toHaveBeenCalledTimes(1);
});

it('未知结果跨离开/返回保留锁，不同项目独立提交', async () => {
  const first = deferred();
  const send = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValue(success);
  const app = mount(send);
  fireEvent.click(screen.getByRole('button', { name: '提交' }));
  app.go('/away');
  await act(async () => first.reject(new Error('断线')));
  app.go('/project/b');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '提交' })));
  expect(app.getOwner().isLocked('a')).toBe(true);
  expect(app.getOwner().isLocked('b')).toBe(false);
  app.go('/project/a');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '提交' })));
  expect(send).toHaveBeenCalledTimes(2);
  expect(app.errors).toHaveLength(1);
  expect(screen.getByLabelText('操作记录')).toHaveTextContent('a:unknown|b:committed');
});

it.each(['resolve', 'reject'] as const)('auth A→B→A 的旧%s不进入新 owner', async (method) => {
  const old = deferred();
  const current = deferred();
  const send = vi
    .fn()
    .mockImplementationOnce(() => old.promise)
    .mockImplementationOnce(() => current.promise);
  const app = mount(send);
  fireEvent.click(screen.getByRole('button', { name: '提交' }));
  const previousOwner = app.getOwner();
  identity.id = accountB;
  app.refresh();
  expect(screen.getByLabelText('操作记录')).toBeEmptyDOMElement();
  identity.id = accountA;
  app.refresh();
  expect(app.getOwner()).not.toBe(previousOwner);
  fireEvent.click(screen.getByRole('button', { name: '提交' }));
  await act(async () => old[method](method === 'resolve' ? success : new Error('旧失败')));
  expect(app.getOwner().getSnapshot()).toHaveLength(1);
  expect(app.getOwner().isLocked('a')).toBe(true);
  expect(screen.getByLabelText('操作记录')).toHaveTextContent('a:pending');
  await act(async () => current.resolve(success));
  expect(screen.getByLabelText('操作记录')).toHaveTextContent('a:committed');
  expect(app.results[0]).toBeUndefined();
  expect(app.errors).toEqual([]);
});

it('授权失效事件同步阻止 POST，晚到结果不恢复旧记录', async () => {
  const pending = deferred();
  const send = vi.fn(() => pending.promise);
  const app = mount(send);
  fireEvent.click(screen.getByRole('button', { name: '提交' }));
  const owner = app.getOwner();
  let attempted!: Promise<unknown>;
  act(() => {
    authSession.notifyAuthorizationRequired();
    attempted = owner.submit({ projectId: 'b', paths: ['two'], message: '不能发送' }, send);
  });
  await expect(attempted).rejects.toThrow('授权');
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(success));
  expect(owner.getSnapshot()).toEqual([]);
});

it('StrictMode 重放后一次点击只发一次，路由切换不撤销当前 owner', async () => {
  const pending = deferred();
  const send = vi.fn(() => pending.promise);
  const app = mount(send, true);
  fireEvent.click(screen.getByRole('button', { name: '提交' }));
  expect(send).toHaveBeenCalledTimes(1);
  const owner = app.getOwner();
  app.go('/away');
  app.go('/project/a');
  expect(app.getOwner()).toBe(owner);
  await act(async () => pending.resolve(success));
  expect(screen.getByLabelText('操作记录')).toHaveTextContent('a:committed');
});

it('无认证 scope 不能调用 transport', async () => {
  identity.mode = undefined;
  identity.id = '';
  const send = vi.fn();
  const app = mount(send);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '提交' })));
  expect(send).not.toHaveBeenCalled();
  expect(app.errors).toHaveLength(1);
});
