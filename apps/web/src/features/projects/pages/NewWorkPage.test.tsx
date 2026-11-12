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
  if (path.endsWith('/agent-eligibility'))
    return json({
      projectId: context.project.id,
      basis: 'REGISTERED_STATE',
      livePreflight: false,
      agents: [
        {
          agentId: agent.id,
          eligible: true,
          reason: null,
          agentStatus: 'READY',
          targetStatus: 'READY',
        },
      ],
    });
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
  await screen.findByText('测试 Agent 可选择，启动时检查');
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
    await screen.findByText('测试 Agent 可选择，启动时检查');
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
    await screen.findByText('测试 Agent 可选择，启动时检查');
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

describe('新建 Task 的明确 Prompt 选择', () => {
  const asset = { id: 'prompt-1', name: '测试资产', kind: 'TASK', type: 'TEXT' };
  const rendered = {
    promptId: asset.id,
    versionId: 'version-7',
    version: 7,
    text: '固定模板内容',
    missingVariables: [] as string[],
  };
  function promptWorkflow(
    options: {
      noAgent?: boolean;
      missing?: boolean;
      failPreview?: boolean;
      startCode?: string;
    } = {},
  ) {
    const bodies: { path: string; body: Record<string, unknown> }[] = [];
    let starts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (init?.method === 'POST') bodies.push({ path, body });
      if (path.startsWith('/api/v1/prompts?')) return json([asset]);
      if (path.endsWith('/render')) {
        if (options.failPreview) return failure('PROMPT_NOT_FOUND', 404);
        return json({
          ...rendered,
          missingVariables:
            options.missing && !(body.variables as Record<string, unknown>)?.subject
              ? ['subject']
              : [],
        });
      }
      if (path === '/api/v1/agents') return json(options.noAgent ? [] : [agent]);
      if (path === '/api/v1/tasks' && init?.method === 'POST') return json(task);
      if (path.endsWith('/transition')) return json({ ...task, status: 'READY' });
      if (path.endsWith('/start')) {
        starts++;
        if (options.startCode && starts === 1) return failure(options.startCode);
        return json(started());
      }
      return base(path);
    });
    return { fetchMock, bodies };
  }
  async function selectPrompt() {
    fireEvent.click(screen.getByText('高级设置'));
    fireEvent.click(screen.getByLabelText('PromptOS 资产（可选）'));
    fireEvent.click(await screen.findByRole('option', { name: /测试资产/ }));
    fireEvent.change(screen.getByLabelText('你想完成什么？'), { target: { value: '主目标保留' } });
  }
  async function previewPrompt() {
    fireEvent.click(screen.getByRole('button', { name: '预览并固定版本' }));
    await screen.findByText(/已固定版本 v7/);
  }
  it.each([
    null,
    { ...rendered, promptId: 'another-prompt' },
    { ...rendered, versionId: {} },
    { ...rendered, versionId: '   ' },
    { ...rendered, version: 0 },
    { ...rendered, version: -1 },
    { ...rendered, version: 7.5 },
    { ...rendered, text: { invalid: true } },
    { ...rendered, missingVariables: [null] },
    { ...rendered, missingVariables: {} },
  ])('拒绝不完整或错误资产的预览响应 %#', async (response) => {
    const f = promptWorkflow();
    show((input, init) =>
      String(input).endsWith('/render')
        ? Promise.resolve(json(response))
        : f.fetchMock(input, init),
    );
    await selectPrompt();
    fireEvent.click(screen.getByRole('button', { name: '预览并固定版本' }));
    await screen.findByText('Prompt 预览失败');
    expect(screen.queryByRole('region', { name: 'Prompt 预览' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建并开始' })).toBeDisabled();
    expect(f.bodies.some((request) => request.path === '/api/v1/tasks')).toBe(false);
  });
  it('补全变量后不接受与已固定版本不同的响应', async () => {
    const f = promptWorkflow({ missing: true });
    let previews = 0;
    show((input, init) => {
      if (String(input).endsWith('/render') && ++previews === 2) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ version: 7 });
        return Promise.resolve(json({ ...rendered, version: 8, versionId: 'version-8' }));
      }
      return f.fetchMock(input, init);
    });
    await selectPrompt();
    await previewPrompt();
    fireEvent.change(screen.getByLabelText('Prompt 变量（JSON 对象）'), {
      target: { value: '{"subject":"补充输入"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: '预览并固定版本' }));
    await screen.findByText('Prompt 预览失败');
    expect(screen.queryByText(/已固定版本 v8/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建并开始' })).toBeDisabled();
    expect(f.bodies.some((request) => request.path === '/api/v1/tasks')).toBe(false);
  });
  it('认证失效后忽略已在途的 Prompt 预览', async () => {
    const pending = deferred<Response>();
    const f = promptWorkflow();
    show((input, init) =>
      String(input).endsWith('/render') ? pending.promise : f.fetchMock(input, init),
    );
    await selectPrompt();
    fireEvent.click(screen.getByRole('button', { name: '预览并固定版本' }));
    act(() => authSession.notifyAuthorizationRequired());
    await act(async () => pending.resolve(json(rendered)));
    expect(screen.queryByText(/已固定版本/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建并开始' })).toBeDisabled();
    expect(f.bodies.some((request) => request.path === '/api/v1/tasks')).toBe(false);
  });
  it('没有 Agent 时不静默丢弃变量，清空变量才允许仅保存模板绑定', async () => {
    const f = promptWorkflow({ noAgent: true });
    show(f.fetchMock);
    await selectPrompt();
    fireEvent.change(screen.getByLabelText('Prompt 变量（JSON 对象）'), {
      target: { value: '{"subject":"本次变量"}' },
    });
    await previewPrompt();
    expect(
      screen.getByText('变量仅用于本次启动；请选择 Agent 后创建并开始，或清空变量仅保存模板绑定。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建任务' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    expect(f.bodies.some((request) => request.path === '/api/v1/tasks')).toBe(false);
    fireEvent.change(screen.getByLabelText('Prompt 变量（JSON 对象）'), {
      target: { value: '{}' },
    });
    await previewPrompt();
    expect(screen.getByText('仅保存模板版本绑定，不保存本次预览变量。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() =>
      expect(f.bodies.some((request) => request.path === '/api/v1/tasks')).toBe(true),
    );
    expect(f.bodies.some((request) => request.path.endsWith('/start'))).toBe(false);
  });
  it('未选 Agent 仍在创建时发送固定版本绑定，预览前不允许提交', async () => {
    const f = promptWorkflow({ noAgent: true });
    show(f.fetchMock);
    await selectPrompt();
    expect(screen.getByRole('button', { name: '创建任务' })).toBeDisabled();
    await previewPrompt();
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(f.bodies.some((x) => x.path === '/api/v1/tasks')).toBe(true));
    expect(f.bodies.find((x) => x.path === '/api/v1/tasks')?.body).toMatchObject({
      title: '主目标保留',
      selectedPrompt: { promptId: 'prompt-1', versionId: 'version-7' },
    });
    expect(f.bodies.some((x) => x.path.endsWith('/start'))).toBe(false);
  });
  it('必填变量补全后重新预览同一版本，安全启动失败重试保留变量与原任务', async () => {
    const f = promptWorkflow({ missing: true, startCode: 'TASK_PROMPT_VARIABLES_MISSING' });
    show(f.fetchMock);
    await selectPrompt();
    await previewPrompt();
    expect(screen.getByText('缺少变量：subject')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建并开始' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Prompt 变量（JSON 对象）'), {
      target: { value: '{"subject":"已确认输入"}' },
    });
    expect(screen.getByRole('button', { name: '创建并开始' })).toBeDisabled();
    await previewPrompt();
    expect(f.bodies.filter((x) => x.path.endsWith('/render'))[1]?.body).toEqual({
      version: 7,
      variables: { subject: '已确认输入' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建并开始' }));
    fireEvent.click(await screen.findByRole('button', { name: '重试启动' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/workspace/session-1'),
    );
    expect(f.bodies.filter((x) => x.path === '/api/v1/tasks')).toHaveLength(1);
    expect(f.bodies.filter((x) => x.path.endsWith('/start')).map((x) => x.body)).toEqual([
      { agentId: 'agent-1', promptVariables: { subject: '已确认输入' } },
      { agentId: 'agent-1', promptVariables: { subject: '已确认输入' } },
    ]);
  });
  it('资产失效或预览失败不创建任务，Goal 明确不应用选择', async () => {
    const f = promptWorkflow({ failPreview: true });
    show(f.fetchMock);
    await selectPrompt();
    fireEvent.click(screen.getByRole('button', { name: '预览并固定版本' }));
    await screen.findByText('Prompt 预览失败');
    expect(screen.getByRole('button', { name: '创建并开始' })).toBeDisabled();
    expect(f.bodies.some((x) => x.path === '/api/v1/tasks')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Goal' }));
    expect(
      screen.getByText('Goal 创建不会绑定 Prompt；请在具体 Task 上选择。'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('PromptOS 资产（可选）')).toBeDisabled();
  });
  it.each(['TASK_PROMPT_RESOLUTION_FAILED', 'PROMPT_VARIABLES_MISSING'])(
    '仅将预运行专用错误作为安全重试：%s',
    async (code) => {
      const f = promptWorkflow({ startCode: code });
      show(f.fetchMock);
      await selectPrompt();
      await previewPrompt();
      fireEvent.click(screen.getByRole('button', { name: '创建并开始' }));
      await screen.findByText('后续结果需要处理');
      if (code.startsWith('TASK_'))
        expect(screen.getByRole('button', { name: '重试启动' })).toBeInTheDocument();
      else expect(screen.queryByRole('button', { name: '重试启动' })).not.toBeInTheDocument();
    },
  );
  it('编辑变量后忽略旧预览响应，不允许凭过期预览提交', async () => {
    const pending = deferred<Response>();
    const f = promptWorkflow();
    show(async (input, init) =>
      String(input).endsWith('/render') ? pending.promise : f.fetchMock(input, init),
    );
    await selectPrompt();
    fireEvent.click(screen.getByRole('button', { name: '预览并固定版本' }));
    fireEvent.change(screen.getByLabelText('Prompt 变量（JSON 对象）'), {
      target: { value: '{"subject":"新的输入"}' },
    });
    await act(async () => pending.resolve(json(rendered)));
    expect(screen.queryByText(/已固定版本/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建并开始' })).toBeDisabled();
  });
  it.each([
    'TASK_PROMPT_PROJECT_MISMATCH',
    'PROMPT_NOT_FOUND',
    'PROMPT_VERSION_NOT_FOUND',
    'PROMPT_LABEL_NOT_FOUND',
  ])('选择在持久化前被拒绝时允许修改：%s', async (code) => {
    const f = promptWorkflow();
    show(async (input, init) =>
      String(input) === '/api/v1/tasks' && init?.method === 'POST'
        ? failure(code, 404)
        : f.fetchMock(input, init),
    );
    await selectPrompt();
    await previewPrompt();
    fireEvent.click(screen.getByRole('button', { name: '创建并开始' }));
    await screen.findByText('创建被拒绝');
    expect(screen.getByLabelText('你想完成什么？')).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: '重试启动' })).not.toBeInTheDocument();
  });
});

describe('项目作用域 Agent 资格', () => {
  const entry = {
    agentId: agent.id,
    eligible: true,
    reason: null,
    agentStatus: 'READY',
    targetStatus: 'STOPPED',
  };
  const eligibility = (entries = [entry], projectId = 'project-1') => ({
    projectId,
    basis: 'REGISTERED_STATE',
    livePreflight: false,
    agents: entries,
  });
  const withEligibility = (response: () => Promise<Response> | Response, agents = [agent]) => {
    const f = workflow();
    const fetchMock = (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/agent-eligibility')
        ? Promise.resolve(response())
        : String(input) === '/api/v1/agents'
          ? Promise.resolve(json(agents))
          : f.fetchMock(input, init);
    return { ...f, fetchMock };
  };
  async function chooseLater() {
    fireEvent.click(screen.getByLabelText('推荐 Agent'));
    fireEvent.click(await screen.findByRole('option', { name: '稍后选择，仅创建任务' }));
  }
  it('服务端认可的跨环境映射可选，同时展示停止状态而不声称可用', async () => {
    const f = withEligibility(() => json(eligibility()));
    show(f.fetchMock);
    await screen.findByText('测试 Agent 可选择，启动时检查');
    fireEvent.click(screen.getByLabelText('推荐 Agent'));
    expect(await screen.findByRole('option', { name: /环境记录：STOPPED/ })).toBeInTheDocument();
    expect(screen.queryByText('测试 Agent 可用')).not.toBeInTheDocument();
  });
  it('显式稍后选择在资格刷新后保持，不再次自动分配', async () => {
    const f = withEligibility(() => json(eligibility()));
    show(f.fetchMock);
    await screen.findByText('测试 Agent 可选择，启动时检查');
    await chooseLater();
    fireEvent.click(screen.getByRole('button', { name: '刷新 Agent 资格' }));
    fireEvent.change(screen.getByLabelText('你想完成什么？'), { target: { value: '仅保存任务' } });
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(f.calls.create).toBe(1));
    expect(f.calls.start).toBe(0);
  });
  it.each(['loading', 'error', 'malformed', 'wrong-project'])(
    '资格%s不会自动指派',
    async (mode) => {
      const pending = deferred<Response>();
      const f = withEligibility(() =>
        mode === 'loading'
          ? pending.promise
          : mode === 'error'
            ? failure('FAILED', 500)
            : mode === 'malformed'
              ? json([])
              : json(eligibility([entry], 'other-project')),
      );
      show(f.fetchMock);
      if (mode === 'loading') await screen.findByText(/正在确认项目 Agent 资格/);
      else await screen.findByText('无法确认项目 Agent 资格，不会自动选择 Agent。');
      expect(screen.queryByText('测试 Agent 可选择，启动时检查')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '创建任务' })).toBeInTheDocument();
    },
  );
  it('禁用但 READY 的 Agent 不自动选择并显示原因', async () => {
    const f = withEligibility(() => json(eligibility()), [{ ...agent, enabled: false }]);
    show(f.fetchMock);
    fireEvent.click(screen.getByLabelText('推荐 Agent'));
    expect(await screen.findByRole('option', { name: /测试 Agent · 已禁用/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.keyDown(screen.getByRole('option', { name: /测试 Agent · 已禁用/ }), {
      key: 'Escape',
    });
    expect(screen.getByRole('button', { name: '创建任务' })).toBeInTheDocument();
  });
  it('所选 Agent 刷新后失去资格不替换，阻止启动但可改为仅创建', async () => {
    let disabled = false;
    const f = withEligibility(() =>
      json({
        ...eligibility(),
        agents: [
          { ...entry, eligible: !disabled, reason: disabled ? 'INCOMPATIBLE_WORKSPACE' : null },
        ],
      }),
    );
    show(f.fetchMock);
    await screen.findByText('测试 Agent 可选择，启动时检查');
    fireEvent.change(screen.getByLabelText('你想完成什么？'), { target: { value: '保留任务' } });
    disabled = true;
    fireEvent.click(screen.getByRole('button', { name: '刷新 Agent 资格' }));
    await screen.findByText('测试 Agent 当前资格不满足，请重新选择或仅创建任务');
    expect(screen.getByRole('button', { name: '创建并开始' })).toBeDisabled();
    await chooseLater();
    expect(screen.getByRole('button', { name: '创建任务' })).toBeEnabled();
  });
});

describe('完整工作要求与短标题', () => {
  it('241字以上完整要求提交到说明，显示可编辑标题并在安全重试中冻结', async () => {
    const f = workflow({ start: () => failure('AGENT_NOT_READY') });
    show(f.fetchMock);
    const instructions = `${'详细要求'.repeat(80)}\n必须完成第二段`;
    fireEvent.change(screen.getByLabelText('你想完成什么？'), { target: { value: instructions } });
    fireEvent.change(screen.getByLabelText('补充上下文（可选）'), {
      target: { value: '额外约束' },
    });
    expect(screen.getByLabelText('任务短标题（可编辑）')).toHaveValue(
      `${'详细要求'.repeat(30).slice(0, 119)}…`,
    );
    fireEvent.change(screen.getByLabelText('任务短标题（可编辑）'), {
      target: { value: '人工短标题' },
    });
    await screen.findByText('测试 Agent 可选择，启动时检查');
    fireEvent.click(screen.getByRole('button', { name: '创建并开始' }));
    await screen.findByRole('button', { name: '重试启动' });
    const create = f.fetchMock.mock.calls.find(
      ([path, init]) => String(path) === '/api/v1/tasks' && init?.method === 'POST',
    );
    expect(JSON.parse(String(create?.[1]?.body))).toMatchObject({
      title: '人工短标题',
      description: `任务要求：\n${instructions}\n\n补充上下文：\n额外约束`,
    });
    expect(screen.getByLabelText('任务短标题（可编辑）')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重试启动' }));
    await waitFor(() => expect(f.calls.start).toBe(2));
    expect(f.calls.create).toBe(1);
  });
  it('总说明或 Goal 标题超限明确阻止提交，不截断文字', async () => {
    const f = workflow();
    show(f.fetchMock);
    const tooLong = '文'.repeat(100000);
    fireEvent.change(screen.getByLabelText('你想完成什么？'), { target: { value: tooLong } });
    expect(screen.getByText(/任务说明（含分节标题）不能超过/)).toBeInTheDocument();
    expect(screen.getByLabelText('你想完成什么？')).toHaveValue(tooLong);
    await screen.findByText('测试 Agent 可选择，启动时检查');
    expect(screen.getByRole('button', { name: '创建并开始' })).toBeDisabled();
    fireEvent.click(screen.getByText('高级设置'));
    fireEvent.click(screen.getByRole('button', { name: 'Goal' }));
    expect(screen.getByText('Goal 标题不能超过 240 个字符。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建 Goal' })).toBeDisabled();
    expect(f.calls.create).toBe(0);
  });
});
