// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
function mount(rows: unknown[] | Promise<unknown[]> = [], query = '') {
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path === `/projects/${project.id}`) return project as T;
    if (path.startsWith('/tasks?')) return (await rows) as T;
    if (path === '/tasks/task-1') return task as T;
    return [] as T;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/projects/${project.id}/work${query}`]}>
        <Routes>
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
