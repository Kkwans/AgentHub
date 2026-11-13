// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { api } from '../../../lib/api';
import { ProjectWorkPage } from '../pages/ProjectWorkPage';
import { ReviewOperationProvider, useReviewOperations } from './ReviewOperationProvider';
import type { ReviewOperationOwner } from '../lib/review-operation-owner';
import { ReviewOperationStatus } from './ReviewOperationStatus';
const auth = vi.hoisted(() => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'token',
  useAuthUser: () => ({ id: auth.id }),
}));
vi.mock('../../../lib/api', async () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  authSession: (await import('../../../lib/auth-api')).authSession,
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
  auth.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
});
const project = { id: 'p1', name: '项目', status: 'ACTIVE', kind: 'STANDARD', repoKind: 'NONE' };
const task = {
  id: 't1',
  projectId: 'p1',
  title: '待审阅任务',
  status: 'WAITING_REVIEW',
  assignedAgentId: 'a1',
  sessionId: 'old-session',
  finalRunId: 'old-run',
};
const success = {
  task: { ...task, status: 'IN_PROGRESS', sessionId: 'new-session' },
  session: { id: 'new-session' },
  run: { id: 'new-run' },
};
function mount(kind: 'task' | 'worktree' = 'task', warm = false) {
  let observedOwner: ReviewOperationOwner | undefined;
  function OwnerProbe() {
    observedOwner = useReviewOperations()?.owner;
    return null;
  }
  let rows = [task];
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path.startsWith('/tasks?')) return rows as T;
    if (path.startsWith('/worktree-executions?'))
      return (
        kind === 'worktree'
          ? [
              {
                id: 'execution-a',
                projectId: 'p1',
                taskId: 't1',
                status: 'REVIEW',
                sessionId: 'old-session',
                runId: 'old-run',
                taskBranch: 'task/a',
                baseBranch: 'main',
                baseSha: 'base',
                worktreePath: '/tmp/tree',
              },
            ]
          : []
      ) as T;
    if (path === '/worktree-executions/execution-a/review')
      return {
        worktreePath: '/tmp/tree',
        baseSha: 'base',
        headSha: 'head',
        taskBranch: 'task/a',
        clean: false,
        aheadBy: 0,
        entries: [],
        patch: '',
        diffStat: '已读取差异',
        truncated: false,
      } as T;
    if (path === '/tasks/t1') return rows[0] as T;
    if (path === '/agents')
      return [{ id: 'a1', name: 'Codex', status: 'READY', enabled: true }] as T;
    if (path.endsWith('/agent-eligibility'))
      return {
        projectId: 'p1',
        basis: 'REGISTERED_STATE',
        livePreflight: false,
        agents: [{ agentId: 'a1', eligible: true }],
      } as T;
    return [] as T;
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: warm ? Infinity : 0 } },
  });
  if (warm) {
    client.setQueryData(['tasks', 'p1'], rows);
    for (const key of ['goals', 'worktrees', 'prompts']) client.setQueryData([key, 'p1'], []);
    client.setQueryData(['agents'], [{ id: 'a1', name: 'Codex', status: 'READY', enabled: true }]);
    client.setQueryData(['execution-targets'], []);
    client.setQueryData(['agent-eligibility', 'p1'], [{ agentId: 'a1', eligible: true }]);
  }
  clients.push(client);
  function Location() {
    return <output data-testid="integration-location">{useLocation().pathname}</output>;
  }
  const tree = () => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/projects/p1/work?task=t1']}>
          <ReviewOperationProvider>
            <OwnerProbe />
            <Link to="/other">离开工作页</Link>
            <Link to="/projects/p1/work?task=t1">返回原任务</Link>
            <ReviewOperationStatus />
            <Routes>
              <Route path="/projects/:projectId" element={<Outlet context={project} />}>
                <Route path="work" element={<ProjectWorkPage />} />
              </Route>
              <Route path="/other" element={<h2>其他页面</h2>} />
              <Route path="/workspace/:id" element={<h2>工作区已打开</h2>} />
            </Routes>
            <Location />
          </ReviewOperationProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>
  );
  const h = render(tree());
  return {
    ...h,
    updateAuth: () => h.rerender(tree()),
    getOperations: () => observedOwner?.getSnapshot(),
    setRows: (next: typeof rows) => {
      rows = next;
    },
  };
}
async function rework() {
  fireEvent.change(await screen.findByRole('textbox', { name: '继续修改说明' }), {
    target: { value: '修正边界' },
  });
  fireEvent.click(screen.getByRole('button', { name: '提交继续修改' }));
}
it('StrictMode首次合法返工仍正常导航，capture gate不被初始化effect失效', async () => {
  const h = mount();
  vi.mocked(api.post).mockImplementation(async () => {
    expect(h.getOperations()?.at(-1)?.phase).toBe('pending');
    return success as never;
  });
  await rework();
  expect(await screen.findByRole('heading', { name: '工作区已打开' })).toBeVisible();
  expect(h.getOperations()?.at(-1)).toMatchObject({
    phase: 'resolved',
    resultHref: '/workspace/new-session',
  });
});
it('离开路由后合法晚响应不拉回工作区，结果交给持久owner', async () => {
  mount();
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  await rework();
  fireEvent.click(screen.getByRole('link', { name: '离开工作页' }));
  expect(await screen.findByRole('heading', { name: '其他页面' })).toBeVisible();
  await act(async () => finish(success));
  expect(screen.getByTestId('integration-location')).toHaveTextContent('/other');
  expect(screen.getByRole('link', { name: '打开已确认结果' })).toHaveAttribute(
    'href',
    '/workspace/new-session',
  );
  fireEvent.click(screen.getByRole('button', { name: '关闭已确认结果' }));
  expect(screen.queryByRole('region', { name: '工作操作记录' })).not.toBeInTheDocument();
});
it('unknown跨路由remount仍锁定原任务并提供独立只读核对，不重试写请求', async () => {
  mount();
  vi.mocked(api.post).mockRejectedValue(new Error('network uncertain'));
  await rework();
  await screen.findByText('工作操作结果待核对');
  fireEvent.click(screen.getByRole('link', { name: '离开工作页' }));
  await screen.findByRole('heading', { name: '其他页面' });
  fireEvent.click(screen.getByRole('button', { name: '核对原操作' }));
  await screen.findByText(/这是状态核对，不是原请求成功确认/);
  fireEvent.click(screen.getByRole('link', { name: '返回原任务' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '确认达到验收标准' })).toBeDisabled(),
  );
  expect(screen.getByRole('button', { name: '提交继续修改' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '核对原操作' })).toBeEnabled();
  expect(api.post).toHaveBeenCalledTimes(1);
});
it('身份切换清空旧结果，旧用户晚响应不得向新用户交付链接', async () => {
  const h = mount();
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  await rework();
  auth.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  h.updateAuth();
  await act(async () => finish(success));
  expect(screen.queryByRole('region', { name: '工作操作记录' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '打开已确认结果' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '工作区已打开' })).not.toBeInTheDocument();
});

it.each(['task', 'worktree'] as const)(
  '%s跨route离开再进入同任务，旧成功不得拉走且owner保留结果',
  async (kind) => {
    mount(kind);
    let finish!: (value: unknown) => void;
    vi.mocked(api.post).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
    );
    if (kind === 'task') await rework();
    else {
      fireEvent.click(await screen.findByRole('button', { name: '读取隔离工作区审阅' }));
      await screen.findByText('已读取差异');
      fireEvent.change(screen.getByRole('textbox', { name: '隔离工作区修改说明' }), {
        target: { value: '修正隔离边界' },
      });
      fireEvent.click(screen.getByRole('button', { name: '提交隔离工作区返工' }));
    }
    fireEvent.click(screen.getByRole('link', { name: '离开工作页' }));
    await screen.findByRole('heading', { name: '其他页面' });
    fireEvent.click(screen.getByRole('link', { name: '返回原任务' }));
    await screen.findByRole('complementary', { name: '工作 Inspector' });
    expect(
      screen.getByRole('button', {
        name: kind === 'task' ? '确认达到验收标准' : '读取隔离工作区审阅',
      }),
    ).toBeDisabled();
    await act(async () =>
      finish(
        kind === 'task'
          ? success
          : {
              id: 'execution-a',
              projectId: 'p1',
              taskId: 't1',
              sessionId: 'old-session',
              runId: 'new-run',
              status: 'RUNNING',
            },
      ),
    );
    expect(screen.getByTestId('integration-location')).toHaveTextContent('/projects/p1/work');
    expect(screen.getByRole('link', { name: '打开已确认结果' })).toHaveAttribute(
      'href',
      kind === 'task' ? '/workspace/new-session' : '/workspace/old-session',
    );
    expect(api.post).toHaveBeenCalledTimes(1);
  },
);

it('StrictMode warm cache首render已有选中任务，首操作仍可正常导航', async () => {
  const h = mount('task', true);
  expect(api.get).not.toHaveBeenCalled();
  vi.mocked(api.post).mockImplementation(async () => {
    expect(h.getOperations()?.at(-1)?.phase).toBe('pending');
    return success as never;
  });
  await rework();
  expect(await screen.findByRole('heading', { name: '工作区已打开' })).toBeVisible();
});
