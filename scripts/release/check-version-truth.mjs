#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const allowIncomplete = process.argv.includes('--allow-incomplete');
const versionArgument = process.argv.slice(2).find((value) => !value.startsWith('--'));
const expected = versionArgument || process.env.AGENTHUB_EXPECTED_VERSION || '1.0.0';
const appBadge = 'v' + expected.split('.').slice(0, 2).join('.');
const errors = [];

const packageJson = await readJson('package.json');
const packagePaths = await readWorkspacePackagePaths(packageJson);
const records = [{ path: 'package.json', version: packageJson.version }];
for (const relative of packagePaths.sort()) {
  try {
    const manifest = await readJson(relative);
    records.push({ path: relative, version: manifest.version });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
for (const record of records) {
  if (record.version !== expected) {
    errors.push(record.path + ' version=' + String(record.version));
  }
}

await requireText('packages/shared/src/index.ts', "AGENTHUB_VERSION = '" + expected + "'");
await requireText('apps/web/src/app/shell/AppShell.tsx', '>' + appBadge + '<');
await requireText('README.md', 'v' + expected);
await requireText('README.md', 'agenthub:' + expected);
await requireText('CHANGELOG.md', '## ' + expected);
await requireText('deploy/compose/docker-compose.yml', 'agenthub:' + expected);
await requireText('deploy/compose/.env.example', 'AGENTHUB_VERSION=' + expected);

const releaseDoc = 'docs/RELEASE-v' + expected + '.md';
const releaseDocText = await tryRead(releaseDoc);
if (releaseDocText === null) errors.push('missing ' + releaseDoc);
else if (!releaseDocText.includes('AgentHub v' + expected))
  errors.push(releaseDoc + ' missing title');

const manifestPath = 'docs/qa/visual/v' + expected + '/manifest.json';
const manifestText = await tryRead(manifestPath);
if (manifestText === null) {
  errors.push('missing ' + manifestPath);
} else {
  try {
    const manifest = JSON.parse(manifestText);
    if (manifest.releaseVersion !== expected)
      errors.push(manifestPath + ' releaseVersion mismatch');
    if (manifest.complete !== true && !allowIncomplete)
      errors.push(manifestPath + ' is not complete');
  } catch {
    errors.push(manifestPath + ' is not valid JSON');
  }
}

const scanRoots = ['apps', 'packages', 'scripts', 'deploy', 'tests'];
const scanFiles = ['README.md'];
for (const scanRoot of scanRoots) {
  scanFiles.push(...(await collectTextFiles(scanRoot)));
}
const residuePattern = /v0\.(?:6|7|8|9)(?=\b|[.-])|\b0\.(?:6|7|8|9)\.0\b/g;
const residues = [];
for (const relative of [...new Set(scanFiles)].sort()) {
  if (relative === 'CHANGELOG.md') continue;
  const text = await tryRead(relative);
  if (text === null) continue;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (residuePattern.test(line)) {
      residues.push({ path: relative, line: index + 1, text: line.trim().slice(0, 240) });
    }
    residuePattern.lastIndex = 0;
  }
}
for (const residue of residues) {
  errors.push('current residue ' + residue.path + ':' + residue.line + ' ' + residue.text);
}

const result = {
  expected,
  appBadge,
  packageCount: records.length,
  records,
  scannedFiles: scanFiles.length,
  residues,
  allowIncomplete,
  passed: errors.length === 0,
  errors,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;

async function readWorkspacePackagePaths(manifest) {
  let patterns = [];
  try {
    const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
    let inPackages = false;
    for (const line of workspace.split(/\r?\n/)) {
      if (/^packages:\s*$/.test(line)) {
        inPackages = true;
        continue;
      }
      if (!inPackages) continue;
      const entry = line.match(/^\s+-\s+['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/);
      if (entry) {
        patterns.push(entry[1].trim());
        continue;
      }
      if (/^[^\s#]/.test(line)) break;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (!patterns.length && Array.isArray(manifest.workspaces)) patterns = manifest.workspaces;
  const paths = [];
  for (const pattern of patterns) {
    if (!pattern.endsWith('/*')) throw new Error('unsupported workspace pattern: ' + pattern);
    const prefix = pattern.slice(0, -2);
    const entries = await readdir(join(root, prefix), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) paths.push(prefix + '/' + entry.name + '/package.json');
    }
  }
  if (!paths.length) throw new Error('no workspace packages found');
  return paths;
}

async function readJson(relative) {
  return JSON.parse(await readFile(join(root, relative), 'utf8'));
}

async function tryRead(relative) {
  try {
    return await readFile(join(root, relative), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function requireText(relative, expectedText) {
  const text = await tryRead(relative);
  if (text === null) errors.push('missing ' + relative);
  else if (!text.includes(expectedText)) errors.push(relative + ' missing ' + expectedText);
}

async function collectTextFiles(relativeRoot) {
  const result = [];
  async function visit(relative) {
    let entries;
    try {
      entries = await readdir(join(root, relative), { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const child = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        await visit(child);
        continue;
      }
      const name = basename(entry.name);
      if (
        /\.(?:ts|tsx|js|mjs|cjs|json|yml|yaml|env|md)$/.test(name) ||
        name.startsWith('Dockerfile')
      ) {
        result.push(child);
      }
    }
  }
  await visit(relativeRoot);
  return result;
}
