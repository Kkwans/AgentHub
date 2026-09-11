// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import type { EventRecord } from '../../../lib/api';
import type { ConversationToolItem } from './conversationModel';
import { ChatEntryRenderer } from './ChatEntryRenderer';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

function event(
  payloadJson: Record<string, unknown>,
  overrides: Partial<EventRecord> = {},
): EventRecord {
  return {
    id: overrides.id ?? 'tool-source-1',
    sessionId: 'session-source',
    runId: 'run-source',
    seq: overrides.seq ?? 1,
    type: overrides.type ?? 'tool.call.completed',
    payloadJson,
    createdAt: overrides.createdAt ?? '2026-09-11T08:00:00.000Z',
  };
}

function renderTool(toolEvent: EventRecord) {
  const item: ConversationToolItem = {
    kind: 'tool',
    id: `tool:${toolEvent.id}`,
    createdAt: toolEvent.createdAt,
    firstSeq: toolEvent.seq,
    event: toolEvent,
  };
  return render(
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
}

describe('PinHarness chat source renderers', () => {
  it('renders a read-file card with source theme, line numbers and deferred detail', async () => {
    renderTool(
      event({
        tool: 'read_file',
        path: 'src/features/App.tsx',
        output: JSON.stringify({
          file: { filePath: 'src/features/App.tsx', content: 'const one = 1;\nconst two = 2;' },
        }),
      }),
    );

    const trigger = screen.getByRole('button', { name: '读取文件，工具调用完成，展开详情' });
    expect(trigger.closest('.tool-entry-card')).toHaveClass('tool-entry-card');
    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByText('文件内容')).toBeInTheDocument());
    expect(screen.getByText(/const one = 1;/)).toBeInTheDocument();
    expect(document.querySelector('pre.sticky')?.textContent).toBe('1\n2');
  });

  it('uses the source terminal shell surface and command summary', async () => {
    renderTool(
      event({
        tool: 'exec_command',
        command: 'pnpm test --filter web',
        output: 'Tests passed',
      }),
    );

    const trigger = screen.getByRole('button', { name: '运行命令，工具调用完成，展开详情' });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByText(/shell/)).toBeInTheDocument());
    expect(screen.getAllByText('pnpm test --filter web').length).toBeGreaterThan(1);
    expect(screen.getByText('Tests passed')).toBeInTheDocument();
  });

  it('renders source search groups and a rich SubAgent trace from normalized payloads', async () => {
    renderTool(
      event({
        kind: 'subagent',
        status: 'completed',
        description: '拆分并核验会话页面',
        entries: [
          { type: 'thinking', text: '先读取目标文件。', streaming: false },
          {
            type: 'tool_use',
            tool: 'search',
            query: 'ChatConversationView',
            output: 'src/App.tsx:8:ChatConversationView',
          },
        ],
      }),
    );

    expect(screen.getByText('SubAgent')).toBeInTheDocument();
    expect(screen.getAllByText('拆分并核验会话页面').length).toBeGreaterThan(0);
    const subagentButton = screen.getByRole('button', { name: /拆分并核验会话页面/ });
    fireEvent.click(subagentButton);
    await waitFor(() => expect(screen.getByText('执行轨迹')).toBeInTheDocument());
    expect(screen.getByText('Subagent prompt')).toBeInTheDocument();
    expect(screen.getByText(/query=ChatConversationView/)).toBeInTheDocument();
  });
});
