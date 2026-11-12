// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectContextLayout } from './ProjectContextLayout';
import { ProjectWorkPage } from './ProjectWorkPage';
import { api } from '../../../lib/api';

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
function mount(rows: unknown[] | Promise<unknown[]> = [], query = '', agents: unknown[] = []) {
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path === `/projects/${project.id}`) return project as T;
    if (path.startsWith('/tasks?')) return (await rows) as T;
    if (path === '/tasks/task-1') return task as T;
    if (path === '/agents') return agents as T;
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
