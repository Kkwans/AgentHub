// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EventRecord } from '../../../lib/api';
import type { ConversationPlanItem } from './conversationModel';
import { ChatEntryRenderer } from './ChatEntryRenderer';

afterEach(cleanup);

describe('ChatEntryRenderer plan entry', () => {
  it('uses the PinHarness-style expandable plan card for ACP plan updates', () => {
    const event: EventRecord = {
      id: 'plan-render-1',
      sessionId: 'session-1',
      runId: 'run-1',
      seq: 4,
      type: 'agent.plan.updated',
      payloadJson: {
        entries: [
          { content: '读取项目结构', priority: 'high', status: 'completed' },
          { content: '运行测试', priority: 'medium', status: 'in_progress' },
        ],
      },
      createdAt: '2026-09-10T08:00:00.000Z',
    };
    const item: ConversationPlanItem = {
      kind: 'plan',
      id: 'plan:run-1:default',
      createdAt: event.createdAt,
      firstSeq: event.seq,
      event,
    };

    render(
      <ChatEntryRenderer
        item={item}
        resolving={undefined}
        resolveError={undefined}
        resolveVariables={undefined}
        activeThoughtId={undefined}
        onResolve={() => undefined}
      />,
    );

    expect(screen.getByText('执行计划 · 1/2 完成')).toBeInTheDocument();
    const summary = screen.getByText('执行计划 · 1/2 完成').closest('summary');
    expect(summary).toBeInTheDocument();
    fireEvent.click(summary!);
    expect(screen.getByText('读取项目结构')).toHaveClass('line-through');
    expect(screen.getByText('运行测试')).toBeInTheDocument();
  });
});
