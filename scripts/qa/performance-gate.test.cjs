const { test } = require('node:test');
const assert = require('node:assert/strict');
const { thresholds } = require('./performance-gate.cjs');

test('performance thresholds match the approved v1.0 gate', () => {
  assert.deepEqual(thresholds, {
    homeLcpMs: 2000,
    routeVisibleMs: 250,
    inputResponseMs: 100,
    gitTreeBuildMs: 50,
    sessionFilterMs: 50,
    minFps: 40,
  });
});
