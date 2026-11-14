// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Link,
  MemoryRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { api } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';
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
function mount(kind: 'task' | 'worktree' = 'task', warm = false, search = '?task=t1', count = 2) {
  let observedOwner: ReviewOperationOwner | undefined;
  let go: ((path: string) => void) | undefined;
  function OwnerProbe() {
    observedOwner = useReviewOperations()?.owner;
    return null;
  }
  let rows = [
    task,
    { ...task, id: 't2', title: '第二项工作' },
    ...Array.from({ length: Math.max(0, count - 2) }, (_, index) => ({
      ...task,
      id: `t${index + 3}`,
      title: `工作 ${index + 3}`,
    })),
  ];
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
        mergeAdmission: {
          expectedRunId: 'old-run',
          expectedOperationId: 'operation-a',
          dispatchOperationId: 'operation-a',
          retryEligible: false,
          mergeAllowed: true,
        },
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
    go = useNavigate();
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
    go: (path: string) => go?.(path),
    refreshTasks: () => client.invalidateQueries({ queryKey: ['tasks', 'p1'] }),
    getOperations: () => observedOwner?.getSnapshot(),
    client,
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

function mobile(width = 390) {
  return vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: width <= Number(query.match(/max-width: (\d+)px/)?.[1] ?? 0),
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
it.each([390, 768, 1023])(
  '%spx unknown返回列表仍保留原Inspector并阻止选其他工作',
  async (width) => {
    const media = mobile(width);
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
  },
);
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

function responsiveViewport(initial: number) {
  let width = initial;
  const lists: Array<{ media: string; listeners: Set<() => void> }> = [];
  const spy = vi.spyOn(window, 'matchMedia').mockImplementation((media) => {
    const item = { media, listeners: new Set<() => void>() };
    lists.push(item);
    return {
      get matches() {
        return width <= Number(media.match(/max-width: (\d+)px/)?.[1] ?? 0);
      },
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_event: string, handler: EventListenerOrEventListenerObject) =>
        item.listeners.add(handler as () => void),
      removeEventListener: (_event: string, handler: EventListenerOrEventListenerObject) =>
        item.listeners.delete(handler as () => void),
      dispatchEvent: () => false,
    };
  });
  return {
    restore: () => spy.mockRestore(),
    resize: (next: number) =>
      act(() => {
        width = next;
        lists.forEach((item) => item.listeners.forEach((fn) => fn()));
      }),
  };
}
it.each([768, 1023])('%spx多任务列表与详情互斥，平板筛选不折叠', async (width) => {
  const viewport = responsiveViewport(width);
  try {
    mount('task', false, '', 30);
    const list = await screen.findByRole('region', { name: '工作列表' });
    expect(list.querySelectorAll('button')).toHaveLength(30);
    expect(screen.queryByRole('complementary', { name: '工作 Inspector' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '工作状态' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '筛选' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /工作 30/ }));
    expect(await screen.findByRole('heading', { name: '工作 30' })).toBeVisible();
    expect(screen.queryByRole('region', { name: '工作列表' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回工作列表' }));
    expect(screen.getByRole('region', { name: '工作列表' })).toBeVisible();
  } finally {
    viewport.restore();
  }
});
it('1024px仍显示双栏，不引入详情返回按钮', async () => {
  const viewport = responsiveViewport(1024);
  try {
    mount();
    expect(await screen.findByRole('region', { name: '工作列表' })).toBeVisible();
    expect(screen.getByRole('complementary', { name: '工作 Inspector' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '返回工作列表' })).not.toBeInTheDocument();
  } finally {
    viewport.restore();
  }
});
it('编辑框在390→768→1024→768保持同一节点及焦点', async () => {
  const viewport = responsiveViewport(390);
  try {
    mount();
    const field = await screen.findByRole('textbox', { name: '继续修改说明' });
    field.focus();
    fireEvent.change(field, { target: { value: '跨断点保留输入' } });
    for (const width of [768, 1024, 768]) {
      viewport.resize(width);
      expect(screen.getByRole('textbox', { name: '继续修改说明' })).toBe(field);
      expect(field).toHaveFocus();
      expect(field).toHaveValue('跨断点保留输入');
    }
  } finally {
    viewport.restore();
  }
});
it.each(['task', 'worktree'] as const)(
  '%s pending跨phone/tablet/wide/tablet不卸载且晚成功不导航',
  async (kind) => {
    const viewport = responsiveViewport(390);
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
          target: { value: '跨断点修改' },
        });
        fireEvent.click(screen.getByRole('button', { name: '提交隔离工作区返工' }));
      }
      const field = screen.getByRole('textbox', {
        name: kind === 'task' ? '继续修改说明' : '隔离工作区修改说明',
      });
      for (const width of [768, 1024, 768]) {
        viewport.resize(width);
        expect(field).toBeInTheDocument();
      }
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
      expect(screen.queryByRole('heading', { name: '工作区已打开' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: '打开已确认结果' })).toHaveAttribute(
        'href',
        kind === 'task' ? '/workspace/new-session' : '/workspace/old-session',
      );
      expect(api.post).toHaveBeenCalledTimes(1);
    } finally {
      viewport.restore();
    }
  },
);

it('无task桌面编辑区缩到平板列表，将隐藏编辑器焦点移回选中行', async () => {
  const viewport = responsiveViewport(1024);
  try {
    mount('task', false, '');
    const field = await screen.findByRole('textbox', { name: '继续修改说明' });
    field.focus();
    viewport.resize(768);
    expect(field).toBeInTheDocument();
    expect(field).not.toBeVisible();
    expect(screen.getByRole('button', { name: /待审阅任务/ })).toHaveFocus();
  } finally {
    viewport.restore();
  }
});
it.each([767, 768, 1023, 1024])(
  '%spx warm cache首次合法返工不会被布局初始化错误阻止',
  async (width) => {
    const viewport = responsiveViewport(width);
    try {
      mount('task', true);
      vi.mocked(api.post).mockResolvedValue(success as never);
      await rework();
      expect(await screen.findByRole('heading', { name: '工作区已打开' })).toBeVisible();
    } finally {
      viewport.restore();
    }
  },
);

it.each(['editor', 'outside'] as const)(
  '平板详情任务被删除后仅迁移隐藏焦点（原焦点%s）',
  async (focus) => {
    const viewport = responsiveViewport(768);
    try {
      const h = mount();
      const field = await screen.findByRole('textbox', { name: '继续修改说明' });
      const outside = screen.getByRole('link', { name: '离开工作页' });
      (focus === 'editor' ? field : outside).focus();
      h.setRows([{ ...task, id: 't2', title: '剩余工作' }]);
      await act(async () => {
        await h.refreshTasks();
      });
      expect(await screen.findByText('找不到这项工作')).toBeVisible();
      const back = screen.getByRole('button', { name: '返回工作列表' });
      expect(focus === 'editor' ? back : outside).toHaveFocus();
      expect(screen.queryByRole('region', { name: '工作列表' })).not.toBeInTheDocument();
    } finally {
      viewport.restore();
    }
  },
);
it('平板同页URL切到看板后隐藏编辑器焦点移到可见列表切换按钮', async () => {
  const viewport = responsiveViewport(768);
  try {
    const h = mount();
    const field = await screen.findByRole('textbox', { name: '继续修改说明' });
    field.focus();
    act(() => h.go('/projects/p1/work?task=t1&view=board'));
    expect(screen.getByLabelText('工作看板')).toBeVisible();
    expect(screen.getByRole('button', { name: '列表' })).toHaveFocus();
    expect(screen.queryByRole('region', { name: '工作列表' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '工作 Inspector' })).not.toBeInTheDocument();
  } finally {
    viewport.restore();
  }
});

it('MERGING缓存与失败刷新交错不能丢失原合并的只读核对入口', async () => {
  const h = mount('worktree');
  let reject!: (error: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((_yes, no) => {
        reject = no;
      }) as never,
  );
  fireEvent.click(await screen.findByRole('button', { name: '读取隔离工作区审阅' }));
  await screen.findByText('已读取差异');
  fireEvent.click(screen.getByRole('checkbox', { name: '我已审阅改动，确认提交并合并到基础分支' }));
  fireEvent.click(screen.getByRole('button', { name: '提交并合并隔离工作区' }));
  await waitFor(() => expect(h.getOperations()?.at(-1)?.phase).toBe('pending'));
  const original = vi.mocked(api.get).getMockImplementation()!;
  const rows = h.client.getQueryData<Array<Record<string, unknown>>>(['worktrees', 'p1'])!;
  let finishRefresh!: (value: unknown) => void;
  const refresh = new Promise((yes) => {
    finishRefresh = yes;
  });
  vi.mocked(api.get).mockImplementation((path) =>
    path.startsWith('/worktree-executions?') ? (refresh as never) : original(path),
  );
  act(() =>
    h.client.setQueryData(
      ['worktrees', 'p1'],
      rows.map((row) => ({ ...row, status: 'MERGING' })),
    ),
  );
  await act(async () =>
    reject(new ApiError('WORKTREE_GIT_PREWRITE_REJECTED', '明确前置拒绝', 409)),
  );
  expect(h.getOperations()?.at(-1)?.phase).toBe('unknown');
  await act(async () => finishRefresh(rows));
  await screen.findByRole('button', { name: '读取隔离工作区审阅' });
  expect(screen.getByRole('button', { name: '核对原隔离执行' })).toBeVisible();
  expect(vi.mocked(api.post)).toHaveBeenCalledTimes(1);
});

it('Worktree未知跨路由后按原实际attempt核对，仅明确拒绝可重新审阅', async () => {
  const h = mount('worktree');
  const original = vi.mocked(api.get).getMockImplementation()!;
  let rejected = false;
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/worktree-executions/execution-a')
      return h.client.getQueryData<Array<unknown>>(['worktrees', 'p1'])?.[0] as never;
    const value = await original(path);
    if (path === '/worktree-executions/execution-a/review' && rejected)
      return {
        ...(value as object),
        mergeAdmission: {
          expectedRunId: 'old-run',
          expectedOperationId: 'operation-a',
          dispatchOperationId: 'operation-b',
          retryEligible: true,
          mergeAllowed: true,
        },
      } as never;
    return value;
  });
  vi.mocked(api.post).mockImplementation(async () => {
    rejected = true;
    throw new ApiError('WORKTREE_GIT_PREWRITE_REJECTED', '明确前置拒绝', 409);
  });
  fireEvent.click(await screen.findByRole('button', { name: '读取隔离工作区审阅' }));
  await screen.findByText('已读取差异');
  fireEvent.click(screen.getByRole('checkbox', { name: '我已审阅改动，确认提交并合并到基础分支' }));
  fireEvent.click(screen.getByRole('button', { name: '提交并合并隔离工作区' }));
  await waitFor(() => expect(h.getOperations()?.at(-1)?.phase).toBe('unknown'));
  expect(h.getOperations()?.at(-1)).toMatchObject({
    gitMergeAttempt: { runId: 'old-run', operationId: 'operation-a' },
  });
  fireEvent.click(screen.getByRole('link', { name: '离开工作页' }));
  await screen.findByRole('heading', { name: '其他页面' });
  fireEvent.click(screen.getByRole('button', { name: '核对原操作' }));
  await waitFor(() => expect(h.getOperations()?.at(-1)?.phase).toBe('retryable'));
  expect(api.post).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('link', { name: '返回原任务' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '读取隔离工作区审阅' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: '读取隔离工作区审阅' }));
  await screen.findByText('已读取差异');
  expect(
    screen.getByRole('checkbox', { name: '我已审阅改动，确认提交并合并到基础分支' }),
  ).not.toBeChecked();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
});
