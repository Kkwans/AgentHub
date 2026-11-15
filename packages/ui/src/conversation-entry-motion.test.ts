import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('./pinharness.css', import.meta.url), 'utf8');
const conversation = readFileSync(
  new URL(
    '../../../apps/web/src/features/workspace/components/ChatConversationView.tsx',
    import.meta.url,
  ),
  'utf8',
);
const entries = readFileSync(
  new URL(
    '../../../apps/web/src/features/workspace/components/ChatEntryRenderer.tsx',
    import.meta.url,
  ),
  'utf8',
);
const keyframes = (name: string) => {
  const start = css.indexOf(`@keyframes ${name} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  const opening = css.indexOf('{', start);
  for (let index = opening; index < css.length; index++) {
    if (css[index] === '{') depth++;
    if (css[index] === '}' && --depth === 0) return css.slice(opening, index + 1);
  }
  throw new Error(`Unclosed keyframes ${name}`);
};

it('fades remountable conversation content without changing its measured geometry', () => {
  const fade = keyframes('conversation-entry-fade');
  expect(fade).toContain('opacity: 0');
  expect(fade).toContain('opacity: 1');
  const declarations = [...fade.matchAll(/([\w-]+)\s*:/g)].map((match) => match[1]);
  expect(declarations).toEqual(['opacity', 'opacity']);
});

it('changes only the two content entrance contracts and preserves their timing and reduced-motion opt-out', () => {
  expect(conversation).toContain(
    'animate-[conversation-entry-fade_var(--anim-entry-fast)_var(--ease-out-expo)_both] motion-reduce:animate-none',
  );
  expect(entries).toContain(
    'animate-[conversation-entry-fade_200ms_ease-out_both] motion-reduce:animate-none',
  );
  expect(conversation).not.toContain('animate-[hci-entry_');
  expect(entries).not.toContain('animate-[hci-entry_');
  // This translation is the virtual layout position, NOT an entrance effect.
  expect(conversation).toContain('transform: `translateY(${virtualItem.start}px)`');
  expect(keyframes('hci-entry')).toContain('transform: translateY(4px)');
  expect(keyframes('hci-entry')).toContain('transform: translateY(0)');
});
