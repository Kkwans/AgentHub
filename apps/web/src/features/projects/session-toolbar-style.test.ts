import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./sessionToolbar.module.css', import.meta.url), 'utf8');
const scoped = css.slice(css.indexOf('/* Keep the session filters together'));
const desktop = scoped.slice(0, scoped.indexOf('/* At narrow tablet widths'));
const tablet = scoped.slice(scoped.indexOf('/* At narrow tablet widths'));

function rule(source: string, selector: string) {
  const start = source.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(source.indexOf('{', start) + 1, source.indexOf('}', start));
}

describe('session toolbar responsive filter grouping', () => {
  it('keeps desktop filters intrinsic and assigns spare width to search, not an empty spacer', () => {
    expect(desktop).toContain('@media (min-width: 768px)');
    const group = rule(desktop, '.toolbar .filters');
    expect(group).toContain('flex: 0 0 auto');
    expect(group).toContain('flex-wrap: nowrap');
    const select = rule(desktop, '.toolbar .select');
    expect(select).toContain('flex: 0 0 150px');
    expect(select).toContain('min-width: 0');
    expect(rule(desktop, '.toolbar .search')).toContain('flex: 1 1 220px');
    expect(rule(desktop, '.toolbar .spacer')).toContain('display: none');
  });

  it('moves the entire pair to a fluid second row on narrow tablets without changing phones', () => {
    expect(tablet).toContain('@media (min-width: 768px) and (max-width: 959px)');
    const group = rule(tablet, '.toolbar .filters');
    expect(group).toContain('order: 1');
    expect(group).toContain('flex: 1 0 100%');
    expect(rule(tablet, '.toolbar .select')).toContain('flex: 1 1 0');
    expect(scoped).not.toMatch(/\.projectsToolbar|\.workToolbar|\[hidden\]|max-width: 767px/);
    // Existing phone disclosure remains responsible for visibility and layout.
    const existing = readFileSync(new URL('./projects.module.css', import.meta.url), 'utf8');
    expect(existing).toMatch(/\.sessionFilterOptions\[hidden\]\s*\{\s*display: none;/);
    expect(existing).toMatch(
      /@media \(max-width: 767px\)\s*\{\s*\.sessionFilterOptions\s*\{\s*flex: 1 1 100%;/,
    );
  });
});

it('applies the scoped module alongside every existing toolbar class', () => {
  const view = readFileSync(new URL('./pages/ProjectSessionsPage.tsx', import.meta.url), 'utf8');
  expect(view).toContain("import sessionToolbar from '../sessionToolbar.module.css'");
  for (const [existing, scoped, count] of [
    ['sessionsToolbar', 'toolbar', 1],
    ['toolbarSearch', 'search', 1],
    ['sessionFilterOptions', 'filters', 1],
    ['toolbarSelect', 'select', 2],
    ['toolbarSpacer', 'spacer', 1],
  ] as const) {
    const classes = '${projectsStyles.' + existing + '} ${sessionToolbar.' + scoped + '}';
    expect(view.split(classes).length - 1).toBe(count);
  }
});
