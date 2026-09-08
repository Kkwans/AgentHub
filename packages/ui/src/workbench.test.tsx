// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Workbench,
  WorkbenchCommandBar,
  WorkbenchDisclosure,
  WorkbenchExecutionItem,
  WorkbenchPanel,
  WorkbenchStatus,
} from './workbench.js';

afterEach(cleanup);

describe('v1 workbench structural contract', () => {
  it('keeps named rail, conversation, inspector and terminal slots', () => {
    render(
      <Workbench
        topbar={<span>AgentHub</span>}
        rail={
          <WorkbenchPanel side="rail" title="会话">
            列表
          </WorkbenchPanel>
        }
        inspector={
          <WorkbenchPanel side="inspector" title="检查器">
            Changes
          </WorkbenchPanel>
        }
        terminal={<pre>Terminal output</pre>}
        labels={{ rail: '会话栏', conversation: '工作对话', inspector: '变更检查器' }}
      >
        <WorkbenchPanel side="conversation" title="任务">
          内容
        </WorkbenchPanel>
      </Workbench>,
    );

    expect(screen.getByRole('banner')).toHaveTextContent('AgentHub');
    expect(screen.getByRole('complementary', { name: '会话栏' })).toHaveTextContent('列表');
    expect(screen.getByRole('main', { name: '工作对话' })).toHaveTextContent('内容');
    expect(screen.getByRole('complementary', { name: '变更检查器' })).toHaveTextContent('Changes');
    expect(screen.getByRole('region', { name: 'Terminal' })).toHaveTextContent('Terminal output');
  });

  it('serializes panel visibility state for responsive CSS', () => {
    const { container } = render(
      <Workbench railCollapsed inspectorCollapsed inspectorOpen={false}>
        <p>内容</p>
      </Workbench>,
    );

    expect(container.firstElementChild).toHaveAttribute('data-rail-collapsed', 'true');
    expect(container.firstElementChild).toHaveAttribute('data-inspector-collapsed', 'true');
    expect(container.firstElementChild).toHaveAttribute('data-inspector-open', 'false');
  });

  it('renders status, disclosure and command primitives with accessible contracts', () => {
    render(
      <>
        <WorkbenchStatus label="Agent 正在运行" tone="running" busy />
        <WorkbenchDisclosure summary="执行详情" defaultOpen>
          <code>pnpm test</code>
        </WorkbenchDisclosure>
        <WorkbenchExecutionItem title="检查工作树" meta="12ms" status={<span>完成</span>}>
          输出
        </WorkbenchExecutionItem>
        <WorkbenchCommandBar status={<span>上下文 42%</span>} footer={<button>发送</button>}>
          <textarea aria-label="消息" />
        </WorkbenchCommandBar>
      </>,
    );

    expect(screen.getByRole('status', { name: 'Agent 正在运行' })).toHaveAttribute(
      'data-busy',
      'true',
    );
    expect(screen.getByText('pnpm test')).toBeVisible();
    expect(screen.getByText('检查工作树')).toBeVisible();
    expect(screen.getByRole('group', { name: '命令栏' })).toHaveClass('ah-workbench-command-bar');
  });
});
