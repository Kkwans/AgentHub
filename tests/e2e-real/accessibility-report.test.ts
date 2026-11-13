import { expect, it } from 'vitest';
import { scanKey, summarizeAccessibility } from './accessibility-report.js';
const pages = ['light', 'dark'].flatMap((theme) =>
  Array.from({ length: 7 }, (_, v) =>
    Array.from({ length: 11 }, (_, r) => ({ theme, viewport: String(v), route: String(r) })),
  ).flat(),
);
const expected = pages.map(scanKey);
it('requires all 154 unique expected states, not just row count', () => {
  expect(summarizeAccessibility(expected, pages, 0, 0)).toEqual({
    missing: [],
    complete: true,
    passed: true,
  });
  const duplicate = [...pages.slice(1), pages[1]!];
  expect(summarizeAccessibility(expected, duplicate, 0, 0).complete).toBe(false);
  expect(
    summarizeAccessibility(
      expected,
      [...pages.slice(1), { theme: 'unexpected', viewport: '0', route: '0' }],
      0,
      0,
    ).complete,
  ).toBe(false);
});
it('separates completed scanning from accessibility success', () => {
  expect(summarizeAccessibility(expected, pages, 1, 0)).toMatchObject({
    complete: true,
    passed: false,
  });
  expect(summarizeAccessibility(expected, pages, 0, 1).passed).toBe(false);
});
it('retains every missing combination after setup or partial-page failure', () => {
  expect(summarizeAccessibility(expected, [], 0, 1)).toEqual({
    missing: expected,
    complete: false,
    passed: false,
  });
  expect(summarizeAccessibility(expected, pages.slice(0, 9), 0, 1).missing).toEqual(
    expected.slice(9),
  );
});
