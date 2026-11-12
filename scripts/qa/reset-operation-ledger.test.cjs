/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');

// Inspect the reset plan, never import/execute the destructive operations script.
const source = readFileSync(resolve(__dirname, '../ops/reset-project-data.ts'), 'utf8');
test('manual reset inventories ledger and explicitly warns that idempotency history is revoked', () => {
  assert.match(source, /const projectScopedTables = \[[\s\S]*?'task_creation_operations'/);
  assert.match(source, /清空会删除目标项目的任务创建操作账本并撤销其幂等历史/);
  assert.match(source, /const execute = process\.argv\.slice\(2\)\.includes\('--execute'\)/);
});
test('ledger deletion is scoped to the same projects and precedes Task deletion inside existing transaction', () => {
  const plan = source.slice(source.indexOf('async function databaseTransaction('));
  const ledger = '`delete from task_creation_operations where project_id in ${list}`';
  const tasks = '`delete from tasks where project_id in ${list}`';
  assert.ok(plan.indexOf(ledger) >= 0);
  assert.ok(plan.indexOf(ledger) < plan.indexOf(tasks));
  assert.match(plan, /\.transaction\(async \(transaction\) =>/);
  assert.equal((source.match(/delete from task_creation_operations/g) || []).length, 1);
});
