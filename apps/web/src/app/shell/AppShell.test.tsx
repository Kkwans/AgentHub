// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AgentHubProvider } from '@agenthub/ui';

import { AppShell } from './AppShell';
import { fuzzyScore } from './CommandPalette';

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
});

function renderShell(initialEntries: string[] = ['/projects/p-1/overview']) {
  render(
    <AgentHubProvider initialPreference="light">
      <MemoryRouter initialEntries={initialEntries}>
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
});

describe('CommandPalette fuzzy matching', () => {
  it('ranks contiguous matches above loose subsequence matches and rejects misses', () => {
    expect(fuzzyScore('run', 'Runtime')).toBeGreaterThan(fuzzyScore('rm', 'Runtime'));
    expect(fuzzyScore('xyz', 'Runtime')).toBe(-1);
  });
});
