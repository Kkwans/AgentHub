// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { SessionRecord } from '../../../lib/api';
import {
  getSessionWindow,
  SESSION_VIRTUALIZATION_THRESHOLD,
  SESSION_WINDOW_SIZE,
  SessionRail,
} from './SessionRail';

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
  it('工作区导航连接真实页面并保留项目范围的新建入口', () => {
    const onSelect = vi.fn();
    render(
      <MemoryRouter>
        <SessionRail
          sessions={{ data: [], error: null, isLoading: false, refetch: vi.fn() }}
          currentId="current"
          projectId="project-1"
          onSelect={onSelect}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'AgentHub' })).toHaveAttribute('href', '/home');
    expect(screen.getByRole('link', { name: '项目' })).toHaveAttribute(
      'href',
      '/projects',
    );
    expect(screen.getByRole('link', { name: 'Prompt 库' })).toHaveAttribute('href', '/prompts');
    expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute(
      'href',
      '/settings/appearance',
    );
    expect(screen.getByRole('link', { name: '新建会话' })).toHaveAttribute(
      'href',
      '/projects/project-1/sessions?new=1',
    );
    fireEvent.click(screen.getByRole('link', { name: '项目' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('长列表按阈值窗口化，并保留当前会话', () => {
    const items = Array.from({ length: SESSION_VIRTUALIZATION_THRESHOLD + 20 }, (_, index) => ({
      id: `session-${index}`,
    }));

    const firstWindow = getSessionWindow(items, SESSION_WINDOW_SIZE);
    expect(firstWindow.items).toHaveLength(SESSION_WINDOW_SIZE);
    expect(firstWindow.items[0]?.id).toBe('session-0');
    expect(firstWindow.hasEarlier).toBe(true);
    expect(firstWindow.hiddenCount).toBe(items.length - SESSION_WINDOW_SIZE);

    const anchoredWindow = getSessionWindow(items, SESSION_WINDOW_SIZE, 'session-130');
    expect(anchoredWindow.items.some((item) => item.id === 'session-130')).toBe(true);
  });

  it('短列表不截断会话', () => {
    const items = [{ id: 'one' }, { id: 'two' }];
    expect(getSessionWindow(items, SESSION_WINDOW_SIZE)).toEqual({
      items,
      hiddenCount: 0,
      hasEarlier: false,
    });
  });

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
