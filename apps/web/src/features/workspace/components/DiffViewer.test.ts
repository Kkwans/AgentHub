import { describe, expect, it } from 'vitest';

import { isBinaryPatch, languageForPath, summarizeDiff } from './DiffViewer';

describe('languageForPath', () => {
  it('根据仓库文件扩展名选择 Monaco 语言，未知类型回退纯文本', () => {
    expect(languageForPath('apps/web/src/App.tsx')).toBe('typescript');
    expect(languageForPath('scripts/release/version-truth.mjs')).toBe('javascript');
    expect(languageForPath('docs/README.md')).toBe('markdown');
    expect(languageForPath('assets/archive.bin')).toBe('plaintext');
    expect(languageForPath(undefined)).toBe('plaintext');
  });

  it('识别二进制 Diff，并统计受控预览中的增删行', () => {
    expect(isBinaryPatch('Binary files a/logo.png and b/logo.png differ')).toBe(true);
    expect(isBinaryPatch('@@ -1 +1 @@\n-old\n+new')).toBe(false);
    expect(summarizeDiff('--- a/app.ts\n+++ b/app.ts\n-old\n+new\n+second')).toEqual({
      additions: 2,
      deletions: 1,
    });
  });
});
