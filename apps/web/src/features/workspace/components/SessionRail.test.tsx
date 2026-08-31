// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { SessionRecord } from '../../../lib/api';
import { SessionRail } from './SessionRail';

afterEach(() => cleanup());

function session(id: string, title: string, lastActiveAt: string): SessionRecord {
  return {
    id,
    projectId: 'project-1',
    agentId: 'agent-1',
    taskId: null,
    title,
    cwd: '/workspace/project',
    branch: 'main',
    status: 'CLOSED',
    model: null,
    mode: null,
    reasoningEffort: null,
    lastActiveAt,
  };
}

describe('SessionRail', () => {
  it('默认收起更早会话，搜索时自动展开历史分组', () => {
    const now = new Date();
    const sessions = [
      session('today', '今天会话', now.toISOString()),
      session('earlier', '历史会话', new Date(now.getTime() - 3 * 86_400_000).toISOString()),
    ];
    render(
      <MemoryRouter>
        <SessionRail
          sessions={{ data: sessions, error: null, isLoading: false, refetch: vi.fn() }}
          currentId="today"
        />
      </MemoryRouter>,
    );

    const earlier = screen.getByRole('button', { name: /更早/ });
    expect(earlier).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('历史会话')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: '搜索会话' }), {
      target: { value: '历史' },
    });
    expect(earlier).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('历史会话')).toBeInTheDocument();
  });
});
