import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { AgentHubDatabase, RemoteNodeRepository } from '@agenthub/db';

import { AppError } from '../errors.js';
import type {
  DirectoryEntry,
  ProjectCandidate,
  RemoteFilesystemOperations,
  WorkspaceRoot,
} from '../filesystem/filesystem-service.js';
import type {
  FileTreeEntry,
  ProjectPreflightReport,
  RemoteProjectOperations,
} from '../projects/project-service.js';
import { validateRelativePath } from '../projects/path-security.js';
import { RemoteNodeRpcError, type RemoteNodeGateway } from './remote-node-gateway.js';

export class RemoteNodeOperations implements RemoteProjectOperations, RemoteFilesystemOperations {
  constructor(
    private readonly nodes: RemoteNodeRepository<AgentHubDatabase>,
    private readonly gateway: RemoteNodeGateway,
  ) {}

  async preflight(targetId: string, rootPath: string): Promise<ProjectPreflightReport> {
    return this.rpc<ProjectPreflightReport>(targetId, 'project.preflight', { rootPath });
  }

  async listFiles(
    targetId: string,
    rootPath: string,
    requestedPath: string,
    depth: number,
  ): Promise<FileTreeEntry[]> {
    const result = await this.rpc<{ entries: FileTreeEntry[] }>(targetId, 'fs.list', {
      rootPath,
      requestedPath,
      depth,
    });
    return result.entries;
  }

  readFile(targetId: string, rootPath: string, requestedPath: string) {
    return this.rpc<{
      path: string;
      content: string;
      size: number;
      sha256: string;
      modifiedAt: string;
      readOnly: true;
    }>(targetId, 'fs.read', { rootPath, requestedPath });
  }

  async listRoots(targetId: string): Promise<WorkspaceRoot[]> {
    const node = await this.requireNode(targetId);
    return node.allowedRootsJson.filter(isAbsolute).map((path) => ({
      rootId: `${targetId}:${path}`,
      label: basename(path) || path,
      path,
      targetId,
      source: 'REMOTE_NODE' as const,
    }));
  }

  async listDirectories(
    targetId: string,
    rootId: string | undefined,
    requestedPath: string,
  ): Promise<{ root: WorkspaceRoot; path: string; entries: DirectoryEntry[] }> {
    const roots = await this.listRoots(targetId);
    const root = selectRoot(roots, rootId, requestedPath);
    const directory = resolveRemotePath(root.path, requestedPath);
    const result = await this.rpc<{ entries: FileTreeEntry[] }>(targetId, 'fs.list', {
      rootPath: root.path,
      requestedPath: relative(root.path, directory),
      depth: 0,
    });
    return {
      root,
      path: directory,
      entries: result.entries
        .filter((entry) => !entry.name.startsWith('.') || entry.name === '.git')
        .slice(0, 500)
        .map((entry) => ({
          name: entry.name,
          path: join(directory, entry.name),
          type: entry.type,
          accessible: entry.type !== 'SYMLINK' || entry.blocked !== true,
        })),
    };
  }

  async discoverProjects(targetId: string, rootId?: string): Promise<ProjectCandidate[]> {
    const roots = await this.listRoots(targetId);
    const selected = rootId ? roots.filter((root) => root.rootId === rootId) : roots;
    if (!selected.length) throw new AppError(404, 'FILESYSTEM_ROOT_NOT_FOUND', '文件根目录不存在');
    const candidates: ProjectCandidate[] = [];
    for (const root of selected) {
      const result = await this.rpc<{ entries: FileTreeEntry[] }>(targetId, 'fs.list', {
        rootPath: root.path,
        requestedPath: '',
        depth: 2,
      });
      collectRemoteCandidates(root, root.path, result.entries, candidates);
    }
    return candidates;
  }

  private async requireNode(targetId: string) {
    const node = await this.nodes.getByTargetId(targetId);
    if (!node) throw new AppError(404, 'REMOTE_NODE_NOT_FOUND', 'Project 的 Remote Node 不存在');
    if (node.revokedAt) throw new AppError(409, 'REMOTE_NODE_REVOKED', 'Remote Node 已撤销');
    return node;
  }

  private async rpc<T>(
    targetId: string,
    command: 'project.preflight' | 'fs.list' | 'fs.read',
    payload: Record<string, unknown>,
  ): Promise<T> {
    const node = await this.nodes.getByTargetId(targetId);
    if (!node) throw new AppError(404, 'REMOTE_NODE_NOT_FOUND', 'Project 的 Remote Node 不存在');
    if (node.revokedAt) throw new AppError(409, 'REMOTE_NODE_REVOKED', 'Remote Node 已撤销');
    try {
      return (await this.gateway.request(node.id, command, payload)) as T;
    } catch (error) {
      throw remoteRpcAppError(error);
    }
  }
}

const REMOTE_PROJECT_MARKERS = new Map([
  ['AGENTS.md', 'AGENTS.md'],
  ['CLAUDE.md', 'CLAUDE.md'],
  ['package.json', 'package.json'],
  ['pnpm-lock.yaml', 'pnpm-lock'],
  ['yarn.lock', 'yarn-lock'],
  ['package-lock.json', 'npm-lock'],
]);

function selectRoot(
  roots: WorkspaceRoot[],
  rootId: string | undefined,
  requestedPath: string,
): WorkspaceRoot {
  if (rootId) {
    const root = roots.find((item) => item.rootId === rootId);
    if (!root) throw new AppError(404, 'FILESYSTEM_ROOT_NOT_FOUND', '文件根目录不存在');
    return root;
  }
  const root = roots
    .filter((item) => isWithin(item.path, requestedPath))
    .sort((left, right) => right.path.length - left.path.length)[0];
  if (root) return root;
  const first = roots[0];
  if (!first) throw new AppError(404, 'FILESYSTEM_ROOT_NOT_FOUND', '文件根目录不存在');
  return first;
}

function resolveRemotePath(root: string, requestedPath: string): string {
  const candidate = requestedPath
    ? isAbsolute(requestedPath)
      ? resolve(requestedPath)
      : resolve(root, validateRelativePath(requestedPath))
    : root;
  if (!isWithin(root, candidate)) {
    throw new AppError(400, 'PATH_TRAVERSAL', '请求路径超出 Remote Node 授权目录');
  }
  return candidate;
}

function collectRemoteCandidates(
  root: WorkspaceRoot,
  directoryPath: string,
  entries: FileTreeEntry[],
  candidates: ProjectCandidate[],
  depth = 0,
): void {
  if (candidates.length >= 100) return;
  const markers = entries
    .map((entry) => REMOTE_PROJECT_MARKERS.get(entry.name))
    .filter((marker): marker is string => Boolean(marker));
  if (markers.length) {
    candidates.push({
      name: basename(directoryPath) || directoryPath,
      rootPath: directoryPath,
      relativePath: relative(root.path, directoryPath) || '.',
      markers,
      git: false,
      packageManagers: markers.filter((marker) => marker.endsWith('-lock')),
      readable: true,
    });
  }
  if (depth >= 2) return;
  for (const entry of entries) {
    if (entry.type !== 'DIRECTORY' || !entry.children) continue;
    collectRemoteCandidates(
      root,
      join(root.path, entry.path),
      entry.children,
      candidates,
      depth + 1,
    );
  }
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  );
}

export function remoteRpcAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof RemoteNodeRpcError) {
    const status = error.code === 'REMOTE_NODE_OFFLINE' ? 409 : 502;
    return new AppError(status, error.code, error.message, undefined, { cause: error });
  }
  return new AppError(502, 'REMOTE_NODE_RPC_FAILED', 'Remote Node 请求失败', undefined, {
    cause: error,
  });
}
