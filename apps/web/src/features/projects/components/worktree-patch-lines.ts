/** Presentation only: preserve every character, including CRLF and a missing final newline. */
export function worktreePatchLines(patch: string) {
  // Limit presentation work, never the review content itself.
  if (patch.length > 128 * 1024) return null;
  const lines = patch.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  if (lines.length > 2_000) return null;
  let inHunk = false;
  return lines.map((text) => {
    if (text.startsWith('diff --git ')) inHunk = false;
    if (/^@@(?:@)? /.test(text)) {
      inHunk = true;
      return { text, kind: 'hunk' as const };
    }
    if (inHunk && text.startsWith('+')) return { text, kind: 'addition' as const };
    if (inHunk && text.startsWith('-')) return { text, kind: 'deletion' as const };
    return { text, kind: 'context' as const };
  });
}
