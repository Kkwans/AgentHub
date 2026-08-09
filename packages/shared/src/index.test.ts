import { describe, expect, it } from 'vitest';

import { AGENTHUB_VERSION } from './index.js';

describe('共享包基线', () => {
  it('暴露 v0.1 版本', () => {
    expect(AGENTHUB_VERSION).toBe('0.1.0');
  });
});
