// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';

vi.mock('./lib/realtime', () => ({
  realtime: {
    onState(listener: (state: '已连接') => void) {
      listener('已连接');
      return () => undefined;
    },
  },
}));

describe('App', () => {
  it('使用中文导航并渲染目标路由', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/tasks']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('navigation', { name: '一级导航' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '任务' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Goal 与 Task' })).toBeInTheDocument();
    expect(screen.getByText('尚未创建 Task')).toBeInTheDocument();
  });
});
