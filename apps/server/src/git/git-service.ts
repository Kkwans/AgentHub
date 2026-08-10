import { randomUUID } from 'node:crypto';
import { access, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runProcess, type ProcessResult } from '@agenthub/agent-core';
import type {
  AgentHubDatabase,
  ExecutionTargetRepository,
  GitSnapshotRepository,
  ProjectRepository,
} from '@agenthub/db';

import { AppError } from '../errors.js';
import { assertContained, validateRelativePath } from '../projects/path-security.js';
import type { GitHeadProbe } from '../sessions/session-service.js';

export interface GitStatusEntry {
  index: string;
  worktree: string;
  path: string;
  originalPath?: string;
}

export interface GitStatusReport {
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  headSha?: string;
  clean: boolean;
  entries: GitStatusEntry[];
}

export class GitService implements GitHeadProbe {
  constructor(
    private readonly projects: ProjectRepository<AgentHubDatabase>,
    private readonly snapshots: GitSnapshotRepository<AgentHubDatabase>,
    private readonly targets?: ExecutionTargetRepository<AgentHubDatabase>,
  ) {}

  async status(projectId: string): Promise<GitStatusReport> {
    const project = await this.requireGitProject(projectId);
    return this.statusAt(project.realRootPath);
  }

  async diff(projectId: string, input: { staged?: boolean; path?: string }) {
    const project = await this.requireGitProject(projectId);
    const path = input.path
      ? await validateGitPath(project.realRootPath, input.path, true)
      : undefined;
    const args = [
      '-C',
      project.realRootPath,
      'diff',
      '--no-ext-diff',
      '--no-color',
      '--unified=3',
      ...(input.staged ? ['--cached'] : []),
      ...(path ? ['--', path] : []),
    ];
    const result = await runGit(args, 4 * 1024 * 1024);
    requireSuccess(result, 'GIT_DIFF_FAILED', 'Git Diff 读取失败');
    return { patch: result.stdout, truncated: result.truncated, staged: input.staged === true };
  }

  async commits(projectId: string, limit = 50) {
    const project = await this.requireGitProject(projectId);
    const result = await runGit([
      '-C',
      project.realRootPath,
      'log',
      `-n${Math.min(Math.max(limit, 1), 200)}`,
      '--date=iso-strict',
      '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x1e',
    ]);
    requireSuccess(result, 'GIT_LOG_FAILED', 'Git 提交历史读取失败');
    return result.stdout
      .split('\x1e')
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [sha, shortSha, authorName, authorEmail, authoredAt, subject] = record.split('\x1f');
        return { sha, shortSha, authorName, authorEmail, authoredAt, subject };
      });
  }

  async branches(projectId: string) {
    const project = await this.requireGitProject(projectId);
    const result = await runGit([
      '-C',
      project.realRootPath,
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)%00%(objectname)%00%(HEAD)%00%(upstream:short)%00%(committerdate:iso-strict)',
      'refs/heads',
    ]);
    requireSuccess(result, 'GIT_BRANCHES_FAILED', 'Git 分支读取失败');
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, sha, head, upstream, committedAt] = line.split('\0');
        return { name, sha, current: head === '*', upstream: upstream || undefined, committedAt };
      });
  }

  async commit(
    projectId: string,
    input: { message: string; mode: 'STAGED' | 'SELECTED'; paths?: string[] },
  ) {
    const project = await this.requireGitProject(projectId);
    let paths: string[] = [];
    if (input.mode === 'SELECTED') {
      if (!input.paths?.length) {
        throw new AppError(400, 'GIT_COMMIT_PATHS_REQUIRED', 'selected-files commit 必须选择文件');
      }
      paths = await Promise.all(
        input.paths.map((path) => validateGitPath(project.realRootPath, path, false)),
      );
      const add = await runGit(['-C', project.realRootPath, 'add', '--', ...paths]);
      requireSuccess(add, 'GIT_ADD_SELECTED_FAILED', '所选文件暂存失败');
    }
    const before = await this.readHead(project.realRootPath);
    const result = await runGit([
      '-C',
      project.realRootPath,
      'commit',
      ...(input.mode === 'SELECTED' ? ['--only'] : []),
      '-m',
      input.message,
      ...(paths.length ? ['--', ...paths] : []),
    ]);
    requireSuccess(result, 'GIT_COMMIT_FAILED', 'Git 提交失败');
    const after = await this.readHead(project.realRootPath);
    return { beforeSha: before, sha: after, output: result.stdout.trim() };
  }

  async readHead(cwd: string): Promise<string | undefined> {
    const result = await runGit(['-C', cwd, 'rev-parse', 'HEAD'], 64_000);
    return result.exitCode === 0 ? result.stdout.trim() || undefined : undefined;
  }

  async capture(
    runId: string,
    projectId: string,
    cwd: string,
    type: 'BEFORE' | 'AFTER' | 'REVIEW',
  ) {
    const project = await this.projects.get(projectId);
    if (!project || project.repoKind !== 'GIT') return undefined;
    if (await this.isRemote(project.targetId)) return undefined;
    const status = await this.statusAt(cwd);
    return this.snapshots.create({
      id: randomUUID(),
      runId,
      projectId,
      snapshotType: type,
      headSha: status.headSha,
      branch: status.branch,
      statusJson: status as unknown as Record<string, unknown>,
      diffStatJson: summarizeStatus(status.entries),
    });
  }

  private async statusAt(cwd: string): Promise<GitStatusReport> {
    const result = await runGit([
      '-C',
      cwd,
      'status',
      '--porcelain=v1',
      '--branch',
      '-z',
      '--untracked-files=all',
    ]);
    if (result.exitCode !== 0) return { clean: true, entries: [] };
    const chunks = result.stdout.split('\0').filter(Boolean);
    const header = chunks[0]?.startsWith('## ') ? chunks.shift()?.slice(3) : undefined;
    const entries: GitStatusEntry[] = [];
    while (chunks.length) {
      const record = chunks.shift();
      if (!record || record.length < 4) continue;
      const entry: GitStatusEntry = {
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
    const branch = parseBranchHeader(header);
    const headSha = await this.readHead(cwd);
    return {
      ...branch,
      ...(headSha ? { headSha } : {}),
      clean: entries.length === 0,
      entries,
    };
  }

  private async requireGitProject(id: string) {
    const project = await this.projects.get(id);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project 不存在');
    if (project.repoKind !== 'GIT')
      throw new AppError(409, 'PROJECT_NOT_GIT', 'Project 不是 Git 仓库');
    if (await this.isRemote(project.targetId)) {
      throw new AppError(409, 'REMOTE_GIT_UNSUPPORTED', 'v0.2 暂不提供 Remote Node Git 控制接口');
    }
    return project;
  }

  private async isRemote(targetId: string): Promise<boolean> {
    return (await this.targets?.get(targetId))?.kind === 'REMOTE_NODE';
  }
}

async function validateGitPath(
  root: string,
  requested: string,
  mustExist: boolean,
): Promise<string> {
  const path = validateRelativePath(requested);
  const absolute = resolve(root, path);
  assertContained(root, absolute, 'PATH_TRAVERSAL');
  let exists = true;
  try {
    await access(absolute);
  } catch (error) {
    exists = false;
    if (mustExist) {
      throw new AppError(404, 'FILE_NOT_FOUND', 'Git path 不存在', undefined, { cause: error });
    }
  }
  if (exists) assertContained(root, await realpath(absolute), 'SYMLINK_ESCAPE');
  return path;
}

function parseBranchHeader(
  header?: string,
): Omit<GitStatusReport, 'headSha' | 'clean' | 'entries'> {
  if (!header) return {};
  const countsAt = header.lastIndexOf(' [');
  const tracking = countsAt >= 0 ? header.slice(0, countsAt) : header;
  const counts = countsAt >= 0 ? header.slice(countsAt + 1) : '';
  const upstreamAt = tracking.indexOf('...');
  const branch = upstreamAt >= 0 ? tracking.slice(0, upstreamAt) : tracking;
  const upstream = upstreamAt >= 0 ? tracking.slice(upstreamAt + 3) : undefined;
  const ahead = /ahead (?<value>\d+)/.exec(counts)?.groups?.value;
  const behind = /behind (?<value>\d+)/.exec(counts)?.groups?.value;
  return {
    ...(branch ? { branch } : {}),
    ...(upstream ? { upstream } : {}),
    ...(ahead ? { ahead: Number(ahead) } : {}),
    ...(behind ? { behind: Number(behind) } : {}),
  };
}

function summarizeStatus(entries: GitStatusEntry[]): Record<string, unknown> {
  return {
    total: entries.length,
    staged: entries.filter((entry) => entry.index !== ' ' && entry.index !== '?').length,
    unstaged: entries.filter((entry) => entry.worktree !== ' ').length,
    untracked: entries.filter((entry) => entry.index === '?' && entry.worktree === '?').length,
  };
}

async function runGit(args: string[], maxOutputBytes = 2 * 1024 * 1024) {
  return runProcess({
    executable: '/usr/bin/git',
    args,
    timeoutMs: 30_000,
    maxOutputBytes,
  });
}

function requireSuccess(result: ProcessResult, code: string, message: string): void {
  if (result.exitCode !== 0) throw new AppError(409, code, message);
}
