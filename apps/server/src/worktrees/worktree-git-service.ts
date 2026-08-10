import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { runProcess, type ProcessResult } from '@agenthub/agent-core';

import { AppError } from '../errors.js';

const GIT_EXECUTABLE = '/usr/bin/git';
const SAFE_PATH_SEGMENT = /^[0-9a-f-]{1,64}$/i;

export interface WorktreeBase {
  branch: string;
  sha: string;
}

export interface WorktreeReview {
  worktreePath: string;
  baseSha: string;
  headSha: string;
  taskBranch: string;
  clean: boolean;
  aheadBy: number;
  entries: Array<{
    index: string;
    worktree: string;
    path: string;
    originalPath?: string;
  }>;
  patch: string;
  diffStat: string;
  truncated: boolean;
}

export interface WorktreeMergeResult {
  mergeCommitSha: string;
  managedCommitSha?: string;
  merged: boolean;
}

export class WorktreeGitService {
  private canonicalRoot?: string;

  constructor(private readonly managedRoot: string) {
    if (!isAbsolute(managedRoot)) {
      throw new AppError(500, 'WORKTREE_ROOT_NOT_ABSOLUTE', 'Worktree managed root 必须是绝对路径');
    }
  }

  async inspectBase(projectRoot: string, requestedBranch?: string): Promise<WorktreeBase> {
    const branch = requestedBranch || (await this.currentBranch(projectRoot));
    await validateBranch(branch);
    const result = await git(
      ['-C', projectRoot, 'rev-parse', '--verify', `refs/heads/${branch}^{commit}`],
      64_000,
    );
    requireGitSuccess(result, 'WORKTREE_BASE_BRANCH_NOT_FOUND', '指定的 base branch 不存在');
    return { branch, sha: result.stdout.trim() };
  }

  taskBranch(taskId: string, executionId: string): string {
    requireSafeSegment(taskId);
    requireSafeSegment(executionId);
    return `agenthub/task-${taskId.slice(0, 8)}-${executionId.slice(0, 8)}`;
  }

  async create(input: {
    projectRoot: string;
    projectId: string;
    executionId: string;
    taskBranch: string;
    baseSha: string;
  }): Promise<string> {
    requireSafeSegment(input.projectId);
    requireSafeSegment(input.executionId);
    await validateBranch(input.taskBranch);
    await this.assertProjectRepository(input.projectRoot);

    const root = await this.root();
    const projectDirectory = join(root, input.projectId);
    assertContained(root, projectDirectory);
    await mkdir(projectDirectory, { recursive: true });
    assertContained(root, await realpath(projectDirectory));

    const worktreePath = join(projectDirectory, input.executionId);
    assertContained(root, worktreePath);
    if (await pathExists(worktreePath)) {
      throw new AppError(409, 'WORKTREE_PATH_EXISTS', '受管 Worktree 路径已经存在');
    }

    const branchExists = await git([
      '-C',
      input.projectRoot,
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${input.taskBranch}`,
    ]);
    if (branchExists.exitCode === 0) {
      throw new AppError(409, 'WORKTREE_TASK_BRANCH_EXISTS', '任务分支已经存在');
    }
    if (branchExists.exitCode !== 1) {
      throw new AppError(409, 'WORKTREE_BRANCH_CHECK_FAILED', '任务分支检查失败');
    }

    const created = await git(
      [
        '-C',
        input.projectRoot,
        'worktree',
        'add',
        '-b',
        input.taskBranch,
        worktreePath,
        input.baseSha,
      ],
      2 * 1024 * 1024,
    );
    requireGitSuccess(created, 'WORKTREE_CREATE_FAILED', 'Git Worktree 创建失败');
    await this.assertIdentity(input.projectRoot, worktreePath, input.taskBranch);
    return await realpath(worktreePath);
  }

  async review(input: {
    projectRoot: string;
    worktreePath: string;
    baseSha: string;
    taskBranch: string;
  }): Promise<WorktreeReview> {
    const worktreePath = await this.assertManagedExistingPath(input.worktreePath);
    await this.assertIdentity(input.projectRoot, worktreePath, input.taskBranch);
    const [status, trackedPatch, stat, head, ahead] = await Promise.all([
      git(['-C', worktreePath, 'status', '--porcelain=v1', '-z', '--untracked-files=all']),
      git(
        [
          '-C',
          worktreePath,
          'diff',
          '--no-ext-diff',
          '--no-color',
          '--unified=3',
          input.baseSha,
          '--',
        ],
        4 * 1024 * 1024,
      ),
      git([
        '-C',
        worktreePath,
        'diff',
        '--no-ext-diff',
        '--no-color',
        '--stat',
        input.baseSha,
        '--',
      ]),
      git(['-C', worktreePath, 'rev-parse', 'HEAD'], 64_000),
      git(['-C', worktreePath, 'rev-list', '--count', `${input.baseSha}..HEAD`], 64_000),
    ]);
    requireGitSuccess(status, 'WORKTREE_STATUS_FAILED', 'Worktree Git status 读取失败');
    requireGitSuccess(trackedPatch, 'WORKTREE_DIFF_FAILED', 'Worktree Diff 读取失败');
    requireGitSuccess(stat, 'WORKTREE_DIFF_FAILED', 'Worktree Diff 统计读取失败');
    requireGitSuccess(head, 'WORKTREE_HEAD_FAILED', 'Worktree HEAD 读取失败');
    requireGitSuccess(ahead, 'WORKTREE_HISTORY_FAILED', 'Worktree 提交历史读取失败');
    const entries = parseStatus(status.stdout);
    const untrackedPatch = await readUntrackedPatch(
      worktreePath,
      entries,
      Math.max(0, 4 * 1024 * 1024 - Buffer.byteLength(trackedPatch.stdout)),
    );
    return {
      worktreePath,
      baseSha: input.baseSha,
      headSha: head.stdout.trim(),
      taskBranch: input.taskBranch,
      clean: entries.length === 0,
      aheadBy: Number(ahead.stdout.trim()),
      entries,
      patch: `${trackedPatch.stdout}${untrackedPatch.patch}`,
      diffStat: stat.stdout,
      truncated: trackedPatch.truncated || untrackedPatch.truncated || stat.truncated,
    };
  }

  async commitAndMerge(input: {
    projectRoot: string;
    worktreePath: string;
    baseBranch: string;
    baseSha: string;
    taskBranch: string;
    commitMessage: string;
  }): Promise<WorktreeMergeResult> {
    const worktreePath = await this.assertManagedExistingPath(input.worktreePath);
    await validateBranch(input.baseBranch);
    await validateBranch(input.taskBranch);
    await this.assertIdentity(input.projectRoot, worktreePath, input.taskBranch);
    await this.assertPrimaryMergeReady(input.projectRoot, input.baseBranch, input.baseSha);

    const add = await git(['-C', worktreePath, 'add', '-A']);
    requireGitSuccess(add, 'WORKTREE_STAGE_FAILED', 'Worktree 变更暂存失败');
    const staged = await git(['-C', worktreePath, 'diff', '--cached', '--quiet']);
    if (![0, 1].includes(staged.exitCode ?? -1)) {
      throw new AppError(409, 'WORKTREE_STAGE_CHECK_FAILED', 'Worktree 暂存状态检查失败');
    }

    let managedCommitSha: string | undefined;
    if (staged.exitCode === 1) {
      const committed = await git(
        ['-C', worktreePath, 'commit', '-m', input.commitMessage],
        2 * 1024 * 1024,
      );
      requireGitSuccess(committed, 'WORKTREE_COMMIT_FAILED', 'Worktree 受管提交创建失败');
      managedCommitSha = await readHead(worktreePath);
    }

    await this.assertPrimaryMergeReady(input.projectRoot, input.baseBranch, input.baseSha);
    const unmergedCount = await git([
      '-C',
      input.projectRoot,
      'rev-list',
      '--count',
      `${input.baseBranch}..${input.taskBranch}`,
    ]);
    requireGitSuccess(unmergedCount, 'WORKTREE_HISTORY_FAILED', '任务分支提交历史读取失败');
    if (Number(unmergedCount.stdout.trim()) === 0) {
      return {
        mergeCommitSha: await readHead(input.projectRoot),
        ...(managedCommitSha ? { managedCommitSha } : {}),
        merged: false,
      };
    }

    const conflictCheck = await git(
      ['-C', input.projectRoot, 'merge-tree', '--write-tree', input.baseBranch, input.taskBranch],
      2 * 1024 * 1024,
    );
    if (conflictCheck.exitCode !== 0) {
      throw new AppError(409, 'WORKTREE_MERGE_CONFLICT', '任务分支与 base branch 存在冲突');
    }

    const merged = await git(
      ['-C', input.projectRoot, 'merge', '--no-ff', '--no-edit', input.taskBranch],
      2 * 1024 * 1024,
    );
    if (merged.exitCode !== 0) {
      await git(['-C', input.projectRoot, 'merge', '--abort']);
      throw new AppError(409, 'WORKTREE_MERGE_FAILED', '任务分支合并失败，已尝试恢复主工作区');
    }
    return {
      mergeCommitSha: await readHead(input.projectRoot),
      ...(managedCommitSha ? { managedCommitSha } : {}),
      merged: true,
    };
  }

  private async root(): Promise<string> {
    if (this.canonicalRoot) return this.canonicalRoot;
    await mkdir(this.managedRoot, { recursive: true });
    this.canonicalRoot = await realpath(this.managedRoot);
    return this.canonicalRoot;
  }

  private async assertManagedExistingPath(path: string): Promise<string> {
    const root = await this.root();
    assertContained(root, resolve(path));
    let canonical: string;
    try {
      canonical = await realpath(path);
    } catch (error) {
      throw new AppError(404, 'WORKTREE_NOT_FOUND', '受管 Worktree 不存在', undefined, {
        cause: error,
      });
    }
    assertContained(root, canonical);
    return canonical;
  }

  private async assertProjectRepository(projectRoot: string): Promise<void> {
    const result = await git(['-C', projectRoot, 'rev-parse', '--is-inside-work-tree'], 64_000);
    if (result.exitCode !== 0 || result.stdout.trim() !== 'true') {
      throw new AppError(409, 'PROJECT_NOT_GIT', 'Project 不是可用的 Git 工作区');
    }
  }

  private async assertIdentity(
    projectRoot: string,
    worktreePath: string,
    taskBranch: string,
  ): Promise<void> {
    const [projectCommon, worktreeCommon, branch] = await Promise.all([
      git(['-C', projectRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir']),
      git(['-C', worktreePath, 'rev-parse', '--path-format=absolute', '--git-common-dir']),
      this.currentBranch(worktreePath),
    ]);
    requireGitSuccess(projectCommon, 'PROJECT_NOT_GIT', 'Project Git identity 读取失败');
    requireGitSuccess(
      worktreeCommon,
      'WORKTREE_IDENTITY_MISMATCH',
      'Worktree Git identity 读取失败',
    );
    const [projectCommonPath, worktreeCommonPath] = await Promise.all([
      realpath(projectCommon.stdout.trim()),
      realpath(worktreeCommon.stdout.trim()),
    ]);
    if (projectCommonPath !== worktreeCommonPath || branch !== taskBranch) {
      throw new AppError(
        409,
        'WORKTREE_IDENTITY_MISMATCH',
        'Worktree 不属于登记的 Project 或任务分支',
      );
    }
  }

  private async assertPrimaryMergeReady(
    projectRoot: string,
    baseBranch: string,
    baseSha: string,
  ): Promise<void> {
    const [status, branch, ancestor] = await Promise.all([
      git(['-C', projectRoot, 'status', '--porcelain=v1', '-z', '--untracked-files=all']),
      this.currentBranch(projectRoot),
      git(['-C', projectRoot, 'merge-base', '--is-ancestor', baseSha, baseBranch]),
    ]);
    requireGitSuccess(status, 'GIT_STATUS_FAILED', 'Project Git status 读取失败');
    if (status.stdout.length > 0) {
      throw new AppError(409, 'PRIMARY_WORKTREE_DIRTY', 'Project 主工作区存在未提交变更');
    }
    if (branch !== baseBranch) {
      throw new AppError(409, 'PRIMARY_BRANCH_CHANGED', 'Project 当前分支已不是登记的 base branch');
    }
    if (ancestor.exitCode !== 0) {
      throw new AppError(409, 'WORKTREE_BASE_DIVERGED', 'base branch 历史已替换，不能安全合并');
    }
  }

  private async currentBranch(cwd: string): Promise<string> {
    const result = await git(['-C', cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD'], 64_000);
    requireGitSuccess(result, 'GIT_DETACHED_HEAD', 'Git 工作区当前处于 detached HEAD');
    return result.stdout.trim();
  }
}

async function validateBranch(branch: string): Promise<void> {
  if (!branch || branch.length > 240) {
    throw new AppError(400, 'GIT_BRANCH_INVALID', 'Git branch 名称不合法');
  }
  const result = await git(['check-ref-format', '--branch', branch], 64_000);
  if (result.exitCode !== 0) {
    throw new AppError(400, 'GIT_BRANCH_INVALID', 'Git branch 名称不合法');
  }
}

function requireSafeSegment(value: string): void {
  if (!SAFE_PATH_SEGMENT.test(value)) {
    throw new AppError(400, 'WORKTREE_PATH_SEGMENT_INVALID', 'Worktree 标识不合法');
  }
}

function assertContained(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (
    pathFromRoot !== '' &&
    (isAbsolute(pathFromRoot) || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`))
  ) {
    throw new AppError(403, 'WORKTREE_PATH_ESCAPE', 'Worktree 路径超出受管目录');
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function parseStatus(raw: string): WorktreeReview['entries'] {
  const chunks = raw.split('\0').filter(Boolean);
  const entries: WorktreeReview['entries'] = [];
  while (chunks.length > 0) {
    const record = chunks.shift();
    if (!record || record.length < 4) continue;
    const entry: WorktreeReview['entries'][number] = {
      index: record[0] ?? ' ',
      worktree: record[1] ?? ' ',
      path: record.slice(3),
    };
    if (/[RC]/.test(`${entry.index}${entry.worktree}`)) {
      const originalPath = chunks.shift();
      if (originalPath) entry.originalPath = originalPath;
    }
    entries.push(entry);
  }
  return entries;
}

async function readUntrackedPatch(
  worktreePath: string,
  entries: WorktreeReview['entries'],
  maxOutputBytes: number,
): Promise<{ patch: string; truncated: boolean }> {
  const chunks: string[] = [];
  let capturedBytes = 0;
  let truncated = false;
  const untracked = entries.filter((entry) => entry.index === '?' && entry.worktree === '?');
  for (const entry of untracked) {
    const candidate = resolve(worktreePath, entry.path);
    assertContained(worktreePath, candidate);
    const metadata = await lstat(candidate);
    if (!metadata.isFile()) continue;
    assertContained(worktreePath, await realpath(candidate));
    const remaining = maxOutputBytes - capturedBytes;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const result = await git(
      ['-C', worktreePath, 'diff', '--no-index', '--no-color', '--', '/dev/null', entry.path],
      remaining,
    );
    if (![0, 1].includes(result.exitCode ?? -1)) {
      throw new AppError(409, 'WORKTREE_DIFF_FAILED', '未跟踪文件 Diff 读取失败');
    }
    chunks.push(result.stdout);
    capturedBytes += Buffer.byteLength(result.stdout);
    truncated ||= result.truncated;
  }
  return { patch: chunks.join(''), truncated };
}

async function readHead(cwd: string): Promise<string> {
  const result = await git(['-C', cwd, 'rev-parse', 'HEAD'], 64_000);
  requireGitSuccess(result, 'WORKTREE_HEAD_FAILED', 'Git HEAD 读取失败');
  return result.stdout.trim();
}

async function git(args: string[], maxOutputBytes = 1024 * 1024): Promise<ProcessResult> {
  return runProcess({
    executable: GIT_EXECUTABLE,
    args,
    timeoutMs: 30_000,
    maxOutputBytes,
  });
}

function requireGitSuccess(result: ProcessResult, code: string, message: string): void {
  if (result.exitCode !== 0) throw new AppError(409, code, message);
}
