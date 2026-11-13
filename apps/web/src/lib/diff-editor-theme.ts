import type { editor } from 'monaco-editor';

export const AGENTHUB_DIFF_LIGHT = 'agenthub-diff-light';
export const AGENTHUB_DIFF_DARK = 'agenthub-diff-dark';

// Keep Monaco's syntax palette and diff backgrounds. Its default bright-red
// attribute/property token fails contrast on the inserted-character highlight.
export const diffEditorThemes: Record<string, editor.IStandaloneThemeData> = {
  [AGENTHUB_DIFF_LIGHT]: {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'attribute.name', foreground: '8E1616' },
      // Light CSS values retain blue syntax while clearing the actual stacked
      // deleted-character background (#ffa3a3) seen in the focus-review CI.
      { token: 'attribute.value.css', foreground: '033E80' },
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
    ],
    colors: {},
  },
};
