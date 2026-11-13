import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '@agenthub/agent-core';
import { afterEach, expect, it } from 'vitest';
import { createLocalGitWriteResourceResolver } from './git-write-resource.js';
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function git(root: string, args: string[]) {
  const result = await runProcess({
    executable: '/usr/bin/git',
    args: ['-C', root, ...args],
    timeoutMs: 10_000,
    maxOutputBytes: 64_000,
  });
  if (result.exitCode !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
async function fixture(committed = false, format = 'sha1') {
  const base = await mkdtemp(join(tmpdir(), 'agenthub-git-resource-'));
  temporary.push(base);
  const root = join(base, 'repository');
  await mkdir(root);
  await git(root, ['init', `--object-format=${format}`, '--initial-branch=main']);
  if (committed) {
    await writeFile(join(root, 'one.txt'), 'original\n');
    await git(root, ['add', 'one.txt']);
    await git(root, [
      '-c',
      'user.name=AgentHub Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'baseline',
    ]);
  }
  return { root, base };
}
function setup(root: string, kind = 'LOCAL_HOST', device = 'trusted-device') {
  const project = {
    id: 'project',
    targetId: 'target',
    realRootPath: root,
    repoKind: 'GIT',
    status: 'ACTIVE',
  };
  const target = { id: 'target', kind };
  return {
    project,
    target,
    resolve: createLocalGitWriteResourceResolver({
      projects: { get: async () => project },
      targets: { get: async () => target },
      executionDeviceId: device,
    }),
  };
}
it('明确unborn返回null且只读probe不创建index/refs或修改HEAD', async () => {
  const { root } = await fixture();
  const before = await readFile(join(root, '.git/HEAD'), 'utf8');
  const result = await setup(root).resolve('project');
  expect(result.head).toBeNull();
  expect(result.canonicalCommonDir).toBe(join(root, '.git'));
  expect(result.worktreeIdentity).toBe(root);
  expect(await readFile(join(root, '.git/HEAD'), 'utf8')).toBe(before);
  await expect(readFile(join(root, '.git/index'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it.each(['sha1', 'sha256'])('完整%s HEAD提交可验证，probe不改变HEAD/index', async (format) => {
  const { root } = await fixture(true, format);
  const beforeIndex = await readFile(join(root, '.git/index'));
  const expected = await git(root, ['rev-parse', 'HEAD']);
  const result = await setup(root).resolve('project');
  expect(result.head).toBe(expected);
  expect(result.head).toHaveLength(format === 'sha1' ? 40 : 64);
  expect(await readFile(join(root, '.git/index'))).toEqual(beforeIndex);
  expect(await git(root, ['rev-parse', 'HEAD'])).toBe(expected);
});
it('target/project/symlink别名及linked worktree共享同一设备common-dir资源键', async () => {
  const { root, base } = await fixture(true);
  const alias = join(base, 'alias');
  await symlink(root, alias);
  const linked = join(base, 'linked');
  await git(root, ['worktree', 'add', '-b', 'other', linked]);
  const original = await setup(root).resolve('project');
  const alternate = setup(alias);
  alternate.project.id = 'project-alias';
  alternate.project.targetId = 'target-alias';
  alternate.target.id = 'target-alias';
  const aliased = await alternate.resolve('project-alias');
  const worktree = await setup(linked).resolve('project');
  expect(aliased.repositoryKey).toBe(original.repositoryKey);
  expect(worktree.repositoryKey).toBe(original.repositoryKey);
  expect(aliased.worktreeIdentity).toBe(original.worktreeIdentity);
  expect(worktree.worktreeIdentity).not.toBe(original.worktreeIdentity);
  expect(
    (await setup(root, 'LOCAL_HOST', 'other-device').resolve('project')).repositoryKey,
  ).not.toBe(original.repositoryKey);
});
it('缺失Project或target、REMOTE_NODE、归档项目与空设备身份均failclosed', async () => {
  const { root } = await fixture();
  expect(() => setup(root, 'LOCAL_HOST', '')).toThrow('设备身份');
  const missingProject = createLocalGitWriteResourceResolver({
    projects: { get: async () => undefined },
    targets: { get: async () => undefined },
    executionDeviceId: 'device',
  });
  await expect(missingProject('project')).rejects.toMatchObject({
    code: 'GIT_PROJECT_UNAVAILABLE',
  });
  const { project } = setup(root);
  const missingTarget = createLocalGitWriteResourceResolver({
    projects: { get: async () => project },
    targets: { get: async () => undefined },
    executionDeviceId: 'device',
  });
  await expect(missingTarget('project')).rejects.toMatchObject({
    code: 'GIT_LOCAL_TARGET_REQUIRED',
  });
  await expect(setup(root, 'REMOTE_NODE').resolve('project')).rejects.toMatchObject({
    code: 'GIT_LOCAL_TARGET_REQUIRED',
  });
  const archived = setup(root);
  archived.project.status = 'ARCHIVED';
  await expect(archived.resolve('project')).rejects.toMatchObject({
    code: 'GIT_PROJECT_UNAVAILABLE',
  });
});
it('损坏/不可解析HEAD不是unborn，失效root不是null', async () => {
  const { root, base } = await fixture(true);
  await writeFile(join(root, '.git/HEAD'), 'not-a-valid-head\n');
  await expect(setup(root).resolve('project')).rejects.toThrow();
  await expect(setup(join(base, 'missing')).resolve('project')).rejects.toThrow();
});
it('已有symbolic分支指向不存在对象不是unborn', async () => {
  const { root } = await fixture();
  await writeFile(join(root, '.git/refs/heads/main'), `${'a'.repeat(40)}\n`);
  await expect(setup(root).resolve('project')).rejects.toThrow();
});
it('嵌套project路径会改变pathspec语义，当前保守拒绝而非猜测', async () => {
  const { root } = await fixture();
  const nested = join(root, 'nested');
  await mkdir(nested);
  await expect(setup(nested).resolve('project')).rejects.toMatchObject({
    code: 'GIT_ROOT_NOT_WORKTREE',
  });
});

it('ambient GIT_DIR/GIT_WORK_TREE不能将只读身份探测重定向到另一资源', async () => {
  const { root, base } = await fixture(true);
  const expected = await git(root, ['rev-parse', 'HEAD']);
  const oldDirectory = process.env.GIT_DIR;
  const oldWorktree = process.env.GIT_WORK_TREE;
  try {
    process.env.GIT_DIR = join(base, 'wrong-git-dir');
    process.env.GIT_WORK_TREE = join(base, 'wrong-worktree');
    const result = await setup(root).resolve('project');
    expect(result.head).toBe(expected);
    expect(result.canonicalCommonDir).toBe(join(root, '.git'));
  } finally {
    if (oldDirectory === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = oldDirectory;
    if (oldWorktree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = oldWorktree;
  }
});
