const { test } = require('node:test');
const assert = require('node:assert/strict');
/* global __dirname */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('css budget emits machine-readable ownership results', () => {
  const root = path.resolve(__dirname, '../..');
  const result = spawnSync(process.execPath, ['scripts/qa/css-budget.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined);
  const report = JSON.parse(result.stdout);
  assert.ok(Array.isArray(report.files));
  assert.ok(report.files.some((entry) => entry.path.endsWith('workspace.module.css')));
  assert.ok(Array.isArray(report.warnings));
  assert.ok(Array.isArray(report.errors));
});
