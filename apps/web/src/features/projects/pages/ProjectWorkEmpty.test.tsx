// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectContextLayout } from './ProjectContextLayout';
import { ProjectWorkPage } from './ProjectWorkPage';
import { api } from '../../../lib/api';
import { ApiError } from '../../../lib/api-error';

vi.mock('../../../lib/api', async () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  authSession: (await import('../../../lib/auth-api')).authSession,
}));
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'local_trusted',
  useAuthUser: () => null,
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});
const project = {
  id: 'project-1',
  name: '当前项目',
  rootPath: '/projects/current',
  status: 'ACTIVE',
  kind: 'STANDARD',
  repoKind: 'NONE',
};
const task = {
  id: 'task-1',
  projectId: project.id,
  title: '真实任务',
  description: '验收说明',
  status: 'BACKLOG',
  updatedAt: '2026-11-12T00:00:00Z',
};
function registeredEligibility(agents = selectableAgents, projectId = project.id) {
  return {
    projectId,
    basis: 'REGISTERED_STATE',
    livePreflight: false,
    agents: agents.map((agent) => ({
      agentId: agent.id,
      eligible: true,
      reason: null as string | null,
      agentStatus: 'READY',
      targetStatus: 'READY',
    })),
  };
}
function mount(
  rows: unknown[] | Promise<unknown[]> = [],
  query = '',
  agents: unknown[] = selectableAgents,
  eligibility: unknown = registeredEligibility(),
  worktrees: unknown[] | Promise<unknown[]> = [],
  targets: unknown[] = [],
) {
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path === `/projects/${project.id}`) return project as T;
    if (path.startsWith('/tasks?')) return (await rows) as T;
    if (path === '/tasks/task-1') return task as T;
    if (path === '/agents') return agents as T;
    if (path === '/execution-targets') return targets as T;
    if (path.startsWith('/worktree-executions?')) return (await worktrees) as T;
    if (path.endsWith('/agent-eligibility')) return (await eligibility) as T;
    return [] as T;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/projects/${project.id}/work${query}`]}>
        <Routes>
          <Route path="/workspace/:sessionId" element={<h2>已进入工作区</h2>} />
          <Route path="/projects/:projectId" element={<ProjectContextLayout />}>
            <Route path="work" element={<ProjectWorkPage />} />
            <Route path="work/new" element={<h2>创建当前项目工作</h2>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
it.each(['', '?view=board&status=DONE'])(
  '真空项目只保留项目header精确新建入口，无无用工具栏/Inspector %s',
  async (query) => {
    mount([], query);
    await screen.findByRole('heading', { name: '开始这个项目的第一项工作' });
    expect(screen.queryByRole('textbox', { name: '搜索工作' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '工作 Inspector' })).not.toBeInTheDocument();
    expect(screen.queryByText('从列表选择工作')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: '新建工作' });
    expect(link).toHaveAttribute('href', '/projects/project-1/work/new');
    expect(screen.getAllByRole('button', { name: '新建工作' })).toHaveLength(1);
    fireEvent.click(link);
    expect(await screen.findByRole('heading', { name: '创建当前项目工作' })).toBeVisible();
  },
);
it('有任务但搜索无结果仍保留筛选和选中详情', async () => {
  mount([task]);
  const search = await screen.findByRole('textbox', { name: '搜索工作' });
  fireEvent.change(search, { target: { value: '不匹配' } });
  expect(screen.getByText('没有匹配的工作')).toBeVisible();
  expect(
    within(screen.getByRole('complementary', { name: '工作 Inspector' })).getByText('真实任务'),
  ).toBeVisible();
  expect(screen.queryByText('开始这个项目的第一项工作')).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: '' } });
  expect(screen.queryByText('没有匹配的工作')).not.toBeInTheDocument();
});
it('加载中不冒充空项目', () => {
  mount(new Promise(() => {}));
  expect(screen.queryByText('开始这个项目的第一项工作')).not.toBeInTheDocument();
});
it('错误不冒充空项目', async () => {
  const promise = Promise.reject(new Error('工作读取失败'));
  promise.catch(() => {});
  mount(promise);
  await screen.findByText('工作读取失败');
  expect(screen.queryByText('开始这个项目的第一项工作')).not.toBeInTheDocument();
});
it('新增任务后自动恢复已有列表与AH039取消组件', async () => {
  const client = mount([]);
  await screen.findByText('开始这个项目的第一项工作');
  await act(async () => {
    client.setQueryData(
      ['tasks', project.id],
      [{ ...task, status: 'IN_PROGRESS', sessionId: 'session-1' }],
    );
  });
  expect(await screen.findByRole('textbox', { name: '搜索工作' })).toBeVisible();
  expect(screen.getByRole('button', { name: '前往工作区停止执行' })).toBeVisible();
  expect(screen.queryByText('开始这个项目的第一项工作')).not.toBeInTheDocument();
});

it('无Agent手工开始从BACKLOG先READY再IN_PROGRESS，不启动Session', async () => {
  vi.mocked(api.post).mockImplementation(
    async (_path, body) => ({ ...task, status: (body as { status: string }).status }) as never,
  );
  mount([task]);
  fireEvent.click(await screen.findByRole('button', { name: /^开始(?:手工任务)?$/ }));
  await waitFor(() =>
    expect(vi.mocked(api.post).mock.calls).toEqual([
      ['/tasks/task-1/transition', { status: 'READY' }],
      ['/tasks/task-1/transition', { status: 'IN_PROGRESS' }],
    ]),
  );
  await screen.findByText('任务已标记为进行中；没有启动 Agent。');
});

it.each(['BACKLOG', 'BLOCKED', 'READY'])('Agent启动%s遵守READY前置合同', async (status) => {
  vi.mocked(api.post).mockResolvedValue({ session: { id: 'session-1' } } as never);
  mount([{ ...task, status }], '?agentId=agent-1');
  fireEvent.click(await screen.findByRole('button', { name: '启动 Session' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/start', { agentId: 'agent-1' }),
  );
  expect(vi.mocked(api.post).mock.calls).toEqual([
    ...(status === 'READY' ? [] : [['/tasks/task-1/transition', { status: 'READY' }]]),
    ['/tasks/task-1/start', { agentId: 'agent-1' }],
  ]);
});
it('Agent启动前转换失败可见且不继续start', async () => {
  vi.mocked(api.post).mockRejectedValue(new Error('任务状态已变化，请刷新'));
  mount([{ ...task, status: 'BACKLOG' }], '?agentId=agent-1');
  fireEvent.click(await screen.findByRole('button', { name: '启动 Session' }));
  expect(await screen.findByText('任务状态已变化，请刷新')).toBeVisible();
  expect(api.post).toHaveBeenCalledTimes(1);
});
it('Agent启动失败可见且不自动重试', async () => {
  vi.mocked(api.post).mockRejectedValue(new Error('任务 Prompt 缺少必填变量，尚未启动 Agent'));
  mount([{ ...task, status: 'READY' }], '?agentId=agent-1');
  fireEvent.click(await screen.findByRole('button', { name: '启动 Session' }));
  expect(await screen.findByText('任务 Prompt 缺少必填变量，尚未启动 Agent')).toBeVisible();
  expect(api.post).toHaveBeenCalledTimes(1);
});
it.each(['IN_PROGRESS', 'WAITING_REVIEW', 'DONE', 'CANCELED'])(
  '%s不允许重复Agent启动',
  async (status) => {
    mount([{ ...task, status }], '?agentId=agent-1');
    const button = await screen.findByRole('button', { name: '启动 Session' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(api.post).not.toHaveBeenCalled();
  },
);
it('取消状态转换失败可见', async () => {
  vi.mocked(api.post).mockRejectedValue(new Error('取消状态更新失败'));
  mount([task]);
  fireEvent.click(await screen.findByRole('button', { name: '取消' }));
  expect(await screen.findByText('取消状态更新失败')).toBeVisible();
});

it('切换选择后不继续旧任务的启动，也不把旧错误显示给新任务', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const client = mount([{ ...task, status: 'BLOCKED' }], '?agentId=agent-1');
  fireEvent.click(await screen.findByRole('button', { name: '启动 Session' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/transition', { status: 'READY' }),
  );
  await act(async () =>
    client.setQueryData(
      ['tasks', project.id],
      [{ ...task, id: 'task-2', title: '另一项工作', status: 'READY' }],
    ),
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole('complementary', { name: '工作 Inspector' })).getByText('另一项工作'),
    ).toBeVisible(),
  );
  await act(async () => finish({ ...task, status: 'READY' }));
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('任务操作失败')).not.toBeInTheDocument();
});
it('旧任务启动失败不污染后来选中的任务', async () => {
  let reject!: (reason: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }) as never,
  );
  const client = mount([{ ...task, status: 'READY' }], '?agentId=agent-1');
  fireEvent.click(await screen.findByRole('button', { name: '启动 Session' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/start', { agentId: 'agent-1' }),
  );
  // Keep the refreshed response aligned with the new selected row.
  vi.mocked(api.get).mockImplementation(
    async <T,>(path: string) =>
      (path === `/projects/${project.id}`
        ? project
        : path.startsWith('/tasks?')
          ? [{ ...task, id: 'task-2', title: '另一项工作', status: 'READY' }]
          : path === '/agents'
            ? selectableAgents
            : path.endsWith('/agent-eligibility')
              ? registeredEligibility()
              : []) as T,
  );
  await act(async () =>
    client.setQueryData(
      ['tasks', project.id],
      [{ ...task, id: 'task-2', title: '另一项工作', status: 'READY' }],
    ),
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole('complementary', { name: '工作 Inspector' })).getByText('另一项工作'),
    ).toBeVisible(),
  );
  await act(async () => reject(new Error('旧任务失败')));
  expect(screen.queryByText('旧任务失败')).not.toBeInTheDocument();
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('旧任务启动成功迟到后不跳离新选择', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const client = mount([{ ...task, status: 'READY' }], '?agentId=agent-1');
  fireEvent.click(await screen.findByRole('button', { name: '启动 Session' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/start', { agentId: 'agent-1' }),
  );
  vi.mocked(api.get).mockImplementation(
    async <T,>(path: string) =>
      (path === `/projects/${project.id}`
        ? project
        : path.startsWith('/tasks?')
          ? [{ ...task, id: 'task-2', title: '另一项工作', status: 'READY' }]
          : path === '/agents'
            ? selectableAgents
            : path.endsWith('/agent-eligibility')
              ? registeredEligibility()
              : []) as T,
  );
  await act(async () =>
    client.setQueryData(
      ['tasks', project.id],
      [{ ...task, id: 'task-2', title: '另一项工作', status: 'READY' }],
    ),
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole('complementary', { name: '工作 Inspector' })).getByText('另一项工作'),
    ).toBeVisible(),
  );
  await act(async () => finish({ session: { id: 'session-1' } }));
  expect(screen.queryByText('已进入工作区')).not.toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: '工作 Inspector' })).toBeVisible();
});
it('离开页面后不继续转换之后的启动请求', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  mount([{ ...task, status: 'BLOCKED' }], '?agentId=agent-1');
  fireEvent.click(await screen.findByRole('button', { name: '启动 Session' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/transition', { status: 'READY' }),
  );
  cleanup();
  await act(async () => finish({ ...task, status: 'READY' }));
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('READY转换期间锁定运行Agent选择，失败结束后恢复选择', async () => {
  let reject!: (reason: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }) as never,
  );
  mount([{ ...task, status: 'BLOCKED' }], '?agentId=agent-1');
  const selector = await screen.findByRole('combobox', { name: '运行 Agent' });
  expect(selector).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '启动 Session' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/transition', { status: 'READY' }),
  );
  expect(selector).toBeDisabled();
  await act(async () => reject(new Error('转换失败')));
  await screen.findByText('转换失败');
  expect(selector).not.toBeDisabled();
  expect(api.post).toHaveBeenCalledTimes(1);
});

const selectableAgents = [
  { id: 'agent-1', name: '执行者一', status: 'READY', enabled: true },
  { id: 'agent-2', name: '执行者二', status: 'READY', enabled: true },
];
it('已分配Agent的任务默认显示与实际启动一致', async () => {
  vi.mocked(api.post).mockResolvedValue({ session: { id: 'session-1' } } as never);
  mount([{ ...task, status: 'READY', assignedAgentId: 'agent-1' }], '', selectableAgents);
  const selector = await screen.findByRole('combobox', { name: '运行 Agent' });
  await waitFor(() => expect(selector).toHaveTextContent('执行者一'));
  fireEvent.click(screen.getByRole('button', { name: '启动 Session' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/start', { agentId: 'agent-1' }),
  );
});
it('明确清除运行Agent不会回退显示任务已分配Agent', async () => {
  mount(
    [{ ...task, status: 'READY', assignedAgentId: 'agent-1' }],
    '?agentId=agent-2',
    selectableAgents,
  );
  const selector = await screen.findByRole('combobox', { name: '运行 Agent' });
  await waitFor(() => expect(selector).toHaveTextContent('执行者二'));
  fireEvent.click(selector);
  fireEvent.click(await screen.findByRole('option', { name: '不选择 Agent' }));
  await waitFor(() => expect(selector).toHaveTextContent('不选择 Agent'));
  expect(screen.getByRole('button', { name: '开始手工任务' })).toBeVisible();
});
it('任务切换不沿用上个任务明确选择的Agent', async () => {
  mount(
    [
      { ...task, status: 'READY', assignedAgentId: 'agent-1' },
      { ...task, id: 'task-2', title: '第二项工作', status: 'READY', assignedAgentId: 'agent-1' },
    ],
    '',
    selectableAgents,
  );
  const selector = await screen.findByRole('combobox', { name: '运行 Agent' });
  await waitFor(() => expect(selector).toHaveTextContent('执行者一'));
  fireEvent.click(selector);
  fireEvent.click(await screen.findByRole('option', { name: '执行者二' }));
  fireEvent.click(
    within(screen.getByRole('region', { name: '工作列表' })).getByRole('button', {
      name: /第二项工作/,
    }),
  );
  await waitFor(() => expect(selector).toHaveTextContent('执行者一'));
  fireEvent.click(
    within(screen.getByRole('region', { name: '工作列表' })).getByRole('button', {
      name: /真实任务/,
    }),
  );
  await waitFor(() => expect(selector).toHaveTextContent('执行者一'));
});

it('URL明确Agent覆盖已分配默认并用于请求', async () => {
  vi.mocked(api.post).mockResolvedValue({ session: { id: 'session-1' } } as never);
  mount(
    [{ ...task, status: 'READY', assignedAgentId: 'agent-1' }],
    '?agentId=agent-2',
    selectableAgents,
  );
  const selector = await screen.findByRole('combobox', { name: '运行 Agent' });
  await waitFor(() => expect(selector).toHaveTextContent('执行者二'));
  fireEvent.click(screen.getByRole('button', { name: '启动 Session' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/start', { agentId: 'agent-2' }),
  );
});
it('界面切换任务后不把URL的Agent覆盖带给下一任务', async () => {
  mount(
    [
      { ...task, status: 'READY', assignedAgentId: 'agent-1' },
      { ...task, id: 'task-2', title: '第二项工作', status: 'READY', assignedAgentId: 'agent-1' },
    ],
    '?agentId=agent-2',
    selectableAgents,
  );
  const selector = await screen.findByRole('combobox', { name: '运行 Agent' });
  await waitFor(() => expect(selector).toHaveTextContent('执行者二'));
  fireEvent.click(
    within(screen.getByRole('region', { name: '工作列表' })).getByRole('button', {
      name: /第二项工作/,
    }),
  );
  await waitFor(() => expect(selector).toHaveTextContent('执行者一'));
});
it('跨项目切换不保留前项目的本地Agent选择', async () => {
  const project2 = { ...project, id: 'project-2', name: '第二项目' };
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path === '/projects/project-1') return project as T;
    if (path === '/projects/project-2') return project2 as T;
    if (path.startsWith('/tasks?'))
      return [
        {
          ...task,
          id: path.includes('project-2') ? 'task-2' : task.id,
          projectId: path.includes('project-2') ? project2.id : project.id,
          status: 'READY',
          assignedAgentId: 'agent-1',
        },
      ] as T;
    if (path === '/agents') return selectableAgents as T;
    if (path.endsWith('/agent-eligibility'))
      return registeredEligibility(
        selectableAgents,
        path.includes('project-2') ? project2.id : project.id,
      ) as T;
    return [] as T;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/project-1/work']}>
        <Link to="/projects/project-2/work">转到第二项目</Link>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectContextLayout />}>
            <Route path="work" element={<ProjectWorkPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const selector = await screen.findByRole('combobox', { name: '运行 Agent' });
  await waitFor(() => expect(selector).toHaveTextContent('执行者一'));
  fireEvent.click(selector);
  fireEvent.click(await screen.findByRole('option', { name: '执行者二' }));
  await waitFor(() => expect(selector).toHaveTextContent('执行者二'));
  fireEvent.click(screen.getByRole('link', { name: '转到第二项目' }));
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: '运行 Agent' })).toHaveTextContent('执行者一'),
  );
});

it('保存任务变量只PATCH当前任务，不自动启动', async () => {
  const stored = { ...task, sessionId: null, promptVariablesJson: { subject: '原值' } };
  vi.mocked(api.patch).mockResolvedValue({
    ...stored,
    promptVariablesJson: { subject: '修复值' },
  } as never);
  mount([stored]);
  const input = await screen.findByRole('textbox', { name: '任务 Prompt 变量（JSON 对象）' });
  expect(input).toHaveValue(JSON.stringify(stored.promptVariablesJson, null, 2));
  fireEvent.change(input, { target: { value: '{"subject":"修复值"}' } });
  fireEvent.click(screen.getByRole('button', { name: '保存变量' }));
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith('/tasks/task-1', {
      promptVariables: { subject: '修复值' },
    }),
  );
  expect(api.post).not.toHaveBeenCalled();
  expect(await screen.findByText('变量已保存。')).toBeVisible();
});
it('任务变量非法JSON不允许保存，背景刷新不覆盖未保存输入', async () => {
  const stored = { ...task, sessionId: null, promptVariablesJson: { subject: '原值' } };
  const client = mount([stored]);
  const input = await screen.findByRole('textbox', { name: '任务 Prompt 变量（JSON 对象）' });
  fireEvent.change(input, { target: { value: '[' } });
  expect(screen.getByRole('button', { name: '保存变量' })).toBeDisabled();
  await act(async () =>
    client.setQueryData(
      ['tasks', project.id],
      [{ ...stored, promptVariablesJson: { subject: '后台更新' } }],
    ),
  );
  expect(input).toHaveValue('[');
  expect(api.patch).not.toHaveBeenCalled();
});

it.each(['null', '[]', '"文本"', '4'])('任务变量拒绝非对象JSON %s', async (value) => {
  mount([{ ...task, sessionId: null }]);
  fireEvent.change(await screen.findByRole('textbox', { name: '任务 Prompt 变量（JSON 对象）' }), {
    target: { value },
  });
  expect(screen.getByRole('button', { name: '保存变量' })).toBeDisabled();
  expect(api.patch).not.toHaveBeenCalled();
});
it.each([
  { status: 'IN_PROGRESS', sessionId: null },
  { status: 'BLOCKED', sessionId: null },
  { status: 'READY', sessionId: 'session-1' },
  { status: 'READY', sessionId: undefined },
])('已执行或非待启动任务不提供变量编辑 $status/$sessionId', async (state) => {
  mount([{ ...task, ...state }]);
  await screen.findByRole('complementary', { name: '工作 Inspector' });
  expect(
    screen.queryByRole('textbox', { name: '任务 Prompt 变量（JSON 对象）' }),
  ).not.toBeInTheDocument();
});
it('保存期间锁定竞争动作，失败保留草稿可重试', async () => {
  let fail!: (reason: unknown) => void;
  vi.mocked(api.patch).mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }) as never,
  );
  mount([{ ...task, sessionId: null }], '?agentId=agent-1', selectableAgents);
  const input = await screen.findByRole('textbox', { name: '任务 Prompt 变量（JSON 对象）' });
  fireEvent.change(input, { target: { value: '{"subject":"保留草稿"}' } });
  fireEvent.click(screen.getByRole('button', { name: '保存变量' }));
  await waitFor(() => expect(input).toBeDisabled());
  expect(screen.getByRole('button', { name: '启动 Session' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: '运行 Agent' })).toBeDisabled();
  await act(async () => fail(new Error('保存失败，请重试')));
  expect(await screen.findByText('保存失败，请重试')).toBeVisible();
  expect(input).toHaveValue('{"subject":"保留草稿"}');
  expect(screen.getByRole('button', { name: '保存变量' })).toBeEnabled();
  expect(api.post).not.toHaveBeenCalled();
});
it('旧任务保存晚回包不覆盖新任务草稿或显示旧成功', async () => {
  const first = { ...task, sessionId: null, promptVariablesJson: { subject: '一' } };
  const second = {
    ...task,
    id: 'task-2',
    title: '第二任务',
    sessionId: null,
    promptVariablesJson: { subject: '二' },
  };
  let finish!: (value: unknown) => void;
  vi.mocked(api.patch).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  mount([first, second]);
  fireEvent.change(await screen.findByRole('textbox', { name: '任务 Prompt 变量（JSON 对象）' }), {
    target: { value: '{"subject":"一更新"}' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存变量' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
  fireEvent.click(
    within(screen.getByRole('region', { name: '工作列表' })).getByRole('button', {
      name: /第二任务/,
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: '任务 Prompt 变量（JSON 对象）' })).toHaveValue(
      JSON.stringify(second.promptVariablesJson, null, 2),
    ),
  );
  await act(async () => finish({ ...first, promptVariablesJson: { subject: '一更新' } }));
  expect(screen.queryByText('变量已保存。')).not.toBeInTheDocument();
  const input = screen.getByRole('textbox', { name: '任务 Prompt 变量（JSON 对象）' });
  expect(input).toHaveValue(JSON.stringify(second.promptVariablesJson, null, 2));
  fireEvent.change(input, { target: { value: '{"subject":"二草稿"}' } });
  expect(input).toHaveValue('{"subject":"二草稿"}');
  expect(api.post).not.toHaveBeenCalled();
});
it('清空变量整体保存空对象且重复点击不会并发PATCH', async () => {
  let finish!: (value: unknown) => void;
  const stored = { ...task, sessionId: null, promptVariablesJson: { subject: '原值' } };
  vi.mocked(api.patch).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  mount([stored]);
  fireEvent.change(await screen.findByRole('textbox', { name: '任务 Prompt 变量（JSON 对象）' }), {
    target: { value: '{}' },
  });
  const save = screen.getByRole('button', { name: '保存变量' });
  fireEvent.click(save);
  fireEvent.click(save);
  await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
  expect(api.patch).toHaveBeenCalledWith('/tasks/task-1', { promptVariables: {} });
  await act(async () => finish({ ...stored, promptVariablesJson: {} }));
  expect(await screen.findByText('变量已保存。')).toBeVisible();
});
it('错误任务的保存响应不冒称成功并保留草稿', async () => {
  vi.mocked(api.patch).mockResolvedValue({
    ...task,
    id: 'wrong-task',
    promptVariablesJson: {},
  } as never);
  mount([{ ...task, sessionId: null }]);
  const input = await screen.findByRole('textbox', { name: '任务 Prompt 变量（JSON 对象）' });
  fireEvent.change(input, { target: { value: '{"subject":"不能丢"}' } });
  fireEvent.click(screen.getByRole('button', { name: '保存变量' }));
  expect(await screen.findByText('保存响应无法确认，请核对原任务的变量。')).toBeVisible();
  expect(input).toHaveValue('{"subject":"不能丢"}');
  expect(screen.queryByText('变量已保存。')).not.toBeInTheDocument();
});

it('修复变量后清除旧启动错误但不自动再次启动', async () => {
  const stored = { ...task, status: 'READY', sessionId: null, promptVariablesJson: {} };
  vi.mocked(api.post).mockRejectedValue(new Error('任务 Prompt 缺少必填变量，尚未启动 Agent'));
  vi.mocked(api.patch).mockResolvedValue({
    ...stored,
    promptVariablesJson: { subject: '修复' },
  } as never);
  mount([stored], '?agentId=agent-1', selectableAgents);
  fireEvent.click(await screen.findByRole('button', { name: '启动 Session' }));
  expect(await screen.findByText('任务 Prompt 缺少必填变量，尚未启动 Agent')).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: '任务 Prompt 变量（JSON 对象）' }), {
    target: { value: '{"subject":"修复"}' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存变量' }));
  expect(await screen.findByText('变量已保存。')).toBeVisible();
  expect(screen.queryByText('任务 Prompt 缺少必填变量，尚未启动 Agent')).not.toBeInTheDocument();
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('S54项目不兼容Agent保留选择原因但不可启动', async () => {
  const eligibility = registeredEligibility();
  eligibility.agents[0] = {
    ...eligibility.agents[0]!,
    eligible: false,
    reason: 'INCOMPATIBLE_WORKSPACE',
  };
  mount(
    [{ ...task, status: 'BACKLOG', assignedAgentId: 'agent-1' }],
    '',
    selectableAgents,
    eligibility,
  );
  const button = await screen.findByRole('button', { name: '启动 Session' });
  await screen.findByText(/所选 Agent 不可用于当前项目：无法访问项目工作区/);
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('combobox', { name: '运行 Agent' }));
  expect(
    await screen.findByRole('option', { name: /执行者一.*无法访问项目工作区/ }),
  ).toHaveAttribute('aria-disabled', 'true');
});
it.each(['loading', 'error'] as const)('S54资格%s仅阻止Agent启动不阻止手工任务', async (mode) => {
  const eligibility =
    mode === 'loading' ? new Promise(() => {}) : Promise.reject(new Error('资格服务不可达'));
  if (mode === 'error') eligibility.catch(() => {});
  mount([{ ...task, status: 'READY' }], '?agentId=agent-1', selectableAgents, eligibility);
  const button = await screen.findByRole('button', { name: '启动 Session' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('combobox', { name: '运行 Agent' }));
  fireEvent.click(await screen.findByRole('option', { name: '不选择 Agent' }));
  const manual = await screen.findByRole('button', { name: '开始手工任务' });
  expect(manual).toBeEnabled();
  vi.mocked(api.post).mockImplementation(
    async (_path, body) => ({ ...task, status: (body as { status: string }).status }) as never,
  );
  fireEvent.click(manual);
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/transition', { status: 'IN_PROGRESS' }),
  );
  expect(vi.mocked(api.post).mock.calls.every(([path]) => path.endsWith('/transition'))).toBe(true);
});
it('S54资格刷新期间旧的可用快照不能继续启动', async () => {
  const client = mount([{ ...task, status: 'READY' }], '?agentId=agent-1');
  const button = await screen.findByRole('button', { name: '启动 Session' });
  await waitFor(() => expect(button).toBeEnabled());
  const original = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation((path) =>
    path.endsWith('/agent-eligibility') ? new Promise(() => {}) : original(path),
  );
  await act(async () => {
    void client.invalidateQueries({ queryKey: ['agent-eligibility', project.id] });
  });
  await waitFor(() => expect(button).toBeDisabled());
});

it.each(['disabled', 'missing', 'not-ready', 'unreported'] as const)(
  'S54不可用默认Agent %s保持身份且不降级手工启动',
  async (mode) => {
    const agents =
      mode === 'missing'
        ? []
        : selectableAgents.map((agent) =>
            agent.id === 'agent-1'
              ? {
                  ...agent,
                  enabled: mode !== 'disabled',
                  status: mode === 'not-ready' ? 'UNVERIFIED' : agent.status,
                }
              : agent,
          );
    const eligibility = registeredEligibility();
    if (mode === 'unreported')
      eligibility.agents = eligibility.agents.filter((entry) => entry.agentId !== 'agent-1');
    mount([{ ...task, status: 'READY', assignedAgentId: 'agent-1' }], '', agents, eligibility);
    const button = await screen.findByRole('button', { name: '启动 Session' });
    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.queryByRole('button', { name: '开始手工任务' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '运行 Agent' })).not.toHaveTextContent(
      '不选择 Agent',
    );
    fireEvent.click(button);
    expect(api.post).not.toHaveBeenCalled();
  },
);
it('S54资格刷新失败保留旧数据仍不可启动，成功刷新后恢复', async () => {
  mount([{ ...task, status: 'READY' }], '?agentId=agent-1');
  const button = await screen.findByRole('button', { name: '启动 Session' });
  await waitFor(() => expect(button).toBeEnabled());
  const original = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation((path) =>
    path.endsWith('/agent-eligibility') ? Promise.reject(new Error('网络失败')) : original(path),
  );
  fireEvent.click(screen.getByRole('button', { name: '刷新 Agent 资格' }));
  await screen.findByText(/所选 Agent 不可用于当前项目：资格无法确认/);
  expect(button).toBeDisabled();
  vi.mocked(api.get).mockImplementation(original);
  fireEvent.click(screen.getByRole('button', { name: '刷新 Agent 资格' }));
  await waitFor(() => expect(button).toBeEnabled());
});

it('S54READY转换期间资格失效不继续旧Agent启动', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const client = mount([{ ...task, status: 'BACKLOG' }], '?agentId=agent-1');
  const button = await screen.findByRole('button', { name: '启动 Session' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/transition', { status: 'READY' }),
  );
  const entries = registeredEligibility().agents.map((entry) => ({
    ...entry,
    eligible: false,
    reason: 'INCOMPATIBLE_WORKSPACE',
  }));
  await act(async () => client.setQueryData(['agent-eligibility', project.id], entries));
  await screen.findByText(/所选 Agent 不可用于当前项目：无法访问项目工作区/);
  await act(async () => finish({ ...task, status: 'READY' }));
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('S54取消期间资格刷新不吞掉原任务的取消失败', async () => {
  let rejectCancel!: (reason: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectCancel = reject;
      }) as never,
  );
  const client = mount([{ ...task, status: 'READY', assignedAgentId: 'agent-1' }]);
  await waitFor(() => expect(screen.getByRole('button', { name: '启动 Session' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/transition', { status: 'CANCELED' }),
  );
  let finishRefresh!: (value: unknown) => void;
  const original = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation((path) =>
    path.endsWith('/agent-eligibility')
      ? new Promise((resolve) => {
          finishRefresh = resolve;
        })
      : original(path),
  );
  await act(async () => {
    void client.invalidateQueries({ queryKey: ['agent-eligibility', project.id] });
  });
  await screen.findByText(/所选 Agent 不可用于当前项目：资格待确认/);
  await act(async () => finishRefresh(registeredEligibility()));
  await waitFor(() =>
    expect(screen.queryByText(/所选 Agent 不可用于当前项目/)).not.toBeInTheDocument(),
  );
  await act(async () => rejectCancel(new Error('取消失败必须可见')));
  expect(await screen.findByText('取消失败必须可见')).toBeVisible();
});

it.each(['success', 'failure'] as const)(
  'S54已发出start的%s不会被随后资格刷新吞掉',
  async (outcome) => {
    let finish!: (value: unknown) => void;
    let fail!: (reason: unknown) => void;
    vi.mocked(api.post).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }) as never,
    );
    const client = mount([{ ...task, status: 'READY' }], '?agentId=agent-1');
    const button = await screen.findByRole('button', { name: '启动 Session' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/tasks/task-1/start', { agentId: 'agent-1' }),
    );
    let finishRefresh!: (value: unknown) => void;
    const original = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((path) =>
      path.endsWith('/agent-eligibility')
        ? new Promise((resolve) => {
            finishRefresh = resolve;
          })
        : original(path),
    );
    await act(async () => {
      void client.invalidateQueries({ queryKey: ['agent-eligibility', project.id] });
    });
    await screen.findByText(/所选 Agent 不可用于当前项目：资格待确认/);
    await act(async () => finishRefresh(registeredEligibility()));
    await waitFor(() =>
      expect(screen.queryByText(/所选 Agent 不可用于当前项目/)).not.toBeInTheDocument(),
    );
    await act(async () =>
      outcome === 'success'
        ? finish({ session: { id: 'session-1' } })
        : fail(new Error('已发出的启动失败')),
    );
    if (outcome === 'success') expect(await screen.findByText('已进入工作区')).toBeVisible();
    else expect(await screen.findByText('已发出的启动失败')).toBeVisible();
    expect(api.post).toHaveBeenCalledTimes(1);
  },
);

it('待审阅任务可明确确认完成，不启动新Session', async () => {
  const reviewTask = {
    ...task,
    status: 'WAITING_REVIEW',
    assignedAgentId: 'agent-1',
    sessionId: 'session-old',
    finalRunId: 'run-old',
  };
  vi.mocked(api.post).mockResolvedValue({
    task: { ...reviewTask, status: 'DONE' },
    session: null,
    run: null,
  } as never);
  mount([reviewTask]);
  fireEvent.click(await screen.findByRole('button', { name: '确认达到验收标准' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/review', { decision: 'APPROVE' }),
  );
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('已进入工作区')).not.toBeInTheDocument();
});
it('待审阅任务提交明确反馈后进入新工作区', async () => {
  const reviewTask = {
    ...task,
    status: 'WAITING_REVIEW',
    assignedAgentId: 'agent-1',
    sessionId: 'session-old',
    finalRunId: 'run-old',
  };
  vi.mocked(api.post).mockResolvedValue({
    task: { ...reviewTask, status: 'IN_PROGRESS', sessionId: 'session-new' },
    session: { id: 'session-new' },
    run: { id: 'run-new' },
  } as never);
  mount([reviewTask]);
  const feedback = await screen.findByRole('textbox', { name: '继续修改说明' });
  expect(screen.getByRole('button', { name: '提交继续修改' })).toBeDisabled();
  fireEvent.change(feedback, { target: { value: '  补充错误恢复测试  ' } });
  fireEvent.click(screen.getByRole('button', { name: '提交继续修改' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/review', {
      decision: 'REWORK',
      feedback: '补充错误恢复测试',
    }),
  );
  expect(await screen.findByText('已进入工作区')).toBeVisible();
});

it('普通Task审阅不越过未知或隔离Worktree生命周期', async () => {
  const reviewTask = {
    ...task,
    status: 'WAITING_REVIEW',
    assignedAgentId: 'agent-1',
    sessionId: 'session-old',
  };
  let finish!: (value: unknown[]) => void;
  mount(
    [reviewTask],
    '',
    selectableAgents,
    registeredEligibility(),
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(`/worktree-executions?projectId=${project.id}`),
  );
  expect(screen.queryByRole('button', { name: '确认达到验收标准' })).not.toBeInTheDocument();
  await act(async () => finish([{ id: 'worktree-1', taskId: task.id, status: 'REVIEW' }]));
  await screen.findByRole('complementary', { name: '工作 Inspector' });
  expect(screen.queryByRole('button', { name: '确认达到验收标准' })).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: '继续修改说明' })).not.toBeInTheDocument();
});
it('自身返工状态后台刷新先于响应时仍进入本次新工作区', async () => {
  const old = {
    ...task,
    status: 'WAITING_REVIEW',
    assignedAgentId: 'agent-1',
    sessionId: 'session-old',
    finalRunId: 'run-old',
  };
  const next = { ...old, status: 'IN_PROGRESS', sessionId: 'session-new', finalRunId: null };
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const client = mount([old]);
  fireEvent.change(await screen.findByRole('textbox', { name: '继续修改说明' }), {
    target: { value: '继续完善' },
  });
  fireEvent.click(screen.getByRole('button', { name: '提交继续修改' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  await act(async () => client.setQueryData(['tasks', project.id], [next]));
  await act(async () =>
    finish({ task: next, session: { id: 'session-new' }, run: { id: 'run-new' } }),
  );
  expect(await screen.findByText('已进入工作区')).toBeVisible();
});
it('审阅重复点击不重复提交且pending锁定取消和Agent切换', async () => {
  const reviewTask = {
    ...task,
    status: 'WAITING_REVIEW',
    assignedAgentId: 'agent-1',
    sessionId: 'session-old',
    finalRunId: 'run-old',
  };
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  mount([reviewTask]);
  const approve = await screen.findByRole('button', { name: '确认达到验收标准' });
  fireEvent.click(approve);
  fireEvent.click(approve);
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('combobox', { name: '运行 Agent' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  await act(async () =>
    finish({ task: { ...reviewTask, status: 'DONE' }, session: null, run: null }),
  );
  expect(await screen.findByText('任务已确认完成。')).toBeVisible();
  expect(screen.getByRole('button', { name: '确认达到验收标准' })).toBeDisabled();
});
it('返工失败保留反馈，未知结果不允许直接重放', async () => {
  vi.mocked(api.post).mockRejectedValue(new Error('网络响应丢失'));
  mount([
    { ...task, status: 'WAITING_REVIEW', assignedAgentId: 'agent-1', sessionId: 'session-old' },
  ]);
  const feedback = await screen.findByRole('textbox', { name: '继续修改说明' });
  fireEvent.change(feedback, { target: { value: '保留修改意见' } });
  fireEvent.click(screen.getByRole('button', { name: '提交继续修改' }));
  expect(await screen.findByText('网络响应丢失')).toBeVisible();
  expect(feedback).toHaveValue('保留修改意见');
  expect(screen.getByRole('button', { name: '提交继续修改' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '核对原任务' })).toBeEnabled();
  expect(api.post).toHaveBeenCalledTimes(1);
});
it('明确准入拒绝后可保留反馈重试且不自动重放', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError('AGENT_NOT_READY', '原Agent尚未就绪', 409));
  mount([
    { ...task, status: 'WAITING_REVIEW', assignedAgentId: 'agent-1', sessionId: 'session-old' },
  ]);
  const feedback = await screen.findByRole('textbox', { name: '继续修改说明' });
  fireEvent.change(feedback, { target: { value: '保留修改意见' } });
  fireEvent.click(screen.getByRole('button', { name: '提交继续修改' }));
  expect(await screen.findByText('原Agent尚未就绪')).toBeVisible();
  expect(feedback).toHaveValue('保留修改意见');
  expect(screen.getByRole('button', { name: '提交继续修改' })).toBeEnabled();
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('Worktree查询失败不开放普通审阅入口', async () => {
  const worktrees = Promise.reject(new Error('隔离执行读取失败'));
  worktrees.catch(() => undefined);
  mount(
    [{ ...task, status: 'WAITING_REVIEW' }],
    '',
    selectableAgents,
    registeredEligibility(),
    worktrees,
  );
  expect(await screen.findByText('隔离执行读取失败')).toBeVisible();
  expect(screen.queryByRole('button', { name: '确认达到验收标准' })).not.toBeInTheDocument();
});
it('切换任务后旧返工响应不跳走、不污染新任务反馈', async () => {
  const old = {
    ...task,
    status: 'WAITING_REVIEW',
    assignedAgentId: 'agent-1',
    sessionId: 'session-old',
    finalRunId: 'run-old',
  };
  const other = {
    ...old,
    id: 'task-2',
    title: '另一项待审阅工作',
    sessionId: 'session-other',
    finalRunId: 'run-other',
  };
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  mount([old, other]);
  fireEvent.change(await screen.findByRole('textbox', { name: '继续修改说明' }), {
    target: { value: '旧任务反馈' },
  });
  fireEvent.click(screen.getByRole('button', { name: '提交继续修改' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  fireEvent.click(
    within(screen.getByRole('region', { name: '工作列表' })).getByRole('button', {
      name: /另一项待审阅工作/,
    }),
  );
  const input = await screen.findByRole('textbox', { name: '继续修改说明' });
  expect(input).toHaveValue('');
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { value: '新任务反馈' } });
  await act(async () =>
    finish({
      task: { ...old, status: 'IN_PROGRESS', sessionId: 'session-new' },
      session: { id: 'session-new' },
      run: { id: 'run-new' },
    }),
  );
  expect(input).toHaveValue('新任务反馈');
  expect(screen.queryByText('已进入工作区')).not.toBeInTheDocument();
  expect(screen.queryByText('审阅未完成')).not.toBeInTheDocument();
});
it('未分配Agent可确认完成但不可返工，错误响应不冒称成功', async () => {
  mount([{ ...task, status: 'WAITING_REVIEW', assignedAgentId: null, sessionId: null }]);
  const approve = await screen.findByRole('button', { name: '确认达到验收标准' });
  expect(approve).toBeEnabled();
  expect(screen.getByRole('button', { name: '提交继续修改' })).toBeDisabled();
  vi.mocked(api.post).mockResolvedValue({
    task: { ...task, id: 'wrong-task', status: 'DONE' },
    session: null,
    run: null,
  } as never);
  fireEvent.click(approve);
  expect(await screen.findByText('审阅响应无法确认，请核对原任务。')).toBeVisible();
  expect(screen.queryByText('任务已确认完成。')).not.toBeInTheDocument();
  expect(approve).toBeDisabled();
});
it('自身确认完成后台刷新先于响应不误报或重复提交', async () => {
  const old = {
    ...task,
    status: 'WAITING_REVIEW',
    assignedAgentId: 'agent-1',
    sessionId: 'session-old',
    finalRunId: 'run-old',
  };
  const done = { ...old, status: 'DONE' };
  const rows = [old];
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const client = mount(rows);
  fireEvent.click(await screen.findByRole('button', { name: '确认达到验收标准' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  // The subsequent refetch must represent the same updated server state. Do not
  // mutate the original array retained in QueryClient's cache in place.
  vi.mocked(api.get).mockImplementation(
    async <T,>(path: string) =>
      (path.startsWith('/tasks?')
        ? [done]
        : path === `/projects/${project.id}`
          ? project
          : path === '/agents'
            ? selectableAgents
            : path.endsWith('/agent-eligibility')
              ? registeredEligibility()
              : []) as T,
  );
  await act(async () => client.setQueryData(['tasks', project.id], [done]));
  await act(async () => finish({ task: done, session: null, run: null }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '确认达到验收标准' })).not.toBeInTheDocument(),
  );
  expect(screen.queryByText('审阅未完成')).not.toBeInTheDocument();
  expect(screen.queryByText('已进入工作区')).not.toBeInTheDocument();
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('隔离REVIEW只开放专属审阅，不走普通任务完成或取消入口', async () => {
  const managed = {
    id: 'execution-a',
    projectId: project.id,
    taskId: task.id,
    status: 'REVIEW',
    sessionId: 'session-a',
    runId: 'run-a',
    taskBranch: 'task/a',
    baseBranch: 'main',
    baseSha: 'base',
    worktreePath: '/tmp/tree',
  };
  mount(
    [{ ...task, status: 'WAITING_REVIEW', assignedAgentId: 'agent-1', sessionId: 'session-a' }],
    '',
    selectableAgents,
    registeredEligibility(),
    [managed],
  );
  expect(await screen.findByRole('button', { name: '读取隔离工作区审阅' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '确认达到验收标准' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '启动 Session' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '提交并合并隔离工作区' })).toBeDisabled();
});
it.each(['REMOTE_NODE', 'missing'])('隔离条件%s只禁隔离入队，不影响普通Agent启动', async (kind) => {
  Object.assign(project, { repoKind: 'GIT', targetId: 'target-a' });
  try {
    mount(
      [{ ...task, status: 'READY', sessionId: null }],
      '?agentId=agent-1',
      selectableAgents,
      registeredEligibility(),
      [],
      kind === 'missing' ? [] : [{ id: 'target-a', kind }],
    );
    expect(await screen.findByRole('button', { name: '加入隔离执行队列' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: '启动 Session' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '刷新隔离执行条件' })).toBeEnabled();
  } finally {
    project.repoKind = 'NONE';
    Reflect.deleteProperty(project, 'targetId');
  }
});
it('本机Git任务可入队，pending锁普通start/cancel/Agent和变量保存', async () => {
  Object.assign(project, { repoKind: 'GIT', targetId: 'target-a' });
  let finish!: (value: unknown) => void;
  vi.mocked(api.post)
    .mockResolvedValueOnce({ ...task, status: 'READY' } as never)
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
    );
  try {
    mount(
      [{ ...task, status: 'BACKLOG', sessionId: null }],
      '?agentId=agent-1',
      selectableAgents,
      registeredEligibility(),
      [],
      [{ id: 'target-a', kind: 'LOCAL_HOST' }],
    );
    const queue = await screen.findByRole('button', { name: '加入隔离执行队列' });
    await waitFor(() => expect(queue).toBeEnabled());
    fireEvent.click(queue);
    expect(screen.getByRole('button', { name: '启动 Session' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '运行 Agent' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '刷新 Agent 资格' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '任务 Prompt 变量（JSON 对象）' })).toBeDisabled();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const originalGet = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((path) =>
      path.startsWith('/worktree-executions?') ? new Promise(() => {}) : originalGet(path),
    );
    await act(async () =>
      finish({
        execution: {
          id: 'exec-a',
          taskId: task.id,
          projectId: project.id,
          agentId: 'agent-1',
          status: 'QUEUED',
        },
        task: { ...task, status: 'IN_PROGRESS', assignedAgentId: 'agent-1' },
      }),
    );
    expect(await screen.findByText(/隔离执行队列已接收/)).toBeVisible();
    expect(screen.getByRole('button', { name: '加入隔离执行队列' })).toBeDisabled();
    expect(api.post).toHaveBeenNthCalledWith(1, '/tasks/task-1/transition', { status: 'READY' });
    expect(api.post).toHaveBeenCalledWith('/tasks/task-1/worktree/queue', { agentId: 'agent-1' });
  } finally {
    project.repoKind = 'NONE';
    Reflect.deleteProperty(project, 'targetId');
  }
});
it('切换并返回原任务仍锁住每项未完成入队，不因其他任务pending覆盖而重放', async () => {
  Object.assign(project, { repoKind: 'GIT', targetId: 'target-a' });
  const first = { ...task, status: 'READY', sessionId: null, assignedAgentId: 'agent-1' };
  const second = { ...first, id: 'task-2', title: '第二个隔离任务' };
  const finishers: Array<(value: unknown) => void> = [];
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishers.push(resolve);
      }) as never,
  );
  try {
    mount(
      [first, second],
      '?agentId=agent-1',
      selectableAgents,
      registeredEligibility(),
      [],
      [{ id: 'target-a', kind: 'LOCAL_HOST' }],
    );
    const queue = await screen.findByRole('button', { name: '加入隔离执行队列' });
    await waitFor(() => expect(queue).toBeEnabled());
    fireEvent.click(queue);
    fireEvent.click(
      within(screen.getByRole('region', { name: '工作列表' })).getByRole('button', {
        name: /第二个隔离任务/,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '加入隔离执行队列' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
    fireEvent.click(
      within(screen.getByRole('region', { name: '工作列表' })).getByRole('button', {
        name: /真实任务/,
      }),
    );
    expect(screen.getByRole('button', { name: '加入隔离执行队列' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '启动 Session' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '加入隔离执行队列' }));
    expect(api.post).toHaveBeenCalledTimes(2);
    const originalGet = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((path) =>
      path.startsWith('/worktree-executions?') ? new Promise(() => {}) : originalGet(path),
    );
    await act(async () =>
      finishers[1]!({
        execution: {
          id: 'exec-b',
          taskId: second.id,
          projectId: project.id,
          agentId: 'agent-1',
          status: 'QUEUED',
        },
        task: { ...second, status: 'IN_PROGRESS' },
      }),
    );
    expect(screen.getByRole('button', { name: '加入隔离执行队列' })).toBeDisabled();
    await act(async () =>
      finishers[0]!({
        execution: {
          id: 'exec-a',
          taskId: first.id,
          projectId: project.id,
          agentId: 'agent-1',
          status: 'QUEUED',
        },
        task: { ...first, status: 'IN_PROGRESS' },
      }),
    );
    expect(screen.getByRole('button', { name: '加入隔离执行队列' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '启动 Session' })).toBeDisabled();
    expect(api.post).toHaveBeenCalledTimes(2);
  } finally {
    project.repoKind = 'NONE';
    Reflect.deleteProperty(project, 'targetId');
  }
});

it('隔离取消按执行保留pending和请求结果，切换A→B→A及延迟刷新不重发', async () => {
  const first = { ...task, status: 'IN_PROGRESS' };
  const second = { ...first, id: 'task-2', title: '第二个隔离任务' };
  const a = { id: 'cancel-a', taskId: first.id, projectId: project.id, status: 'RUNNING' };
  const b = { ...a, id: 'cancel-b', taskId: second.id };
  const finishers: Array<(value: unknown) => void> = [];
  vi.mocked(api.post).mockImplementation(
    () => new Promise((resolve) => finishers.push(resolve)) as never,
  );
  mount([first, second], '', [], undefined, [a, b]);
  const cancel = await screen.findByRole('button', { name: '取消隔离执行' });
  await waitFor(() => expect(cancel).toBeEnabled());
  fireEvent.click(cancel);
  fireEvent.click(
    within(screen.getByRole('region', { name: '工作列表' })).getByRole('button', {
      name: /第二个隔离任务/,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '取消隔离执行' }));
  fireEvent.click(
    within(screen.getByRole('region', { name: '工作列表' })).getByRole('button', {
      name: /真实任务/,
    }),
  );
  expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeDisabled();
  const originalGet = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation((path) =>
    path.startsWith('/worktree-executions?') ? new Promise(() => {}) : originalGet(path),
  );
  await act(async () => finishers[1]!(b));
  expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeDisabled();
  await act(async () => finishers[0]!(a));
  await screen.findByText(/取消请求已发送/);
  expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeDisabled();
  expect(vi.mocked(api.post).mock.calls).toEqual([
    ['/worktree-executions/cancel-a/cancel', {}],
    ['/worktree-executions/cancel-b/cancel', {}],
  ]);
});
it('已受理取消核对到REVIEW释放审阅，返工新Run可单独取消', async () => {
  const running = {
    id: 'cancel-generation',
    taskId: task.id,
    projectId: project.id,
    status: 'RUNNING',
    runId: 'run-old',
  };
  vi.mocked(api.post).mockResolvedValue(running as never);
  mount([{ ...task, status: 'IN_PROGRESS' }], '', [], undefined, [running]);
  const cancel = await screen.findByRole('button', { name: '取消隔离执行' });
  await waitFor(() => expect(cancel).toBeEnabled());
  fireEvent.click(cancel);
  await screen.findByText(/取消请求已发送/);
  const originalGet = vi.mocked(api.get).getMockImplementation()!;
  let current = { ...running, status: 'REVIEW' };
  vi.mocked(api.get).mockImplementation((path) =>
    path === '/worktree-executions/cancel-generation'
      ? (Promise.resolve(current) as never)
      : path.startsWith('/worktree-executions?')
        ? (Promise.resolve([current]) as never)
        : originalGet(path),
  );
  fireEvent.click(screen.getByRole('button', { name: '核对隔离取消状态' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '读取隔离工作区审阅' })).toBeEnabled(),
  );
  current = { ...running, runId: 'run-new' };
  fireEvent.click(screen.getByRole('button', { name: '核对隔离取消状态' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeEnabled());
  expect(api.post).toHaveBeenCalledTimes(1);
});
it('no-run取消pending跨claim新Run仍锁住，回执绑定实际Run后不重复', async () => {
  const execution = {
    id: 'claim-cancel',
    taskId: task.id,
    projectId: project.id,
    status: 'QUEUED',
    runId: null as string | null,
  };
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  mount(
    [
      { ...task, status: 'IN_PROGRESS' },
      { ...task, id: 'task-2', title: '第二个隔离任务' },
    ],
    '',
    [],
    undefined,
    [execution],
  );
  const cancel = await screen.findByRole('button', { name: '取消隔离执行' });
  await waitFor(() => expect(cancel).toBeEnabled());
  fireEvent.click(cancel);
  execution.runId = 'claimed-run';
  execution.status = 'RUNNING';
  fireEvent.click(
    within(screen.getByRole('region', { name: '工作列表' })).getByRole('button', {
      name: /第二个隔离任务/,
    }),
  );
  fireEvent.click(
    within(screen.getByRole('region', { name: '工作列表' })).getByRole('button', {
      name: /真实任务/,
    }),
  );
  expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeDisabled();
  await act(async () => finish({ ...execution }));
  await screen.findByText(/取消请求已发送/);
  expect(screen.getByRole('button', { name: '取消隔离执行' })).toBeDisabled();
  expect(api.post).toHaveBeenCalledTimes(1);
});
it('核对请求跨A→B→A保持只读pending，不并发旧GET覆盖终态', async () => {
  const execution = {
    id: 'check-cancel',
    taskId: task.id,
    projectId: project.id,
    status: 'RUNNING',
    runId: 'run-a',
  };
  vi.mocked(api.post).mockResolvedValue(execution as never);
  mount(
    [
      { ...task, status: 'IN_PROGRESS' },
      { ...task, id: 'task-2', title: '第二个隔离任务' },
    ],
    '',
    [],
    undefined,
    [execution],
  );
  const cancel = await screen.findByRole('button', { name: '取消隔离执行' });
  await waitFor(() => expect(cancel).toBeEnabled());
  fireEvent.click(cancel);
  await screen.findByText(/取消请求已发送/);
  let finish!: (value: unknown) => void;
  const originalGet = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation((path) =>
    path === '/worktree-executions/check-cancel'
      ? (new Promise((resolve) => {
          finish = resolve;
        }) as never)
      : originalGet(path),
  );
  fireEvent.click(screen.getByRole('button', { name: '核对隔离取消状态' }));
  fireEvent.click(
    within(screen.getByRole('region', { name: '工作列表' })).getByRole('button', {
      name: /第二个隔离任务/,
    }),
  );
  fireEvent.click(
    within(screen.getByRole('region', { name: '工作列表' })).getByRole('button', {
      name: /真实任务/,
    }),
  );
  expect(screen.getByRole('button', { name: '核对隔离取消状态' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '核对隔离取消状态' }));
  expect(
    vi.mocked(api.get).mock.calls.filter(([path]) => path === '/worktree-executions/check-cancel'),
  ).toHaveLength(1);
  await act(async () => finish({ ...execution, status: 'CANCELED' }));
  await screen.findByText(/隔离执行已取消/);
});
