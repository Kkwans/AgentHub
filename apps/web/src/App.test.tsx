// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

vi.mock('./lib/realtime', () => ({
  realtime: {
    onState(listener: (state: '已连接') => void) {
      listener('已连接');
      return () => undefined;
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it('PromptOS 空状态来自真实 API 数据层', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [], requestId: 'ui-test' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/promptos']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('还没有 Prompt')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'PromptOS', level: 2 })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/v1\/(prompts|projects|agents)$/),
      expect.any(Object),
    );
  });

  it('PromptOS 明确呈现创建新版本与中文功能标签', async () => {
    const prompt = {
      id: '11111111-1111-4111-8111-111111111111',
      projectId: null,
      key: 'review/safe-change',
      name: '安全审阅',
      description: '只审阅必要变更',
      kind: 'REVIEW',
      type: 'TEXT',
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        const data = path.endsWith('/prompts')
          ? [prompt]
          : path.endsWith(`/prompts/${prompt.id}`)
            ? prompt
            : path.endsWith(`/prompts/${prompt.id}/versions`)
              ? []
              : path.endsWith(`/prompts/${prompt.id}/labels`)
                ? []
                : [];
        return new Response(JSON.stringify({ data, requestId: 'ui-version-test' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/promptos']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      (await screen.findAllByRole('button', { name: '创建新版本' })).length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('tab', { name: '标签' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '上下文预览' })).toBeInTheDocument();
    expect(screen.getByText('不可变版本历史')).toBeInTheDocument();
  });
});
