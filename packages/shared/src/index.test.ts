import { describe, expect, it } from 'vitest';

import { AGENTHUB_VERSION, websocketClientMessageSchema } from './index.js';

describe('共享包基线', () => {
  it('暴露当前产品版本', () => {
    expect(AGENTHUB_VERSION).toBe('1.0.0');
  });

  it('统一 WebSocket 接受 Worktree 控制面 topic', () => {
    expect(
      websocketClientMessageSchema.parse({
        type: 'subscribe',
        topics: ['worktrees', 'remote-nodes'],
      }),
    ).toEqual({ type: 'subscribe', topics: ['worktrees', 'remote-nodes'] });
  });
});
