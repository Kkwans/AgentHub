#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const thresholds = {
  homeLcpMs: 2_000,
  routeVisibleMs: 250,
  inputResponseMs: 100,
  gitTreeBuildMs: 50,
  sessionFilterMs: 50,
  minFps: 40,
};

if (require.main === module) {
  const reportPath = process.argv[2] || process.env.AGENTHUB_PERFORMANCE_REPORT || '';
  if (!reportPath) {
    const result = {
      passed: false,
      status: 'UNVERIFIED',
      thresholds,
      metrics: {},
      errors: ['performance report is required; run the real NAS performance capture first'],
    };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 2;
  } else {
    const resolved = path.resolve(reportPath);
    const input = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const metrics = input.metrics ?? input;
    const errors = [];
    const missing = [];
    for (const key of Object.keys(thresholds)) {
      const value = Number(metrics[key]);
      if (!Number.isFinite(value)) {
        missing.push(key);
        continue;
      }
      const passes = key === 'minFps' ? value >= thresholds[key] : value <= thresholds[key];
      if (!passes) errors.push({ metric: key, actual: value, threshold: thresholds[key] });
    }
    const result = {
      sourceReport: path.relative(process.cwd(), resolved),
      status: missing.length ? 'UNVERIFIED' : errors.length ? 'FAILED' : 'PASSED',
      thresholds,
      metrics,
      missing,
      errors,
      passed: missing.length === 0 && errors.length === 0,
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = missing.length ? 2 : 1;
  }
}

module.exports = { thresholds };
