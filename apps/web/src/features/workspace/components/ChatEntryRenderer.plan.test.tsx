// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import type { EventRecord, MessageRecord } from '../../../lib/api';
import type { ConversationMessageItem } from './conversationModel';
import type { ConversationPlanItem, ConversationToolItem } from './conversationModel';
import { ChatEntryRenderer } from './ChatEntryRenderer';

afterEach(cleanup);

describe('ChatEntryRenderer plan entry', () => {
  it('exposes the copied reply action rail after an assistant response settles', () => {
    const message: MessageRecord = {
      id: 'assistant-message-1',
      runId: 'run-1',
      role: 'ASSISTANT',
      kind: 'TEXT',
      text: '已完成检查。',
      sequence: 8,
      createdAt: '2026-09-10T08:00:02.000Z',
    };
    const item: ConversationMessageItem = {
      kind: 'message',
      id: message.id,
      createdAt: message.createdAt,
      message,
    };

    render(
      <MemoryRouter>
        <ChatEntryRenderer
          item={item}
          resolving={undefined}
          resolveError={undefined}
          resolveVariables={undefined}
          activeThoughtId={undefined}
          onResolve={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('toolbar', { name: 'Agent 回复快捷操作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制回复' })).toBeInTheDocument();
  });

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
      <MemoryRouter>
        <ChatEntryRenderer
          item={item}
          resolving={undefined}
          resolveError={undefined}
          resolveVariables={undefined}
          activeThoughtId={undefined}
          onResolve={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('执行计划 · 1/2 完成')).toBeInTheDocument();
    const summary = screen.getByText('执行计划 · 1/2 完成').closest('summary');
    expect(summary).toBeInTheDocument();
    expect(summary).toHaveTextContent(/^执行计划 · 1\/2 完成$/);
    expect(screen.queryByText('Agent 计划')).not.toBeInTheDocument();
    fireEvent.click(summary!);
    expect(screen.getByText('读取项目结构')).toHaveClass('line-through');
    expect(screen.getByText('运行测试')).toBeInTheDocument();
  });

  it.each([
    {
      name: '全部完成仍保留计数',
      payload: { entries: [{ content: '验证构建', status: 'completed' }] },
      label: '执行计划 · 1/1 完成',
      detail: '验证构建',
    },
    {
      name: '尚未完成不伪装成已完成',
      payload: { entries: [{ content: '审查实现', status: 'pending' }] },
      label: '执行计划 · 0/1 完成',
      detail: '审查实现',
    },
    {
      name: '自定义Markdown标题完整保留而非误去重',
      payload: { update: { content: '# 发布前专项审查\n\n检查迁移与回滚方案。' } },
      label: '执行计划说明',
      detail: '发布前专项审查',
    },
    {
      name: '计划文件引用仍可展开',
      payload: { update: { uri: 'plans/release-checklist.md' } },
      label: '执行计划文件',
      detail: 'plans/release-checklist.md',
    },
    {
      name: '已移除状态不被去重删除',
      payload: { removed: true },
      label: '执行计划已移除',
      detail: 'Agent 已清理这份计划。',
    },
  ])('$name', async ({ payload, label, detail }) => {
    const event: EventRecord = {
      id: 'plan-summary-case',
      sessionId: 'session-1',
      runId: 'run-1',
      seq: 4,
      type: 'agent.plan.updated',
      payloadJson: payload,
      createdAt: '2026-09-10T08:00:00.000Z',
    };
    render(
      <MemoryRouter>
        <ChatEntryRenderer
          item={{
            kind: 'plan',
            id: 'plan:run-1:default',
            createdAt: event.createdAt,
            firstSeq: event.seq,
            event,
          }}
          resolving={undefined}
          resolveError={undefined}
          resolveVariables={undefined}
          activeThoughtId={undefined}
          onResolve={() => undefined}
        />
      </MemoryRouter>,
    );
    const summary = screen.getByText(label).closest('summary')!;
    expect(summary).toHaveAccessibleName(`${label}，展开执行计划详情`);
    expect(summary.textContent).toBe(label);
    expect(screen.queryByText('Agent 计划')).not.toBeInTheDocument();
    expect(summary.parentElement).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(summary.parentElement).toHaveAttribute('open');
    expect(await screen.findByText(detail)).toBeInTheDocument();
  });

  it('keeps an explicitly marked sub-agent tool visible in the inline timeline', () => {
    const event: EventRecord = {
      id: 'subagent-render-1',
      sessionId: 'session-1',
      runId: 'run-1',
      seq: 5,
      type: 'tool.call.started',
      payloadJson: { kind: 'subagent', toolCallId: 'call-subagent' },
      createdAt: '2026-09-10T08:00:01.000Z',
    };
    const item: ConversationToolItem = {
      kind: 'tool',
      id: 'tool:call-subagent',
      createdAt: event.createdAt,
      firstSeq: event.seq,
      event,
    };

    render(
      <MemoryRouter>
        <ChatEntryRenderer
          item={item}
          resolving={undefined}
          resolveError={undefined}
          resolveVariables={undefined}
          activeThoughtId={undefined}
          onResolve={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('子 Agent 执行')).toBeInTheDocument();
    expect(screen.getByText('子 Agent')).toBeInTheDocument();
  });
});
