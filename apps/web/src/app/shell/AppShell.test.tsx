// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AgentHubProvider } from '@agenthub/ui';

import { AppShell } from './AppShell';

describe('v0.7 AppShell', () => {
  it('keeps Project as the context anchor and exposes the new primary IA', () => {
    render(
      <AgentHubProvider>
        <MemoryRouter initialEntries={['/projects/p-1/overview']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="*" element={<div>内容</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AgentHubProvider>,
    );

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '首页' }).getAttribute('href')).toBe('/home');
    expect(screen.getByRole('link', { name: '项目' }).getAttribute('href')).toBe('/projects');
    expect(screen.getByRole('link', { name: 'Agent 中心' }).getAttribute('href')).toBe('/agents/agents');
    expect(screen.getByRole('link', { name: 'Prompt 库' }).getAttribute('href')).toBe('/prompts');
    expect(screen.getByRole('link', { name: /工作区/ }).getAttribute('href')).toBe('/workspace');
    expect(screen.getByRole('link', { name: '设置' }).getAttribute('href')).toBe('/settings/appearance');
    expect(screen.queryByRole('link', { name: '任务' })).toBeNull();
    expect(screen.getByRole('button', { name: /搜索与跳转/ })).toBeTruthy();
  });
});
