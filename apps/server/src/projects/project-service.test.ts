import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { runProcess } from '@agenthub/agent-core';
import { createPgliteDatabase, ExecutionTargetRepository, ProjectRepository } from '@agenthub/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProjectService } from './project-service.js';

describe('Project 预检与只读文件边界', () => {
  let database: Awaited<ReturnType<typeof createPgliteDatabase>>;
  let service: ProjectService;
  let targetId: string;
  let root: string;
  let outside: string;

  beforeAll(async () => {
    database = await createPgliteDatabase({ dataDir: 'memory://' });
    const targets = new ExecutionTargetRepository(database.db);
    const projects = new ProjectRepository(database.db);
    targetId = randomUUID();
    await targets.create({
      id: targetId,
      name: '测试宿主机',
      kind: 'LOCAL_HOST',
      hostname: 'test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    service = new ProjectService(projects, targets);
    root = await mkdtemp(join(tmpdir(), 'agenthub-project-'));
    outside = await mkdtemp(join(tmpdir(), 'agenthub-outside-'));
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'AGENTS.md'), '# 测试规则\n');
    await writeFile(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    await writeFile(join(root, 'src', 'index.ts'), 'export const value = 1;\n');
    await writeFile(join(outside, 'secret.txt'), '不得读取\n');
    await symlink(join(outside, 'secret.txt'), join(root, 'escape-link'));
    await runProcess({ executable: '/usr/bin/git', args: ['-C', root, 'init'], timeoutMs: 10_000 });
  });

  afterAll(async () => {
    await database.close();
  });

  it('添加 Project 时探测 canonical root、Git、规则文件与 package manager', async () => {
    const project = await service.add({
      name: 'Project Fixture',
      targetId,
      rootPath: root,
    });
    const report = await service.preflight(project.id);

    expect(project.realRootPath).toBe(root);
    expect(project.repoKind).toBe('GIT');
    expect(report).toMatchObject({
      status: 'READY',
      git: { detected: true },
      context: { agentsMd: true, packageManagers: ['pnpm'] },
    });
  });

  it('按 Execution Target 将 Remote Node Project 预检委托给远程适配器', async () => {
    const remoteTargetId = randomUUID();
    await new ExecutionTargetRepository(database.db).create({
      id: remoteTargetId,
      name: '测试 Remote Node',
      kind: 'REMOTE_NODE',
      hostname: 'remote-test',
      os: 'linux',
      arch: 'arm64',
      status: 'READY',
    });
    const calls: Array<[string, string]> = [];
    const remoteService = new ProjectService(
      new ProjectRepository(database.db),
      new ExecutionTargetRepository(database.db),
      {
        preflight: async (targetId, rootPath) => {
          calls.push([targetId, rootPath]);
          return {
            status: 'READY' as const,
            rootPath,
            canonicalRoot: rootPath,
            exists: true,
            directory: true,
            permissions: { readable: true, writable: true },
            git: { detected: false },
            context: {
              agentsMd: false,
              claudeMd: false,
              openSpec: false,
              packageManagers: [],
            },
            checks: [{ id: 'remote', status: 'PASS' as const, message: 'Remote fixture ready' }],
          };
        },
        listFiles: async () => [],
        readFile: async () => ({
          path: 'README.md',
          content: '',
          size: 0,
          sha256: '',
          modifiedAt: new Date(0).toISOString(),
          readOnly: true as const,
        }),
      },
    );

    await expect(
      remoteService.preflightForTarget(remoteTargetId, '/srv/remote-project'),
    ).resolves.toMatchObject({ status: 'READY', canonicalRoot: '/srv/remote-project' });
    expect(calls).toEqual([[remoteTargetId, '/srv/remote-project']]);
  });

  it('文件树只读并标记逃逸 symlink', async () => {
    const [project] = await service.list();
    if (!project) throw new Error('Project fixture 不存在');
    const tree = await service.listFiles(project.id, '', 2);
    const link = tree.find((entry) => entry.name === 'escape-link');
    expect(link).toMatchObject({ type: 'SYMLINK', blocked: true });
    const content = await service.readFile(project.id, 'src/index.ts');
    expect(content).toMatchObject({ content: 'export const value = 1;\n', readOnly: true });
  });

  it('在配置工作区根目录后拒绝越界 Project 路径', async () => {
    const restricted = new ProjectService(
      new ProjectRepository(database.db),
      new ExecutionTargetRepository(database.db),
      undefined,
      [outside],
    );
    const report = await restricted.preflightPath(root);
    expect(report).toMatchObject({ status: 'BROKEN', canonicalRoot: root });
    expect(report.checks.at(-1)?.message).toContain('授权的工作区范围');
  });

  it('编辑只更新用户说明，归档不会删除 Project 数据', async () => {
    const [project] = await service.list();
    if (!project) throw new Error('Project fixture 不存在');
    const updated = await service.update(project.id, {
      name: 'Project Fixture Updated',
      description: '由 v0.6 Dialog 修改',
    });
    expect(updated).toMatchObject({
      id: project.id,
      name: 'Project Fixture Updated',
      description: '由 v0.6 Dialog 修改',
      realRootPath: project.realRootPath,
      targetId: project.targetId,
    });
    const archived = await service.archive(project.id);
    expect(archived).toMatchObject({ id: project.id, status: 'ARCHIVED' });
    expect((await service.get(project.id)).realRootPath).toBe(project.realRootPath);
  });

  it.each([
    ['../secret.txt', 'PATH_TRAVERSAL'],
    ['/etc/passwd', 'PATH_ABSOLUTE_FORBIDDEN'],
    ['%2e%2e/secret.txt', 'PATH_TRAVERSAL'],
    ['%252e%252e/secret.txt', 'PATH_TRAVERSAL'],
    ['escape-link', 'SYMLINK_ESCAPE'],
  ])('拒绝危险路径 %s', async (path, code) => {
    const [project] = await service.list();
    if (!project) throw new Error('Project fixture 不存在');
    await expect(service.readFile(project.id, path)).rejects.toMatchObject({ code });
  });
});
