// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from './AppShell';

vi.mock('../lib/realtime', () => ({
  realtime: {
    onState(listener: (state: '已连接') => void) {
      listener('已连接');
      return () => undefined;
    },
  },
}));

afterEach(cleanup);

function renderShell() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/overview']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="overview" element={<h2>概览内容</h2>} />
            <Route path="projects" element={<h2>Project 页面</h2>} />
            <Route path="tasks" element={<h2>Task 页面</h2>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppShell 命令面板', () => {
  it('使用 combobox 键盘模型选择并打开非首项结果', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: /搜索与跳转/ }));
    const combobox = await screen.findByRole('combobox', { name: '搜索页面' });

    expect(combobox).toHaveAttribute('aria-controls', 'command-results');
    expect(combobox).toHaveAttribute('aria-activedescendant', 'command-option-0');
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    expect(combobox).toHaveAttribute('aria-activedescendant', 'command-option-1');
    expect(screen.getByRole('option', { name: /项目/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(combobox, { key: 'Enter' });

    expect(await screen.findByRole('heading', { name: 'Project 页面' })).toBeInTheDocument();
  });

  it('实时连接状态使用 live status 语义', () => {
    renderShell();
    expect(screen.getByRole('status', { name: '实时连接已连接' })).toBeInTheDocument();
  });
});
