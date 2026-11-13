// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../lib/api';
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
  localStorage.clear();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
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
const project = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function terminalQuery() {
  vi.spyOn(api, 'get').mockImplementation(
    async (path) =>
      ({
        scope: `account:${accountA}`,
        projectId: project,
        operationId: path.split('/').at(-1),
        protocolVersion: 1,
        requestHash: 'a'.repeat(64),
        phase: 'COMMAND_SUCCEEDED',
        commandExit: 0,
        observedAfterHead: success.sha,
        resultEvidence: { kind: 'COMMAND_EXIT_ZERO', headAttribution: 'OBSERVED_ONLY' },
      }) as never,
  );
}
type Owner = ReturnType<typeof createGitCommitOwner>;
function mount(send: (input: unknown) => Promise<unknown>, strict = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  let owner: Owner | null = null;
  let latest!: ReturnType<typeof useGitCommitOperations>;
  let navigate!: ReturnType<typeof useNavigate>;
  const errors: unknown[] = [];
  const results: unknown[] = [];
  function Page() {
    const projectId = useParams().projectId!;
    const operations = useGitCommitOperations();
    owner = operations.owner;
    latest = operations;
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
    getOperations: () => latest,
    client,
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

it('adapter刷新等待期间撤权/ABA后不发出旧UI错误回调', async () => {
  const refresh = deferred();
  const app = mount(vi.fn());
  vi.spyOn(api, 'post').mockResolvedValue(success);
  terminalQuery();
  vi.spyOn(app.client, 'invalidateQueries').mockImplementation(async () => {
    await refresh.promise;
  });
  const committed = vi.fn();
  const failed = vi.fn();
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = app
      .getOperations()
      .submit(
        { projectId: project, paths: ['one.ts'], message: '原提交', expectedHead: null },
        committed,
        failed,
      );
    await Promise.resolve();
  });
  expect(committed).toHaveBeenCalledTimes(1);
  act(() => {
    app.getOwner().revoke();
    app.getOwner().activate();
  });
  await act(async () => {
    refresh.reject(new Error('旧刷新失败'));
    await pending;
  });
  expect(failed).not.toHaveBeenCalled();
  expect(app.getOwner().getSnapshot()).toEqual([]);
});
it('adapter成功UI回调同步撤权后不再刷新原缓存', async () => {
  const app = mount(vi.fn());
  vi.spyOn(api, 'post').mockResolvedValue(success);
  terminalQuery();
  const invalidate = vi.spyOn(app.client, 'invalidateQueries');
  const failed = vi.fn();
  await act(async () => {
    await app
      .getOperations()
      .submit(
        { projectId: project, paths: ['one.ts'], message: '原提交', expectedHead: null },
        () => app.getOwner().revoke(),
        failed,
      );
  });
  expect(invalidate).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
});

it('持久marker写入读回后才POST，绑定UUID和原HEAD，完整回执才清marker', async () => {
  const app = mount(vi.fn());
  terminalQuery();
  const post = vi.spyOn(api, 'post').mockImplementation(async (_path, body) => {
    const input = body as { operationId: string; expectedHead: string; protocolVersion: number };
    expect(input.protocolVersion).toBe(1);
    expect(input.expectedHead).toBe(success.sha);
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem(localStorage.key(0)!)).toContain(input.operationId);
    return success as never;
  });
  const committed = vi.fn();
  await act(async () => {
    await app
      .getOperations()
      .submit(
        { projectId: project, paths: ['one'], message: '提交', expectedHead: success.sha },
        committed,
        vi.fn(),
      );
  });
  expect(post).toHaveBeenCalledTimes(1);
  expect(committed).toHaveBeenCalledTimes(1);
  expect(localStorage.length).toBe(0);
});

it('网络回执丢失、卸载重开后只GET，404继续锁定且不重发POST', async () => {
  const first = mount(vi.fn());
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('response lost'));
  await act(async () => {
    await first
      .getOperations()
      .submit(
        { projectId: project, paths: ['one'], message: '提交', expectedHead: null },
        vi.fn(),
        vi.fn(),
      );
  });
  expect(localStorage.length).toBe(1);
  first.view.unmount();
  const second = mount(vi.fn());
  const get = vi.spyOn(api, 'get').mockRejectedValue(new Error('404'));
  await act(async () => {
    await second.getOperations().recover(project);
  });
  expect(second.getOwner().isLocked(project)).toBe(true);
  expect(get).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledTimes(1);
  expect(localStorage.length).toBe(1);
  await act(async () => {
    await expect(
      second
        .getOperations()
        .submit(
          { projectId: project, paths: ['two'], message: '新草稿', expectedHead: null },
          vi.fn(),
          vi.fn(),
        ),
    ).rejects.toThrow();
  });
  expect(post).toHaveBeenCalledTimes(1);
});

it('原操作只读恢复成功仅解恢复锁，不调用当前草稿完成回调', async () => {
  const first = mount(vi.fn());
  const post = vi.spyOn(api, 'post').mockRejectedValue(new Error('response lost'));
  const committed = vi.fn();
  await act(async () => {
    await first
      .getOperations()
      .submit(
        { projectId: project, paths: ['one'], message: '旧提交', expectedHead: null },
        committed,
        vi.fn(),
      );
  });
  terminalQuery();
  await act(async () => {
    await first.getOperations().recover(project);
  });
  expect(first.getOwner().isLocked(project)).toBe(false);
  expect(localStorage.length).toBe(0);
  expect(committed).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledTimes(1);
});

it('存储不可写拒绝POST；缺少原HEAD不生成marker或POST', async () => {
  const app = mount(vi.fn());
  const post = vi.spyOn(api, 'post');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await act(async () => {
    await app
      .getOperations()
      .submit(
        { projectId: project, paths: ['one'], message: '提交', expectedHead: null },
        vi.fn(),
        vi.fn(),
      );
  });
  expect(post).not.toHaveBeenCalled();
  expect(app.getOwner().isLocked(project)).toBe(true);
});

it('恢复GET在途撤权不移除marker，不显示旧结果', async () => {
  const app = mount(vi.fn());
  vi.spyOn(api, 'post').mockRejectedValue(new Error('lost'));
  await act(async () => {
    await app
      .getOperations()
      .submit(
        { projectId: project, paths: ['one'], message: '旧提交', expectedHead: null },
        vi.fn(),
        vi.fn(),
      );
  });
  const read = deferred();
  vi.spyOn(api, 'get').mockReturnValue(read.promise as never);
  let pending!: Promise<void>;
  await act(async () => {
    pending = app.getOperations().recover(project);
  });
  act(() => authSession.notifyAuthorizationRequired());
  await act(async () => {
    read.resolve({});
    await pending;
  });
  expect(localStorage.length).toBe(1);
  expect(app.getOwner().getSnapshot()).toEqual([]);
});

it('POST有效SHA但持久GET无回执时仍保留marker，不清当前草稿', async () => {
  const app = mount(vi.fn());
  vi.spyOn(api, 'post').mockResolvedValue(success);
  vi.spyOn(api, 'get').mockRejectedValue(new Error('404'));
  const committed = vi.fn();
  await act(async () => {
    await app
      .getOperations()
      .submit(
        { projectId: project, paths: ['one'], message: '提交', expectedHead: null },
        committed,
        vi.fn(),
      );
  });
  expect(committed).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(1);
  expect(app.getOwner().isLocked(project)).toBe(true);
});

it('错误项目恢复记录无法解析时禁止POST，不删除坏记录', async () => {
  const app = mount(vi.fn());
  const key = `agenthub:git-commit:v1:${encodeURIComponent(`account:${accountA}`)}:${project}:dddddddd-dddd-4ddd-8ddd-dddddddddddd`;
  localStorage.setItem(key, '{broken');
  const post = vi.spyOn(api, 'post');
  await act(async () => {
    await app.getOperations().recover(project);
  });
  expect(app.getOwner().isLocked(project)).toBe(true);
  expect(localStorage.getItem(key)).toBe('{broken');
  await act(async () => {
    await expect(
      app
        .getOperations()
        .submit(
          { projectId: project, paths: ['one'], message: '提交', expectedHead: null },
          vi.fn(),
          vi.fn(),
        ),
    ).rejects.toThrow();
  });
  expect(post).not.toHaveBeenCalled();
});

it('POST畸形SHA不清marker；随后持久终态恢复解锁但不清草稿', async () => {
  const app = mount(vi.fn());
  vi.spyOn(api, 'post').mockResolvedValue({ sha: 'short' });
  terminalQuery();
  const committed = vi.fn();
  await act(async () => {
    await app
      .getOperations()
      .submit(
        { projectId: project, paths: ['one'], message: '提交', expectedHead: null },
        committed,
        vi.fn(),
      );
  });
  expect(localStorage.length).toBe(1);
  expect(api.get).not.toHaveBeenCalled();
  expect(app.getOwner().isLocked(project)).toBe(true);
  await act(async () => {
    await app.getOperations().recover(project);
  });
  expect(localStorage.length).toBe(0);
  expect(app.getOwner().isLocked(project)).toBe(false);
  expect(committed).not.toHaveBeenCalled();
});

it('并发旧恢复GET晚到失败不能重新锁定已确认操作', async () => {
  const app = mount(vi.fn());
  vi.spyOn(api, 'post').mockRejectedValue(new Error('lost'));
  await act(async () => {
    await app
      .getOperations()
      .submit(
        { projectId: project, paths: ['one'], message: '旧提交', expectedHead: null },
        vi.fn(),
        vi.fn(),
      );
  });
  const old = deferred();
  terminalQuery();
  vi.mocked(api.get).mockImplementationOnce(() => old.promise as never);
  let first!: Promise<void>;
  await act(async () => {
    first = app.getOperations().recover(project);
  });
  await act(async () => {
    await app.getOperations().recover(project);
  });
  expect(app.getOwner().isLocked(project)).toBe(false);
  await act(async () => {
    old.reject(new Error('old response'));
    await first;
  });
  expect(app.getOwner().isLocked(project)).toBe(false);
});
