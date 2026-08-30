import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import { runProcess } from '@agenthub/agent-core';
import type { AgentHubDatabase, ExecutionTargetRepository, ProjectRepository } from '@agenthub/db';

import { AppError } from '../errors.js';
import { assertContained, resolveContainedExistingPath } from './path-security.js';

export interface AddProjectInput {
  name: string;
  description?: string | undefined;
  targetId: string;
  rootPath: string;
  kind?: 'STANDARD' | 'TEST' | undefined;
}

export interface ProjectPreflightReport {
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

export interface FileTreeEntry {
  name: string;
  path: string;
  type: 'FILE' | 'DIRECTORY' | 'SYMLINK';
  size: number;
  modifiedAt: string;
  blocked?: boolean;
  children?: FileTreeEntry[];
}

export interface RemoteProjectOperations {
  preflight(targetId: string, rootPath: string): Promise<ProjectPreflightReport>;
  listFiles(
    targetId: string,
    rootPath: string,
    requestedPath: string,
    depth: number,
  ): Promise<FileTreeEntry[]>;
  readFile(
    targetId: string,
    rootPath: string,
    requestedPath: string,
  ): Promise<{
    path: string;
    content: string;
    size: number;
    sha256: string;
    modifiedAt: string;
    readOnly: true;
  }>;
}

const TREE_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', '.agenthub']);

export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository<AgentHubDatabase>,
    private readonly targets: ExecutionTargetRepository<AgentHubDatabase>,
    private readonly remote?: RemoteProjectOperations,
    private readonly workspaceRoots: string[] = [],
  ) {}

  list() {
    return this.projects.list();
  }

  async get(id: string) {
    const project = await this.projects.get(id);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project 不存在');
    return project;
  }

  async add(input: AddProjectInput) {
    const report = await this.preflightForTarget(input.targetId, input.rootPath);
    if (report.status !== 'READY') {
      throw new AppError(400, 'PROJECT_PREFLIGHT_FAILED', 'Project 路径预检未通过', {
        checks: report.checks,
      });
    }
    return this.projects.create({
      id: randomUUID(),
      name: input.name,
      description: input.description,
      targetId: input.targetId,
      rootPath: input.rootPath,
      realRootPath: report.canonicalRoot,
      repoKind: report.git.detected ? 'GIT' : 'NONE',
      kind: input.kind ?? 'STANDARD',
      status: 'ACTIVE',
    });
  }

  async preflightForTarget(targetId: string, rootPath: string): Promise<ProjectPreflightReport> {
    const target = await this.targets.get(targetId);
    if (!target) throw new AppError(404, 'EXECUTION_TARGET_NOT_FOUND', 'Execution Target 不存在');
    return target.kind === 'REMOTE_NODE'
      ? this.requireRemote().preflight(target.id, rootPath)
      : this.preflightPath(rootPath);
  }

  async update(
    id: string,
    input: {
      name?: string;
      description?: string | null;
      kind?: 'STANDARD' | 'TEST';
    },
  ) {
    await this.get(id);
    return this.projects.update(id, input);
  }

  async archive(id: string) {
    await this.get(id);
    return this.projects.update(id, { status: 'ARCHIVED', archivedAt: new Date() });
  }

  async preflight(id: string): Promise<ProjectPreflightReport> {
    const project = await this.get(id);
    try {
      return await this.preflightForTarget(project.targetId, project.rootPath);
    } catch (error) {
      if (error instanceof AppError && error.code === 'EXECUTION_TARGET_NOT_FOUND') {
        throw new AppError(
          500,
          'PROJECT_TARGET_MISSING',
          'Project 的 Execution Target 不存在',
          undefined,
          {
            cause: error,
          },
        );
      }
      throw error;
    }
  }

  async preflightPath(rootPath: string): Promise<ProjectPreflightReport> {
    const checks: ProjectPreflightReport['checks'] = [];
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(rootPath);
    } catch {
      return failedPreflight(rootPath, checks, 'Project 路径不存在或无法 canonicalize');
    }
    if (this.workspaceRoots.length) {
      const allowedRoots = await Promise.all(
        this.workspaceRoots.map((root) => realpath(root).catch(() => undefined)),
      );
      if (
        !allowedRoots.some(
          (root): root is string => root !== undefined && isWithin(root, canonicalRoot),
        )
      ) {
        return failedPreflight(
          rootPath,
          checks,
          'Project 路径不在 AgentHub 已授权的工作区范围内',
          canonicalRoot,
        );
      }
    }
    const rootStat = await stat(canonicalRoot);
    if (!rootStat.isDirectory()) {
      return failedPreflight(rootPath, checks, 'Project root 不是目录', canonicalRoot);
    }
    checks.push({ id: 'path', status: 'PASS', message: 'Project 路径存在且 realpath 成功' });

    const readable = await canAccess(canonicalRoot, constants.R_OK);
    const writable = await canAccess(canonicalRoot, constants.W_OK);
    checks.push({
      id: 'permissions',
      status: readable && writable ? 'PASS' : readable ? 'WARN' : 'FAIL',
      message: readable
        ? writable
          ? 'Project root 可读写'
          : 'Project root 只读，Agent 修改可能失败'
        : 'Project root 不可读',
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
      message: `已完成规则文件与 package manager 探测`,
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

  async listFiles(id: string, requestedPath = '', depth = 2): Promise<FileTreeEntry[]> {
    const project = await this.get(id);
    const target = await this.targets.get(project.targetId);
    if (!target)
      throw new AppError(500, 'PROJECT_TARGET_MISSING', 'Project 的 Execution Target 不存在');
    if (target.kind === 'REMOTE_NODE') {
      return this.requireRemote().listFiles(target.id, project.realRootPath, requestedPath, depth);
    }
    const directory = await resolveContainedExistingPath(project.realRootPath, requestedPath);
    const directoryStat = await stat(directory);
    if (!directoryStat.isDirectory()) {
      throw new AppError(400, 'FILE_NOT_DIRECTORY', '请求路径不是目录');
    }
    const budget = { remaining: 5_000 };
    return readTree(project.realRootPath, directory, Math.min(Math.max(depth, 0), 6), budget);
  }

  async readFile(id: string, requestedPath: string) {
    const project = await this.get(id);
    const target = await this.targets.get(project.targetId);
    if (!target)
      throw new AppError(500, 'PROJECT_TARGET_MISSING', 'Project 的 Execution Target 不存在');
    if (target.kind === 'REMOTE_NODE') {
      return this.requireRemote().readFile(target.id, project.realRootPath, requestedPath);
    }
    const file = await resolveContainedExistingPath(project.realRootPath, requestedPath);
    const fileStat = await stat(file);
    if (!fileStat.isFile()) throw new AppError(400, 'FILE_NOT_REGULAR', '请求路径不是普通文件');
    if (fileStat.size > 2 * 1024 * 1024) {
      throw new AppError(413, 'FILE_TOO_LARGE', '文件超过 2 MiB，只能通过 Agent 或 artifact 查看');
    }
    const content = await readFile(file);
    if (content.includes(0))
      throw new AppError(415, 'BINARY_FILE_UNSUPPORTED', '二进制文件不提供文本预览');
    return {
      path: relative(project.realRootPath, file),
      content: content.toString('utf8'),
      size: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
      modifiedAt: fileStat.mtime.toISOString(),
      readOnly: true,
    };
  }

  private requireRemote(): RemoteProjectOperations {
    if (!this.remote) {
      throw new AppError(503, 'REMOTE_NODE_GATEWAY_UNAVAILABLE', 'Remote Node Gateway 不可用');
    }
    return this.remote;
  }
}

async function readTree(
  root: string,
  directory: string,
  depth: number,
  budget: { remaining: number },
): Promise<FileTreeEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: FileTreeEntry[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (budget.remaining <= 0) {
      throw new AppError(413, 'FILE_TREE_TOO_LARGE', '文件树超过 5000 项，请缩小目录范围');
    }
    if (TREE_IGNORES.has(entry.name)) continue;
    budget.remaining -= 1;
    const absolute = join(directory, entry.name);
    const metadata = await lstat(absolute);
    const path = relative(root, absolute);
    if (entry.isSymbolicLink()) {
      let blocked = false;
      try {
        assertContained(root, await realpath(absolute), 'SYMLINK_ESCAPE');
      } catch {
        blocked = true;
      }
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

async function inspectGit(cwd: string): Promise<ProjectPreflightReport['git']> {
  const root = await gitLine(cwd, ['rev-parse', '--show-toplevel']);
  if (!root) return { detected: false };
  const branch = await gitLine(cwd, ['branch', '--show-current']);
  const status = await runProcess({
    executable: '/usr/bin/git',
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

async function gitLine(cwd: string, args: string[]): Promise<string | undefined> {
  const result = await runProcess({
    executable: '/usr/bin/git',
    args: ['-C', cwd, ...args],
    timeoutMs: 10_000,
    maxOutputBytes: 64_000,
  });
  return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
}

async function detectPackageManagers(root: string): Promise<string[]> {
  const hints = [
    ['pnpm', 'pnpm-lock.yaml'],
    ['npm', 'package-lock.json'],
    ['yarn', 'yarn.lock'],
    ['bun', 'bun.lock'],
    ['poetry', 'poetry.lock'],
    ['uv', 'uv.lock'],
    ['cargo', 'Cargo.lock'],
    ['maven', 'pom.xml'],
    ['gradle', 'gradlew'],
  ] as const;
  const detected: string[] = [];
  for (const [manager, file] of hints)
    if (await pathExists(join(root, file))) detected.push(manager);
  return detected;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  );
}

function failedPreflight(
  rootPath: string,
  checks: ProjectPreflightReport['checks'],
  message: string,
  canonicalRoot = rootPath,
): ProjectPreflightReport {
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
