/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('body-portaled Select remains above modal and drawer surfaces', () => {
  const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const token = (name: string) => Number(tokens.match(new RegExp(name + ':\\s*(\\d+)'))?.[1]);
  expect(token('--ah-z-modal-popover')).toBeGreaterThan(token('--ah-z-modal'));
  for (const selector of ['ah-dialog-backdrop', 'ah-drawer-backdrop']) {
    expect(styles.match(new RegExp('\\.' + selector + ' \\{([^}]+)'))?.[1]).toContain(
      'z-index: var(--ah-z-modal)',
    );
  }
});
