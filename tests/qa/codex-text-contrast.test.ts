import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const theme = readFileSync(resolve('apps/web/src/app/codex-theme.css'), 'utf8');
const rail = readFileSync(
  resolve('apps/web/src/features/workspace/sessionRail.module.css'),
  'utf8',
);
const [light = '', dark = ''] = theme.split(':root.dark');
function token(css: string, name: string) {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match?.[1]) throw new Error(`Missing ${name}`);
  return match[1].trim();
}
function grayHsl(value: string) {
  const match = value.match(/^0 0% (\d+)%$/);
  if (!match?.[1]) throw new Error(`Expected neutral HSL: ${value}`);
  const byte = Math.round(Number(match[1]) * 2.55)
    .toString(16)
    .padStart(2, '0');
  return `#${byte.repeat(3)}`;
}
function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)
    ?.map((value) => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
  if (channels?.length !== 3) throw new Error(`Invalid color ${hex}`);
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high! + 0.05) / (low! + 0.05);
}
it('keeps small SessionRail metadata readable on the observed selected surface and hover', () => {
  expect(rail.match(/:global\(\.session-list code\)\s*\{([^}]+)\}/)?.[1]).toContain(
    'color: var(--ah-text-secondary)',
  );
  // cdaa real axe observed #e6e6e6 selected background, not a guessed white surface.
  for (const background of ['#ffffff', '#e6e6e6', token(light, '--ah-surface-hover')]) {
    expect(contrast(token(light, '--ah-text-secondary'), background)).toBeGreaterThanOrEqual(4.5);
  }
  for (const background of ['#1f1f1f', '#363636', '#424242']) {
    expect(contrast(token(dark, '--ah-text-secondary'), background)).toBeGreaterThanOrEqual(4.5);
  }
});
it('maps dark sidebar group labels to a neutral readable token on the actual sidebar', () => {
  const label = grayHsl(token(dark, '--sidebar-section-label'));
  const background = grayHsl(token(dark, '--sidebar-bg'));
  expect(contrast(label, background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast('#6e737c', '#171717')).toBeLessThan(4.5); // original real axe regression
});
