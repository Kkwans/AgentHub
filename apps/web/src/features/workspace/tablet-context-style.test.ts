import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./codexWorkbench.module.css', import.meta.url), 'utf8');
const tablet = css.slice(css.lastIndexOf('@media (min-width: 768px) and (max-width: 1179px)'));
const rule = (selector: string) => {
  const start = tablet.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  return tablet.slice(tablet.indexOf('{', start) + 1, tablet.indexOf('}', start));
};

describe('tablet Agent context shrink boundary', () => {
  it('bounds every nested summary wrapper without clipping the disclosure popover', () => {
    expect(rule('.workspace-context-disclosure)')).toContain('min-width: 80px');
    expect(rule('.workspace-context-disclosure)')).not.toContain('overflow');
    for (const selector of [
      '.workspace-context-disclosure > .ah-workbench-disclosure-summary)',
      '.workspace-context-disclosure .ah-workbench-disclosure-summary-content)',
      '.workspace-context-disclosure-summary)',
    ]) {
      expect(rule(selector)).toContain('width: 100%');
      expect(rule(selector)).toContain('min-width: 0');
    }
    expect(rule('.workspace-context-disclosure > .ah-workbench-disclosure-summary)')).toContain(
      'min-height: 44px',
    );
    expect(rule('.workspace-context-disclosure-summary)')).toContain('min-height: 44px');
  });

  it('ellipsizes only the optional visual name, preserving Agent identity and full source text', () => {
    expect(rule('.workspace-context-disclosure-summary > span)')).toContain('flex-shrink: 0');
    const name = rule('.workspace-context-disclosure-summary small)');
    expect(name).toContain('flex: 1 1 auto');
    expect(name).toContain('text-overflow: ellipsis');
    expect(tablet).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    const view = readFileSync(new URL('./pages/WorkspaceView.tsx', import.meta.url), 'utf8');
    expect(view).toContain("<small>{agent?.name ?? 'Agent 未绑定'}</small>");
    expect(view).toContain("<Bot size={14} /> {agent?.name ?? 'Agent 未知'}");
  });
});
