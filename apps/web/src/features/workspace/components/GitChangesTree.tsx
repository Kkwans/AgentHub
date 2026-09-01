import {
  Button,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  IconButton,
  RefreshCw,
} from '@agenthub/ui';
import { useEffect, useMemo, useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../../../components/Feedback';
import type {
  GitBranchRecord,
  GitCommitRecord,
  GitDiffRecord,
  GitStatusRecord,
  QueryState,
} from '../workspace-types';
import { DiffViewer } from './DiffViewer';

export function GitChangesTree({
  status,
  diff,
  commits,
  branches,
  onCommit,
  stagedDiff,
  onStagedDiffChange,
  selectedPath,
  onSelectPath,
  whitespace,
  onWhitespaceChange,
}: {
  status: QueryState<GitStatusRecord>;
  diff: QueryState<GitDiffRecord>;
  commits: QueryState<GitCommitRecord[]>;
  branches: QueryState<GitBranchRecord[]>;
  onCommit: (input: { paths: string[]; message: string }) => Promise<{ sha?: string }>;
  stagedDiff: boolean;
  onStagedDiffChange: (value: boolean) => void;
  selectedPath?: string | undefined;
  onSelectPath?: ((path: string, view?: 'diff' | 'files') => void) | undefined;
  whitespace: 'default' | 'ignore-all-space' | 'ignore-space-change' | 'ignore-blank-lines';
  onWhitespaceChange: (
    value: 'default' | 'ignore-all-space' | 'ignore-space-change' | 'ignore-blank-lines',
  ) => void;
}) {
  type GitView = 'changes' | 'history' | 'branches';
  const [view, setView] = useState<GitView>('changes');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitReceipt, setCommitReceipt] = useState<string>();
  const [commitPending, setCommitPending] = useState(false);
  const [commitError, setCommitError] = useState<Error>();
  const [commitDockOpen, setCommitDockOpen] = useState(false);
  const changeTree = useMemo(
    () => buildGitChangeTree(status.data?.entries ?? []),
    [status.data?.entries],
  );

  const commit = () => {
    setCommitError(undefined);
    setCommitPending(true);
    void onCommit({ paths: selectedPaths, message: commitMessage.trim() })
      .then((receipt) => {
        setSelectedPaths([]);
        setCommitMessage('');
        setCommitReceipt(receipt.sha ? `提交完成：${receipt.sha.slice(0, 12)}` : '提交完成');
      })
      .catch((error: unknown) => {
        setCommitError(error instanceof Error ? error : new Error('Git 提交失败。'));
      })
      .finally(() => setCommitPending(false));
  };

  useEffect(() => {
    if (!status.data) return;
    const available = new Set(status.data.entries.map((entry) => entry.path));
    setSelectedPaths((current) => current.filter((path) => available.has(path)));
  }, [status.data]);

  const togglePath = (path: string) => {
    setCommitReceipt(undefined);
    setCommitDockOpen(true);
    setSelectedPaths((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  };

  const refetchCurrentView = () => {
    if (view === 'history') void commits.refetch();
    else if (view === 'branches') void branches.refetch();
    else {
      void status.refetch();
      if (selectedPath) void diff.refetch();
    }
  };

  const viewLabels: Record<GitView, string> = {
    changes: selectedPath ? '变更与 Diff' : '变更',
    history: '提交历史',
    branches: '分支',
  };

  return (
    <div className="git-inspector">
      <div className="git-summary">
        <GitBranch size={16} />
        <div>
          <strong>{status.data?.branch ?? 'Git'}</strong>
          <code>{status.data?.headSha?.slice(0, 12) ?? '无 HEAD'}</code>
          {status.data?.upstream && (
            <small>
              {status.data.upstream}
              {status.data.ahead ? `，ahead ${status.data.ahead}` : ''}
              {status.data.behind ? `，behind ${status.data.behind}` : ''}
            </small>
          )}
        </div>
        {status.data && (
          <span className={`git-clean-state ${status.data.clean ? 'clean' : 'dirty'}`}>
            {status.data.clean ? '工作区干净' : '有未提交变更'}
          </span>
        )}
      </div>

      <div className="git-viewbar">
        <strong>{viewLabels[view]}</strong>
        <div className="git-view-actions">
          <details className="git-more-menu">
            <summary>更多 Git</summary>
            <div role="menu" aria-label="更多 Git 视图">
              <button type="button" role="menuitem" onClick={() => setView('changes')}>
                变更
              </button>
              <button type="button" role="menuitem" onClick={() => setView('history')}>
                提交历史
              </button>
              <button type="button" role="menuitem" onClick={() => setView('branches')}>
                分支
              </button>
            </div>
          </details>
          <IconButton
            type="button"
            size="1"
            variant="ghost"
            aria-label="刷新 Git 数据"
            onClick={refetchCurrentView}
          >
            <RefreshCw size={15} />
          </IconButton>
        </div>
      </div>

      {commitReceipt && (
        <p className="git-commit-receipt" role="status">
          {commitReceipt}
        </p>
      )}

      {view === 'changes' &&
        (status.isLoading ? (
          <LoadingState label="正在读取 Git 状态" />
        ) : status.error ? (
          <ErrorState error={status.error} retry={() => status.refetch()} />
        ) : status.data?.clean ? (
          <EmptyState title="工作区干净" description="没有 staged、unstaged 或 untracked 文件。" />
        ) : (
          <>
            <div className="git-selection-heading">
              <span>{status.data?.entries.length ?? 0} 个变更</span>
              <button
                type="button"
                onClick={() =>
                  (() => {
                    const next =
                      selectedPaths.length === status.data?.entries.length
                        ? []
                        : (status.data?.entries.map((entry) => entry.path) ?? []);
                    setSelectedPaths(next);
                    setCommitDockOpen(next.length > 0);
                  })()
                }
              >
                {selectedPaths.length === status.data?.entries.length ? '取消全选' : '全选'}
              </button>
            </div>
            <div className="change-list git-change-list" role="tree" aria-label="Git 文件变更树">
              {changeTree.map((node) => (
                <GitChangeTreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedPath={selectedPath}
                  selectedPaths={selectedPaths}
                  onTogglePath={togglePath}
                  onSelectPath={onSelectPath}
                  onSelectView={setView}
                />
              ))}
            </div>
            <div className={`git-commit-dock${selectedPaths.length ? ' has-selection' : ''}`}>
              <div className="git-commit-dock-summary">
                <span>
                  {selectedPaths.length
                    ? `已选择 ${selectedPaths.length} 个文件`
                    : '勾选文件后提交'}
                </span>
                {selectedPaths.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCommitDockOpen((value) => !value)}
                    aria-expanded={commitDockOpen}
                  >
                    {commitDockOpen ? '收起' : '填写提交说明'}
                  </button>
                )}
              </div>
              {selectedPaths.length > 0 && commitDockOpen && (
                <form
                  className="git-commit-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (selectedPaths.length && commitMessage.trim()) commit();
                  }}
                >
                  <label>
                    <span>提交说明</span>
                    <textarea
                      value={commitMessage}
                      maxLength={10_000}
                      rows={2}
                      placeholder="说明这次变更解决了什么"
                      onChange={(event) => {
                        setCommitReceipt(undefined);
                        setCommitError(undefined);
                        setCommitMessage(event.target.value);
                      }}
                    />
                  </label>
                  <Button
                    type="submit"
                    size="2"
                    disabled={!selectedPaths.length || !commitMessage.trim() || commitPending}
                  >
                    <GitCompareArrows size={16} />
                    {commitPending ? '正在提交…' : `提交所选文件 (${selectedPaths.length})`}
                  </Button>
                  <small>只提交勾选文件，不会混入其他已暂存变更。</small>
                  {commitError && (
                    <div className="workspace-query-error" role="alert">
                      <span>{commitError.message}</span>
                      <button type="button" onClick={commit}>
                        重试提交
                      </button>
                    </div>
                  )}
                </form>
              )}
            </div>
            {selectedPath && (
              <section className="git-selected-diff" aria-label={`已选择 ${selectedPath} 的 Diff`}>
                <div className="git-selected-diff-heading">
                  <div>
                    <span>选中文件</span>
                    <code title={selectedPath}>{selectedPath}</code>
                  </div>
                  <span>Diff</span>
                </div>
                <div className="git-diff-toolbar">
                  <label className="git-diff-toggle">
                    <input
                      type="checkbox"
                      checked={stagedDiff}
                      onChange={(event) => onStagedDiffChange(event.target.checked)}
                    />
                    staged
                  </label>
                  <label className="git-whitespace-select">
                    <span>空白</span>
                    <select
                      aria-label="Diff 空白处理"
                      value={whitespace}
                      onChange={(event) =>
                        onWhitespaceChange(
                          event.target.value as
                            | 'default'
                            | 'ignore-all-space'
                            | 'ignore-space-change'
                            | 'ignore-blank-lines',
                        )
                      }
                    >
                      <option value="default">保留</option>
                      <option value="ignore-all-space">忽略全部</option>
                      <option value="ignore-space-change">忽略变化</option>
                      <option value="ignore-blank-lines">忽略空行</option>
                    </select>
                  </label>
                </div>
                {diff.isLoading ? (
                  <LoadingState label="正在读取 Diff" />
                ) : diff.error ? (
                  <ErrorState error={diff.error} retry={() => diff.refetch()} />
                ) : (
                  <DiffViewer
                    patch={diff.data?.patch ?? ''}
                    truncated={Boolean(diff.data?.truncated)}
                    path={selectedPath}
                  />
                )}
              </section>
            )}
          </>
        ))}

      {view === 'history' && (
        <div className="git-view-content">
          {commits.isLoading ? (
            <LoadingState label="正在读取提交历史" />
          ) : commits.error ? (
            <ErrorState error={commits.error} retry={() => commits.refetch()} />
          ) : !commits.data?.length ? (
            <EmptyState title="还没有提交" description="这个 Git 仓库尚无提交历史。" />
          ) : (
            <div className="git-history-list">
              {commits.data.map((item) => (
                <article key={item.sha}>
                  <strong>{item.subject}</strong>
                  <span>
                    <code>{item.shortSha}</code> · {item.authorName}
                  </span>
                  <time dateTime={item.authoredAt}>{formatGitTime(item.authoredAt)}</time>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'branches' && (
        <div className="git-view-content">
          {branches.isLoading ? (
            <LoadingState label="正在读取分支" />
          ) : branches.error ? (
            <ErrorState error={branches.error} retry={() => branches.refetch()} />
          ) : !branches.data?.length ? (
            <EmptyState title="没有本地分支" description="这个 Git 仓库尚无可展示的分支。" />
          ) : (
            <div className="git-branch-list">
              {branches.data.map((item) => (
                <article key={item.name} className={item.current ? 'current' : undefined}>
                  <GitBranch size={15} />
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.upstream ?? '未跟踪远端分支'}</span>
                  </div>
                  <code>{item.sha.slice(0, 8)}</code>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

function GitChangeTreeNode({
  node,
  depth,
  selectedPath,
  selectedPaths,
  onTogglePath,
  onSelectPath,
  onSelectView,
}: {
  node: GitChangeTreeNode;
  depth: number;
  selectedPath?: string | undefined;
  selectedPaths: string[];
  onTogglePath: (path: string) => void;
  onSelectPath?: ((path: string, view?: 'diff' | 'files') => void) | undefined;
  onSelectView: (view: 'changes' | 'history' | 'branches') => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (node.kind === 'directory') {
    return (
      <div
        className="git-change-directory"
        role="treeitem"
        aria-level={depth + 1}
        aria-label={`${node.path || 'Project 根目录'}，${node.fileCount} 个文件`}
      >
        <button
          type="button"
          className="git-change-directory-label"
          style={{ paddingInlineStart: depth * 14 }}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <ChevronDown size={12} aria-hidden="true" />
          ) : (
            <ChevronRight size={12} aria-hidden="true" />
          )}
          <FolderGit2 size={14} aria-hidden="true" />
          <strong>{node.name === '.' ? 'Project 根目录' : node.name}</strong>
          <small>{node.fileCount}</small>
        </button>
        {expanded ? (
          <div className="git-change-tree-children">
            {node.children.map((child) => (
              <GitChangeTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                selectedPaths={selectedPaths}
                onTogglePath={onTogglePath}
                onSelectPath={onSelectPath}
                onSelectView={onSelectView}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const { entry } = node;
  const presentation = presentGitChange(entry);
  const lineStats = combineLineStats(entry.stagedStats, entry.worktreeStats);
  const untracked = entry.index === '?' && entry.worktree === '?';
  return (
    <div
      className={`git-change-row${selectedPath === entry.path ? ' selected' : ''}`}
      role="treeitem"
      aria-level={depth + 1}
      key={`${entry.path}-${entry.index}-${entry.worktree}`}
    >
      <label style={{ paddingInlineStart: depth * 14 }}>
        <input
          type="checkbox"
          checked={selectedPaths.includes(entry.path)}
          onChange={() => onTogglePath(entry.path)}
          aria-label={`选择 ${entry.path}`}
        />
        <span
          className={`git-change-glyph ${presentation.tone}`}
          title={presentation.label}
          aria-label={presentation.label}
        >
          {presentation.glyph}
        </span>
        <span className="git-change-path" title={entry.path}>
          {node.name}
          {entry.originalPath ? (
            <small className="git-change-origin">从 {entry.originalPath}</small>
          ) : null}
        </span>
        <small className="git-change-state" title={presentation.label}>
          {lineStats ? (
            <>
              <span className="additions">+{lineStats.additions}</span>
              <span className="deletions">−{lineStats.deletions}</span>
            </>
          ) : (
            presentation.label
          )}
        </small>
      </label>
      {onSelectPath ? (
        <button
          type="button"
          className="git-change-preview"
          aria-label={`查看 ${entry.path} ${untracked ? '文件' : 'Diff'}`}
          onClick={() => {
            if (untracked) {
              onSelectPath(entry.path, 'files');
              onSelectView('changes');
            } else {
              onSelectPath(entry.path, 'diff');
            }
          }}
        >
          {untracked ? '文件' : 'Diff'}
        </button>
      ) : null}
    </div>
  );
}

function presentGitChange(entry: { index: string; worktree: string; originalPath?: string }): {
  glyph: string;
  label: string;
  tone: 'conflict' | 'rename' | 'added' | 'deleted' | 'changed' | 'untracked';
} {
  const { index, worktree } = entry;
  const porcelain = `${index}${worktree}`;
  // Git reports unmerged entries using all six two-letter combinations, not
  // just `UU`; preserve each as an explicit conflict instead of presenting a
  // delete/add pair as an ordinary change.
  const conflict = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']).has(porcelain);
  const staged = index !== ' ' && index !== '?';
  const unstaged = worktree !== ' ' && worktree !== '?';
  if (conflict) return { glyph: '!', label: '冲突', tone: 'conflict' };
  if (entry.originalPath || index === 'R' || worktree === 'R') {
    return {
      glyph: '→',
      label: staged && unstaged ? '重命名并有未暂存修改' : '重命名',
      tone: 'rename',
    };
  }
  if (index === '?' && worktree === '?') return { glyph: '+', label: '未跟踪', tone: 'untracked' };
  if (index === 'D' || worktree === 'D') {
    return {
      glyph: '−',
      label: staged && unstaged ? '删除并有未暂存修改' : '已删除',
      tone: 'deleted',
    };
  }
  if (index === 'A' || worktree === 'A') {
    return {
      glyph: '+',
      label: staged && unstaged ? '新增并有未暂存修改' : '已新增',
      tone: 'added',
    };
  }
  return {
    glyph: '~',
    label: staged && unstaged ? '已暂存并有未暂存修改' : staged ? '已暂存修改' : '未暂存修改',
    tone: 'changed',
  };
}

function combineLineStats(
  staged: { additions: number; deletions: number } | undefined,
  worktree: { additions: number; deletions: number } | undefined,
): { additions: number; deletions: number } | undefined {
  if (!staged && !worktree) return undefined;
  return {
    additions: (staged?.additions ?? 0) + (worktree?.additions ?? 0),
    deletions: (staged?.deletions ?? 0) + (worktree?.deletions ?? 0),
  };
}

function formatGitTime(value: string): string {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString('zh-CN', { hour12: false });
}

export const GitInspector = GitChangesTree;
