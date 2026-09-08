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
  // The full PinHarness stylesheet is a deliberate source snapshot rather
  // than an AgentHub-authored module. Keep a bounded, provenance-checked
  // envelope for that file while applying the normal module budget below.
  referenceStylesheetBytes: 128 * 1024,
  referenceStylesheetImportantCount: 200,
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
  const isReferenceStylesheet = path === 'apps/web/src/pinharness/pinharness.css';
  const isWorkspaceShell = path === 'apps/web/src/features/workspace/workspace.module.css';
  const isSingleComponent =
    /(?:sessionRail|terminal|Feedback|AccessGate|agentCenter|home|settings)\.module\.css$/.test(
      path,
    );
  const record = {
    path,
    bytes,
    importantCount,
    isReferenceStylesheet,
    isWorkspaceShell,
    isSingleComponent,
  };
  records.push(record);

  if (isReferenceStylesheet) {
    if (!text.includes('PinHarness source is copied into the AgentHub web bundle')) {
      errors.push({ path, rule: 'reference-provenance' });
    }
    if (bytes > limits.referenceStylesheetBytes) {
      errors.push({
        path,
        rule: 'reference-stylesheet-bytes',
        actual: bytes,
        maximum: limits.referenceStylesheetBytes,
      });
    }
    if (importantCount > limits.referenceStylesheetImportantCount) {
      errors.push({
        path,
        rule: 'reference-stylesheet-important-declaration',
        actual: importantCount,
        maximum: limits.referenceStylesheetImportantCount,
      });
    }
    continue;
  }

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
