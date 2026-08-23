// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  AhEmptyState,
  AhErrorState,
  AhDialog,
  AhInput,
  AhProjectContext,
  AhResizablePane,
  AhStatusPill,
  AhThemeSelect,
  AhTextarea,
} from './product.js';
import { AgentHubProvider } from './provider.js';

describe('product components', () => {
  it('translates unknown domain status without leaking the enum', () => {
    render(<AhStatusPill status="SOME_INTERNAL_STATE" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('状态');
    expect(status.textContent).not.toContain('SOME_INTERNAL_STATE');
  });

  it('provides actionable empty and error states', () => {
    const retry = () => undefined;
    render(
      <AgentHubProvider>
        <>
          <AhEmptyState title="还没有项目" action={<button type="button">创建项目</button>} />
          <AhErrorState title="加载失败" description="请重试" retry={retry} />
        </>
      </AgentHubProvider>,
    );
    expect(screen.getByText('还没有项目')).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建项目' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('exposes non-native input and composable dialog primitives', () => {
    render(
      <AgentHubProvider>
        <AhInput label="搜索" placeholder="输入关键词" />
        <AhDialog open title="测试弹层" onClose={() => undefined}>
          <p>内容</p>
        </AhDialog>
      </AgentHubProvider>,
    );
    expect(screen.getByRole('textbox', { name: '搜索' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: '测试弹层' })).toBeTruthy();
  });

  it('provides an accessible autosizing textarea primitive', () => {
    render(
      <AgentHubProvider>
        <AhTextarea label="工作描述" placeholder="描述目标" />
      </AgentHubProvider>,
    );
    expect(screen.getByRole('textbox', { name: '工作描述' })).toBeTruthy();
  });

  it('renders project context tabs and theme preference control', () => {
    render(
      <AgentHubProvider>
        <AhProjectContext
          project={{ id: 'p-1', name: 'AgentHub', rootPath: '/workspace/agenthub' }}
          tabs={[{ to: '/projects/p-1/overview', label: '概览' }]}
        />
        <AhThemeSelect />
      </AgentHubProvider>,
    );
    expect(screen.getByRole('navigation', { name: '项目上下文' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '概览' }).getAttribute('href')).toBe(
      '/projects/p-1/overview',
    );
    expect(screen.getByRole('combobox', { name: '主题' })).toBeTruthy();
  });

  it('resizes a pane with the keyboard handle and can collapse', () => {
    render(
      <AgentHubProvider>
        <AhResizablePane title="检查器" initialSize={360} minSize={280} maxSize={480} collapsible>
          <p>内容</p>
        </AhResizablePane>
      </AgentHubProvider>,
    );
    const handle = screen.getByRole('separator', { name: '调整检查器宽度' });
    expect(handle.getAttribute('aria-valuenow')).toBe('360');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle.getAttribute('aria-valuenow')).toBe('344');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle.getAttribute('aria-valuenow')).toBe('280');
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(screen.getByRole('button', { name: '展开检查器' })).toBeTruthy();
  });
});
