import type { editor } from 'monaco-editor';

export const AGENTHUB_DIFF_LIGHT = 'agenthub-diff-light';
export const AGENTHUB_DIFF_DARK = 'agenthub-diff-dark';

// Keep Monaco's syntax palette and diff backgrounds. Its default bright-red
// attribute/property token fails contrast on the inserted-character highlight.
export const diffEditorThemes: Record<string, editor.IStandaloneThemeData> = {
  [AGENTHUB_DIFF_LIGHT]: {
    base: 'vs',
    inherit: true,
    rules: [{ token: 'attribute.name', foreground: '8E1616' }],
    colors: {},
  },
  [AGENTHUB_DIFF_DARK]: {
    base: 'vs-dark',
    inherit: true,
    rules: [{ token: 'attribute.name', foreground: '9CDCFE' }],
    colors: {},
  },
};
