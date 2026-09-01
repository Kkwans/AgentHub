// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSessionEventPages, mergeSessionEvents, WorkspacePage } from './WorkspacePage';

vi.mock('../../../lib/realtime', () => ({
  realtime: {
    subscribe: () => () => undefined,
  },
}));

const session = {
  id: 'session-1',
  projectId: 'project-1',
  agentId: 'agent-1',
  taskId: null,
  externalSessionId: 'external-session',
  title: '可靠性回归',
  cwd: '/volume2/Project/AgentHub',
  branch: 'main',
  status: 'READY',
  model: null,
  mode: null,
  lastSeq: 0,
  createdAt: '2026-08-11T00:00:00.000Z',
  startedAt: null,
  lastActiveAt: null,
  closedAt: null,
  archivedAt: null,
};

const project = {
  id: session.projectId,
  name: 'AgentHub',
  description: null,
  targetId: 'target-1',
  rootPath: session.cwd,
  realRootPath: session.cwd,
  repoKind: 'GIT',
  status: 'ACTIVE',
};

const agent = {
  id: session.agentId,
  targetId: project.targetId,
  name: 'Codex 主力',
  agentKind: 'CODEX',
  adapterKind: 'ACP_STDIO',
  status: 'READY',
  enabled: true,
  detectedVersion: '1.1.14',
  defaultModel: null,
  defaultMode: null,
  capabilitiesJson: { configuration: { models: true, modes: true } },
  lastPreflightAt: '2026-08-11T00:00:00.000Z',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data, requestId: 'workspace-page-test' }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(message = '测试服务失败', status = 503) {
  return new Response(
    JSON.stringify({
      error: { code: 'HTTP_ERROR', message, requestId: 'workspace-page-test' },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function renderWorkspace(fetchMock: typeof fetch, initialEntry = `/sessions/${session.id}`) {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/sessions/:id" element={<WorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

function baseFetch(path: string, method?: string) {
  if (path === `/api/v1/sessions/${session.id}`) return jsonResponse(session);
  if (path === '/api/v1/sessions') return jsonResponse([session]);
  if (path === '/api/v1/projects') return jsonResponse([project]);
  if (path === '/api/v1/agents') return jsonResponse([agent]);
  if (path === '/api/v1/settings/capabilities') {
    return jsonResponse({ terminal: { available: false } });
  }
  if (path === '/api/v1/prompt-context/resolve' && method === 'POST') {
    return jsonResponse({ ready: true, finalContext: '', missingVariables: [], items: [] });
  }
  if (path.startsWith(`/api/v1/sessions/${session.id}/messages`)) return jsonResponse([]);
  if (path === `/api/v1/sessions/${session.id}/runs`) return jsonResponse([]);
  if (path === `/api/v1/sessions/${session.id}/events?afterSeq=0&limit=500`) {
    return jsonResponse([]);
  }
  if (path === `/api/v1/approvals?sessionId=${session.id}`) return jsonResponse([]);
  if (path === `/api/v1/projects/${project.id}/files?depth=4`) return jsonResponse([]);
  if (path === `/api/v1/projects/${project.id}/git/diff`) {
    return jsonResponse({ patch: '', truncated: false });
  }
  if (path === `/api/v1/projects/${project.id}/git/status`) {
    return jsonResponse({ branch: 'main', headSha: null, clean: true, entries: [] });
  }
  if (path === `/api/v1/projects/${project.id}/git/diff?staged=false`) {
    return jsonResponse({ patch: '', truncated: false, staged: false });
  }
  if (path === `/api/v1/projects/${project.id}/git/diff?staged=true`) {
    return jsonResponse({ patch: '', truncated: false, staged: true });
  }
  if (path === `/api/v1/projects/${project.id}/git/commits?limit=30`) return jsonResponse([]);
  if (path === `/api/v1/projects/${project.id}/git/branches`) return jsonResponse([]);
  return jsonResponse({});
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkspacePage 数据分区可靠性', () => {
  it('按 seq 分页拉取长 Session 事件并合并去重', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      id: `event-${index + 1}`,
      sessionId: session.id,
      runId: null,
      seq: index + 1,
      type: 'tool.call.started',
      payloadJson: {},
      createdAt: '2026-08-11T00:00:00.000Z',
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith(`afterSeq=0&limit=500`)) return jsonResponse(firstPage);
      if (path.endsWith(`afterSeq=500&limit=500`)) {
        return jsonResponse([
          {
            ...firstPage[0]!,
            id: 'event-501',
            seq: 501,
          },
        ]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const fetched = await fetchSessionEventPages(session.id);
    expect(fetched).toHaveLength(501);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/sessions/${session.id}/events?afterSeq=500&limit=500`,
      expect.any(Object),
    );
    expect(mergeSessionEvents([firstPage[499]!], fetched.slice(499))).toEqual([
      firstPage[499]!,
      fetched[500],
    ]);
  });

  it('messages 加载失败时显示可重试错误，不伪装成等待第一条指令', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith(`/api/v1/sessions/${session.id}/messages`)) {
        return errorResponse('消息服务不可用');
      }
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    expect(await screen.findByText('请求失败，请稍后重试。')).toBeInTheDocument();
    expect(screen.queryByText('等待第一条指令')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '重新加载' }).length).toBeGreaterThan(0);
  });

  it('消息窗口按 beforeSequence 加载更早历史并保持时间线顺序', async () => {
    const currentPage = Array.from({ length: 100 }, (_, index) => ({
      id: `message-${index + 101}`,
      runId: null,
      role: 'ASSISTANT' as const,
      kind: 'TEXT',
      text: `当前消息 ${index + 101}`,
      sequence: index + 101,
      createdAt: new Date((index + 101) * 1_000).toISOString(),
    }));
    const previousPage = Array.from({ length: 100 }, (_, index) => ({
      id: `message-${index + 1}`,
      runId: null,
      role: 'ASSISTANT' as const,
      kind: 'TEXT',
      text: `更早消息 ${index + 1}`,
      sequence: index + 1,
      createdAt: new Date((index + 1) * 1_000).toISOString(),
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith(`/api/v1/sessions/${session.id}/messages`)) {
        return path.includes('beforeSequence=101')
          ? jsonResponse(previousPage)
          : jsonResponse(currentPage);
      }
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    expect(await screen.findByText('当前消息 200')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '加载更早消息' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/sessions/${session.id}/messages?limit=100&beforeSequence=101`,
        expect.any(Object),
      ),
    );
    expect(await screen.findByText('更早消息 1')).toBeInTheDocument();
    expect(screen.getByText('当前消息 200')).toBeInTheDocument();
  });

  it('超过 500 项时只渲染窗口，并支持展开旧窗口后回到最新', async () => {
    const longTimeline = Array.from({ length: 600 }, (_, index) => ({
      id: `message-${index + 1}`,
      runId: null,
      role: 'ASSISTANT' as const,
      kind: 'TEXT',
      text: `长会话消息 ${index + 1}`,
      sequence: index + 1,
      createdAt: new Date((index + 1) * 1_000).toISOString(),
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith(`/api/v1/sessions/${session.id}/messages`))
        return jsonResponse(longTimeline);
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    expect(await screen.findByText('长会话消息 600')).toBeInTheDocument();
    expect(screen.queryByText('长会话消息 1')).not.toBeInTheDocument();
    const scroll = screen.getByRole('log');
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 5_000 },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    fireEvent.scroll(scroll);

    expect(await screen.findByText('长会话消息 1')).toBeInTheDocument();
    expect(screen.queryByText('长会话消息 600')).not.toBeInTheDocument();
    const jumpLatest = screen.getByRole('button', { name: '回到最新' });
    fireEvent.click(jumpLatest);
    await waitFor(() => {
      expect(screen.getByText('长会话消息 600')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '回到最新' })).not.toBeInTheDocument();
    });
  });

  it('正常对话视图将 Agent 事件类型翻译成中文，不泄露协议枚举', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === `/api/v1/sessions/${session.id}/events?afterSeq=0&limit=500`) {
        return jsonResponse([
          {
            id: 'event-tool-completed',
            sessionId: session.id,
            runId: 'run-1',
            seq: 1,
            type: 'tool.call.completed',
            payloadJson: { title: '读取文件', status: 'completed' },
            createdAt: '2026-08-11T00:00:00.000Z',
          },
        ]);
      }
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    expect(await screen.findByLabelText('读取文件，工具调用完成，展开详情')).toBeInTheDocument();
    expect(screen.queryByText('tool.call.completed')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '在工具检查器中查看' })).toHaveAttribute(
      'href',
      expect.stringContaining('?view=activity'),
    );
    expect(screen.queryByText(/\"title\"/)).not.toBeInTheDocument();
  });

  it('供应商连接诊断在对话中显示中文下一步，原文只在脱敏诊断中出现', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith(`/api/v1/sessions/${session.id}/messages`)) {
        return jsonResponse([
          {
            id: 'message-error',
            runId: 'run-error',
            role: 'ASSISTANT',
            kind: 'TEXT',
            text: 'Warning: Falling back from WebSockets to HTTPS transport. stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses?token=secret)',
            sequence: 1,
            createdAt: '2026-08-11T00:00:00.000Z',
          },
        ]);
      }
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    expect(await screen.findByText('Agent 连接失败')).toBeInTheDocument();
    expect(screen.getByText(/检查 Agent 是否已授权/)).toBeInTheDocument();
    const debug = screen.getByText('显示脱敏诊断');
    expect(debug.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText(/Falling back from WebSockets/).closest('details')).toBe(
      debug.closest('details'),
    );
    fireEvent.click(debug);
    expect(await screen.findByText(/已隐藏地址/)).toBeInTheDocument();
    expect(screen.queryByText('https://chatgpt.com')).not.toBeInTheDocument();
    expect(screen.queryByText('token=secret')).not.toBeInTheDocument();
  });

  it('Approval 提交失败可见、可重试，并且提交期间禁用全部选项', async () => {
    let attempts = 0;
    let releaseApproval: ((response: Response) => void) | undefined;
    const pendingApproval = new Promise<Response>((resolve) => {
      releaseApproval = resolve;
    });
    const approval = {
      id: 'approval-1',
      sessionId: session.id,
      runId: 'run-1',
      title: '执行工具',
      description: '需要你的确认',
      optionsJson: [
        { id: 'allow', label: '允许', kind: 'allow' },
        { id: 'deny', label: '拒绝', kind: 'deny' },
      ],
      status: 'PENDING',
      selectedOptionId: null,
      deliveryId: null,
      deliveryState: null,
      deliveryAttemptCount: null,
      deliveryErrorCode: null,
      deliveryErrorMessage: null,
      requestedAt: '2026-08-11T00:00:00.000Z',
      resolvedAt: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === `/api/v1/approvals?sessionId=${session.id}`) return jsonResponse([approval]);
      if (path === '/api/v1/approvals/approval-1/resolve' && init?.method === 'POST') {
        attempts += 1;
        return attempts === 1 ? pendingApproval : jsonResponse({});
      }
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    const allow = await screen.findByRole('button', { name: '允许' });
    const deny = screen.getByRole('button', { name: '拒绝' });
    fireEvent.click(allow);
    await waitFor(() => {
      expect(allow).toBeDisabled();
      expect(deny).toBeDisabled();
    });
    releaseApproval?.(
      new Response(
        JSON.stringify({
          error: {
            code: 'APPROVAL_ALREADY_RESOLVED',
            message: 'Approval 已被其他操作拒绝',
            requestId: 'workspace-page-test',
          },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '这个权限请求已经被其他操作处理，请刷新查看最新状态。',
    );

    fireEvent.click(screen.getByRole('button', { name: '重试此选项' }));
    await waitFor(() => expect(attempts).toBe(2));
  });

  it('Approval 投递未知时不再显示决定按钮或盲目重试，并给出普通用户下一步', async () => {
    const approval = {
      id: 'approval-unknown',
      sessionId: session.id,
      runId: 'run-unknown',
      title: '允许执行工具吗？',
      description: null,
      optionsJson: [
        { id: 'allow', label: '允许一次', kind: 'allow_once' },
        { id: 'deny', label: '拒绝', kind: 'deny_once' },
      ],
      status: 'APPROVED',
      selectedOptionId: 'allow',
      deliveryId: 'delivery-unknown',
      deliveryState: 'UNKNOWN',
      deliveryAttemptCount: 1,
      deliveryErrorCode: 'APPROVAL_DELIVERY_TIMEOUT',
      deliveryErrorMessage: 'Agent 未确认是否收到，为避免重复执行不会自动重发。',
      requestedAt: '2026-08-11T00:00:00.000Z',
      resolvedAt: '2026-08-11T00:00:01.000Z',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === `/api/v1/approvals?sessionId=${session.id}`) return jsonResponse([approval]);
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    expect(await screen.findByText('无法确认 Agent 是否收到')).toBeInTheDocument();
    expect(
      screen.getByText('Agent 没有在限定时间内确认，系统不会自动重发，避免同一权限操作执行两次。'),
    ).toBeInTheDocument();
    const debug = screen.getByText('显示诊断信息');
    expect(debug.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(debug);
    expect(debug.closest('details')).toHaveAttribute('open');
    expect(screen.getByText(approval.deliveryErrorMessage)).toBeInTheDocument();
    expect(screen.getByText('APPROVAL_DELIVERY_TIMEOUT')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往 Session 列表恢复或重新开始' })).toHaveAttribute(
      'href',
      '/sessions',
    );
    expect(screen.queryByRole('button', { name: '允许一次' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拒绝' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试此选项' })).not.toBeInTheDocument();
  });

  it('Approval 没有合法选项时不渲染空操作区，而是给出可执行的下一步', async () => {
    const approval = {
      id: 'approval-no-options',
      sessionId: session.id,
      runId: 'run-no-options',
      title: '需要处理权限请求',
      description: 'Agent 没有返回可用选项。',
      optionsJson: [{ label: '缺少 id' }],
      status: 'PENDING',
      selectedOptionId: null,
      deliveryId: null,
      deliveryState: null,
      deliveryAttemptCount: null,
      deliveryErrorCode: null,
      deliveryErrorMessage: null,
      requestedAt: '2026-08-11T00:00:00.000Z',
      resolvedAt: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === `/api/v1/approvals?sessionId=${session.id}`) return jsonResponse([approval]);
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    expect(
      await screen.findByText('Agent 没有提供可执行选项，请返回 Session 列表重新开始。'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '缺少 id' })).not.toBeInTheDocument();
  });

  it('Stop Run 提交期间防重复，失败显示可见反馈并支持重试', async () => {
    let cancelAttempts = 0;
    let releaseCancel: ((response: Response) => void) | undefined;
    const pendingCancel = new Promise<Response>((resolve) => {
      releaseCancel = resolve;
    });
    const run = {
      id: 'run-1',
      sessionId: session.id,
      status: 'RUNNING',
      prompt: '执行任务',
      model: null,
      mode: null,
      gitBeforeSha: null,
      gitAfterSha: null,
      startedAt: '2026-08-11T00:00:00.000Z',
      completedAt: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === `/api/v1/sessions/${session.id}/runs`) return jsonResponse([run]);
      if (path === `/api/v1/sessions/${session.id}/events?afterSeq=0&limit=500`) {
        return jsonResponse([
          {
            id: 'thought-running',
            sessionId: session.id,
            runId: run.id,
            seq: 1,
            type: 'agent.thought.delta',
            payloadJson: { messageId: 'thought-1', text: '正在核验实现。' },
            createdAt: '2026-08-11T00:00:01.000Z',
          },
        ]);
      }
      if (
        path === `/api/v1/sessions/${session.id}/runs/${run.id}/cancel` &&
        init?.method === 'POST'
      ) {
        cancelAttempts += 1;
        return cancelAttempts === 1 ? pendingCancel : jsonResponse({});
      }
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    expect(
      await screen.findByRole('region', { name: '当前运行状态：Agent 正在执行' }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('正在思考，展开思考过程')).toBeInTheDocument();
    expect(screen.getByText('正在思考').closest('details')).toHaveClass('running');
    const stop = await screen.findByRole('button', { name: '停止 Run' });
    fireEvent.click(stop);
    await waitFor(() => expect(stop).toBeDisabled());
    releaseCancel?.(errorResponse('停止 Run 失败'));
    expect(await screen.findByRole('alert')).toHaveTextContent('停止 Run 失败');
    fireEvent.click(screen.getByRole('button', { name: '重试停止' }));
    await waitFor(() => expect(cancelAttempts).toBe(2));
  });

  it('关闭的 Session 明确说明原因并锁定 Composer', async () => {
    const closedSession = { ...session, status: 'CLOSED' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === `/api/v1/sessions/${session.id}`) return jsonResponse(closedSession);
      if (path === '/api/v1/sessions') return jsonResponse([closedSession]);
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    expect(
      await screen.findByRole('region', { name: '当前运行状态：Session 已关闭' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /可靠性回归/ }).querySelector('.session-state-dot'),
    ).toHaveClass('session-state-closed');
    const composer = await screen.findByRole('textbox', { name: '给 Agent 发送工程指令' });
    expect(composer).toHaveAttribute('aria-label', '给 Agent 发送工程指令');
    expect(composer).toHaveAttribute('name', 'message');
    expect(composer).toHaveAttribute('placeholder', '会话已关闭，无法继续发送指令。');
    expect(composer).toBeDisabled();
    expect(screen.getByText('会话已关闭，无法继续发送指令。')).toBeInTheDocument();
  });

  it('PromptOS 服务失败时阻止静默跳过绑定，重新解析成功后恢复发送', async () => {
    let contextAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/v1/prompt-context/resolve' && init?.method === 'POST') {
        contextAttempts += 1;
        return contextAttempts === 1
          ? errorResponse('PromptOS 服务暂时不可用')
          : jsonResponse({ ready: true, finalContext: '', missingVariables: [], items: [] });
      }
      if (path === `/api/v1/sessions/${session.id}/runs` && init?.method === 'POST') {
        return jsonResponse({ id: 'run-2' }, 201);
      }
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    const promptButton = await screen.findByRole(
      'button',
      { name: /PromptOS 服务失败/ },
      { timeout: 5_000 },
    );
    fireEvent.click(promptButton);
    expect(await screen.findByRole('alert')).toHaveTextContent('请求失败，请稍后重试。');
    expect(screen.getByRole('button', { name: '重新解析' })).toBeInTheDocument();

    const composer = screen.getByPlaceholderText('给 Agent 发送工程指令…');
    fireEvent.change(composer, { target: { value: '继续执行' } });
    const send = screen.getByRole('button', { name: '发送' });
    expect(send).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '重新解析' }));
    await waitFor(() => expect(contextAttempts).toBe(2));
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/sessions/${session.id}/runs`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('Git 工作区提供可发现的历史、分支与 selected-files commit', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === `/api/v1/projects/${project.id}/git/status`) {
        return jsonResponse({
          branch: 'main',
          upstream: 'origin/main',
          ahead: 1,
          headSha: '1234567890abcdef',
          clean: false,
          entries: [
            { index: ' ', worktree: 'M', path: 'apps/web/src/App.tsx' },
            { index: '?', worktree: '?', path: 'docs/review.md' },
          ],
        });
      }
      if (path === `/api/v1/projects/${project.id}/git/commits?limit=30`) {
        return jsonResponse([
          {
            sha: 'abcdef0123456789',
            shortSha: 'abcdef0',
            authorName: 'Kkwans',
            authoredAt: '2026-08-11T01:02:03.000Z',
            subject: 'feat(workspace): 完成 Git 工作区',
          },
        ]);
      }
      if (path === `/api/v1/projects/${project.id}/git/branches`) {
        return jsonResponse([
          {
            name: 'main',
            sha: 'abcdef0123456789',
            current: true,
            upstream: 'origin/main',
            committedAt: '2026-08-11T01:02:03.000Z',
          },
        ]);
      }
      if (path === `/api/v1/projects/${project.id}/git/commit` && init?.method === 'POST') {
        return jsonResponse({ beforeSha: '1234567', sha: 'abcdef0123456789', output: '[main] ok' });
      }
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock, `/sessions/${session.id}?view=git`);

    expect(await screen.findByText(/origin\/main/)).toBeInTheDocument();
    expect(screen.getByText('2 个变更')).toBeInTheDocument();

    fireEvent.click(screen.getByText('更多 Git'));
    fireEvent.click(screen.getByRole('menuitem', { name: '提交历史' }));
    expect(await screen.findByText('feat(workspace): 完成 Git 工作区')).toBeInTheDocument();
    fireEvent.click(screen.getByText('更多 Git'));
    fireEvent.click(screen.getByRole('menuitem', { name: '分支' }));
    expect(await screen.findByText('abcdef01')).toBeInTheDocument();
    expect(screen.queryByText('未跟踪远端分支')).not.toBeInTheDocument();
    expect(screen.getAllByText(/origin\/main/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('更多 Git'));
    fireEvent.click(screen.getByRole('menuitem', { name: '变更' }));
    fireEvent.click(await screen.findByRole('button', { name: '查看 apps/web/src/App.tsx Diff' }));
    expect(
      await screen.findByRole('region', { name: '已选择 apps/web/src/App.tsx 的 Diff' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择 apps/web/src/App.tsx' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 apps/web/src/App.tsx' }));
    fireEvent.change(screen.getByPlaceholderText('说明这次变更解决了什么'), {
      target: { value: 'feat(workspace): 提交选择的文件' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交所选文件 (1)' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/projects/${project.id}/git/commit`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            mode: 'SELECTED',
            paths: ['apps/web/src/App.tsx'],
            message: 'feat(workspace): 提交选择的文件',
          }),
        }),
      ),
    );
    expect(await screen.findByText('提交完成：abcdef012345')).toBeInTheDocument();
  });

  it('移动检查器提供唯一且可操作的关闭按钮', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('max-width: 899px'),
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    renderWorkspace(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        baseFetch(String(input), init?.method),
      ),
    );

    await screen.findByRole('tab', { name: '对话' });
    expect(screen.queryByRole('button', { name: '关闭检查器' })).not.toBeInTheDocument();
    const mobileTabs = screen.getByRole('tablist', { name: 'Workspace 视图' });
    fireEvent.click(within(mobileTabs).getByRole('tab', { name: 'Git' }));
    const closeButton = await screen.findByRole('button', { name: '关闭检查器' });
    expect(screen.getAllByRole('button', { name: '关闭检查器' })).toHaveLength(1);
    fireEvent.click(closeButton);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '关闭检查器' })).not.toBeInTheDocument(),
    );
  });
});
