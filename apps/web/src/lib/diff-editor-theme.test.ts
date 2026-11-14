import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENTHUB_DIFF_DARK, AGENTHUB_DIFF_LIGHT, diffEditorThemes } from './diff-editor-theme';

function rgb(hex: string): number[] {
  return hex
    .replace('#', '')
    .match(/../g)!
    .map((value) => parseInt(value, 16));
}
function luminance(color: number[]): number {
  return color
    .map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
}
function contrast(foreground: string, background: number[]): number {
  const values = [luminance(rgb(foreground)), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}
function over(base: number[], foreground: string, alpha: number): number[] {
  return rgb(foreground).map((channel, index) =>
    Math.round(channel * alpha + base[index]! * (1 - alpha)),
  );
}

describe('review-specific syntax contrast', () => {
  it.each([
    [AGENTHUB_DIFF_LIGHT, 'ffffff', 0.25],
    [AGENTHUB_DIFF_DARK, '1e1e1e', 0.2],
  ] as const)(
    '%s keeps readable syntax on unchanged/added/removed line and character backgrounds',
    (name, baseHex, alpha) => {
      const theme = diffEditorThemes[name]!;
      const foreground = theme.rules.find((rule) => rule.token === 'attribute.name')!.foreground!;
      const base = rgb(baseHex);
      const inserted = over(base, '9bb955', 0.2);
      const removed = over(base, 'ff0000', 0.2);
      for (const bg of [
        base,
        inserted,
        removed,
        over(inserted, '9ccc2c', alpha),
        over(removed, 'ff0000', 0.2),
      ]) {
        expect(contrast(foreground, bg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(theme.inherit).toBe(true);
      expect(theme.colors).toEqual({}); // Never remove insertion/deletion highlights.
      expect(theme.rules).toHaveLength(name === AGENTHUB_DIFF_LIGHT ? 2 : 4);
    },
  );
  it('keeps CSS identifier values readable on actual dark CI inserted/deleted character backgrounds', () => {
    const theme = diffEditorThemes[AGENTHUB_DIFF_DARK]!;
    const valueColor = theme.rules.find(
      (rule) => rule.token === 'attribute.value.css',
    )!.foreground!;
    // 42022db dark failure: block was CE9178 on 6f1313; grid on 4b5a2a.
    const base = rgb('1e1e1e');
    const inserted = over(base, '9bb955', 0.2);
    const removed = over(base, 'ff0000', 0.2);
    for (const background of [
      rgb('6f1313'),
      rgb('4b5a2a'),
      base,
      inserted,
      removed,
      over(inserted, '9ccc2c', 0.2),
      over(removed, 'ff0000', 0.2),
    ]) {
      expect(contrast(valueColor, background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('CE9178', rgb('4b5a2a'))).toBeLessThan(4.5);
    expect(theme.colors).toEqual({});
    expect(theme.rules.map((rule) => rule.token)).toEqual([
      'attribute.name',
      'attribute.value.css',
      'keyword.ts',
      'string.ts',
    ]);
    expect(diffEditorThemes[AGENTHUB_DIFF_LIGHT]!.rules.map((rule) => rule.token)).toEqual([
      'attribute.name',
      'attribute.value.css',
    ]);
  });
  it('keeps light CSS values readable on the exact stacked deleted-character CI background', () => {
    const theme = diffEditorThemes[AGENTHUB_DIFF_LIGHT]!;
    const color = theme.rules.find((rule) => rule.token === 'attribute.value.css')!.foreground!;
    // f9efbde CI 43486971598: block (#0451a5) on #ffa3a3 scored 4.04.
    expect(contrast('0451A5', rgb('ffa3a3'))).toBeLessThan(4.5);
    const base = rgb('ffffff');
    const inserted = over(base, '9bb955', 0.2);
    const removed = over(base, 'ff0000', 0.2);
    for (const background of [
      rgb('ffa3a3'),
      rgb('ebf1dc'),
      rgb('d7e8b0'),
      base,
      inserted,
      removed,
      over(inserted, '9ccc2c', 0.25),
      over(removed, 'ff0000', 0.2),
    ])
      expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
    expect(theme.colors).toEqual({});
    expect(
      theme.rules.some((rule) =>
        ['attribute.value', 'keyword', 'string', 'number'].includes(rule.token),
      ),
    ).toBe(false);
    expect(
      diffEditorThemes[AGENTHUB_DIFF_DARK]!.rules.find(
        (rule) => rule.token === 'attribute.value.css',
      )!.foreground,
    ).toBe('F4C7AF');
  });
  it('fixes the actual TSX const contrast without broadening to JS or numbers', () => {
    const theme = diffEditorThemes[AGENTHUB_DIFF_DARK]!;
    const color = theme.rules.find((rule) => rule.token === 'keyword.ts')!.foreground!;
    const base = rgb('1e1e1e');
    const added = over(base, '9bb955', 0.2);
    const removed = over(base, 'ff0000', 0.2);
    // c8d1ab2 390dark actual const node: #569cd6 on #373d29, ratio ~3.82.
    expect(contrast('569CD6', rgb('373d29'))).toBeLessThan(4.5);
    for (const background of [
      rgb('373d29'),
      base,
      added,
      removed,
      over(added, '9ccc2c', 0.2),
      over(removed, 'ff0000', 0.2),
    ]) {
      expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      theme.rules.some((rule) =>
        ['keyword', 'keyword.js', 'number.ts'].includes(rule.token),
      ),
    ).toBe(false);
    expect(theme.colors).toEqual({});
    expect(diffEditorThemes[AGENTHUB_DIFF_LIGHT]!.rules.map((rule) => rule.token)).toEqual([
      'attribute.name',
      'attribute.value.css',
    ]);
  });
  it('keeps TSX strings readable on exact dark deleted and inserted character backgrounds', () => {
    const theme = diffEditorThemes[AGENTHUB_DIFF_DARK]!;
    const color = theme.rules.find((rule) => rule.token === 'string.ts')!.foreground!;
    expect(contrast('CE9178', rgb('6f1313'))).toBeLessThan(4.5);
    for (const bg of ['1e1e1e', '6f1313', '4b5a2a', '373d29'])
      expect(contrast(color, rgb(bg))).toBeGreaterThanOrEqual(4.5);
    expect(theme.rules.some((rule) => ['string', 'string.js'].includes(rule.token))).toBe(false);
    expect(theme.colors).toEqual({});
  });
  it('covers the exact light axe backgrounds and preserves distinct property hue', () => {
    const color = diffEditorThemes[AGENTHUB_DIFF_LIGHT]!.rules[0]!.foreground!;
    for (const background of ['ebf1dc', 'd7e8b0'])
      expect(contrast(color, rgb(background))).toBeGreaterThanOrEqual(4.5);
    expect(color).not.toBe('000000');
    expect(diffEditorThemes[AGENTHUB_DIFF_DARK]!.rules[0]!.foreground).toBe('9CDCFE');
  });
  it('uses a scoped deletion color with readable selected-row contrast, leaving dark danger unchanged', () => {
    const css = readFileSync(
      new URL('../features/workspace/inspector.module.css', import.meta.url),
      'utf8',
    );
    const color = css.match(/git-change-state \.deletions\)\s*\{\s*color:\s*(#[a-f0-9]+);/)![1]!;
    for (const bg of ['ffffff', 'f7f7f7', 'ededed'])
      expect(contrast(color, rgb(bg))).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain("[data-agenthub-theme='dark'] .workspace");
    expect(css).toContain(':global(.dark .workspace) :global(.git-change-state .deletions)');
    for (const bg of ['171717', '292929'])
      expect(contrast('ff7d83', rgb(bg))).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps the Diff preview action readable on selected rows without changing global tertiary', () => {
    const css = readFileSync(
      new URL('../features/workspace/inspector.module.css', import.meta.url),
      'utf8',
    );
    const rule = css.match(
      /:global\(\.workspace\) :global\(\.git-change-preview\)\s*\{([^}]+)\}/,
    )![1]!;
    expect(rule).toContain('color: var(--ah-text-secondary)');
    expect(rule).toContain('background: transparent');
    const theme = readFileSync(new URL('../app/codex-theme.css', import.meta.url), 'utf8');
    const colors = [...theme.matchAll(/--ah-text-secondary:\s*(#[a-f0-9]+);/g)].map(
      (match) => match[1]!,
    );
    // ba8f625 real axe: selected preview #6e6e6e on #ededed was 4.35.
    expect(contrast('6e6e6e', rgb('ededed'))).toBeLessThan(4.5);
    for (const bg of ['ffffff', 'f5f5f5', 'ededed'])
      expect(contrast(colors[0]!, rgb(bg))).toBeGreaterThanOrEqual(4.5);
    for (const bg of ['171717', '292929', '383838'])
      expect(contrast(colors[1]!, rgb(bg))).toBeGreaterThanOrEqual(4.5);
    expect(theme).toContain('--ah-text-tertiary: #6e6e6e;');
  });
});
