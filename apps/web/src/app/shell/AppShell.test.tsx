// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { AgentHubProvider } from '@agenthub/ui';

import { AppShell } from './AppShell';
import { fuzzyScore } from './CommandPalette';

const auth = vi.hoisted(() => ({
  user: null as { id: string; username: string; role: 'ADMIN' } | null,
  mode: 'local_trusted' as 'local_trusted' | 'token' | undefined,
}));
vi.mock('../../components/AccessGate', () => ({
  useAuthUser: () => auth.user,
  useAuthMode: () => auth.mode,
}));

vi.mock('../../lib/realtime', () => ({
  realtime: {
    onState(listener: (state: '已连接') => void) {
      listener('已连接');
      return () => undefined;
    },
  },
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  auth.user = null;
  auth.mode = 'local_trusted';
});

function HistoryControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={() => navigate(-1)}>后退测试</button>
      <button onClick={() => navigate(1)}>前进测试</button>
      <output data-testid="location">{location.pathname}</output>
    </>
  );
}

function renderShell(initialEntries: string[] = ['/projects/p-1/overview'], width = 1440) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });
  render(
    <AgentHubProvider initialPreference="light">
      <MemoryRouter initialEntries={initialEntries}>
        <HistoryControls />
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<h2>页面内容</h2>} />
            <Route path="projects" element={<h2>Project 页面</h2>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AgentHubProvider>,
  );
}

describe('AppShell', () => {
  it.each([
    ['/projects/p1/work/new', '项目'],
    ['/projects/p1/sessions', '项目'],
    ['/settings/account', '设置'],
    ['/settings/security', '设置'],
    ['/prompts/p1/versions', 'Prompt 库'],
    ['/agents/a1', 'Agent 中心'],
    ['/agents/runtime/docker', '运行环境'],
    ['/agents/nodes/node1', '远程节点'],
  ])('子路由 %s 保持唯一的当前入口 %s', (path, label) => {
    renderShell([path]);
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    const currentLinks = [...screen.getAllByRole('link')].filter(
      (link) => link.getAttribute('aria-current') === 'page',
    );
    expect(currentLinks).toHaveLength(1);
  });
  it.each(['/projects-old', '/settings-other', '/agents-other'])(
    '不将相似前缀 %s 视为当前分区',
    (path) => {
      renderShell([path]);
      expect(
        screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current')),
      ).toHaveLength(0);
    },
  );
  it('浏览器后退前进同步分区，不依赖导航点击', () => {
    renderShell(['/projects/p1/work', '/settings/security']);
    expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: '后退测试' }));
    expect(screen.getByRole('link', { name: '项目' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '设置' })).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByRole('button', { name: '前进测试' }));
    expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '项目' })).not.toHaveAttribute('aria-current');
  });
  it.each([1440, 1024])('本地访问身份在 %i 侧栏是可用的账号设置链接', (width) => {
    renderShell(['/projects'], width);
    const account = screen.getByRole('link', { name: '本地受信任访问，账号设置' });
    expect(account).toHaveAttribute('href', '/settings/account');
    expect(screen.queryByText('Kwan')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    fireEvent.click(account);
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/account');
    expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute('aria-current', 'page');
  });
  it('展示真实登录用户名，不伪造管理员名称', () => {
    auth.user = { id: 'user-1', username: '实际用户', role: 'ADMIN' };
    auth.mode = 'token';
    renderShell();
    expect(screen.getByRole('link', { name: '实际用户，账号设置' })).toHaveAttribute(
      'href',
      '/settings/account',
    );
    expect(screen.queryByText('本地受信任访问')).not.toBeInTheDocument();
  });
  it('缺少身份上下文时不假定本地受信任或管理员', () => {
    auth.mode = undefined;
    renderShell();
    expect(screen.getByRole('link', { name: '未关联账号，账号设置' })).toBeInTheDocument();
  });
  it('移动导航账号链接打开账号设置并关闭抽屉', async () => {
    renderShell(['/projects/p1/work'], 390);
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
    const drawer = await screen.findByRole('dialog', { name: '导航' });
    expect(within(drawer).getByRole('link', { name: '项目' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(within(drawer).getByRole('link', { name: '本地受信任访问，账号设置' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/account');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '导航' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: '打开导航' })).toBeInTheDocument();
  });
  it.each([768, 1024])('compact navigation at %i preserves accessible destinations', (width) => {
    renderShell(['/projects'], width);
    const navigation = screen.getByRole('navigation', { name: '主导航' });
    const links = within(navigation).getAllByRole('link');
    const names = ['首页', '项目', 'Agent 中心', 'Prompt 库', '设置'];
    const hrefs = ['/home', '/projects', '/agents', '/prompts', '/settings/appearance'];
    expect(links).toHaveLength(5);
    links.forEach((link, index) => {
      expect(link).toHaveAccessibleName(names[index]);
      expect(link).toHaveAttribute('href', hrefs[index]);
      expect(link.textContent).toBe('');
    });
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeDisabled();
  });
  it('保留主导航、Infrastructure 子入口和 Project 上下文壳层', () => {
    renderShell();

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Infrastructure' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '首页' })).toHaveAttribute('href', '/home');
    expect(screen.getByRole('link', { name: '项目' })).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: 'Agent 中心' })).toHaveAttribute('href', '/agents');
    expect(screen.getByRole('link', { name: 'Prompt 库' })).toHaveAttribute('href', '/prompts');
    expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute(
      'href',
      '/settings/appearance',
    );
    expect(screen.getByRole('link', { name: '运行环境' })).toHaveAttribute(
      'href',
      '/agents/runtime',
    );
    expect(screen.getByRole('button', { name: /搜索与跳转/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '折叠侧边栏' })).toBeInTheDocument();
  });

  it('Ctrl+K closes mobile navigation before opening the outside command dialog', async () => {
    renderShell(['/projects/p-1/overview'], 390);
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
    expect(screen.getByRole('dialog', { name: '导航' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: '导航' })).toBeNull();
    expect(await screen.findByRole('combobox', { name: '搜索' })).toBeInTheDocument();
  });

  it('按六个业务分组展示命令面板并支持模糊搜索和键盘打开', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: /搜索与跳转/ }));
    const combobox = await screen.findByRole('combobox', { name: '搜索' });

    for (const group of ['Recent', 'Projects', 'Sessions', 'Agents', 'Prompts', 'Commands']) {
      expect(screen.getByRole('region', { name: group })).toBeInTheDocument();
    }
    expect(combobox).toHaveAttribute('aria-controls', 'command-results');
    expect(combobox).toHaveAttribute('aria-activedescendant', 'command-option-0');
    fireEvent.change(combobox, { target: { value: '项目' } });
    expect(
      screen
        .getAllByRole('option', { name: /项目/ })
        .find((option) => option.getAttribute('aria-selected') === 'true'),
    ).toBeTruthy();
    fireEvent.keyDown(combobox, { key: 'Enter' });

    expect(await screen.findByRole('heading', { name: 'Project 页面' })).toBeInTheDocument();
  });

  it('提供当前 Project 的 New Work 快捷入口并可用 Escape 关闭', async () => {
    renderShell(['/projects/project-1/overview']);
    fireEvent.click(screen.getByRole('button', { name: /搜索与跳转/ }));
    expect(await screen.findByRole('option', { name: /新建 Work/ })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: '搜索' }), { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '搜索与跳转' })).not.toBeInTheDocument(),
    );
  });

  it('只在非 Workspace 页面响应 Ctrl/Cmd+B，并持久化折叠状态', () => {
    renderShell(['/projects']);
    const shell = document.querySelector('[data-shell="app-shell"]');
    expect(shell).toHaveAttribute('data-sidebar-state', 'expanded');
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(shell).toHaveAttribute('data-sidebar-state', 'collapsed');
    expect(window.localStorage.getItem('agenthub.sidebar.collapsed')).toBe('true');

    cleanup();
    window.localStorage.clear();
    renderShell(['/workspace/session-1']);
    const workspaceShell = document.querySelector('[data-shell="app-shell"]');
    expect(workspaceShell).toHaveAttribute('data-sidebar-state', 'expanded');
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(workspaceShell).toHaveAttribute('data-sidebar-state', 'expanded');
  });

  it('实时连接状态使用 live status 语义', () => {
    renderShell();
    expect(screen.getByRole('status', { name: '实时连接已连接' })).toBeInTheDocument();
  });

  it('在 Infrastructure 子路由只高亮精确的一级入口', () => {
    renderShell(['/agents/runtime']);

    expect(screen.getByRole('link', { name: '运行环境' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Agent 中心' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('CommandPalette fuzzy matching', () => {
  it('ranks contiguous matches above loose subsequence matches and rejects misses', () => {
    expect(fuzzyScore('run', 'Runtime')).toBeGreaterThan(fuzzyScore('rm', 'Runtime'));
    expect(fuzzyScore('xyz', 'Runtime')).toBe(-1);
  });
});
