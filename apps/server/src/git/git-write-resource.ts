import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { runProcess, type ProcessResult } from '@agenthub/agent-core';
import { AppError } from '../errors.js';

type Project = {
  id: string;
  targetId: string;
  realRootPath: string;
  repoKind: string;
  status: string;
};
type Target = { id: string; kind: string };
export type GitWriteResource = Readonly<{
  projectId: string;
  targetId: string;
  executionDeviceId: string;
  repositoryKey: string;
  canonicalCommonDir: string;
  worktreeIdentity: string;
  head: string | null;
}>;
// Snapshot normal user configuration/credential transports for both probe and
// executor, but discard ambient Git routing/config overrides. Disabling HOME or
// global config would break existing author identity, signing and hooks.
export function isolateGitEnvironment(environment: NodeJS.ProcessEnv) {
  return Object.freeze({
    ...Object.fromEntries(
      Object.entries(environment).filter(
        ([key, value]) => !key.toUpperCase().startsWith('GIT_') && value !== undefined,
      ),
    ),
    GIT_TERMINAL_PROMPT: '0',
  });
}
export const isolatedGitEnvironment = isolateGitEnvironment(process.env);
const sha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
function fail(code = 'GIT_RESOURCE_READ_FAILED'): never {
  throw new AppError(409, code, '无法权威核对本地 Git 资源，未允许写入。');
}
async function probe(root: string, args: string[]): Promise<ProcessResult> {
  const result = await runProcess({
    executable: '/usr/bin/git',
    args: ['--no-optional-locks', '-C', root, ...args],
    // Never allow ambient GIT_DIR/GIT_WORK_TREE/config overrides to redirect identity.
    inheritEnv: false,
    env: isolatedGitEnvironment,
    timeoutMs: 10_000,
    maxOutputBytes: 64_000,
  });
  if (result.timedOut || result.canceled || result.truncated || result.signal) fail();
  return result;
}
function oneLine(result: ProcessResult): string {
  const value = result.stdout.trim();
  if (result.exitCode !== 0 || !value || /[\r\n\0]/.test(value)) fail();
  return value;
}
async function headAt(root: string): Promise<string | null> {
  const head = await probe(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (head.exitCode === 0) {
    const value = oneLine(head);
    if (!sha.test(value)) fail('GIT_HEAD_INVALID');
    return value.toLowerCase();
  }
  if (head.exitCode !== 1 || head.stdout.trim() || head.stderr.trim()) fail('GIT_HEAD_READ_FAILED');
  const symbolic = oneLine(await probe(root, ['symbolic-ref', '--quiet', 'HEAD']));
  if (!symbolic.startsWith('refs/heads/')) fail('GIT_HEAD_INVALID');
  if ((await probe(root, ['check-ref-format', symbolic])).exitCode !== 0) fail('GIT_HEAD_INVALID');
  // --exists has distinct missing(2) and lookup-error(1) exits. Unsupported Git
  // versions fail closed instead of treating a read error as an unborn branch.
  const exists = await probe(root, ['show-ref', '--exists', symbolic]);
  if (exists.exitCode !== 2 || exists.stdout.trim()) fail('GIT_HEAD_READ_FAILED');
  const stillSymbolic = oneLine(await probe(root, ['symbolic-ref', '--quiet', 'HEAD']));
  const finalHead = await probe(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (
    stillSymbolic !== symbolic ||
    finalHead.exitCode !== 1 ||
    finalHead.stdout.trim() ||
    finalHead.stderr.trim()
  )
    fail('GIT_HEAD_CHANGED');
  return null;
}

/** Dormant read-only foundation. Device identity is trusted server configuration,
 * shared by LOCAL_HOST aliases, never a caller/project supplied target ID.
 * Call again after acquiring the claim immediately before dispatch; this is not
 * an atomic filesystem snapshot or a guard against unrelated external Git. */
export function createLocalGitWriteResourceResolver(input: {
  projects: { get(id: string): Promise<Project | undefined> };
  targets: { get(id: string): Promise<Target | undefined> };
  executionDeviceId: string;
}) {
  if (
    typeof input.executionDeviceId !== 'string' ||
    !input.executionDeviceId.trim() ||
    input.executionDeviceId !== input.executionDeviceId.trim()
  ) {
    throw new AppError(500, 'GIT_EXECUTION_DEVICE_REQUIRED', '必须配置明确的本地执行设备身份。');
  }
  const executionDeviceId = input.executionDeviceId;
  return async (projectId: string): Promise<GitWriteResource> => {
    const project = await input.projects.get(projectId);
    if (
      !project ||
      project.id !== projectId ||
      project.repoKind !== 'GIT' ||
      project.status !== 'ACTIVE'
    )
      fail('GIT_PROJECT_UNAVAILABLE');
    const target = await input.targets.get(project.targetId);
    if (!target || target.id !== project.targetId || target.kind !== 'LOCAL_HOST')
      fail('GIT_LOCAL_TARGET_REQUIRED');
    try {
      if (!isAbsolute(project.realRootPath)) fail('GIT_ROOT_INVALID');
      const root = await realpath(project.realRootPath);
      const worktreeIdentity = await realpath(
        oneLine(await probe(root, ['rev-parse', '--show-toplevel'])),
      );
      // A nested project root would change pathspec semantics at dispatch. Until
      // that protocol is explicit, admit only an exact canonical worktree root.
      if (root !== worktreeIdentity) fail('GIT_ROOT_NOT_WORKTREE');
      const common = oneLine(
        await probe(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      );
      if (!isAbsolute(common)) fail('GIT_COMMON_DIR_INVALID');
      const canonicalCommonDir = await realpath(common);
      const repositoryKey = `git:${createHash('sha256')
        .update(JSON.stringify([executionDeviceId, canonicalCommonDir]))
        .digest('hex')}`;
      return Object.freeze({
        projectId,
        targetId: target.id,
        executionDeviceId,
        repositoryKey,
        canonicalCommonDir,
        worktreeIdentity,
        head: await headAt(root),
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      fail();
    }
  };
}
