// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentCenterPage } from './AgentCenterPage';
import { capabilitiesFor, executionTargetKindLabel } from '../agent-presentation';

import { api } from '../../../lib/api';
vi.mock('../../../lib/api', async () => ({
  api: { get: vi.fn() },
  ApiError: (await import('../../../lib/api-error')).ApiError,
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});
const labels = (capabilitiesJson: Record<string, unknown>) => capabilitiesFor({ capabilitiesJson });
describe('Agent capability truthfulness', () => {
  it.each([
    ['LOCAL_HOST', '本机'],
    ['DOCKER_CONTAINER', 'Docker'],
    ['REMOTE_NODE', '远程节点'],
    ['FUTURE_TARGET', '类型待确认'],
    [undefined, '类型待确认'],
  ])('labels target kind %s without assuming Local', (kind, label) => {
    expect(executionTargetKindLabel(kind)).toBe(label);
  });

  it('does not invent capabilities for empty or unknown reports', () => {
    expect(labels({})).toEqual([]);
    expect(labels({ futureCapability: true, sessions: {}, run: 'true' })).toEqual([]);
  });
  it('does not treat false flags or nested objects as supported', () => {
    expect(
      labels({
        session: false,
        runs: false,
        approvals: false,
        sessions: { create: false, load: false },
        workspace: { files: false, terminal: false },
      }),
    ).toEqual([]);
  });
  it('normalizes plural aliases and deduplicates confirmed legacy flags', () => {
    expect(
      labels({
        session: true,
        sessions: true,
        run: true,
        runs: true,
        approval: true,
        approvals: true,
      }),
    ).toEqual(['Session', 'Run', 'Approval']);
  });
  it('reads the actual nested adapter contract without guessing Run', () => {
    expect(
      labels({
        sessions: { create: true },
        prompts: { text: true },
        interaction: { approvals: true },
        workspace: { files: true, terminal: false },
      }),
    ).toEqual(['Session', '文本输入', 'Approval', '文件']);
  });
  it('keeps directory rows informational and exposes an honest host diagnostics link', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(
      ['agents'],
      [
        {
          id: 'a1',
          name: '待核对 Agent',
          agentKind: 'CUSTOM_ACP',
          adapterKind: 'ACP_STDIO',
          enabled: true,
          status: 'UNVERIFIED',
          capabilitiesJson: {},
          targetId: 't1',
        },
      ],
    );
    client.setQueryData(['discovery-agents'], []);
    client.setQueryData(['execution-targets'], []);
    function Route() {
      return <output data-testid="route">{useLocation().pathname}</output>;
    }
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AgentCenterPage />
          <Route />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const card = await screen.findByRole('group', { name: /待核对 Agent/ });
    expect(within(card).getByText('能力待确认')).toBeInTheDocument();
    expect(within(card).getByText('已启用')).toBeVisible();
    expect(card.querySelector('dl')).toHaveTextContent('Runtime');
    expect(card.querySelector('dl')).toHaveTextContent('Provider');
    expect(card.querySelector('dl')).not.toHaveTextContent('Model');
    expect(within(card).queryByText('Session 中选择')).not.toBeInTheDocument();
    expect(within(card).getByText('未找到关联运行环境')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: '管理 Agent' })).toHaveAttribute(
      'href',
      '/agents/a1',
    );
    expect(card).not.toHaveAttribute('tabindex');
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(screen.getByTestId('route')).toHaveTextContent(/^\/$/);
    expect(within(card).queryByRole('link', { name: '服务器诊断' })).not.toBeInTheDocument();
    expect(screen.getAllByText('基础设施', { selector: 'summary' })).toHaveLength(1);
    fireEvent.click(screen.getByText('基础设施', { selector: 'summary' }));
    const link = screen.getByRole('link', { name: '服务器诊断' });
    expect(link).toHaveAttribute('href', '/agents/diagnostics');
    expect(link).toHaveAccessibleDescription('当前 AgentHub 服务器，不是此 Agent 专属诊断');
    fireEvent.click(link);
    expect(screen.getByTestId('route')).toHaveTextContent('/agents/diagnostics');
    client.clear();
  });
});

const readyAgent = {
  id: 'a1',
  name: 'Codex',
  agentKind: 'CODEX',
  adapterKind: 'ACP_STDIO',
  enabled: true,
  status: 'READY',
  targetId: 't1',
  capabilitiesJson: {},
};
function mountSources() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AgentCenterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
it('辅助源失败不伪装成零结果或缺配置，重试恢复且保留Agent', async () => {
  let failed = true;
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path === '/agents') return [readyAgent] as T;
    if (failed) throw new Error('unavailable');
    return (
      path === '/execution-targets'
        ? [{ id: 't1', name: '本机环境', kind: 'LOCAL_HOST' }]
        : [{ state: 'UNVERIFIED' }]
    ) as T;
  });
  mountSources();
  const row = await screen.findByRole('group', { name: 'Codex，Codex，登记就绪' });
  expect(row).toBeVisible();
  const targetError = await screen.findByRole('region', { name: '运行环境读取状态' });
  const candidateError = await screen.findByRole('region', { name: '发现结果读取状态' });
  expect(within(row).getByText('运行环境读取失败')).toBeVisible();
  expect(screen.getByText('未知', { exact: true })).toBeVisible();
  expect(screen.queryByText('未找到关联运行环境')).not.toBeInTheDocument();
  failed = false;
  fireEvent.click(within(targetError).getByRole('button', { name: '重新加载' }));
  fireEvent.click(within(candidateError).getByRole('button', { name: '重新加载' }));
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: '运行环境读取状态' })).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: '发现结果读取状态' })).not.toBeInTheDocument(),
  );
  expect(within(row).getByText('本机环境 · 本机')).toBeVisible();
  expect(screen.queryByText('未知', { exact: true })).not.toBeInTheDocument();
  expect(screen.getByText('登记状态不代表运行前预检结果。')).toBeVisible();
});
it('辅助源加载中与成功缺关联分别显示，不声称零发现结果', async () => {
  let finishTargets!: (value: unknown) => void;
  let finishCandidates!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementation(<T,>(path: string) => {
    if (path === '/agents') return Promise.resolve([readyAgent] as T);
    return new Promise<unknown>((resolve) => {
      if (path === '/execution-targets') finishTargets = resolve;
      else finishCandidates = resolve;
    }) as Promise<T>;
  });
  mountSources();
  const row = await screen.findByRole('group', { name: 'Codex，Codex，登记就绪' });
  expect(within(row).getByText('正在加载运行环境')).toBeVisible();
  expect(screen.getByText('加载中', { exact: true })).toBeVisible();
  expect(screen.queryByText('未找到关联运行环境')).not.toBeInTheDocument();
  await act(async () => {
    finishTargets([]);
    finishCandidates([]);
  });
  expect(await screen.findByText('未找到关联运行环境')).toBeVisible();
  expect(screen.queryByText('加载中', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '运行环境读取状态' })).not.toBeInTheDocument();
});

it('已缓存辅助数据刷新失败仍明确未知，不把旧值冒充最新结果', async () => {
  let failed = false;
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path === '/agents') return [readyAgent] as T;
    if (failed) throw new Error('refresh failed');
    return (
      path === '/execution-targets' ? [{ id: 't1', name: '缓存环境', kind: 'LOCAL_HOST' }] : []
    ) as T;
  });
  const client = mountSources();
  expect(await screen.findByText('缓存环境 · 本机')).toBeVisible();
  failed = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['execution-targets'] });
    await client.invalidateQueries({ queryKey: ['discovery-agents'] });
  });
  expect(await screen.findByText('未知', { exact: true })).toBeVisible();
  expect(screen.getByRole('group', { name: 'Codex，Codex，登记就绪' })).toBeVisible();
  expect(screen.queryByText('缓存环境 · 本机')).not.toBeInTheDocument();
  expect(screen.getByText('运行环境读取失败', { exact: true })).toBeVisible();
});

it.each([false, true])('主Agent源失败总数及登记就绪数均未知（旧缓存=%s）', async (cached) => {
  let failed = !cached;
  vi.mocked(api.get).mockImplementation(async <T,>(path: string) => {
    if (path === '/agents') {
      if (failed) throw new Error('agents unavailable');
      return [readyAgent] as T;
    }
    return [] as T;
  });
  const client = mountSources();
  if (cached) {
    await screen.findByRole('group', { name: 'Codex，Codex，登记就绪' });
    failed = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['agents'] });
    });
  }
  expect(await screen.findByText('暂时无法加载')).toBeVisible();
  expect(screen.getAllByText('未知', { exact: true })).toHaveLength(2);
  expect(screen.queryByText('还没有接入 Agent')).not.toBeInTheDocument();
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  expect(await screen.findByRole('group', { name: 'Codex，Codex，登记就绪' })).toBeVisible();
  expect(screen.queryAllByText('未知', { exact: true })).toHaveLength(0);
});

it('首次加载不是空库，搜索无结果与真空库不同且刷新不丢查询', async () => {
  let finish!: (value: unknown) => void;
  let ready = false;
  vi.mocked(api.get).mockImplementation(<T,>(path: string) => {
    if (path !== '/agents') return Promise.resolve([] as T);
    if (ready) return Promise.resolve([readyAgent] as T);
    return new Promise<unknown>((resolve) => {
      finish = resolve;
    }) as Promise<T>;
  });
  mountSources();
  expect(screen.queryByText('还没有接入 Agent')).not.toBeInTheDocument();
  await act(async () => {
    ready = true;
    finish([readyAgent]);
  });
  await screen.findByRole('group', { name: 'Codex，Codex，登记就绪' });
  const search = screen.getByRole('searchbox', { name: '搜索 Agent' });
  fireEvent.change(search, { target: { value: '无匹配名称' } });
  expect(screen.getByText('没有匹配的 Agent')).toBeVisible();
  expect(screen.queryByText('还没有接入 Agent')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled());
  expect(search).toHaveValue('无匹配名称');
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  expect(screen.getByRole('group', { name: 'Codex，Codex，登记就绪' })).toBeVisible();
});
it('真实默认Model保留且基础设施每个目标唯一，停用不变成登记就绪', async () => {
  vi.mocked(api.get).mockImplementation(
    async <T,>(path: string) =>
      (path === '/agents'
        ? [{ ...readyAgent, name: '长名称'.repeat(20), enabled: false, defaultModel: '真实模型' }]
        : []) as T,
  );
  mountSources();
  const row = await screen.findByRole('group', { name: /需要处理/ });
  const title = within(row).getByRole('heading', { name: '长名称'.repeat(20) });
  expect(title).toHaveTextContent('长名称'.repeat(20));
  expect(title.parentElement).not.toContainElement(within(row).getByText('已停用'));
  expect(within(row).getByRole('link', { name: '管理 Agent' })).toHaveAttribute(
    'href',
    '/agents/a1',
  );
  expect(within(row).getByText('真实模型')).toBeVisible();
  expect(within(row).getByText('已停用')).toBeVisible();
  expect(within(row).queryByText('登记就绪')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('基础设施', { selector: 'summary' }));
  const nav = screen.getByRole('navigation', { name: '基础设施导航' });
  for (const [name, href] of [
    ['运行环境', '/agents/runtime'],
    ['远程节点', '/agents/nodes'],
    ['服务器诊断', '/agents/diagnostics'],
  ] as const) {
    expect(within(nav).getAllByRole('link', { name })).toHaveLength(1);
    expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href);
  }
});

it('discovery entries are single semantic links, not nested interactive buttons', async () => {
  vi.mocked(api.get).mockResolvedValue([]);
  mountSources();
  const discovery = screen.getByRole('link', { name: '发现 Agent' });
  expect(discovery).toHaveAttribute('href', '/agents/agents/discover');
  expect(discovery.querySelector('button, a, [role="button"]')).toBeNull();
  const emptyDiscovery = await screen.findByRole('link', { name: '开始发现' });
  expect(emptyDiscovery).toHaveAttribute('href', '/agents/agents/discover');
  expect(emptyDiscovery.querySelector('button, a, [role="button"]')).toBeNull();
  discovery.focus();
  expect(discovery).toHaveFocus();
});
