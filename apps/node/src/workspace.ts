import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { runProcess } from '@agenthub/agent-core';

import { NodeCommandError } from './node-client.js';

export interface RemoteProjectPreflightReport {
  status: 'READY' | 'BROKEN';
  rootPath: string;
  canonicalRoot: string;
  exists: boolean;
  directory: boolean;
  permissions: { readable: boolean; writable: boolean };
  git: { detected: boolean; root?: string; branch?: string; dirty?: boolean };
  context: {
    agentsMd: boolean;
    claudeMd: boolean;
    openSpec: boolean;
    packageManagers: string[];
  };
  checks: Array<{ id: string; status: 'PASS' | 'WARN' | 'FAIL'; message: string }>;
}

export interface RemoteFileTreeEntry {
  name: string;
  path: string;
  type: 'FILE' | 'DIRECTORY' | 'SYMLINK';
  size: number;
  modifiedAt: string;
  blocked?: boolean;
  children?: RemoteFileTreeEntry[];
}

const TREE_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', '.agenthub']);

export class NodeWorkspace {
  constructor(private readonly allowedRoots: string[]) {}

  async preflight(rootPath: string): Promise<RemoteProjectPreflightReport> {
    const checks: RemoteProjectPreflightReport['checks'] = [];
    this.assertLexicallyAllowed(rootPath);
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(rootPath);
      this.assertCanonicalAllowed(canonicalRoot);
    } catch (error) {
      if (error instanceof NodeCommandError) throw error;
      return failedPreflight(rootPath, checks, 'Project 路径不存在或无法 canonicalize');
    }
    const metadata = await stat(canonicalRoot);
    if (!metadata.isDirectory()) {
      return failedPreflight(rootPath, checks, 'Project root 不是目录', canonicalRoot);
    }
    checks.push({ id: 'path', status: 'PASS', message: '远程 Project 路径通过 realpath 校验' });
    const readable = await canAccess(canonicalRoot, constants.R_OK);
    const writable = await canAccess(canonicalRoot, constants.W_OK);
    checks.push({
      id: 'permissions',
      status: readable && writable ? 'PASS' : readable ? 'WARN' : 'FAIL',
      message: readable
        ? writable
          ? '远程 Project root 可读写'
          : '远程 Project root 只读，Agent 修改可能失败'
        : '远程 Project root 不可读',
    });
    const git = await inspectGit(canonicalRoot);
    checks.push({
      id: 'git',
      status: git.detected ? 'PASS' : 'WARN',
      message: git.detected
        ? `检测到 Git${git.branch ? `，分支 ${git.branch}` : ''}`
        : '未检测到 Git',
    });
    const context = {
      agentsMd: await pathExists(join(canonicalRoot, 'AGENTS.md')),
      claudeMd: await pathExists(join(canonicalRoot, 'CLAUDE.md')),
      openSpec:
        (await pathExists(join(canonicalRoot, 'openspec'))) ||
        (await pathExists(join(canonicalRoot, '.openspec'))),
      packageManagers: await detectPackageManagers(canonicalRoot),
    };
    checks.push({
      id: 'context',
      status: 'PASS',
      message: '已完成远程规则与 package manager 探测',
    });
    return {
      status: readable ? 'READY' : 'BROKEN',
      rootPath,
      canonicalRoot,
      exists: true,
      directory: true,
      permissions: { readable, writable },
      git,
      context,
      checks,
    };
  }

  async resolveProjectRoot(rootPath: string): Promise<string> {
    this.assertLexicallyAllowed(rootPath);
    const canonicalRoot = await realpath(rootPath).catch((error: unknown) => {
      throw new NodeCommandError(
        'REMOTE_FILE_NOT_FOUND',
        error instanceof Error ? error.message : '远程路径不存在',
      );
    });
    this.assertCanonicalAllowed(canonicalRoot);
    return canonicalRoot;
  }

  async listFiles(rootPath: string, requestedPath: string, depth: number) {
    const root = await this.resolveProjectRoot(rootPath);
    const directory = await resolveContainedExistingPath(root, requestedPath);
    if (!(await stat(directory)).isDirectory()) {
      throw new NodeCommandError('FILE_NOT_DIRECTORY', '请求路径不是目录');
    }
    return readTree(root, directory, Math.min(Math.max(depth, 0), 6), { remaining: 5_000 });
  }

  async readTextFile(rootPath: string, requestedPath: string) {
    const root = await this.resolveProjectRoot(rootPath);
    const file = await resolveContainedExistingPath(root, requestedPath);
    const metadata = await stat(file);
    if (!metadata.isFile()) throw new NodeCommandError('FILE_NOT_REGULAR', '请求路径不是普通文件');
    if (metadata.size > 2 * 1024 * 1024) {
      throw new NodeCommandError('FILE_TOO_LARGE', '文件超过 2 MiB，只能通过 Agent 查看');
    }
    const content = await readFile(file);
    if (content.includes(0)) {
      throw new NodeCommandError('BINARY_FILE_UNSUPPORTED', '二进制文件不提供文本预览');
    }
    return {
      path: relative(root, file),
      content: content.toString('utf8'),
      size: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
      modifiedAt: metadata.mtime.toISOString(),
      readOnly: true,
    };
  }

  private assertLexicallyAllowed(candidate: string): void {
    if (!isAbsolute(candidate)) {
      throw new NodeCommandError('REMOTE_PATH_NOT_ABSOLUTE', '远程 Project path 必须是绝对路径');
    }
    const resolved = resolve(candidate);
    if (!this.allowedRoots.some((root) => isContained(root, resolved))) {
      throw new NodeCommandError('REMOTE_ROOT_NOT_ALLOWED', '远程路径不在 Node 授权 root 内');
    }
  }

  private assertCanonicalAllowed(candidate: string): void {
    if (!this.allowedRoots.some((root) => isContained(root, candidate))) {
      throw new NodeCommandError('REMOTE_SYMLINK_ESCAPE', '远程路径 realpath 逃逸授权 root');
    }
  }
}

async function resolveContainedExistingPath(root: string, requestedPath: string): Promise<string> {
  const path = validateRelativePath(requestedPath);
  const lexical = resolve(root, path);
  if (!isContained(root, lexical)) {
    throw new NodeCommandError('PATH_TRAVERSAL', '请求路径超出远程 Project root');
  }
  let canonical: string;
  try {
    canonical = await realpath(lexical);
  } catch {
    throw new NodeCommandError('FILE_NOT_FOUND', '远程文件或目录不存在');
  }
  if (!isContained(root, canonical)) {
    throw new NodeCommandError('SYMLINK_ESCAPE', '远程 symlink 逃逸 Project root');
  }
  return canonical;
}

function validateRelativePath(requestedPath: string): string {
  if (requestedPath.includes('\0')) throw new NodeCommandError('PATH_INVALID', '路径包含非法字符');
  const candidates = [requestedPath];
  let decoded = requestedPath;
  for (let index = 0; index < 2; index += 1) {
    try {
      decoded = decodeURIComponent(decoded);
      candidates.push(decoded);
    } catch {
      throw new NodeCommandError('PATH_ENCODING_INVALID', '路径编码不合法');
    }
  }
  for (const candidate of candidates) {
    if (isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate)) {
      throw new NodeCommandError('PATH_ABSOLUTE_FORBIDDEN', '文件路径必须相对于 Project root');
    }
    if (candidate.replaceAll('\\', '/').split('/').includes('..')) {
      throw new NodeCommandError('PATH_TRAVERSAL', '文件路径不能包含上级目录跳转');
    }
  }
  return requestedPath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === '' ||
    (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`))
  );
}

async function readTree(
  root: string,
  directory: string,
  depth: number,
  budget: { remaining: number },
): Promise<RemoteFileTreeEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: RemoteFileTreeEntry[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (budget.remaining <= 0) {
      throw new NodeCommandError('FILE_TREE_TOO_LARGE', '文件树超过 5000 项，请缩小范围');
    }
    if (TREE_IGNORES.has(entry.name)) continue;
    budget.remaining -= 1;
    const absolute = join(directory, entry.name);
    const metadata = await lstat(absolute);
    const path = relative(root, absolute);
    if (entry.isSymbolicLink()) {
      const blocked = await realpath(absolute)
        .then((canonical) => !isContained(root, canonical))
        .catch(() => true);
      result.push({
        name: entry.name,
        path,
        type: 'SYMLINK',
        size: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
        ...(blocked ? { blocked: true } : {}),
      });
      continue;
    }
    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path,
        type: 'DIRECTORY',
        size: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
        ...(depth > 0 ? { children: await readTree(root, absolute, depth - 1, budget) } : {}),
      });
      continue;
    }
    result.push({
      name: entry.name,
      path,
      type: 'FILE',
      size: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
    });
  }
  return result;
}

async function inspectGit(cwd: string): Promise<RemoteProjectPreflightReport['git']> {
  const gitExecutable = await findExecutable('git');
  if (!gitExecutable) return { detected: false };
  const root = await gitLine(gitExecutable, cwd, ['rev-parse', '--show-toplevel']);
  if (!root) return { detected: false };
  const branch = await gitLine(gitExecutable, cwd, ['branch', '--show-current']);
  const status = await runProcess({
    executable: gitExecutable,
    args: ['-C', cwd, 'status', '--porcelain=v1', '-z'],
    timeoutMs: 10_000,
    maxOutputBytes: 1024 * 1024,
  });
  return {
    detected: true,
    root,
    ...(branch ? { branch } : {}),
    dirty: status.exitCode === 0 && status.stdout.length > 0,
  };
}

async function gitLine(executable: string, cwd: string, args: string[]) {
  const result = await runProcess({
    executable,
    args: ['-C', cwd, ...args],
    timeoutMs: 10_000,
    maxOutputBytes: 64_000,
  });
  return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
}

async function findExecutable(name: string): Promise<string | undefined> {
  const { delimiter, join: joinPath } = await import('node:path');
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(isAbsolute)) {
    const candidate = joinPath(directory, name);
    if (await canAccess(candidate, constants.X_OK)) return candidate;
  }
  return undefined;
}

async function detectPackageManagers(root: string): Promise<string[]> {
  const hints: Array<[string, string]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['Cargo.lock', 'cargo'],
    ['go.mod', 'go'],
    ['pom.xml', 'maven'],
    ['gradlew', 'gradle'],
  ];
  const detected = await Promise.all(
    hints.map(async ([file, manager]) =>
      (await pathExists(join(root, file))) ? manager : undefined,
    ),
  );
  return [...new Set(detected.filter((value): value is string => Boolean(value)))];
}

async function pathExists(path: string): Promise<boolean> {
  return canAccess(path, constants.F_OK);
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

function failedPreflight(
  rootPath: string,
  checks: RemoteProjectPreflightReport['checks'],
  message: string,
  canonicalRoot = rootPath,
): RemoteProjectPreflightReport {
  checks.push({ id: 'path', status: 'FAIL', message });
  return {
    status: 'BROKEN',
    rootPath,
    canonicalRoot,
    exists: false,
    directory: false,
    permissions: { readable: false, writable: false },
    git: { detected: false },
    context: { agentsMd: false, claudeMd: false, openSpec: false, packageManagers: [] },
    checks,
  };
}
