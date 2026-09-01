import { describe, expect, it } from 'vitest';

import { languageForPath } from './DiffViewer';

describe('languageForPath', () => {
  it('根据仓库文件扩展名选择 Monaco 语言，未知类型回退纯文本', () => {
    expect(languageForPath('apps/web/src/App.tsx')).toBe('typescript');
    expect(languageForPath('scripts/release/version-truth.mjs')).toBe('javascript');
    expect(languageForPath('docs/README.md')).toBe('markdown');
    expect(languageForPath('assets/archive.bin')).toBe('plaintext');
    expect(languageForPath(undefined)).toBe('plaintext');
  });
});
