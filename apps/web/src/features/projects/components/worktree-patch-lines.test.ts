import { describe, expect, it } from 'vitest';
import { worktreePatchLines } from './worktree-patch-lines';

describe('worktree patch presentation', () => {
  it.each(['', '\n', '\n\n', 'a\r\n+b\r\n', 'last line', 'a\n\nlast', '+<script>x</script>'])(
    'preserves exact text %j',
    (patch) => {
      expect(
        worktreePatchLines(patch)!
          .map((line) => line.text)
          .join(''),
      ).toBe(patch);
    },
  );
  it('distinguishes hunk changes from file headers, including content beginning with ++ or --', () => {
    const patch =
      'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n---old\n+++new\n context\n\\ No newline at end of file\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n';
    expect(worktreePatchLines(patch)!.map((line) => line.kind)).toEqual([
      'context',
      'context',
      'context',
      'hunk',
      'deletion',
      'addition',
      'context',
      'context',
      'context',
      'context',
      'context',
    ]);
  });
  it('does not invent change types for binary or metadata-only patches', () => {
    expect(
      worktreePatchLines('diff --git a/a b/a\nBinary files a/a and b/a differ\n')!.every(
        (line) => line.kind === 'context',
      ),
    ).toBe(true);
  });
});

it('bounds highlighting without truncating the source', () => {
  expect(worktreePatchLines('x'.repeat(128 * 1024 + 1))).toBeNull();
  expect(worktreePatchLines('x\n'.repeat(2001))).toBeNull();
  expect(worktreePatchLines('x\n'.repeat(2000))).toHaveLength(2000);
});
