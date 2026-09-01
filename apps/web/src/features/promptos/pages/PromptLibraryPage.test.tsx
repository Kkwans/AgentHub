import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PromptOS ordinary-user contracts', () => {
  it('uses shared dialog/select flows instead of exposing raw binding enums', () => {
    const source = readFileSync(new URL('./PromptLibraryPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('新建 Prompt 绑定');
    expect(source).toContain('labelPromptBindingTarget');
    expect(source).toContain('labelPromptVersionSource(version.source)');
    expect(source).toContain('position="right"');
    expect(source).toContain('size={420}');
    expect(source).not.toContain('<option>PROJECT</option>');
    expect(source).not.toContain('<option>AGENT</option>');
    expect(source).not.toContain('<strong>{prompt.type} content</strong>');
    expect(source).not.toContain('可选 UUID');
  });
});
