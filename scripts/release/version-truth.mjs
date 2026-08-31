#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const expected = process.argv[2] || process.env.AGENTHUB_EXPECTED_VERSION;
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const workspacePatterns = await readWorkspacePatterns();
const packagePaths = [];
for (const pattern of workspacePatterns) {
  if (!pattern.endsWith('/*')) {
    throw new Error(`unsupported workspace pattern: ${pattern}`);
  }
  const prefix = pattern.replace(/\/\*$/, '');
  const entries = await readdir(join(root, prefix), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    packagePaths.push(join(prefix, entry.name, 'package.json'));
  }
}

const records = [{ path: 'package.json', version: packageJson.version }];
for (const relative of packagePaths.sort()) {
  try {
    const manifest = JSON.parse(await readFile(join(root, relative), 'utf8'));
    records.push({ path: relative, version: manifest.version });
  } catch (error) {
    // A missing manifest is not a package; malformed/unreadable manifests must fail closed.
    if (error?.code !== 'ENOENT') throw error;
  }
}

const baseline = expected || packageJson.version;
const mismatches = records.filter((record) => record.version !== baseline);
const result = {
  scope:
    'workspace-package-consistency-only; runtime/UI/OCI versions require the release inventory',
  expected: baseline,
  workspacePatterns,
  packageCount: records.length,
  records,
  passed: mismatches.length === 0,
};
console.log(JSON.stringify(result, null, 2));
if (mismatches.length) {
  console.error(
    `version truth failed: ${mismatches.map((record) => `${record.path}=${record.version}`).join(', ')}`,
  );
  process.exitCode = 1;
}

async function readWorkspacePatterns() {
  try {
    const workspaceYaml = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
    const patterns = [];
    let inPackages = false;
    for (const line of workspaceYaml.split(/\r?\n/)) {
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
    if (!patterns.length) throw new Error('pnpm-workspace.yaml has no package patterns');
    return patterns;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (Array.isArray(packageJson.workspaces) && packageJson.workspaces.length) {
    return packageJson.workspaces;
  }
  throw new Error('workspace package patterns are not configured');
}
