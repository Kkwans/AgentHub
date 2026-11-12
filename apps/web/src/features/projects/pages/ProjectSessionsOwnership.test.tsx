// @vitest-environment jsdom
// Ownership regressions use the real project layout, route transitions and access gate.
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import { authSession } from '../../../lib/auth-api';
import type * as AuthModule from '../../../lib/auth-api';
import { AccessGate } from '../../../components/AccessGate';
import { ProjectContextLayout } from './ProjectContextLayout';
import { ProjectSessionsPage } from './ProjectSessionsPage';
import { useSessionCreation } from '../hooks/useSessionCreation';
import type { ProjectRecord, AgentRecord } from '../../../lib/api';
vi.mock('../../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../../lib/auth-api', async (original) => ({
  ...(await original<typeof AuthModule>()),
  authApi: {
    get: vi.fn(async () => ({ mode: 'token', authenticated: false, setupRequired: false })),
  },
}));
vi.mock('../../../lib/realtime', () => ({ realtime: { disconnect: vi.fn(), reconnect: vi.fn() } }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.clearAllMocks();
});
const project = (id: string) => ({
  id,
  name: `项目${id}`,
  rootPath: `/project/${id}`,
  status: 'ACTIVE',
  kind: 'STANDARD',
  repoKind: 'NONE',
});
let changeRoute: ReturnType<typeof useNavigate>;
function Controls() {
  const navigate = useNavigate();
  changeRoute = navigate;
  const location = useLocation();
  return (
    <>
      <output data-testid="location">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate('/projects/B/sessions?new=1')}>测试切换B</button>
      <button onClick={() => navigate(-1)}>测试Back</button>
    </>
  );
}
function mount(token = false, missingUser = false) {
  let resolve!: (value: unknown) => void;
  let reject!: (value: unknown) => void;
  const pending = new Promise((r, j) => {
    resolve = r;
    reject = j;
  });
  vi.mocked(api.post).mockImplementation(() => pending as never);
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path === '/projects/A') return project('A') as T;
    if (path === '/projects/B') return project('B') as T;
    if (path.endsWith('/agent-eligibility'))
      return {
        projectId: path.split('/')[2],
        basis: 'REGISTERED_STATE',
        livePreflight: false,
        agents: [],
      } as T;
    if (path === '/agents')
      return [
        { id: 'agent-1', name: '测试Agent', status: 'READY' },
        { id: '22222222-2222-4222-8222-222222222222', name: '第二Agent', status: 'READY' },
      ] as T;
    return [] as T;
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  for (const id of ['A', 'B']) client.setQueryData(['project', id], project(id));
  client.setQueryData(['auth-status'], {
    mode: token ? 'token' : 'local_trusted',
    authenticated: true,
    setupRequired: false,
    user: token && !missingUser ? { id: 'user-A', username: '账号A', role: 'ADMIN' } : null,
  });
  const invalidation = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={['/projects/A/sessions', '/projects/A/sessions?new=1']}
        initialIndex={1}
      >
        <Controls />
        <AccessGate>
          <Routes>
            <Route path="/projects/:projectId" element={<ProjectContextLayout />}>
              <Route path="sessions" element={<ProjectSessionsPage />} />
            </Route>
            <Route path="/workspace/:id" element={<h2>目标Workspace</h2>} />
          </Routes>
        </AccessGate>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { resolve, reject, client, invalidation };
}
async function submit() {
  const button = await screen.findByRole('button', { name: '创建并进入 Workspace' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
}
const response = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: 'A',
  agentId: 'agent-1',
  cwd: '/project/A',
};
it('A draft cannot leak into cached B', async () => {
  mount();
  const title = await screen.findByRole('textbox', { name: '会话名称' });
  fireEvent.change(title, { target: { value: '只属于A的草稿' } });
  act(() => changeRoute('/projects/B/sessions?new=1'));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/projects/B/'));
  expect(screen.getByRole('textbox', { name: '会话名称' })).toHaveValue('新 Session');
  await submit();
  expect(api.post).toHaveBeenCalledWith(
    '/sessions',
    expect.objectContaining({ projectId: 'B', cwd: '/project/B', title: '新 Session' }),
  );
});
it('pending A success only refreshes A and never steals B navigation', async () => {
  const state = mount();
  await submit();
  expect(api.post).toHaveBeenCalledWith('/sessions', expect.objectContaining({ projectId: 'A' }));
  act(() => changeRoute('/projects/B/sessions?new=1'));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/projects/B/'));
  await act(async () => state.resolve(response));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/projects/B/'));
  expect(state.invalidation).toHaveBeenCalledWith({ queryKey: ['sessions', 'A'] });
});
it('Back closes dialog and revokes late navigation', async () => {
  const state = mount();
  await submit();
  act(() => changeRoute(-1));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await act(async () => state.resolve(response));
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/A/sessions'),
  );
});
it('authorization loss revokes late navigation', async () => {
  const state = mount(true);
  await submit();
  act(() => authSession.notifyAuthorizationRequired());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await act(async () => state.resolve(response));
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/A/sessions'),
  );
});
it('wrong project and agent response is fenced as unknown', async () => {
  const state = mount();
  await submit();
  await act(async () => state.resolve({ ...response, projectId: 'B', agentId: 'other-agent' }));
  expect(await screen.findByText(/创建结果尚未确认/)).toBeVisible();
  expect(screen.getByTestId('location')).toHaveTextContent('/projects/A/sessions');
  expect(screen.getByRole('button', { name: '创建并进入 Workspace' })).toBeDisabled();
});
it('matching success navigates and tolerates normalized Docker cwd', async () => {
  const state = mount();
  await submit();
  await act(async () => state.resolve({ ...response, cwd: '/container/project' }));
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(`/workspace/${response.id}`),
  );
  expect(state.invalidation).toHaveBeenCalledWith({ queryKey: ['sessions', 'A'] });
});
it('double submit only sends once', async () => {
  mount();
  const button = await screen.findByRole('button', { name: '创建并进入 Workspace' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
});
it('unknown response requires read-only check and explicit resume, never automatic retry', async () => {
  const state = mount();
  await submit();
  await act(async () => state.reject(new Error('资源清理状态尚未确认')));
  expect(await screen.findByText(/创建结果尚未确认/)).toBeVisible();
  expect(screen.getByRole('button', { name: '创建并进入 Workspace' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '读取原项目会话' }));
  const resume = await screen.findByRole('button', { name: '已核对，重新编辑' });
  expect(screen.getByText('原请求说明：资源清理状态尚未确认')).toBeVisible();
  expect(api.post).toHaveBeenCalledTimes(1);
  fireEvent.click(resume);
  expect(screen.getByRole('button', { name: '创建并进入 Workspace' })).toBeEnabled();
  expect(api.post).toHaveBeenCalledTimes(1);
});
it('account identity change starts fresh and old success cannot navigate or refresh', async () => {
  const state = mount(true);
  await submit();
  act(() =>
    state.client.setQueryData(['auth-status'], {
      mode: 'token',
      authenticated: true,
      setupRequired: false,
      user: { id: 'user-B', username: '账号B', role: 'ADMIN' },
    }),
  );
  await act(async () => state.resolve(response));
  expect(screen.getByTestId('location')).toHaveTextContent('/projects/A/sessions');
  expect(state.invalidation).not.toHaveBeenCalledWith({ queryKey: ['sessions', 'A'] });
});
it('malformed session UUID is unknown', async () => {
  const state = mount();
  await submit();
  await act(async () => state.resolve({ ...response, id: '../../other' }));
  expect(await screen.findByText(/创建结果尚未确认/)).toBeVisible();
  expect(screen.getByTestId('location')).toHaveTextContent('/projects/A/sessions');
});
it('close and reopen retains in-flight fence, late success does not close the new dialog', async () => {
  const state = mount();
  const title = await screen.findByRole('textbox', { name: '会话名称' });
  fireEvent.change(title, { target: { value: '原请求名称' } });
  fireEvent.click(screen.getByRole('combobox', { name: 'Agent' }));
  fireEvent.click(await screen.findByRole('option', { name: '第二Agent' }));
  await submit();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
  await screen.findByRole('dialog', { name: '新建会话' });
  expect(screen.getByRole('button', { name: '创建并进入 Workspace' })).toBeDisabled();
  await act(async () =>
    state.resolve({ ...response, agentId: '22222222-2222-4222-8222-222222222222' }),
  );
  expect(screen.getByRole('dialog', { name: '新建会话' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: '会话名称' })).toHaveValue('原请求名称');
  expect(screen.getByRole('combobox', { name: 'Agent' })).toHaveTextContent('第二Agent');
  expect(screen.getByText('本次请求 Agent ID：22222222-2222-4222-8222-222222222222')).toBeVisible();
  expect(screen.getByRole('button', { name: '创建并进入 Workspace' })).toBeDisabled();
  expect(screen.getByRole('link', { name: '打开已创建的会话：原请求名称' })).toHaveAttribute(
    'href',
    `/workspace/${response.id}`,
  );
  fireEvent.click(screen.getByRole('button', { name: '创建另一会话' }));
  expect(screen.getByRole('textbox', { name: '会话名称' })).toHaveValue('新 Session');
  expect(screen.getByRole('button', { name: '创建并进入 Workspace' })).toBeEnabled();
  expect(screen.getByTestId('location')).toHaveTextContent('/projects/A/sessions');
});
it.each([
  { projectId: 'B', agentId: '22222222-2222-4222-8222-222222222222' },
  { projectId: 'A', agentId: 'not-a-uuid' },
])(
  'reopened unknown rejects wrong-owner or malformed readback $projectId $agentId',
  async (identity) => {
    const state = mount();
    await submit();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
    await screen.findByRole('dialog', { name: '新建会话' });
    await act(async () => state.reject(new Error('response lost')));
    expect(await screen.findByText(/创建结果尚未确认/)).toBeVisible();
    vi.mocked(api.get).mockResolvedValue([{ ...response, ...identity, title: '未确认记录' }]);
    fireEvent.click(screen.getByRole('button', { name: '读取原项目会话' }));
    expect(await screen.findByText('无法确认原项目的会话列表，请稍后再读取。')).toBeVisible();
    expect(screen.queryByRole('button', { name: '已核对，重新编辑' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建并进入 Workspace' })).toBeDisabled();
    expect(api.post).toHaveBeenCalledTimes(1);
  },
);
it('missing gate identity fails closed even with no cached auth', async () => {
  const client = new QueryClient();
  clients.push(client);
  const { result } = renderHook(
    () =>
      useSessionCreation(project('A') as ProjectRecord, true, [
        { id: 'agent-1', status: 'READY' } as AgentRecord,
      ]),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
      ),
    },
  );
  expect(result.current.ready).toBe(false);
  act(() => result.current.setAgentId('agent-1'));
  await act(async () => result.current.create());
  expect(api.post).not.toHaveBeenCalled();
});
it('token identity without user id fails closed', async () => {
  mount(true, true);
  const button = await screen.findByRole('button', { name: '创建并进入 Workspace' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(api.post).not.toHaveBeenCalled();
});
it('readback has a synchronous gate and cannot resume while another read is pending', async () => {
  const state = mount();
  await submit();
  await act(async () => state.reject(new Error('lost')));
  fireEvent.click(await screen.findByRole('button', { name: '读取原项目会话' }));
  await screen.findByRole('button', { name: '已核对，重新编辑' });
  let resolve!: (rows: unknown[]) => void;
  const read = new Promise<unknown[]>((r) => {
    resolve = r;
  });
  vi.mocked(api.get).mockClear();
  vi.mocked(api.get).mockImplementation(() => read as never);
  const check = screen.getByRole('button', { name: '读取原项目会话' });
  fireEvent.click(check);
  fireEvent.click(check);
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: '已核对，重新编辑' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '创建并进入 Workspace' })).toBeDisabled();
  await act(async () => resolve([]));
  expect(screen.getByRole('button', { name: '已核对，重新编辑' })).toBeEnabled();
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('failed second read removes prior checked state and keeps the original cleanup warning', async () => {
  const state = mount();
  await submit();
  await act(async () => state.reject(new Error('资源清理结果未知')));
  fireEvent.click(await screen.findByRole('button', { name: '读取原项目会话' }));
  await screen.findByRole('button', { name: '已核对，重新编辑' });
  vi.mocked(api.get).mockRejectedValueOnce(new Error('read failed'));
  fireEvent.click(screen.getByRole('button', { name: '读取原项目会话' }));
  expect(await screen.findByText('无法确认原项目的会话列表，请稍后再读取。')).toBeVisible();
  expect(screen.getByText('原请求说明：资源清理结果未知')).toBeVisible();
  expect(screen.queryByRole('button', { name: '已核对，重新编辑' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '创建并进入 Workspace' })).toBeDisabled();
  expect(api.post).toHaveBeenCalledTimes(1);
});
