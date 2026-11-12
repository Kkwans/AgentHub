/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const css = fs.readFileSync(
  path.join(root, 'apps/web/src/features/workspace/workspace.module.css'),
  'utf8',
);
const view = fs.readFileSync(
  path.join(root, 'apps/web/src/features/workspace/pages/WorkspaceView.tsx'),
  'utf8',
);

test('WorkspaceView local module references retain a CSS definition', () => {
  const references = [...view.matchAll(/workspaceStyles\.([A-Za-z]\w*)/g)].map((match) => match[1]);
  assert.ok(references.length > 0);
  for (const name of references) assert.match(css, new RegExp(`\\.${name}(?=[\\s:{.,>])`));
});

test('Workspace keeps terminal expansion, focus, mobile tabs and resize affordances', () => {
  for (const selector of [
    ':global(.workspace-terminal-slot)',
    ':global(.workspace-terminal-slot .terminal-dock-shell.expanded)',
    ':global(.workspace-terminal-slot:has(.terminal-dock-shell.expanded) .terminal-dock-shell)',
    '.workspace :global(button:focus-visible)',
    '.mobileTabs button',
    ".workspace :global(.three-column-split > [role='separator'][aria-orientation='vertical'])",
  ])
    assert.ok(css.includes(selector), `Missing active selector: ${selector}`);
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(css.includes('@media (max-width: 767px)'));
});
