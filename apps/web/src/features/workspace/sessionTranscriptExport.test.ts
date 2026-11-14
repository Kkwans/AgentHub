import { describe, expect, it, vi } from 'vitest';
import {
  collectTranscript,
  formatTranscript,
  transcriptFilename,
  TRANSCRIPT_LIMITS,
} from './sessionTranscriptExport';
const row = (sequence: number, extra = {}) => ({
  id: `m${sequence}`,
  sessionId: 's',
  sequence,
  role: 'USER',
  text: `message ${sequence}`,
  createdAt: '2026-01-01T00:00:00Z',
  ...extra,
});
const collect = (pages: unknown[]) => {
  const read = vi.fn(async () => pages.shift());
  return { read, result: collectTranscript('s', read, new AbortController().signal) };
};
describe('persisted text transcript export', () => {
  it('reads all pages to an empty boundary, deduplicates overlap and orders by sequence', async () => {
    const { result, read } = collect([[row(4), row(5)], [row(2), row(3), row(4)], [row(1)], []]);
    expect(await result).toEqual({ upperSequence: 5, rows: [1, 2, 3, 4, 5].map((n) => row(n)) });
    expect(read.mock.calls.map((call) => (call as unknown[])[0])).toEqual([undefined, 4, 2, 1]);
  });
  it.each([
    [[row(3)], [row(4)]],
    [[row(3)], [row(3)]],
    [[row(3)], [row(2), row(3, { text: 'conflicting' })]],
    [[row(1, { sessionId: 'other' })]],
    [[row(1, { sequence: 0 })]],
    [[row(1, { role: 'SECRET' })]],
    [[row(1, { createdAt: 'invalid' })]],
    [undefined],
  ])('rejects malformed, cross-session, changing or non-progressing pages %#', async (...pages) => {
    await expect(collect(pages).result).rejects.toThrow();
  });
  it('does not return a partial file after a later page fails', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce([row(2)])
      .mockRejectedValueOnce(new Error('private-error'));
    await expect(collectTranscript('s', read, new AbortController().signal)).rejects.toThrow();
  });
  it('enforces character and message limits', async () => {
    await expect(
      collect([[row(1, { text: 'x'.repeat(TRANSCRIPT_LIMITS.characters + 1) })]]).result,
    ).rejects.toThrow();
    let cursor = 10001;
    const read = async () => Array.from({ length: Math.min(200, cursor) }, () => row(cursor--));
    await expect(collectTranscript('s', read, new AbortController().signal)).rejects.toThrow();
  });
  it('discards a late response after cancellation', async () => {
    const controller = new AbortController();
    const read = async () => {
      controller.abort();
      return [row(1)];
    };
    await expect(collectTranscript('s', read, controller.signal)).rejects.toThrow();
  });
  it('exports only text with safe literal fences and explicit scope, never raw payloads', async () => {
    const result = await collect([
      [
        row(1, { text: '<img src=x>\n```\n中文\u0000', contentJson: { password: 'secret' } }),
        row(2, { role: 'TOOL', text: 'private-tool' }),
        row(3, { role: 'ASSISTANT', text: 'answer' }),
      ],
      [],
    ]).result;
    const text = formatTranscript(result, { id: 's', title: '# title' }, '2026-01-01T00:00:00Z');
    expect(text).toContain('````text\n<img src=x>\n```\n中文\n````');
    expect(text).toContain('answer');
    expect(text).not.toMatch(/secret|private-tool/);
    expect(text).not.toContain(String.fromCharCode(0));
    expect(text).toContain('不是完整审计或事务快照');
    expect(transcriptFilename('../unsafe/\nname')).not.toMatch(/[/\\\n]/);
  });
});
