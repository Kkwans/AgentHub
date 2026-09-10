import { describe, expect, it } from 'vitest';

import { resolveLockedSessionState } from './ComposerToolbar';

describe('ComposerToolbar session state labels', () => {
  it('keeps READY sendable and gives locked states explicit labels', () => {
    expect(resolveLockedSessionState('READY')).toBe('就绪');
    expect(resolveLockedSessionState('CLOSED')).toBe('已关闭');
    expect(resolveLockedSessionState('DISCONNECTED')).toBe('已断开');
    expect(resolveLockedSessionState('WAITING_APPROVAL')).toBe('等待审批');
    expect(resolveLockedSessionState('UNKNOWN')).toBe('不可发送');
  });
});
