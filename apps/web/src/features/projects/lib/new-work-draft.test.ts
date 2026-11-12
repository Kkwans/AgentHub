import { describe, expect, it } from 'vitest';
import { prepareNewWork, suggestTaskTitle } from './new-work-draft';
describe('任务短标题与完整说明', () => {
  it('仅摘要列表标题，完整多行要求和补充上下文原样保留', () => {
    const instructions = `${'长'.repeat(241)}\n第二行要求`;
    const value = prepareNewWork({ kind: 'task', instructions, supplemental: '约束原文' });
    expect(value.title).toBe(`${'长'.repeat(119)}…`);
    expect(value.description).toBe(`任务要求：\n${instructions}\n\n补充上下文：\n约束原文`);
    expect(value.error).toBeNull();
  });
  it('按 UTF16 预算生成标题但不切断 Unicode 码点', () => {
    const title = suggestTaskTitle('😀'.repeat(121));
    expect(title).toBe(`${'😀'.repeat(59)}…`);
    expect(title.length).toBeLessThanOrEqual(120);
    expect(
      prepareNewWork({
        kind: 'task',
        instructions: '正文',
        supplemental: '',
        shortTitle: '😀'.repeat(121),
      }).error,
    ).toContain('240');
  });
  it('允许显式标题，100000预算包含格式标签', () => {
    const base = { kind: 'task' as const, supplemental: '', shortTitle: '人工标题' };
    const value = prepareNewWork({ ...base, instructions: '文'.repeat(99994) });
    expect(value.description).toHaveLength(100000);
    expect(value.error).toBeNull();
    expect(value.title).toBe('人工标题');
    expect(prepareNewWork({ ...base, instructions: '文'.repeat(99995) }).error).toContain('100000');
  });
  it('Goal 使用独立标题与补充说明限额，不偷换成 Task 模型', () => {
    expect(
      prepareNewWork({ kind: 'goal', instructions: '标'.repeat(241), supplemental: '' }).error,
    ).toContain('Goal 标题');
    expect(
      prepareNewWork({ kind: 'goal', instructions: '标题', supplemental: '文'.repeat(20001) })
        .error,
    ).toContain('20000');
    expect(prepareNewWork({ kind: 'goal', instructions: '标题', supplemental: '说明' })).toEqual({
      title: '标题',
      description: '说明',
      error: null,
    });
  });
});
