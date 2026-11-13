import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '@agenthub/agent-core';
import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { GitService } from './git-service.js';
const projectId = '11111111-1111-4111-8111-111111111111';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(repoKind = 'GIT') {
  const root = await mkdtemp(join(tmpdir(), 'agenthub-git-status-repro-'));
  roots.push(root);
  const initialized = await runProcess({
    executable: '/usr/bin/git',
    args: ['-C', root, 'init'],
    timeoutMs: 5000,
    maxOutputBytes: 10000,
  });
  expect(initialized.exitCode).toBe(0);
  const create = vi.fn(async (record: unknown) => record);
  const project = { id: projectId, repoKind, targetId: 'local', realRootPath: root };
  const service = new GitService(
    { get: vi.fn(async () => project) } as unknown as ConstructorParameters<typeof GitService>[0],
    { create } as unknown as ConstructorParameters<typeof GitService>[1],
  );
  return { root, create, service };
}
it('合法无HEAD空仓库的git status成功，不能与读取失败混同', async () => {
  const { service } = await fixture();
  expect(await service.status(projectId)).toMatchObject({ clean: true, entries: [] });
});
it('登记为非Git项目在执行status前被明确拒绝', async () => {
  const { service } = await fixture('DIRECTORY');
  await expect(service.status(projectId)).rejects.toMatchObject({ code: 'PROJECT_NOT_GIT' });
});
it('真实损坏index的status必须报告错误而非clean true', async () => {
  const { root, service } = await fixture();
  await writeFile(join(root, '.git', 'index'), 'invalid-index');
  const raw = await runProcess({
    executable: '/usr/bin/git',
    args: ['-C', root, 'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all'],
    timeoutMs: 5000,
    maxOutputBytes: 10000,
  });
  expect(raw.exitCode).not.toBe(0);
  expect(raw.stderr).toMatch(/index/);
  await expect(service.status(projectId)).rejects.toMatchObject({ code: 'GIT_STATUS_FAILED' });
});
it('真实读取失败不得创建伪clean诊断快照', async () => {
  const { root, create, service } = await fixture();
  await writeFile(join(root, '.git', 'index'), 'invalid-index');
  await expect
    .soft(service.capture('run1', projectId, root, 'BEFORE'))
    .rejects.toMatchObject({ code: 'GIT_STATUS_FAILED' });
  expect.soft(create).not.toHaveBeenCalled();
});
it('登记仍为Git但目录已不是仓库时不能靠数据库类型伪装clean', async () => {
  const { root, service } = await fixture();
  await rm(join(root, '.git'), { recursive: true, force: true });
  await expect(service.status(projectId)).rejects.toMatchObject({ code: 'GIT_STATUS_FAILED' });
});

it('真实损坏仓库通过status API传播受控错误而不泄漏路径/stderr', async () => {
  const { root, service } = await fixture();
  await writeFile(join(root, '.git', 'index'), 'invalid-index');
  const response = await request(createApp({ git: service })).get(
    `/api/v1/projects/${projectId}/git/status`,
  );
  expect(response.status).toBe(409);
  expect(response.body.error).toMatchObject({
    code: 'GIT_STATUS_FAILED',
    message: 'Git 状态读取失败',
  });
  expect(response.body).not.toHaveProperty('data');
  expect(JSON.stringify(response.body)).not.toContain(root);
  expect(JSON.stringify(response.body)).not.toContain('index');
});
