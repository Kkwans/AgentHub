// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, authSession, type AgentRecord } from '../../../lib/api';
import { AgentDetailPage } from './AgentDetailPage';

const auth = vi.hoisted(() => ({ id: 'admin1' }));
vi.mock('../../../components/AccessGate', () => ({
  useAuthMode: () => 'token',
  useAuthUser: () => ({ id: auth.id }),
}));
vi.mock('../../../lib/api', async (original) => ({
  ...(await original<{ api: typeof api; authSession: typeof authSession }>()),
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));
const make = (id: string): AgentRecord => ({
  id,
  targetId: `target-${id}`,
  name: `Agent ${id}`,
  agentKind: 'CUSTOM_ACP',
  adapterKind: 'ACP_STDIO',
  status: 'UNVERIFIED',
  enabled: true,
  detectedVersion: null,
  defaultModel: 'old-model',
  defaultMode: null,
  capabilitiesJson: {},
  lastPreflightAt: null,
});
let records: AgentRecord[];
const clients: QueryClient[] = [];
beforeEach(() => {
  auth.id = 'admin1';
  records = [make('one'), make('two')];
  vi.mocked(api.get).mockImplementation(
    async <T,>(path: string) => (path === '/agents' ? records : []) as T,
  );
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.resetAllMocks();
});
function mount(id = 'two') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const ui = () => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/agents/${id}`]}>
          <Link to="/agents/one">切换到另一个 Agent</Link>
          <Routes>
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>
  );
  const result = render(ui());
  return {
    ...result,
    rerenderIdentity: () => result.rerender(ui()),
  };
}
async function edit() {
  const model = await screen.findByRole('textbox', { name: '默认模型' });
  fireEvent.change(model, { target: { value: 'new-model' } });
  fireEvent.click(screen.getByRole('button', { name: '保存默认设置' }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('exact Agent defaults management', () => {
  it('keeps pending recovery locked when readback target changes despite matching values', async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error('lost response'));
    mount();
    await edit();
    await screen.findByRole('heading', { name: '保存结果待核对' });
    records[1] = { ...make('two'), targetId: 'different-target', defaultModel: 'new-model' };
    fireEvent.click(screen.getByRole('button', { name: '读取服务器当前值' }));
    expect(
      await screen.findByText(
        'Agent 执行环境身份已变化，请返回列表重新进入；本页不会采用此响应或重试保存。',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('当前值与本次提交一致。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '读取服务器当前值' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '采用服务器值继续编辑' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '默认模型' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存默认设置' })).toBeDisabled();
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('does not block default editing on unavailable target metadata', async () => {
    vi.mocked(api.get).mockImplementation(<T,>(path: string) =>
      path === '/agents' ? Promise.resolve(records as T) : new Promise<T>(() => {}),
    );
    vi.mocked(api.patch).mockResolvedValue({ ...make('two'), defaultModel: 'new-model' });
    mount();
    await edit();
    expect(
      await screen.findByText('默认设置已保存。仅影响后续会话的默认选择。'),
    ).toBeInTheDocument();
    expect(screen.getByText(/执行环境名称暂不可用/)).toBeInTheDocument();
  });
  it('keeps recovery locked when readback fails or its exact Agent is missing', async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error('lost'));
    mount();
    await edit();
    await screen.findByRole('heading', { name: '保存结果待核对' });
    records = [make('one')];
    fireEvent.click(screen.getByRole('button', { name: '读取服务器当前值' }));
    expect(await screen.findByText('Agent 不存在或已不再可见。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存默认设置' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '采用服务器值继续编辑' })).not.toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledTimes(1);
  });
  it('does not submit twice while the initial save is unresolved', async () => {
    vi.mocked(api.patch).mockReturnValue(new Promise(() => {}));
    mount();
    await edit();
    fireEvent.click(screen.getByRole('button', { name: '保存默认设置' }));
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('reads exact ID rather than the first record, including StrictMode remount', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Agent two' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Agent one' })).not.toBeInTheDocument();
    expect(screen.getByText('尚未检查')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /启动|禁用|删除|检查/ })).not.toBeInTheDocument();
  });
  it.each(['missing', 'duplicate', 'malformed'])(
    'blocks unsafe detail identity: %s',
    async (kind) => {
      if (kind === 'missing') records = [make('one')];
      if (kind === 'duplicate') records = [make('two'), make('two')];
      if (kind === 'malformed')
        records = [{ ...make('two'), defaultMode: undefined } as unknown as AgentRecord];
      mount();
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: '默认模型' })).not.toBeInTheDocument();
    },
  );
  it('saves exact target, trims strings, and clears empty defaults with null', async () => {
    vi.mocked(api.patch).mockResolvedValue({ ...make('two'), defaultModel: 'new-model' });
    mount();
    await edit();
    expect(
      await screen.findByText('默认设置已保存。仅影响后续会话的默认选择。'),
    ).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith('/agents/two', {
      defaultModel: 'new-model',
      defaultMode: null,
    });
    fireEvent.change(screen.getByRole('textbox', { name: '默认模型' }), {
      target: { value: '   ' },
    });
    vi.mocked(api.patch).mockResolvedValue({ ...make('two'), defaultModel: null });
    fireEvent.click(screen.getByRole('button', { name: '保存默认设置' }));
    expect(api.patch).toHaveBeenLastCalledWith('/agents/two', {
      defaultModel: null,
      defaultMode: null,
    });
  });
  it.each(['wrong-id', 'wrong-value', 'wrong-target', 'malformed'])(
    'does not claim save success for %s',
    async (kind) => {
      const response = { ...make('two'), defaultModel: 'new-model' };
      vi.mocked(api.patch).mockResolvedValue(
        kind === 'wrong-id'
          ? { ...response, id: 'one' }
          : kind === 'wrong-value'
            ? make('two')
            : kind === 'wrong-target'
              ? { ...response, targetId: 'other-target' }
              : { id: 'two' },
      );
      mount();
      await edit();
      expect(await screen.findByRole('heading', { name: '保存结果待核对' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '保存默认设置' })).toBeDisabled();
      expect(
        screen.queryByText('默认设置已保存。仅影响后续会话的默认选择。'),
      ).not.toBeInTheDocument();
      expect(api.patch).toHaveBeenCalledTimes(1);
    },
  );
  it('reconciles a lost response read-only and requires explicit adoption before editing', async () => {
    vi.mocked(api.patch).mockImplementation(async () => {
      records[1] = { ...make('two'), defaultModel: 'new-model' };
      throw new Error('lost');
    });
    mount();
    await edit();
    await screen.findByRole('heading', { name: '保存结果待核对' });
    fireEvent.click(screen.getByRole('button', { name: '读取服务器当前值' }));
    expect(await screen.findByText('当前值与本次提交一致。')).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: '默认模型' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '采用服务器值继续编辑' }));
    expect(screen.getByRole('textbox', { name: '默认模型' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '保存默认设置' })).toBeDisabled();
  });
  it('shows differing readback without overwriting it or silently retrying', async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error('unknown'));
    mount();
    await edit();
    await screen.findByRole('heading', { name: '保存结果待核对' });
    fireEvent.click(screen.getByRole('button', { name: '读取服务器当前值' }));
    expect(
      await screen.findByText('当前值与本次提交不同，可能尚未保存或已被其他修改覆盖。'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '采用服务器值继续编辑' }));
    expect(screen.getByRole('textbox', { name: '默认模型' })).toHaveValue('old-model');
    expect(api.patch).toHaveBeenCalledTimes(1);
  });
  it('ignores late save success after changing Agent', async () => {
    const pending = deferred<AgentRecord>();
    vi.mocked(api.patch).mockReturnValue(pending.promise);
    mount();
    await edit();
    fireEvent.click(screen.getByRole('link', { name: '切换到另一个 Agent' }));
    await screen.findByRole('heading', { name: 'Agent one' });
    await act(async () => pending.resolve({ ...make('two'), defaultModel: 'new-model' }));
    expect(screen.getByRole('textbox', { name: '默认模型' })).toHaveValue('old-model');
    expect(
      screen.queryByText('默认设置已保存。仅影响后续会话的默认选择。'),
    ).not.toBeInTheDocument();
  });
  it('revokes actions and ignores deferred results on auth-required', async () => {
    const pending = deferred<AgentRecord>();
    vi.mocked(api.patch).mockReturnValue(pending.promise);
    mount();
    await edit();
    act(() => authSession.notifyAuthorizationRequired());
    await act(async () => pending.resolve({ ...make('two'), defaultModel: 'new-model' }));
    expect(screen.getByRole('alert')).toHaveTextContent('认证身份已失效');
    expect(screen.queryByRole('button', { name: '保存默认设置' })).not.toBeInTheDocument();
  });
  it('does not accept a previous administrator response after identity changes', async () => {
    const pending = deferred<AgentRecord>();
    vi.mocked(api.patch).mockReturnValue(pending.promise);
    const view = mount();
    await edit();
    auth.id = 'admin2';
    view.rerenderIdentity();
    await screen.findByRole('heading', { name: 'Agent two' });
    await act(async () => pending.resolve({ ...make('two'), defaultModel: 'new-model' }));
    expect(
      screen.queryByText('默认设置已保存。仅影响后续会话的默认选择。'),
    ).not.toBeInTheDocument();
  });
});

it('prioritizes editable defaults and keeps technical identity in a native disclosure', async () => {
  mount();
  await screen.findByRole('textbox', { name: '默认模型' });
  const heading = screen.getByRole('heading', { name: '默认设置' });
  const summary = screen.getByText('技术信息与能力报告', { exact: true });
  const details = summary.closest('details');
  expect(details).not.toHaveAttribute('open');
  expect(heading.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText('全局状态不代表每个项目都可运行。')).toBeVisible();
  expect(screen.getByText(/当前服务没有版本冲突保护/)).toBeVisible();
  expect(screen.getByText(/仅用于后续会话的默认选择/)).toBeVisible();
  fireEvent.click(summary);
  expect(details).toHaveAttribute('open');
  expect(details).toHaveTextContent('Agent：two');
  expect(details).toHaveTextContent('执行环境：target-two');
  expect(screen.getByRole('link', { name: '服务器诊断（不是此 Agent 专属诊断）' })).toHaveAttribute(
    'href',
    '/agents/diagnostics',
  );
  fireEvent.click(summary);
  expect(details).not.toHaveAttribute('open');
  expect(api.patch).not.toHaveBeenCalled();
});

it('连接检查读取已保存状态不覆盖默认设置草稿', async () => {
  const agent = records[1]!;
  vi.mocked(api.get).mockImplementation(
    async <T,>(path: string) =>
      (path === '/agents'
        ? records
        : path === '/execution-targets'
          ? [{ id: agent.targetId, kind: 'LOCAL_HOST', name: '本机' }]
          : path === '/projects'
            ? [
                {
                  id: 'project',
                  name: '检查项目一',
                  status: 'ACTIVE',
                  targetId: agent.targetId,
                  realRootPath: '/registered',
                },
              ]
            : []) as T,
  );
  vi.mocked(api.post).mockResolvedValue({
    agentId: agent.id,
    targetId: agent.targetId,
    projectId: 'project',
    cwd: '/registered',
    smokeSession: false,
    status: 'READY',
    checkedAt: '2026-11-14T06:00:00Z',
    checks: [
      { id: 'process', status: 'PASS' },
      { id: 'initialize', status: 'PASS' },
      { id: 'session', status: 'SKIP' },
    ],
  });
  mount();
  const model = await screen.findByRole('textbox', { name: '默认模型' });
  fireEvent.change(model, { target: { value: 'unsaved-draft' } });
  fireEvent.click(await screen.findByRole('combobox', { name: '检查项目' }));
  fireEvent.click(await screen.findByRole('option', { name: '检查项目一' }));
  fireEvent.click(screen.getByRole('button', { name: '检查连接' }));
  await screen.findByText('连接检查通过');
  records[1] = { ...agent, status: 'READY', defaultModel: 'server-other-value' };
  fireEvent.click(screen.getByRole('button', { name: '读取已保存状态' }));
  await screen.findByText('最近检查就绪');
  expect(model).toHaveValue('unsaved-draft');
  expect(api.patch).not.toHaveBeenCalled();
});
