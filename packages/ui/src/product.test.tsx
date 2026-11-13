// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AhEmptyState,
  AhErrorState,
  AhDialog,
  AhDrawer,
  AhInput,
  AhLoadingState,
  AhProjectContext,
  AhStatusPill,
  AhStatusDot,
  AhThemeSelect,
  AhTextarea,
  humanizeStatus,
} from './product.js';
import { AgentHubProvider } from './provider.js';

afterEach(cleanup);

describe('product components', () => {
  it.each([AhStatusPill, AhStatusDot])('labels unplanned tasks with a neutral status', (Status) => {
    render(<Status status="BACKLOG" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('待规划');
    expect(
      status.matches('[data-tone="gray"]') || status.querySelector('[data-tone="gray"]'),
    ).toBeTruthy();
    expect(status.querySelector('[data-tone="yellow"]')).toBeNull();
  });

  it.each([
    ['BACKLOG', '待规划'],
    ['READY', '就绪'],
    ['IN_PROGRESS', '进行中'],
    ['WAITING_REVIEW', '待审阅'],
    ['DONE', '已完成'],
    ['BLOCKED', '已阻塞'],
    ['CANCELED', '已取消'],
  ])('labels the known task state %s', (state, label) => {
    expect(humanizeStatus(state)).toBe(label);
  });

  it('translates unknown domain status without leaking the enum', () => {
    render(<AhStatusPill status="SOME_INTERNAL_STATE" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('状态');
    expect(status.textContent).not.toContain('SOME_INTERNAL_STATE');
  });

  it('offers a compact dot status for dense entity rows', () => {
    render(<AhStatusDot status="RUNNING" />);
    expect(screen.getByRole('status')).toHaveTextContent('执行中');
    expect(screen.getByRole('status').querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('maps terminal closed status to the neutral tone', () => {
    render(<AhStatusPill status="CLOSED" />);
    expect(screen.getByRole('status')).toHaveTextContent('已关闭');
    expect(screen.getByRole('status').querySelector('[data-tone="gray"]')).toBeTruthy();
  });

  it.each([AhStatusPill, AhStatusDot])(
    'labels archived projects with a neutral status',
    (Status) => {
      render(<Status status="ARCHIVED" />);
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('已归档');
      expect(
        status.matches('[data-tone="gray"]') || status.querySelector('[data-tone="gray"]'),
      ).toBeTruthy();
    },
  );

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
    const { container } = render(
      <AgentHubProvider>
        <AhInput label="搜索" placeholder="输入关键词" />
        <AhDialog open title="测试弹层" onClose={() => undefined}>
          <p>内容</p>
        </AhDialog>
      </AgentHubProvider>,
    );
    expect(screen.getByLabelText('搜索')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '搜索' })).not.toBeInTheDocument();
    expect(container).toHaveAttribute('aria-hidden', 'true');
    const dialog = screen.getByRole('dialog', { name: '测试弹层' });
    expect(dialog.closest('.ah-dialog-backdrop')?.parentElement).toBe(document.body);
    expect(container).not.toContainElement(dialog);
    expect(screen.getByRole('dialog', { name: '测试弹层' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
  });

  it('renders the PinHarness drawer with focus-safe close semantics', () => {
    const onClose = vi.fn();
    render(
      <AgentHubProvider>
        <button type="button">打开抽屉</button>
        <AhDrawer open title="版本与标签" position="right" onClose={onClose}>
          <button type="button">抽屉内容</button>
        </AhDrawer>
      </AgentHubProvider>,
    );

    expect(screen.getByRole('dialog', { name: '版本与标签' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('provides an accessible autosizing textarea primitive', () => {
    render(
      <AgentHubProvider>
        <AhTextarea label="工作描述" placeholder="描述目标" />
      </AgentHubProvider>,
    );
    expect(screen.getByRole('textbox', { name: '工作描述' })).toBeTruthy();
  });

  it('uses the PinHarness loading surface with structural skeleton rows', () => {
    render(<AhLoadingState label="正在加载页面" description="正在读取最新状态" rows={3} />);
    expect(screen.getByRole('status', { name: '正在加载页面' })).toHaveClass('ah-loading-state');
    expect(screen.getByText('正在读取最新状态')).toBeInTheDocument();
    expect(document.querySelectorAll('.ah-loading-skeleton')).toHaveLength(3);
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
});
