import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./taskStartAttemptsPanel.module.css', import.meta.url), 'utf8');

it('启动记录复用详情横向缩进，保留独立使用和纵向20px间距', () => {
  const panel = css.match(/\.panel\s*\{([^}]+)\}/)?.[1];
  expect(panel).toBeDefined();
  expect(panel).toContain('padding: 20px var(--task-inspector-inset, 20px)');
  expect(panel).toContain('min-width: 0');
  expect(panel).toContain('box-sizing: border-box');
  expect(panel).toContain('border-top: 1px solid var(--ah-border-subtle)');
});
