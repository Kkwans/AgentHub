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
      expect(theme.rules).toHaveLength(1);
    },
  );
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
});
