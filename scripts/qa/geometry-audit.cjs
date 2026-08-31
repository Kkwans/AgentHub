#!/usr/bin/env node

/**
 * Validate the machine-readable layout findings emitted by the real visual gate.
 * This script intentionally consumes reports instead of making product-specific
 * assumptions about DOM class names.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { flattenPages, completenessErrors } = require('./visual-evidence.cjs');

const reportPath = process.argv[2] || process.env.AGENTHUB_GEOMETRY_REPORT || '';
const outputPath = process.argv[3] || process.env.AGENTHUB_GEOMETRY_OUTPUT || '';
if (!reportPath) {
  throw new Error('usage: pnpm qa:geometry <audit.json> [geometry.json]');
}

const resolved = path.resolve(reportPath);
const report = JSON.parse(fs.readFileSync(resolved, 'utf8'));
const pages = flattenPages(report);

if (!pages.length) throw new Error(`geometry report has no pages: ${resolved}`);

const violations = completenessErrors(report).map((rule) => ({ snapshot: 'matrix', rule }));
for (const page of pages) {
  const layout = page.layout || {};
  const snapshot = `${page.theme || 'unknown'}/${page.viewport || 'unknown'} ${page.route}`;
  const filename = page.filename || page.fileName || '';
  if (
    !filename ||
    path.basename(filename) !== filename ||
    !filename.endsWith('.png') ||
    !fs.existsSync(path.join(path.dirname(resolved), filename))
  ) {
    violations.push({ snapshot, rule: 'screenshot-file-missing' });
  }
  for (const field of ['consoleErrors', 'pageErrors', 'failedRequests']) {
    if (!Array.isArray(page[field])) violations.push({ snapshot, rule: `${field}-missing` });
    else if (page[field].length)
      violations.push({ snapshot, rule: field, count: page[field].length });
  }
  if (layout.resolvedTheme !== page.theme) violations.push({ snapshot, rule: 'theme-mismatch' });
  if (!layout.geometry) violations.push({ snapshot, rule: 'geometry-unmeasured' });
  for (const check of layout.geometry?.checks || []) {
    if (!Number.isFinite(check.actual) || check.actual > check.maximum) {
      violations.push({ snapshot, rule: check.rule, actual: check.actual, maximum: check.maximum });
    }
  }
  if (layout.horizontalOverflow) {
    violations.push({ snapshot, rule: 'horizontal-overflow' });
  }
  if (layout.hiddenFocus) violations.push({ snapshot, rule: 'hidden-focus-target' });
  if (layout.unnamedButtons > 0) {
    violations.push({
      snapshot,
      rule: 'unnamed-buttons',
      count: layout.unnamedButtons,
    });
  }
}

const result = {
  sourceReport: path.relative(process.cwd(), resolved),
  snapshotCount: pages.length,
  passed: violations.length === 0,
  releaseReady: false,
  violations,
  unverifiedStates: report.unverifiedStates || [],
  unmeasuredRules: [...new Set(pages.flatMap((page) => page.layout?.geometry?.unmeasured || []))],
  scope: 'baseline measurements; not the complete v1 release geometry gate',
};
if (outputPath) {
  const resolvedOutput = path.resolve(outputPath);
  fs.writeFileSync(resolvedOutput, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  writeChecksums(path.dirname(resolvedOutput));
}

if (violations.length) {
  console.error(
    violations
      .map((violation) =>
        violation.count
          ? `${violation.snapshot}: ${violation.rule} (${violation.count})`
          : `${violation.snapshot}: ${violation.rule}`,
      )
      .join('\n'),
  );
  process.exitCode = 1;
} else {
  console.log(`geometry audit passed: ${pages.length} page snapshots`);
}

function writeChecksums(directory) {
  const checksumPath = path.join(directory, 'SHA256SUMS');
  const lines = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== 'SHA256SUMS')
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const digest = crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(directory, name)))
        .digest('hex');
      return `${digest}  ${name}`;
    });
  fs.writeFileSync(checksumPath, `${lines.join('\n')}\n`, 'utf8');
}
