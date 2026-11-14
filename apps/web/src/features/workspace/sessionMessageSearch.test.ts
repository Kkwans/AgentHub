import { expect, it } from 'vitest';
import { parseMessageSearchPage } from './sessionMessageSearch';
import { inspectLocationMessages } from './messageLocation';
const hit = {
  id: 'm',
  sessionId: 's',
  role: 'USER',
  sequence: 2,
  snippet: '<img> %_ 中文',
  createdAt: '2026-11-14T00:00:00Z',
};
const page = {
  hits: [hit],
  upperSequence: 4,
  nextBeforeSequence: 2,
  scannedCount: 2,
  exhausted: false,
};
it('retains literal snippets and 400 Unicode code points, not UTF16 units', () => {
  expect(parseMessageSearchPage(page, 's').hits[0]?.snippet).toBe(hit.snippet);
  expect(
    parseMessageSearchPage({ ...page, hits: [{ ...hit, snippet: '😀'.repeat(400) }] }, 's').hits,
  ).toHaveLength(1);
});
it('zero hits with remaining cursor is not exhausted', () => {
  expect(parseMessageSearchPage({ ...page, hits: [] }, 's').exhausted).toBe(false);
});
it.each([
  { ...page, upperSequence: 5 },
  { ...page, nextBeforeSequence: 4 },
  { ...page, hits: [{ ...hit, sessionId: 'other' }] },
  { ...page, hits: [hit, hit] },
  { ...page, hits: [{ ...hit, snippet: 'x'.repeat(401) }] },
  { ...page, exhausted: true },
  { ...page, scannedCount: 101 },
])('rejects conflicting identity/bounds/cursor %#', (value) => {
  expect(() => parseMessageSearchPage(value, 's', 4, 4)).toThrow();
});
it('requires exact saved identity and rejects same sequence collisions', () => {
  const row = {
    id: 'm',
    sequence: 2,
    role: 'USER' as const,
    kind: 'TEXT',
    runId: null,
    text: 'body',
    createdAt: hit.createdAt,
  };
  expect(inspectLocationMessages([row], hit)).toBe(true);
  expect(() => inspectLocationMessages([{ ...row, id: 'other' }], hit)).toThrow();
  expect(() => inspectLocationMessages([row, { ...row, id: 'other' }], hit)).toThrow();
});
it.each([
  { ...page, scannedCount: 0 },
  { ...page, nextBeforeSequence: 3 },
  { ...page, hits: [], scannedCount: 0 },
])('rejects contradictory scan accounting or cursor %#', (value) => {
  expect(() => parseMessageSearchPage(value, 's')).toThrow();
});
