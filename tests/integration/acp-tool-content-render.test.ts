// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createRequire } from 'node:module';
import type * as React from 'react';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { normalizeAcpSessionUpdate } from '../../packages/adapter-acp/src/normalization';
import { buildConversationTimeline } from '../../apps/web/src/features/workspace/components/conversationModel';
import { ChatEntryRenderer } from '../../apps/web/src/features/workspace/components/ChatEntryRenderer';
import type { EventRecord } from '../../apps/web/src/lib/api';

// Resolve React from the web workspace, not a new production dependency edge.
const webRequire = createRequire(resolve(process.cwd(), 'apps/web/package.json'));
const { createElement } = webRequire('react') as typeof React;
const { MemoryRouter } = webRequire('react-router-dom') as {
  MemoryRouter: React.ComponentType<{ children?: React.ReactNode }>;
};

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
function event(payloadJson: Record<string, unknown>, overrides: Partial<EventRecord>): EventRecord {
  return {
    id: overrides.id ?? 'wire-event',
    sessionId: 'wire-session',
    runId: 'wire-run',
    seq: overrides.seq ?? 1,
    type: overrides.type ?? 'tool.call.started',
    payloadJson,
    createdAt: '2026-11-14T00:00:00.000Z',
  };
}
function renderTool(toolEvent: EventRecord) {
  return render(
    createElement(
      MemoryRouter,
      null,
      createElement(ChatEntryRenderer, {
        item: {
          kind: 'tool',
          id: `tool:${toolEvent.id}`,
          createdAt: toolEvent.createdAt,
          firstSeq: toolEvent.seq,
          event: toolEvent,
        },
        resolving: undefined,
        resolveError: undefined,
        resolveVariables: undefined,
        activeThoughtId: undefined,
        onResolve: () => undefined,
      }),
    ),
  );
}
it('renders standard ACP text output through normalization and started/failed timeline merging', async () => {
  const text = 'Fixture 预期失败：演示错误状态，不是实际服务故障。';
  const updates = [
    ...normalizeAcpSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'wire-failed',
      title: 'Fixture 失败工具',
      kind: 'other',
      status: 'in_progress',
      rawOutput: { secret: 'private-raw' },
      content: [{ type: 'content', content: { type: 'text', text } }],
    }),
    ...normalizeAcpSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'wire-failed',
      status: 'failed',
      rawOutput: { secret: 'private-raw-update' },
    }),
  ];
  const timeline = buildConversationTimeline(
    [],
    updates.map((update, index) =>
      event(update.payload, { id: `wire-${index}`, type: update.type, seq: index + 1 }),
    ),
  );
  expect(timeline).toHaveLength(1);
  const item = timeline[0];
  if (item?.kind !== 'tool') throw new Error('Expected normalized tool');
  const view = renderTool(item.event);
  expect(view.container.querySelector('.tool-entry-failure-preview')).toHaveTextContent(text);
  expect(view.container).not.toHaveTextContent('private-raw');
  fireEvent.click(screen.getByRole('button', { name: 'Fixture 失败工具，工具调用失败，展开详情' }));
  await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(1));
});
