// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { readRatio, resolveThreeColumnLayoutMode } from './three-column-split.js';

afterEach(() => window.localStorage.clear());

describe('PinHarness ThreeColumnSplit shared layout contract', () => {
  it('keeps the explicit wide, medium and single breakpoints', () => {
    expect(resolveThreeColumnLayoutMode(1_440)).toBe('wide');
    expect(resolveThreeColumnLayoutMode(1_024)).toBe('medium');
    expect(resolveThreeColumnLayoutMode(767)).toBe('single');
    expect(resolveThreeColumnLayoutMode(0)).toBeNull();
  });

  it('clamps persisted panel ratios without allowing malformed preferences through', () => {
    window.localStorage.setItem('left-panel', '0.6');
    expect(readRatio('left-panel', 0.22, 0.12, 0.45)).toBe(0.45);
    window.localStorage.setItem('left-panel', 'not-a-number');
    expect(readRatio('left-panel', 0.22, 0.12, 0.45)).toBe(0.22);
  });
});
