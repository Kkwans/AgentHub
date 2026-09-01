#!/usr/bin/env node
/* global Buffer, URL, console, process */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const strictWarnings = process.argv.includes('--strict-warnings');
const sourceRoots = ['apps/web/src', 'packages/ui/src'];
const limits = {
  workspaceShellBytes: 16 * 1024,
  singleComponentBytes: 12 * 1024,
  warningBytes: 25 * 1024,
  failureBytes: 40 * 1024,
  // The reduced-motion root contract must override component transition
  // declarations; all feature CSS is expected to stay free of !important.
  importantCount: 4,
};

const files = [];
for (const sourceRoot of sourceRoots) {
  await collectCss(resolve(root, sourceRoot));
}

const records = [];
const errors = [];
const warnings = [];
for (const file of files.sort()) {
  const text = await readFile(file, 'utf8');
  const path = relative(root, file);
  const bytes = Buffer.byteLength(text, 'utf8');
  const importantCount = (text.match(/!important\b/g) ?? []).length;
  const isWorkspaceShell = path === 'apps/web/src/features/workspace/workspace.module.css';
  const isSingleComponent =
    /(?:sessionRail|terminal|Feedback|AccessGate|agentCenter|home|settings)\.module\.css$/.test(
      path,
    );
  const record = { path, bytes, importantCount, isWorkspaceShell, isSingleComponent };
  records.push(record);

  if (isWorkspaceShell && bytes > limits.workspaceShellBytes) {
    errors.push({
      path,
      rule: 'workspace-shell-bytes',
      actual: bytes,
      maximum: limits.workspaceShellBytes,
    });
  }
  if (isSingleComponent && bytes > limits.singleComponentBytes) {
    errors.push({
      path,
      rule: 'single-component-bytes',
      actual: bytes,
      maximum: limits.singleComponentBytes,
    });
  }
  if (bytes > limits.failureBytes) {
    errors.push({ path, rule: 'module-bytes', actual: bytes, maximum: limits.failureBytes });
  } else if (bytes > limits.warningBytes) {
    warnings.push({
      path,
      rule: 'module-bytes-warning',
      actual: bytes,
      maximum: limits.warningBytes,
    });
  }
  if (importantCount > limits.importantCount) {
    errors.push({
      path,
      rule: 'important-declaration',
      actual: importantCount,
      maximum: limits.importantCount,
    });
  }
  if (text.includes('.ah-compat-')) {
    errors.push({ path, rule: 'compat-selector-residue' });
  }
}

const result = {
  generatedAt: new Date().toISOString(),
  limits,
  files: records,
  warnings,
  errors,
  passed: errors.length === 0 && (!strictWarnings || warnings.length === 0),
};
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;

async function collectCss(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectCss(path);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.css')) {
      const info = await stat(path);
      if (info.isFile()) files.push(path);
    }
  }
}

export { limits };
