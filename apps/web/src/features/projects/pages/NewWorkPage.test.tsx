// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NewWorkPage } from './NewWorkPage';
import { authSession } from '../../../lib/api';

const context = vi.hoisted(() => ({
  project: { id: 'project-1', name: '项目一', rootPath: '/projects/one' },
}));
vi.mock('./ProjectContextLayout', () => ({ useProjectContext: () => context.project }));
vi.mock('./ProjectWorkPage', () => ({ ProjectWorkPage: () => <div>任务列表</div> }));

const task = {
  id: 'task-1',
  projectId: 'project-1',
  title: '修复登录',
  status: 'BACKLOG',
  sessionId: null,
};
const started = () => ({
  task: { ...task, status: 'IN_PROGRESS', sessionId: 'session-1' },
  session: { id: 'session-1', projectId: task.projectId, taskId: task.id, agentId: 'agent-1' },
});
const agent = { id: 'agent-1', name: '测试 Agent', status: 'READY', enabled: true };
const json = (data: unknown) =>
  new Response(JSON.stringify({ data, requestId: 'test' }), {
    headers: { 'content-type': 'application/json' },
  });
const failure = (code: string, status = 409) =>
  new Response(
    JSON.stringify({
      error: { code, message: '失败', requestId: 'test' },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}
function show(fetchMock: typeof fetch) {
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/project-1/work/new']}>
        <Location />
        <NewWorkPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, refresh: () => view.rerender(tree()) };
}
function base(path: string) {
  if (path === '/api/v1/agents') return json([agent]);
  if (path === '/api/v1/tasks/task-1') return json({ ...task, status: 'READY' });
  return json([]);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function workflow(
  overrides: Partial<
    Record<'create' | 'transition' | 'start' | 'read', () => Promise<Response> | Response>
  > = {},
) {
  const calls = { create: 0, transition: 0, start: 0, read: 0 };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const operation =
      path === '/api/v1/tasks' && init?.method === 'POST'
        ? 'create'
        : path.endsWith('/transition')
          ? 'transition'
          : path.endsWith('/start')
            ? 'start'
            : path === '/api/v1/tasks/task-1'
              ? 'read'
              : undefined;
    if (operation) {
      calls[operation]++;
      if (overrides[operation]) return overrides[operation]();
      if (operation === 'start') return json(started());
      return json({ ...task, status: operation === 'create' ? 'BACKLOG' : 'READY' });
    }
    return base(path);
  });
  return { calls, fetchMock };
}
async function submitTask() {
  fireEvent.change(screen.getByLabelText('你想完成什么？'), { target: { value: '修复登录' } });
  await screen.findByText('测试 Agent 可用');
  fireEvent.click(screen.getByRole('button', { name: '创建并开始' }));
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  context.project = { id: 'project-1', name: '项目一', rootPath: '/projects/one' };
});

describe('新建工作部分成功恢复', () => {
  it('启动被拒绝后重试仅恢复原任务，不再次创建', async () => {
    let creates = 0;
    let starts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/v1/tasks' && init?.method === 'POST') {
        creates++;
        return json(task);
      }
      if (path.endsWith('/transition')) return json({ ...task, status: 'READY' });
      if (path.endsWith('/start')) {
        starts++;
        return starts === 1 ? failure('AGENT_NOT_READY') : json(started());
      }
      return base(path);
    });
    show(fetchMock);
    fireEvent.change(screen.getByLabelText('你想完成什么？'), { target: { value: '修复登录' } });
    await screen.findByText('测试 Agent 可用');
    fireEvent.click(screen.getByRole('button', { name: '创建并开始' }));
    await screen.findByText(/Agent 尚未预检就绪/);
    fireEvent.click(screen.getByRole('button', { name: /^(创建并开始|重试启动)$/ }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/workspace/session-1'),
    );
    expect(creates).toBe(1);
    expect(starts).toBe(2);
  });

  it('状态转换被明确拒绝后先读取原任务，再恢复缺失步骤', async () => {
    let attempt = 0;
    const { calls, fetchMock } = workflow({
      transition: () =>
        ++attempt === 1 ? failure('VALIDATION_FAILED', 400) : json({ ...task, status: 'READY' }),
      read: () => json(task),
    });
    show(fetchMock);
    await submitTask();
    await screen.findByText('任务已创建');
    fireEvent.click(screen.getByRole('button', { name: '重试启动' }));
    await waitFor(() => expect(calls.start).toBe(1));
    expect(calls).toEqual({ create: 1, transition: 2, start: 1, read: 1 });
  });

  it('创建响应丢失后锁定草稿和再次创建，提供列表核对', async () => {
    const { calls, fetchMock } = workflow({
      create: () => Promise.reject(new TypeError('network')),
    });
    show(fetchMock);
    await submitTask();
    await screen.findByText('创建结果待核对');
    expect(screen.getByLabelText('你想完成什么？')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '创建并开始' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试启动' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '核对任务列表' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/project-1/work');
    expect(calls.create).toBe(1);
    expect(calls.start).toBe(0);
  });

  it('创建返回无法确认的任务时不能继续写入', async () => {
    const { calls, fetchMock } = workflow({ create: () => json({ ...task, projectId: 'other' }) });
    show(fetchMock);
    await submitTask();
    await screen.findByText('创建结果待核对');
    expect(calls.transition).toBe(0);
    expect(calls.start).toBe(0);
  });

  it('只有明确的创建校验拒绝才允许修改草稿重试', async () => {
    let attempt = 0;
    const { calls, fetchMock } = workflow({
      create: () => (++attempt === 1 ? failure('VALIDATION_FAILED', 400) : json(task)),
    });
    show(fetchMock);
    await submitTask();
    await screen.findByText('创建被拒绝');
    expect(screen.getByLabelText('你想完成什么？')).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '创建并开始' }));
    await waitFor(() => expect(calls.start).toBe(1));
    expect(calls.create).toBe(2);
  });

  it('启动响应丢失后只读核对，即使状态仍 READY 也不解锁盲目重试', async () => {
    const { calls, fetchMock } = workflow({
      start: () => Promise.reject(new TypeError('network')),
    });
    show(fetchMock);
    await submitTask();
    await screen.findByText('任务已创建');
    fireEvent.click(screen.getByRole('button', { name: '核对原任务状态' }));
    await waitFor(() => expect(calls.read).toBe(1));
    expect(screen.queryByRole('button', { name: '重试启动' })).not.toBeInTheDocument();
    expect(calls.start).toBe(1);
    expect(calls.create).toBe(1);
    expect(screen.getByText(/请求可能已生效/)).toBeInTheDocument();
  });

  it('状态转换的响应丢失时不继续启动', async () => {
    const { calls, fetchMock } = workflow({
      transition: () => Promise.reject(new TypeError('network')),
    });
    show(fetchMock);
    await submitTask();
    await screen.findByText('任务已创建');
    expect(screen.queryByRole('button', { name: '重试启动' })).not.toBeInTheDocument();
    expect(calls.start).toBe(0);
    expect(calls.create).toBe(1);
  });

  it('快速重复点击不会创建第二个任务', async () => {
    const pending = deferred<Response>();
    const { calls, fetchMock } = workflow({ create: () => pending.promise });
    show(fetchMock);
    fireEvent.change(screen.getByLabelText('你想完成什么？'), { target: { value: '修复登录' } });
    await screen.findByText('测试 Agent 可用');
    const submit = screen.getByRole('button', { name: '创建并开始' });
    act(() => {
      submit.click();
      submit.click();
    });
    expect(calls.create).toBe(1);
    await act(async () => {
      pending.resolve(json(task));
    });
    await waitFor(() => expect(calls.start).toBe(1));
  });

  it('关闭创建中的弹窗后不迟到启动或导航', async () => {
    const pending = deferred<Response>();
    const { calls, fetchMock } = workflow({ create: () => pending.promise });
    show(fetchMock);
    await submitTask();
    fireEvent.click(screen.getByRole('button', { name: '核对任务列表' }));
    const destination = screen.getByTestId('location').textContent;
    await act(async () => {
      pending.resolve(json(task));
    });
    expect(calls.transition).toBe(0);
    expect(calls.start).toBe(0);
    expect(screen.getByTestId('location').textContent).toBe(destination);
  });

  it('切换项目后旧创建结果不启动，也不覆盖新草稿', async () => {
    const pending = deferred<Response>();
    const { calls, fetchMock } = workflow({ create: () => pending.promise });
    const view = show(fetchMock);
    await submitTask();
    context.project = { id: 'project-2', name: '项目二', rootPath: '/projects/two' };
    view.refresh();
    fireEvent.change(screen.getByLabelText('你想完成什么？'), { target: { value: '另一个目标' } });
    await act(async () => {
      pending.resolve(json(task));
    });
    expect(screen.getByLabelText('你想完成什么？')).toHaveValue('另一个目标');
    expect(calls.transition).toBe(0);
    expect(calls.start).toBe(0);
    expect(screen.getByTestId('location')).not.toHaveTextContent('/workspace/');
  });

  it('认证失效后迟到的创建不会继续启动', async () => {
    const pending = deferred<Response>();
    const { calls, fetchMock } = workflow({ create: () => pending.promise });
    show(fetchMock);
    await submitTask();
    act(() => {
      authSession.notifyAuthorizationRequired();
    });
    await act(async () => {
      pending.resolve(json(task));
    });
    expect(calls.start).toBe(0);
    expect(calls.transition).toBe(0);
  });

  it('核对发现任务已有会话时不再启动，可打开已有工作区', async () => {
    const { calls, fetchMock } = workflow({
      start: () => failure('AGENT_NOT_READY'),
      read: () => json({ ...task, status: 'IN_PROGRESS', sessionId: 'existing-session' }),
    });
    show(fetchMock);
    await submitTask();
    await screen.findByText('任务已创建');
    fireEvent.click(screen.getByRole('button', { name: '重试启动' }));
    await screen.findByRole('button', { name: '打开已有工作区' });
    expect(calls.start).toBe(1);
    expect(calls.create).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '打开已有工作区' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/workspace/existing-session');
  });

  it('核对返回其他项目或任务时不进行任何恢复写入', async () => {
    const { calls, fetchMock } = workflow({
      start: () => failure('AGENT_NOT_READY'),
      read: () => json({ ...task, projectId: 'other-project', status: 'READY' }),
    });
    show(fetchMock);
    await submitTask();
    await screen.findByText('任务已创建');
    fireEvent.click(screen.getByRole('button', { name: '重试启动' }));
    await screen.findByText('任务响应无法确认，请到任务列表核对。');
    expect(calls.start).toBe(1);
    expect(calls.transition).toBe(1);
    expect(calls.create).toBe(1);
  });

  it('启动已发送后关闭弹窗不将迟到成功当作新的导航', async () => {
    const pending = deferred<Response>();
    const { calls, fetchMock } = workflow({ start: () => pending.promise });
    show(fetchMock);
    await submitTask();
    await waitFor(() => expect(calls.start).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: '查看原任务' }));
    await act(async () => {
      pending.resolve(json(started()));
    });
    expect(screen.getByTestId('location')).toHaveTextContent('/projects/project-1/work');
    expect(screen.getByTestId('location')).not.toHaveTextContent('/workspace/');
    expect(screen.getByTestId('location')).toHaveTextContent('?task=task-1');
  });
  it('未选择 Agent 时明确仅创建任务，不发出启动请求', async () => {
    const { calls, fetchMock } = workflow();
    show(async (input, init) =>
      String(input) === '/api/v1/agents' ? json([]) : fetchMock(input, init),
    );
    fireEvent.change(screen.getByLabelText('你想完成什么？'), { target: { value: '修复登录' } });
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?task=task-1'));
    expect(calls.create).toBe(1);
    expect(calls.transition).toBe(0);
    expect(calls.start).toBe(0);
  });

  it('无法识别的启动响应不允许直接重试', async () => {
    const { calls, fetchMock } = workflow({ start: () => json({ session: null }) });
    show(fetchMock);
    await submitTask();
    await screen.findByText('任务响应无法确认，请到任务列表核对。');
    expect(screen.queryByRole('button', { name: '重试启动' })).not.toBeInTheDocument();
    expect(calls.start).toBe(1);
  });

  it('连续核对以最新会话关联为准，不保留已消失的旧工作区入口', async () => {
    let read = 0;
    const { fetchMock } = workflow({
      start: () => Promise.reject(new TypeError('network')),
      read: () =>
        json({ ...task, status: 'READY', sessionId: ++read === 1 ? 'old-session' : null }),
    });
    show(fetchMock);
    await submitTask();
    await screen.findByText('任务已创建');
    fireEvent.click(screen.getByRole('button', { name: '核对原任务状态' }));
    await screen.findByRole('button', { name: '打开已有工作区' });
    fireEvent.click(screen.getByRole('button', { name: '核对原任务状态' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '打开已有工作区' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: '重试启动' })).not.toBeInTheDocument();
  });
  it.each([
    [
      'task id',
      () => {
        const value = started();
        value.task.id = 'other-task';
        return value;
      },
    ],
    [
      'task project',
      () => {
        const value = started();
        value.task.projectId = 'other-project';
        return value;
      },
    ],
    [
      'session project',
      () => {
        const value = started();
        value.session.projectId = 'other-project';
        return value;
      },
    ],
    [
      'session task',
      () => {
        const value = started();
        value.session.taskId = 'other-task';
        return value;
      },
    ],
    [
      'session agent',
      () => {
        const value = started();
        value.session.agentId = 'other-agent';
        return value;
      },
    ],
    [
      'task/session association',
      () => {
        const value = started();
        value.task.sessionId = 'other-session';
        return value;
      },
    ],
    ['incomplete session', () => ({ ...started(), session: { id: 'session-1' } })],
  ])('启动成功响应的 %s 不匹配时不导航、不允许重试', async (_name, result) => {
    const { calls, fetchMock } = workflow({ start: () => json(result()) });
    show(fetchMock);
    await submitTask();
    await screen.findByText(/请求可能已生效/);
    expect(screen.queryByRole('button', { name: '重试启动' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开已有工作区' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).not.toHaveTextContent('/workspace/');
    expect(calls.start).toBe(1);
    expect(calls.create).toBe(1);
  });
});
