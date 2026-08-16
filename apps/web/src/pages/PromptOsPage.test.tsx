import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PromptOS v0.6 ordinary-user contracts', () => {
  it('uses shared dialog/select flows instead of exposing raw binding enums', () => {
    const source = [
      readFileSync(new URL('./PromptOsPage.tsx', import.meta.url), 'utf8'),
      readFileSync(
        new URL('../features/promptos/components/PromptOsSections.tsx', import.meta.url),
        'utf8',
      ),
    ].join('\n');

    expect(source).toContain('新建 Prompt 绑定');
    expect(source).toContain('新建 Skill 绑定');
    expect(source).toContain('labelPromptBindingTarget');
    expect(source).toContain('labelPromptBindingSlot');
    expect(source).toContain('bindingSelectorLabel');
    expect(source).toContain('优先级：{binding.priority}');
    expect(source).toContain('PromptVariableEditor');
    expect(source).toContain('字段编辑');
    expect(source).toContain('通过任务名称选择');
    expect(source).not.toContain('<option>PROJECT</option>');
    expect(source).not.toContain('<option>AGENT</option>');
    expect(source).not.toContain('<option> TASK </option>');
    expect(source).not.toContain('<strong>{prompt.type} content</strong>');
    expect(source).not.toContain('可选 UUID');
    expect(source).not.toContain('binding.versionId?.slice');
  });
});
