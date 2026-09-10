import { describe, expect, it } from 'vitest';

import type { EventRecord } from '../../../lib/api';
import { readPlanSummary } from './ChatCommandBar';
import { resolveLockedSessionState } from './ComposerToolbar';

describe('ComposerToolbar session state labels', () => {
  it('keeps READY sendable and gives locked states explicit labels', () => {
    expect(resolveLockedSessionState('READY')).toBe('就绪');
    expect(resolveLockedSessionState('CLOSED')).toBe('已关闭');
    expect(resolveLockedSessionState('DISCONNECTED')).toBe('已断开');
    expect(resolveLockedSessionState('WAITING_APPROVAL')).toBe('等待审批');
    expect(resolveLockedSessionState('UNKNOWN')).toBe('不可发送');
  });

  it('reduces the latest normalized plan snapshot for the CommandBar progress fact', () => {
    const event = (seq: number, payloadJson: Record<string, unknown>): EventRecord => ({
      id: `plan-${seq}`,
      sessionId: 'session-1',
      runId: 'run-1',
      seq,
      type: 'agent.plan.updated',
      payloadJson,
      createdAt: `2026-09-10T08:00:0${seq}.000Z`,
    });
    expect(
      readPlanSummary([
        event(1, {
          entries: [
            { content: '检查代码', status: 'in_progress' },
            { content: '运行测试', status: 'pending' },
          ],
        }),
        event(2, {
          entries: [
            { content: '检查代码', status: 'completed' },
            { content: '运行测试', status: 'in_progress' },
          ],
        }),
      ]),
    ).toEqual({ completed: 1, total: 2 });
  });
});
