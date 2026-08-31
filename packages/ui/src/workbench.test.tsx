// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Workbench, WorkbenchPanel } from './workbench.js';

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
});
