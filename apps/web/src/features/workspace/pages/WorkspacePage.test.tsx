import { GitCommitOperationProvider } from '../components/GitCommitOperationProvider';
// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSessionEventPages, mergeSessionEvents, WorkspacePage } from './WorkspacePage';

vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'local_trusted',
  useAuthUser: () => null,
}));

vi.mock('../../../lib/realtime', () => ({
  realtime: {
    subscribe: () => () => undefined,
  },
}));

const session = {
  id: 'session-1',
  projectId: '11111111-1111-4111-8111-111111111111',
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

// Only the UUID actually observed on a mocked POST can obtain a durable receipt.
function gitTerminalResponse(path: string, operationId: string | undefined) {
  if (
    !operationId ||
    path !== `/api/v1/projects/${project.id}/git/commit-operations/${operationId}`
  )
    return undefined;
  return jsonResponse({
    scope: 'local-trusted',
    projectId: project.id,
    operationId,
    protocolVersion: 1,
    requestHash: 'a'.repeat(64),
    phase: 'COMMAND_SUCCEEDED',
    commandExit: 0,
    observedAfterHead: 'abcdef0123456789abcdef0123456789abcdef01',
    resultEvidence: { kind: 'COMMAND_EXIT_ZERO', headAttribution: 'OBSERVED_ONLY' },
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

function renderWorkspace(
  fetchMock: typeof fetch,
  initialEntry = `/sessions/${session.id}`,
  cachedSession?: typeof session,
  precache = true,
) {
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
  if (cachedSession && precache) client.setQueryData(['session', cachedSession.id], cachedSession);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        {cachedSession ? <Link to={`/workspace/${cachedSession.id}`}>切换已缓存会话</Link> : null}
        <GitCommitOperationProvider>
          <Routes>
            <Route path="/sessions/:id" element={<WorkspacePage />} />
            <Route path="/workspace/:id" element={<WorkspacePage />} />
          </Routes>
        </GitCommitOperationProvider>
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
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('WorkspacePage 数据分区可靠性', () => {
  it.each([false, true])(
    '手机首次直达变更深链保留检查器并在就绪后聚焦（warm=%s）',
    async (warm) => {
      vi.stubGlobal('innerWidth', 390);
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        baseFetch(String(input), init?.method),
      );
      const client = renderWorkspace(
        fetchMock,
        `/workspace/${session.id}?view=changes`,
        warm ? session : undefined,
      );
      await screen.findByRole('heading', { name: '审阅更改' });
      await waitFor(() => expect(screen.getByRole('button', { name: '关闭检查器' })).toHaveFocus());
      expect(screen.getByRole('heading', { name: '审阅更改' })).toBeInTheDocument();
      await act(async () => {
        client
          .getQueryCache()
          .find({ queryKey: ['session', session.id] })
          ?.setState({ status: 'error', error: new Error('读取会话失败') });
      });
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: '关闭检查器' })).not.toBeInTheDocument(),
      );
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(escape);
      expect(escape.defaultPrevented).toBe(false);
      await act(async () => {
        client.setQueryData(['session', session.id], session);
      });
      await waitFor(() => expect(screen.getByRole('button', { name: '关闭检查器' })).toHaveFocus());
    },
  );

  it('共享辅助栏关闭后把焦点还给对应触发按钮', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(max-width: 1179px)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      baseFetch(String(input), init?.method),
    );
    renderWorkspace(fetchMock);

    const supportToggle = await screen.findByRole('button', { name: '打开辅助栏' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(supportToggle);
    const dialog = await screen.findByRole('dialog', { name: '工作区辅助栏' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(supportToggle.closest('.workspace-contextbar')).toHaveAttribute('inert');
    const sessionClose = within(dialog).getByRole('button', { name: '关闭会话列表' });
    await waitFor(() => expect(sessionClose).toHaveFocus());
    const tabs = within(dialog).getByRole('tablist', { name: '辅助栏视图' });
    const inspectorTab = within(tabs).getByRole('tab', { name: '检查器' });
    inspectorTab.focus();
    fireEvent.click(inspectorTab);
    await screen.findByRole('button', { name: '关闭检查器' });
    expect(inspectorTab).toHaveFocus();
    fireEvent.keyDown(inspectorTab, { key: 'Escape' });
    await waitFor(() => expect(supportToggle).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(supportToggle.closest('.workspace-contextbar')).not.toHaveAttribute('inert');
    fireEvent.click(supportToggle);
    fireEvent.click(await screen.findByRole('button', { name: '关闭辅助栏遮罩' }));
    await waitFor(() => expect(supportToggle).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

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
    const longTimeline = Array.from({ length: 600 }, (_, index) => {
      const runId = `run-${index + 1}`;
      const sequence = index * 2 + 1;
      return [
        {
          id: `user-${index + 1}`,
          runId,
          role: 'USER' as const,
          kind: 'TEXT' as const,
          text: `执行第 ${index + 1} 轮`,
          sequence,
          createdAt: new Date(sequence * 1_000).toISOString(),
        },
        {
          id: `message-${index + 1}`,
          runId,
          role: 'ASSISTANT' as const,
          kind: 'TEXT' as const,
          text: `长会话消息 ${index + 1}`,
          sequence: sequence + 1,
          createdAt: new Date((sequence + 1) * 1_000).toISOString(),
        },
      ];
    }).flat();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith(`/api/v1/sessions/${session.id}/messages`))
        return jsonResponse(longTimeline);
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    expect(await screen.findByText('长会话消息 600', {}, { timeout: 30_000 })).toBeInTheDocument();
    expect(screen.queryByText('长会话消息 1')).not.toBeInTheDocument();
    const scroll = screen.getByRole('log');
    Object.defineProperties(scroll, {
      scrollHeight: { configurable: true, value: 5_000 },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 4_500 },
    });
    // User intent must take over immediately, before the browser emits the
    // resulting scroll event. This is the race that previously let streaming
    // rAF/smooth scrolling reclaim the viewport after an upward wheel.
    fireEvent.wheel(scroll, { deltaY: -120 });
    expect(screen.getByRole('button', { name: '回到最新' })).toBeInTheDocument();
    scroll.scrollTop = 0;
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
    expect(screen.queryByText(/"title"/)).not.toBeInTheDocument();
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
      if (path === '/api/v1/approvals/approval-1')
        return jsonResponse({
          ...approval,
          status: 'APPROVED',
          selectedOptionId: 'allow',
          deliveryId: 'delivery-1',
          deliveryState: 'QUEUED',
          deliveryAttemptCount: 0,
        });
      if (path === '/api/v1/approvals/approval-1/resolve' && init?.method === 'POST') {
        attempts += 1;
        return attempts === 1
          ? pendingApproval
          : jsonResponse({
              ...approval,
              status: 'APPROVED',
              selectedOptionId: 'allow',
              deliveryId: 'delivery-1',
              deliveryState: 'QUEUED',
              deliveryAttemptCount: 0,
            });
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
    expect(
      await screen.findByText('决定已保存，正在等待投递；尚未确认 Agent 接收。'),
    ).toBeInTheDocument();
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
    expect(
      await screen.findByLabelText('Agent 正在提供思考内容，收起思考内容'),
    ).toBeInTheDocument();
    expect(screen.getByText('Agent 正在提供思考内容').closest('details')).toHaveClass('running');
    expect(screen.getByText('正在核验实现。')).toBeInTheDocument();
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
    const stateBanner = screen.getByRole('region', { name: '当前运行状态：Session 已关闭' });
    expect(stateBanner.querySelector('strong')).toHaveClass('block');
    expect(stateBanner.querySelector('span:not(.run-state-marker)')).toHaveClass('mt-1');
    expect(
      screen
        .getByRole('link', { name: /可靠性回归/, hidden: true })
        .querySelector('.session-state-dot'),
    ).toHaveClass('session-state-closed');
    expect(
      screen.queryByRole('textbox', { name: '给 Agent 发送工程指令' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('会话已关闭，无法继续发送指令。')).not.toBeInTheDocument();
    expect(document.querySelector('.composer-shell')).not.toBeInTheDocument();
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

  it('Composer 遵循 PinHarness 的 Return 发送约定，并用 Esc 关闭上下文浮层', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === `/api/v1/sessions/${session.id}/runs` && init?.method === 'POST') {
        return jsonResponse({ id: 'run-shortcut' }, 201);
      }
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    const composer = await screen.findByRole('textbox', { name: '给 Agent 发送工程指令' });
    const contextButton = await screen.findByRole('button', { name: /PromptOS/ });
    fireEvent.click(contextButton);
    expect(await screen.findByRole('dialog', { name: 'PromptOS 上下文预览' })).toBeInTheDocument();
    fireEvent.keyDown(composer, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'PromptOS 上下文预览' })).not.toBeInTheDocument();

    fireEvent.change(composer, { target: { value: '继续执行这项工作' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/sessions/${session.id}/runs`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it.each([1024, 1440])('专注审阅保留提交草稿与进行中的请求（%s）', async (width) => {
    vi.stubGlobal('innerWidth', width);
    const mediaChanges = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_: string, update: () => void) => mediaChanges.add(update),
      removeEventListener: (_: string, update: () => void) => mediaChanges.delete(update),
    }));
    localStorage.setItem('agenthub.workspace.layout-v2.right.collapsed', 'false');
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    let operationId: string | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === `/api/v1/projects/${project.id}/git/status`)
        return jsonResponse({
          branch: 'main',
          clean: false,
          entries: [{ index: ' ', worktree: 'M', path: 'a.ts' }],
        });
      if (path === `/api/v1/projects/${project.id}/git/commit` && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        operationId = body.operationId;
        expect(body).toEqual({
          protocolVersion: 1,
          operationId: expect.any(String),
          expectedHead: null,
          mode: 'SELECTED',
          paths: ['a.ts'],
          message: '保留草稿',
        });
        return pending;
      }
      return gitTerminalResponse(path, operationId) ?? baseFetch(path, init?.method);
    });
    const savedStorage = JSON.stringify({ ...localStorage });
    renderWorkspace(fetchMock, `/workspace/${session.id}?view=changes`);
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 a.ts' }));
    const draft = screen.getByPlaceholderText('说明这次变更解决了什么');
    fireEvent.change(draft, { target: { value: '保留草稿' } });
    const conversation = screen.getByRole('textbox', { name: '给 Agent 发送工程指令' });
    fireEvent.change(conversation, { target: { value: '保留对话草稿' } });
    const focus = screen.getByRole('button', { name: '专注审阅' });
    fireEvent.click(focus);
    expect(focus).toHaveAttribute('aria-pressed', 'true');
    const consumedEscape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    consumedEscape.preventDefault();
    window.dispatchEvent(consumedEscape);
    expect(focus).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByPlaceholderText('说明这次变更解决了什么')).toBe(draft);
    expect(draft).toHaveValue('保留草稿');
    fireEvent.click(screen.getByRole('button', { name: '提交所选文件 (1)' }));
    const busy = await screen.findByRole('button', { name: '正在提交…' });
    fireEvent.keyDown(focus, { key: 'Escape' });
    expect(focus).toHaveAccessibleName('专注审阅');
    expect(focus).toHaveFocus();
    if (width === 1024)
      expect(screen.getByRole('dialog', { name: '工作区辅助栏' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '给 Agent 发送工程指令' })).toBe(conversation);
    expect(conversation).toHaveValue('保留对话草稿');
    expect(screen.getByRole('button', { name: '正在提交…' })).toBe(busy);
    expect(screen.getByPlaceholderText('说明这次变更解决了什么')).toBe(draft);
    fireEvent.click(focus);
    fireEvent.click(focus);
    const recoveryKeys = Object.keys(localStorage).filter((key) =>
      key.startsWith('agenthub:git-commit:v1:'),
    );
    expect(recoveryKeys).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(recoveryKeys[0]!)!)).toMatchObject({
      operationId,
      projectId: project.id,
    });
    const nonRecovery = Object.fromEntries(
      Object.entries({ ...localStorage }).filter(([key]) => !recoveryKeys.includes(key)),
    );
    expect(JSON.stringify(nonRecovery)).toBe(savedStorage);
    expect(
      fetchMock.mock.calls.filter(
        ([path, init]) => String(path).endsWith('/git/commit') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
    await act(async () => {
      finish(jsonResponse({ sha: 'abcdef0123456789abcdef0123456789abcdef01' }));
    });
    expect(await screen.findByText('提交命令已完成；观测 HEAD：abcdef012345')).toBeInTheDocument();
    if (width === 1024) {
      fireEvent.keyDown(focus, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: '工作区辅助栏' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '打开辅助栏' }));
      fireEvent.click(
        within(screen.getByRole('tablist', { name: '辅助栏视图' })).getByRole('tab', {
          name: '检查器',
        }),
      );
      expect(screen.getByRole('button', { name: '专注审阅' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      fireEvent.click(screen.getByRole('button', { name: '专注审阅' }));
      fireEvent.click(
        within(screen.getByRole('tablist', { name: '辅助栏视图' })).getByRole('tab', {
          name: '会话',
        }),
      );
      fireEvent.click(
        within(screen.getByRole('tablist', { name: '辅助栏视图' })).getByRole('tab', {
          name: '检查器',
        }),
      );
      expect(screen.getByRole('button', { name: '专注审阅' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      fireEvent.click(screen.getByRole('button', { name: '专注审阅' }));
      await act(async () => {
        vi.stubGlobal('innerWidth', 390);
        for (const update of mediaChanges) update();
      });
      expect(screen.queryByRole('button', { name: /专注审阅/ })).not.toBeInTheDocument();
      await act(async () => {
        vi.stubGlobal('innerWidth', 1024);
        for (const update of mediaChanges) update();
      });
      expect(screen.getByRole('button', { name: '专注审阅' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
    localStorage.removeItem('agenthub.workspace.layout-v2.right.collapsed');
  });

  it('更换会话身份不会继承旧会话的专注布局', async () => {
    vi.stubGlobal('innerWidth', 1440);
    localStorage.setItem('agenthub.workspace.layout-v2.right.collapsed', 'false');
    const next = { ...session, id: 'next-session', title: '另一个会话' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === `/api/v1/sessions/${next.id}`) return jsonResponse(next);
      return baseFetch(String(input), init?.method);
    });
    renderWorkspace(fetchMock, `/workspace/${session.id}?view=changes`, next);
    fireEvent.click(await screen.findByRole('button', { name: '专注审阅' }));
    fireEvent.click(screen.getByRole('link', { name: '切换已缓存会话' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '专注审阅' })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
    expect(screen.queryByRole('button', { name: '退出专注审阅' })).not.toBeInTheDocument();
    localStorage.removeItem('agenthub.workspace.layout-v2.right.collapsed');
  });

  it('Git 工作区提供可发现的历史、分支与 selected-files commit', async () => {
    let operationId: string | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === `/api/v1/projects/${project.id}/git/status`) {
        return jsonResponse({
          branch: 'main',
          upstream: 'origin/main',
          ahead: 1,
          headSha: '1'.repeat(40),
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
            sha: 'abcdef0123456789abcdef0123456789abcdef01',
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
            sha: 'abcdef0123456789abcdef0123456789abcdef01',
            current: true,
            upstream: 'origin/main',
            committedAt: '2026-08-11T01:02:03.000Z',
          },
        ]);
      }
      if (path === `/api/v1/projects/${project.id}/git/commit` && init?.method === 'POST') {
        operationId = JSON.parse(String(init.body)).operationId;
        return jsonResponse({
          beforeSha: '1234567',
          sha: 'abcdef0123456789abcdef0123456789abcdef01',
          output: '[main] ok',
        });
      }
      return gitTerminalResponse(path, operationId) ?? baseFetch(path, init?.method);
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
    fireEvent.click(screen.getByRole('button', { name: '展开文件清单' }));
    expect(screen.getByRole('checkbox', { name: '选择 apps/web/src/App.tsx' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 apps/web/src/App.tsx' }));
    fireEvent.change(screen.getByPlaceholderText('说明这次变更解决了什么'), {
      target: { value: 'feat(workspace): 提交选择的文件' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交所选文件 (1)' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input) === `/api/v1/projects/${project.id}/git/commit` && init?.method === 'POST',
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        protocolVersion: 1,
        operationId,
        expectedHead: '1'.repeat(40),
        mode: 'SELECTED',
        paths: ['apps/web/src/App.tsx'],
        message: 'feat(workspace): 提交选择的文件',
      });
    });
    expect(await screen.findByText('提交命令已完成；观测 HEAD：abcdef012345')).toBeInTheDocument();
  });

  it('归档 Project 的初始变更视图不预取失效的 Git 诊断', async () => {
    const archivedProject = { ...project, status: 'ARCHIVED' as const };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/v1/projects') return jsonResponse([archivedProject]);
      return baseFetch(path, init?.method);
    });
    renderWorkspace(fetchMock);

    expect((await screen.findAllByText('可靠性回归')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/projects/${project.id}/git/status`,
        expect.any(Object),
      ),
    );
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/git/diff'))).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/git/commits'))).toBe(
      false,
    );
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/git/branches'))).toBe(
      false,
    );
  });

  it('移动检查器提供唯一且可操作的关闭按钮', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('max-width: 1179px'),
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
    const gitTab = within(mobileTabs).getByRole('tab', { name: 'Git' });
    fireEvent.click(gitTab);
    await waitFor(() => expect(gitTab).toHaveAttribute('aria-selected', 'true'));
    const closeButton = await screen.findByRole('button', { name: '关闭检查器' });
    expect(screen.getAllByRole('button', { name: '关闭检查器' })).toHaveLength(1);
    fireEvent.click(closeButton);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '关闭检查器' })).not.toBeInTheDocument(),
    );
  });

  it.each([390, 1440])('Workspace %ipx tabs引用真实动态面板', async (width) => {
    vi.stubGlobal('innerWidth', width);
    renderWorkspace(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        baseFetch(String(input), init?.method),
      ),
    );
    const assertPanel = (list: HTMLElement) => {
      const tabs = within(list).getAllByRole('tab');
      for (const trigger of tabs) {
        const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
        expect(panel).not.toBeNull();
        expect(panel).toHaveAttribute('role', 'tabpanel');
        if (trigger.getAttribute('aria-selected') === 'true') {
          expect(panel).toHaveAttribute('aria-labelledby', trigger.id);
        }
      }
    };
    if (width === 390) {
      const views = await screen.findByRole('tablist', { name: 'Workspace 视图' });
      assertPanel(views);
      fireEvent.click(within(views).getByRole('tab', { name: 'Git' }));
    } else {
      fireEvent.click(await screen.findByRole('button', { name: '审阅更改' }));
    }
    const inspector = await screen.findByRole('tablist', { name: '检查器视图' });
    assertPanel(inspector);
    const fileTab = within(inspector).getByRole('tab', { name: '文件' });
    fireEvent.mouseDown(fileTab, { button: 0, ctrlKey: false });
    await waitFor(() => expect(fileTab).toHaveAttribute('aria-selected', 'true'));
    assertPanel(inspector);
  });

  it('手机检查器保留内部导航，关闭后恢复外层视图导航', async () => {
    vi.stubGlobal('innerWidth', 390);
    renderWorkspace(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        baseFetch(String(input), init?.method),
      ),
    );
    const views = await screen.findByRole('tablist', { name: 'Workspace 视图' });
    fireEvent.click(within(views).getByRole('tab', { name: 'Git' }));
    await waitFor(() => expect(views).toHaveAttribute('hidden'));
    const inspector = screen.getByRole('tablist', { name: '检查器视图' });
    for (const [name, heading] of [
      ['活动', '会话活动'],
      ['Run', '运行详情'],
      ['文件', '项目文件'],
    ] as const) {
      const trigger = within(inspector).getByRole('tab', { name });
      trigger.focus();
      fireEvent.mouseDown(trigger, { button: 0, ctrlKey: false });
      await waitFor(() => expect(trigger).toHaveAttribute('aria-selected', 'true'));
      expect(trigger).toHaveFocus();
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: '关闭检查器' }));
    await waitFor(() => expect(views).not.toHaveAttribute('hidden'));
    expect(within(views).getByRole('tab', { name: '对话' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(views).getByRole('tab', { name: '对话' })).toHaveFocus();
    fireEvent.click(within(views).getByRole('tab', { name: '会话' }));
    fireEvent.click(await screen.findByRole('button', { name: '关闭会话列表' }));
    await waitFor(() => expect(within(views).getByRole('tab', { name: '对话' })).toHaveFocus());
    fireEvent.click(within(views).getByRole('tab', { name: '文件' }));
    await screen.findByRole('button', { name: '关闭检查器' });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(within(views).getByRole('tab', { name: '对话' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: '进入沉浸对话' }));
    fireEvent.click(screen.getByRole('button', { name: '审阅更改' }));
    expect(await screen.findByRole('tablist', { name: '检查器视图' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭检查器' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '退出沉浸对话' })).toHaveFocus());
  });

  it('移动端可切换沉浸对话并在退出时清理 body 状态', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('max-width: 1179px'),
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

    const enter = await screen.findByRole('button', { name: '进入沉浸对话' });
    fireEvent.click(enter);
    await waitFor(() => expect(document.body).toHaveClass('mobile-chat-immersive'));
    const exit = screen.getByRole('button', { name: '退出沉浸对话' });
    expect(exit).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(exit);
    await waitFor(() => expect(document.body).not.toHaveClass('mobile-chat-immersive'));
  });
});

it.each([
  ['success', true],
  ['error', true],
  ['success', false],
  ['error', false],
] as const)('S56会话切换后旧发送%s不清空新草稿或串入错误，cached=%s', async (outcome, precache) => {
  window.sessionStorage.clear();
  const second = { ...session, id: 'session-2', title: '已缓存第二会话' };
  const firstDraftKey = `agenthub.workspace.composer.${session.id}`;
  const secondDraftKey = `agenthub.workspace.composer.${second.id}`;
  window.sessionStorage.setItem(firstDraftKey, '发送给第一会话');
  window.sessionStorage.setItem(secondDraftKey, '第二会话未发送的重要草稿');
  let finish!: (value: Response) => void;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === `/api/v1/sessions/${session.id}/runs` && init?.method === 'POST')
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    if (path === `/api/v1/sessions/${second.id}`) return jsonResponse(second);
    if (path === '/api/v1/sessions') return jsonResponse([session, second]);
    return baseFetch(path.replaceAll(second.id, session.id), init?.method);
  });
  const client = renderWorkspace(fetchMock, `/workspace/${session.id}`, second, precache);
  const input = await screen.findByRole('textbox', { name: '给 Agent 发送工程指令' });
  await waitFor(() => expect(input).toHaveValue('发送给第一会话'));
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([path, init]) =>
          String(path).endsWith(`/sessions/${session.id}/runs`) && init?.method === 'POST',
      ),
    ).toBe(true),
  );
  // Native readonly disproves the separate same-session "edit while sending" candidate.
  expect(input).toHaveAttribute('readonly');
  expect(client.getQueryData(['session', second.id])).toEqual(precache ? second : undefined);
  fireEvent.click(screen.getByRole('link', { name: '切换已缓存会话' }));
  const secondInput = await screen.findByRole('textbox', { name: '给 Agent 发送工程指令' });
  await waitFor(() => expect(secondInput).toHaveValue('第二会话未发送的重要草稿'));
  expect(secondInput).not.toHaveAttribute('readonly');
  fireEvent.change(secondInput, { target: { value: '第二会话草稿，切回后继续补充' } });
  await act(async () =>
    finish(
      outcome === 'success'
        ? jsonResponse({ id: 'old-run' })
        : errorResponse('旧会话发送失败', 400),
    ),
  );
  await waitFor(() => expect(secondInput).not.toHaveAttribute('readonly'));
  expect(secondInput).toHaveValue('第二会话草稿，切回后继续补充');
  expect(window.sessionStorage.getItem(secondDraftKey)).toBe('第二会话草稿，切回后继续补充');
  expect(screen.queryByText('请求失败，请稍后重试。')).not.toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(
      ([path, init]) => String(path).includes('/runs') && init?.method === 'POST',
    ),
  ).toHaveLength(1);
  client.clear();
  window.sessionStorage.clear();
});

it.each(['draft', 'unknown'])(
  '实际WorkspacePage跨1180保留重命名弹窗草稿与唯一动作树 %s',
  async (phase) => {
    vi.stubGlobal('innerWidth', 1440);
    const updates = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_: string, fn: () => void) => updates.add(fn),
      removeEventListener: (_: string, fn: () => void) => updates.delete(fn),
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === `/api/v1/sessions/${session.id}/title` && init?.method === 'PATCH')
        throw new Error('response lost');
      if (String(input) === `/api/v1/sessions/${session.id}`)
        return jsonResponse({ ...session, titleRevision: 0 });
      return baseFetch(String(input), init?.method);
    });
    renderWorkspace(fetchMock, `/workspace/${session.id}`);
    const rename = await screen.findByRole('button', { name: '重命名会话' });
    rename.focus();
    fireEvent.click(rename);
    const input = await screen.findByRole('textbox', { name: '会话名称' });
    fireEvent.change(input, { target: { value: '跨宽度不能丢失' } });
    if (phase === 'unknown') {
      await waitFor(() => expect(screen.getByRole('button', { name: '保存名称' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
      await screen.findByRole('button', { name: '核对当前名称' });
    }
    input.focus();
    for (const width of [390, 1440, 390]) {
      await act(async () => {
        vi.stubGlobal('innerWidth', width);
        for (const update of updates) update();
      });
      expect(screen.getByRole('dialog', { name: '重命名会话' })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: '会话名称' })).toBe(input);
      expect(input).toHaveValue('跨宽度不能丢失');
      if (phase === 'draft') expect(input).toHaveFocus();
      else {
        expect(screen.getByRole('button', { name: '核对当前名称' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: '保存名称' })).not.toBeInTheDocument();
      }
      expect(document.querySelectorAll('button[aria-label="重命名会话"]')).toHaveLength(1);
    }
    fireEvent.click(
      screen.getByRole('button', {
        name: phase === 'draft' ? '取消' : '关闭重命名窗口',
      }),
    );
    await waitFor(() => expect(rename).toHaveFocus());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(
      phase === 'draft' ? 0 : 1,
    );
  },
);
