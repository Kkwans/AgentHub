import { constants } from 'node:fs';
import { access, lstat, readdir, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { AgentHubDatabase, ExecutionTargetRepository } from '@agenthub/db';

import { AppError } from '../errors.js';
import { assertContained, validateRelativePath } from '../projects/path-security.js';

export interface WorkspaceRoot {
  rootId: string;
  label: string;
  path: string;
  targetId: string;
  source: 'CONFIGURED' | 'DOCKER_MOUNT' | 'REMOTE_NODE';
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'DIRECTORY' | 'SYMLINK' | 'FILE';
  accessible: boolean;
}

export interface ProjectCandidate {
  name: string;
  rootPath: string;
  relativePath: string;
  markers: string[];
  git: boolean;
  packageManagers: string[];
  readable: boolean;
}

/**
 * Remote Node owns the filesystem. The central server only forwards the
 * already-authorized, read-only directory operations through this boundary.
 */
export interface RemoteFilesystemOperations {
  listRoots(targetId: string): Promise<WorkspaceRoot[]>;
  listDirectories(
    targetId: string,
    rootId: string | undefined,
    requestedPath: string,
  ): Promise<{ root: WorkspaceRoot; path: string; entries: DirectoryEntry[] }>;
  discoverProjects(targetId: string, rootId?: string): Promise<ProjectCandidate[]>;
}

export class FilesystemService {
  constructor(
    private readonly targets: ExecutionTargetRepository<AgentHubDatabase>,
    private readonly configuredRoots: string[],
    private readonly remote?: RemoteFilesystemOperations,
  ) {}

  async listRoots(targetId: string): Promise<WorkspaceRoot[]> {
    const target = await this.targets.get(targetId);
    if (!target) throw new AppError(404, 'EXECUTION_TARGET_NOT_FOUND', 'Execution Target 不存在');
    if (target.kind === 'REMOTE_NODE') {
      return this.requireRemote().listRoots(targetId);
    }
    if (target.kind === 'DOCKER_CONTAINER') {
      const mappings = target.workspaceMappingsJson ?? [];
      return Promise.all(
        mappings
          .filter((mapping) => isAbsolute(mapping.hostRoot))
          .map(async (mapping) => this.makeRoot(targetId, mapping.hostRoot, 'DOCKER_MOUNT')),
      ).then((roots) => roots.filter((root): root is WorkspaceRoot => Boolean(root)));
    }
    const roots = await Promise.all(
      this.configuredRoots.map((root) => this.makeRoot(targetId, root, 'CONFIGURED')),
    );
    return roots.filter((root): root is WorkspaceRoot => Boolean(root));
  }

  async listDirectories(targetId: string, rootId: string | undefined, requestedPath = '') {
    const target = await this.targets.get(targetId);
    if (!target) throw new AppError(404, 'EXECUTION_TARGET_NOT_FOUND', 'Execution Target 不存在');
    if (target.kind === 'REMOTE_NODE') {
      return this.requireRemote().listDirectories(targetId, rootId, requestedPath);
    }
    const roots = await this.listRoots(targetId);
    const root = this.selectRoot(roots, rootId, requestedPath);
    const directory = await this.resolvePath(root, requestedPath);
    const directoryStat = await stat(directory);
    if (!directoryStat.isDirectory())
      throw new AppError(400, 'FILE_NOT_DIRECTORY', '请求路径不是目录');
    const entries = await readdir(directory, { withFileTypes: true });
    const output: DirectoryEntry[] = [];
    for (const entry of entries
      .filter((item) => !item.name.startsWith('.') || item.name === '.git')
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .slice(0, 500)) {
      const fullPath = join(directory, entry.name);
      const type = entry.isDirectory() ? 'DIRECTORY' : entry.isSymbolicLink() ? 'SYMLINK' : 'FILE';
      let accessible = true;
      if (entry.isSymbolicLink()) {
        try {
          const canonical = await realpath(fullPath);
          assertContained(root.path, canonical, 'SYMLINK_ESCAPE');
          accessible = (await stat(canonical)).isDirectory();
        } catch {
          accessible = false;
        }
      }
      output.push({ name: entry.name, path: fullPath, type, accessible });
    }
    return { root, path: directory, entries: output };
  }

  async discoverProjects(targetId: string, rootId?: string): Promise<ProjectCandidate[]> {
    const target = await this.targets.get(targetId);
    if (!target) throw new AppError(404, 'EXECUTION_TARGET_NOT_FOUND', 'Execution Target 不存在');
    if (target.kind === 'REMOTE_NODE') {
      return this.requireRemote().discoverProjects(targetId, rootId);
    }
    const roots = await this.listRoots(targetId);
    const selected = rootId ? roots.filter((root) => root.rootId === rootId) : roots;
    if (!selected.length) throw new AppError(404, 'FILESYSTEM_ROOT_NOT_FOUND', '文件根目录不存在');
    const candidates: ProjectCandidate[] = [];
    for (const root of selected) await scanRoot(root, root, candidates, 0);
    return candidates;
  }

  private selectRoot(
    roots: WorkspaceRoot[],
    rootId: string | undefined,
    requestedPath: string,
  ): WorkspaceRoot {
    if (rootId) {
      const root = roots.find((item) => item.rootId === rootId);
      if (!root) throw new AppError(404, 'FILESYSTEM_ROOT_NOT_FOUND', '文件根目录不存在');
      return root;
    }
    if (isAbsolute(requestedPath)) {
      const matching = roots
        .filter((root) => isWithin(root.path, requestedPath))
        .sort((left, right) => right.path.length - left.path.length)[0];
      if (matching) return matching;
    }
    const first = roots[0];
    if (!first) throw new AppError(404, 'FILESYSTEM_ROOT_NOT_FOUND', '文件根目录不存在');
    return first;
  }

  private async resolvePath(root: WorkspaceRoot, requestedPath: string): Promise<string> {
    if (requestedPath === '') return root.path;
    let lexical: string;
    if (isAbsolute(requestedPath)) {
      lexical = resolve(requestedPath);
      assertContained(root.path, lexical, 'PATH_TRAVERSAL');
    } else {
      const relativePath = validateRelativePath(requestedPath);
      lexical = resolve(root.path, relativePath);
      assertContained(root.path, lexical, 'PATH_TRAVERSAL');
    }
    let canonical: string;
    try {
      canonical = await realpath(lexical);
    } catch (error) {
      throw new AppError(404, 'FILE_NOT_FOUND', '目录不存在', undefined, { cause: error });
    }
    assertContained(root.path, canonical, 'SYMLINK_ESCAPE');
    return canonical;
  }

  private async makeRoot(
    targetId: string,
    inputPath: string,
    source: WorkspaceRoot['source'],
  ): Promise<WorkspaceRoot | undefined> {
    try {
      const canonical = await realpath(inputPath);
      if (source === 'DOCKER_MOUNT') {
        const allowedRoots = await Promise.all(
          this.configuredRoots.map((root) => realpath(root).catch(() => undefined)),
        );
        if (
          !allowedRoots.some(
            (root): root is string => root !== undefined && isWithin(root, canonical),
          )
        ) {
          return undefined;
        }
      }
      const permissions = await access(canonical, constants.R_OK)
        .then(() => true)
        .catch(() => false);
      if (!permissions || !(await stat(canonical)).isDirectory()) return undefined;
      return {
        rootId: `${targetId}:${canonical}`,
        label: basename(canonical) || canonical,
        path: canonical,
        targetId,
        source,
      };
    } catch {
      return undefined;
    }
  }

  private requireRemote(): RemoteFilesystemOperations {
    if (!this.remote) {
      throw new AppError(
        501,
        'REMOTE_FILESYSTEM_UNSUPPORTED',
        'Remote Node 文件浏览暂不可用，请检查 Node 连接',
      );
    }
    return this.remote;
  }
}

async function scanRoot(
  root: WorkspaceRoot,
  current: WorkspaceRoot,
  candidates: ProjectCandidate[],
  depth: number,
): Promise<void> {
  if (candidates.length >= 100 || depth > 2) return;
  const markerSet = await detectMarkers(current.path);
  if (markerSet.length) {
    const readable = await access(current.path, constants.R_OK)
      .then(() => true)
      .catch(() => false);
    candidates.push({
      name: basename(current.path) || current.path,
      rootPath: current.path,
      relativePath: relative(root.path, current.path) || '.',
      markers: markerSet,
      git: markerSet.includes('.git'),
      packageManagers: markerSet.filter((marker) => marker.endsWith('-lock')),
      readable,
    });
  }
  let entries;
  try {
    entries = await readdir(current.path, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries
    .filter(
      (item) =>
        item.isDirectory() &&
        !item.name.startsWith('.') &&
        !['node_modules', 'dist', 'build'].includes(item.name),
    )
    .slice(0, 100)) {
    const childPath = join(current.path, entry.name);
    try {
      const canonical = await realpath(childPath);
      assertContained(root.path, canonical, 'SYMLINK_ESCAPE');
      await scanRoot(
        root,
        { ...current, path: canonical, rootId: `${root.rootId}:${canonical}` },
        candidates,
        depth + 1,
      );
    } catch {
      // A single inaccessible or escaped child must not abort discovery of its siblings.
    }
  }
}

async function detectMarkers(path: string): Promise<string[]> {
  const markers = [
    '.git',
    'AGENTS.md',
    'CLAUDE.md',
    'package.json',
    'pnpm-lock',
    'yarn-lock',
    'npm-lock',
  ];
  const found: string[] = [];
  for (const marker of markers) {
    const candidate =
      marker === 'pnpm-lock'
        ? 'pnpm-lock.yaml'
        : marker === 'yarn-lock'
          ? 'yarn.lock'
          : marker === 'npm-lock'
            ? 'package-lock.json'
            : marker;
    try {
      await lstat(join(path, candidate));
      found.push(marker);
    } catch {
      // marker absent
    }
  }
  return found;
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  );
}
