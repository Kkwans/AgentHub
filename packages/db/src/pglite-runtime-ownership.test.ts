import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { acquirePgliteRuntimeOwnership } from './pglite-runtime-ownership.js';
import type { RuntimeOwnershipGuard } from './runtime-ownership.js';
vi.mock('node:child_process', { spy: true });
const directories: string[] = [];
const guards: RuntimeOwnershipGuard[] = [];
function directory() {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-runtime-owner-'));
  directories.push(root);
  return root;
}
async function acquire(path: string) {
  const { guard } = await acquirePgliteRuntimeOwnership(path);
  guards.push(guard);
  return guard;
}
afterEach(async () => {
  for (const guard of guards.splice(0)) await guard.release();
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});
it('memory数据库各自独立且release永久撤销本实例', async () => {
  const a = await acquire('memory://');
  const b = await acquire('memory://');
  a.assertHeld();
  b.assertHeld();
  await a.release();
  await a.release();
  expect(() => a.assertHeld()).toThrow();
  b.assertHeld();
});
it.skipIf(process.platform !== 'linux')(
  '实际flock子进程退出后父FD持续排他，释放后独立进程可获取',
  async () => {
    const data = join(directory(), 'pgdata');
    const a = await acquire(data);
    const lock = `${realpathSync(data)}.agenthub-runtime.lock`;
    const attempt = () => spawnSync('/usr/bin/flock', ['-n', '-E', '75', lock, '/bin/true']);
    expect(attempt().status).toBe(75);
    await expect(acquire(data)).rejects.toMatchObject({ code: 'RUNTIME_OWNERSHIP_HELD' });
    a.assertHeld();
    expect(statSync(lock).mode & 0o777).toBe(0o600);
    const inode = statSync(lock).ino;
    await a.release();
    expect(statSync(lock).ino).toBe(inode);
    expect(attempt().status).toBe(0);
    const b = await acquire(data);
    b.assertHeld();
  },
);
it.skipIf(process.platform !== 'linux')(
  '目录symlink别名共享同一锁，不靠路径字符串绕过',
  async () => {
    const root = directory();
    const data = join(root, 'pgdata');
    const a = await acquire(data);
    const alias = join(root, 'alias');
    symlinkSync(data, alias, 'dir');
    await expect(acquire(alias)).rejects.toMatchObject({ code: 'RUNTIME_OWNERSHIP_HELD' });
    await a.release();
    (await acquire(alias)).assertHeld();
  },
);
it.skipIf(process.platform !== 'linux')('拒绝锁路径symlink且不覆盖目标', async () => {
  const root = directory();
  const data = join(root, 'pgdata');
  const target = join(root, 'unrelated');
  writeFileSync(target, 'untouched');
  symlinkSync(target, `${data}.agenthub-runtime.lock`);
  await expect(acquire(data)).rejects.toMatchObject({ code: 'RUNTIME_OWNERSHIP_UNAVAILABLE' });
  expect(statSync(target).size).toBe(9);
});
it.skipIf(process.platform !== 'linux')('锁inode被替换会永久撤销并通知，不会自动重取', async () => {
  const data = join(directory(), 'pgdata');
  const guard = await acquire(data);
  const listener = vi.fn();
  guard.onLost(listener);
  const lock = `${realpathSync(data)}.agenthub-runtime.lock`;
  unlinkSync(lock);
  writeFileSync(lock, '');
  expect(() => guard.assertHeld()).toThrow();
  expect(() => guard.assertHeld()).toThrow();
  expect(listener).toHaveBeenCalledTimes(1);
});
it('不支持的文件协议fail closed', async () => {
  await expect(acquire('file:///tmp/not-opened')).rejects.toMatchObject({
    code: 'RUNTIME_OWNERSHIP_UNSUPPORTED',
  });
});

it.skipIf(process.platform !== 'linux')(
  '系统flock缺失时fail closed并关闭自身FD，之后仍可正常获取',
  async () => {
    const data = join(directory(), 'pgdata');
    vi.mocked(spawnSync).mockReturnValueOnce({
      pid: 0,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: null,
      signal: null,
      error: Object.assign(new Error('private environment diagnostic'), { code: 'ENOENT' }),
    } as ReturnType<typeof spawnSync>);
    await expect(acquire(data)).rejects.toMatchObject({ code: 'RUNTIME_OWNERSHIP_UNAVAILABLE' });
    (await acquire(data)).assertHeld();
  },
);
