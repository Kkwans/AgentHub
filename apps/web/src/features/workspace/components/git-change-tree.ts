import type { GitStatusRecord } from '../workspace-types';

type GitChangeEntry = GitStatusRecord['entries'][number];

export type GitChangeTreeNode =
  | {
      kind: 'directory';
      name: string;
      path: string;
      children: GitChangeTreeNode[];
      fileCount: number;
    }
  | {
      kind: 'file';
      name: string;
      path: string;
      entry: GitChangeEntry;
    };

/**
 * Build a stable repo-relative tree from porcelain entries. Git status is a
 * flat protocol, but the inspector should preserve directory ownership so a
 * large workspace remains scannable without exposing absolute paths.
 */
export function buildGitChangeTree(entries: GitChangeEntry[]): GitChangeTreeNode[] {
  type DirectoryNode = Extract<GitChangeTreeNode, { kind: 'directory' }>;
  const root: DirectoryNode = {
    kind: 'directory',
    name: '.',
    path: '',
    children: [],
    fileCount: 0,
  };
  const directories = new Map<string, DirectoryNode>([['', root]]);

  for (const entry of entries) {
    const rawPath = entry.path.replaceAll('\\', '/');
    if (rawPath.startsWith('/') || /^[A-Za-z]:\//.test(rawPath)) continue;
    const path = rawPath;
    if (!path || path === '.' || path.split('/').some((segment) => !segment || segment === '..')) {
      continue;
    }
    const segments = path.split('/');
    let parent = root;
    let directoryPath = '';
    for (const segment of segments.slice(0, -1)) {
      directoryPath = directoryPath ? `${directoryPath}/${segment}` : segment;
      let directory = directories.get(directoryPath);
      if (!directory) {
        directory = {
          kind: 'directory',
          name: segment,
          path: directoryPath,
          children: [],
          fileCount: 0,
        };
        directories.set(directoryPath, directory);
        parent.children.push(directory);
      }
      directory.fileCount += 1;
      parent = directory;
    }
    parent.children.push({
      kind: 'file',
      name: segments.at(-1) ?? path,
      path,
      entry: { ...entry, path },
    });
    root.fileCount += 1;
  }

  const sortNodes = (nodes: GitChangeTreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
      return left.name.localeCompare(right.name, 'zh-CN', { numeric: true });
    });
    for (const node of nodes) if (node.kind === 'directory') sortNodes(node.children);
  };
  sortNodes(root.children);
  return root.children;
}
