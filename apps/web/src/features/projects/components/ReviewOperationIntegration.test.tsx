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
function mount(kind: 'task' | 'worktree' = 'task', warm = false, search = '?task=t1') {
  let observedOwner: ReviewOperationOwner | undefined;
  function OwnerProbe() {
    observedOwner = useReviewOperations()?.owner;
    return null;
  }
  let rows = [task, { ...task, id: 't2', title: '第二项工作' }];
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
        <MemoryRouter initialEntries={[`/projects/p1/work${search}`]}>
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

function mobile() {
  return vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === '(max-width: 767px)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => false,
  }));
}
it('手机列表进入单详情并返回保留反馈输入与筛选', async () => {
  const media = mobile();
  try {
    mount('task', false, '?status=WAITING_REVIEW');
    expect(await screen.findByRole('region', { name: '工作列表' })).toBeVisible();
    expect(screen.queryByRole('complementary', { name: '工作 Inspector' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /待审阅任务/ }));
    const field = await screen.findByRole('textbox', { name: '继续修改说明' });
    fireEvent.change(field, { target: { value: '保留我的反馈' } });
    expect(screen.queryByRole('region', { name: '工作列表' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回工作列表' }));
    expect(screen.getByRole('region', { name: '工作列表' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /待审阅任务/ }));
    expect(screen.getByRole('textbox', { name: '继续修改说明' })).toBe(field);
    expect(field).toHaveValue('保留我的反馈');
  } finally {
    media.mockRestore();
  }
});
it('手机unknown返回列表仍保留原Inspector并阻止选其他工作', async () => {
  const media = mobile();
  try {
    mount();
    vi.mocked(api.post).mockRejectedValue(new Error('unknown network'));
    await rework();
    await screen.findByText('工作操作结果待核对');
    fireEvent.click(screen.getByRole('button', { name: '返回工作列表' }));
    fireEvent.click(screen.getByRole('button', { name: /第二项工作/ }));
    expect(screen.getByText('原工作仍在提交或等待核对，请先处理原操作。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '返回原工作' }));
    expect(screen.getByRole('textbox', { name: '继续修改说明' })).toHaveValue('修正边界');
    expect(api.post).toHaveBeenCalledTimes(1);
  } finally {
    media.mockRestore();
  }
});
it.each(['?task=missing', '?task=missing&view=board'])(
  '手机非法task显示不存在，不暴露fallback任务动作 %s',
  async (query) => {
    const media = mobile();
    try {
      mount('task', false, query);
      expect(await screen.findByText('找不到这项工作')).toBeVisible();
      expect(screen.queryByLabelText('工作看板')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('complementary', { name: '工作 Inspector' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '提交继续修改' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '返回工作列表' }));
      expect(screen.getByRole('region', { name: '工作列表' })).toBeVisible();
    } finally {
      media.mockRestore();
    }
  },
);

it.each(['task', 'worktree'] as const)(
  '手机%s审阅pending返回再进入后晚成功不导航，保留显式结果',
  async (kind) => {
    const media = mobile();
    try {
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
          target: { value: '继续修正' },
        });
        fireEvent.click(screen.getByRole('button', { name: '提交隔离工作区返工' }));
      }
      fireEvent.click(screen.getByRole('button', { name: '返回工作列表' }));
      expect(screen.getByRole('region', { name: '工作列表' })).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: /待审阅任务/ }));
      const response =
        kind === 'task'
          ? success
          : {
              id: 'execution-a',
              projectId: 'p1',
              taskId: 't1',
              status: 'RUNNING',
              sessionId: 'old-session',
              runId: 'new-run',
            };
      await act(async () => finish(response));
      expect(screen.queryByRole('heading', { name: '工作区已打开' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: '打开已确认结果' })).toHaveAttribute(
        'href',
        kind === 'task' ? '/workspace/new-session' : '/workspace/old-session',
      );
    } finally {
      media.mockRestore();
    }
  },
);

it('手机当前筛选排除选中工作，返回将焦点放到列表容器', async () => {
  const media = mobile();
  try {
    mount('task', false, '?task=t1&status=DONE');
    await screen.findByRole('textbox', { name: '继续修改说明' });
    fireEvent.click(screen.getByRole('button', { name: '返回工作列表' }));
    expect(screen.getByRole('region', { name: '工作列表' })).toHaveFocus();
  } finally {
    media.mockRestore();
  }
});
