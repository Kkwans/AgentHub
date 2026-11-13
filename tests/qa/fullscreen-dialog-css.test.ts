import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
const css = readFileSync('packages/ui/src/styles.css', 'utf8');
it('fullscreen sizing overrides ordinary/mobile rules without changing ordinary dialogs', () => {
  const fullscreen = css.match(/\.ah-dialog\.ah-dialog-fullscreen\s*\{([^}]+)\}/)?.[1];
  expect(fullscreen).toContain('grid-template-rows: auto minmax(0, 1fr) auto');
  expect(fullscreen).toContain('height: 100dvh');
  expect(fullscreen).toContain('width: 100%');
  expect(fullscreen).toContain('overflow: hidden');
  expect(fullscreen).toContain('safe-area-inset-bottom');
  expect(css.match(/\.ah-dialog-fullscreen > \.ah-dialog-body\s*\{([^}]+)\}/)?.[1]).toContain(
    'align-content: start',
  );
  expect(css.match(/\.ah-dialog-fullscreen > \.ah-dialog-body\s*\{([^}]+)\}/)?.[1]).toContain(
    'overflow: auto',
  );
  expect(css.match(/\.ah-dialog-fullscreen > \.ah-dialog-footer\s*\{([^}]+)\}/)?.[1]).toContain(
    'flex-wrap: wrap',
  );
  expect(css).toContain('max-height: min(760px, calc(100dvh - 32px))');
});
