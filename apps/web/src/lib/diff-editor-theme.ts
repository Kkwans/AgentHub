import type { editor } from 'monaco-editor';

export const AGENTHUB_DIFF_LIGHT = 'agenthub-diff-light';
export const AGENTHUB_DIFF_DARK = 'agenthub-diff-dark';

// Preserve Monaco's diff backgrounds. Override only audited syntax families:
// light TS uses muted hues; CSS and dark retain their verified contrast fixes.
export const diffEditorThemes: Record<string, editor.IStandaloneThemeData> = {
  [AGENTHUB_DIFF_LIGHT]: {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'attribute.name', foreground: '8E1616' },
      // Light CSS values retain blue syntax while clearing the actual stacked
      // deleted-character background (#ffa3a3) seen in the focus-review CI.
      { token: 'attribute.value.css', foreground: '033E80' },
      // Low-chroma TS only. Keep the inherited diff backgrounds and invalid
      // token semantics; ordinary text clears the stacked #ffa3a3 deletion.
      { token: 'keyword.ts', foreground: '3D4859' },
      { token: 'keyword.other.ts', foreground: '3D4859' },
      { token: 'string.ts', foreground: '554236' },
      { token: 'string.escape.ts', foreground: '554236' },
      { token: 'number.ts', foreground: '374B42' },
      { token: 'number.float.ts', foreground: '374B42' },
      { token: 'number.hex.ts', foreground: '374B42' },
      { token: 'number.octal.ts', foreground: '374B42' },
      { token: 'number.binary.ts', foreground: '374B42' },
      { token: 'type.identifier.ts', foreground: '4D4057' },
      { token: 'comment.ts', foreground: '424B45' },
      { token: 'comment.doc.ts', foreground: '424B45' },
    ],
    colors: {},
  },
  [AGENTHUB_DIFF_DARK]: {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'attribute.name', foreground: '9CDCFE' },
      // CSS identifier values (e.g. display: block/grid) retain their warm hue
      // but need more luminance on Monaco's stacked inserted-text background.
      { token: 'attribute.value.css', foreground: 'F4C7AF' },
      // TS/TSX keywords need a lighter blue on inserted lines and characters.
      { token: 'keyword.ts', foreground: 'B1D3FF' },
      // Actual inline TSX deletion: idle on #6f1313 fails with default CE9178.
      { token: 'string.ts', foreground: 'F4C7AF' },
    ],
    colors: {},
  },
};
