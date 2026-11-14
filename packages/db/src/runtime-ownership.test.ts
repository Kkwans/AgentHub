import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { acquirePostgresRuntimeOwnership, RUNTIME_OWNERSHIP_KEYS } from './runtime-ownership.js';
class Connection extends EventEmitter {
  connect = vi.fn(async () => undefined);
  query = vi.fn(async (_sql: string, _values: number[]) => ({ rows: [{ held: true as unknown }] }));
  end = vi.fn(async () => {
    this.emit('end');
  });
}
it('专用连接使用稳定数据库范围session锁，显式结束前一直持有', async () => {
  const c = new Connection();
  const guard = await acquirePostgresRuntimeOwnership(c);
  expect(c.query).toHaveBeenCalledWith(
    'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS held',
    [...RUNTIME_OWNERSHIP_KEYS],
  );
  expect(c.end).not.toHaveBeenCalled();
  guard.assertHeld();
  const listener = vi.fn();
  guard.onLost(listener);
  await Promise.all([guard.release(), guard.release()]);
  expect(c.end).toHaveBeenCalledTimes(1);
  expect(listener).not.toHaveBeenCalled();
  expect(() => guard.assertHeld()).toThrow();
});
it.each(['error', 'end'])('%s永久失效并同步通知一次，不重连', async (event) => {
  const c = new Connection();
  const guard = await acquirePostgresRuntimeOwnership(c);
  const fn = vi.fn();
  guard.onLost(fn);
  c.emit(event);
  c.emit('end');
  expect(fn).toHaveBeenCalledTimes(1);
  expect(() => guard.assertHeld()).toThrow();
  const late = vi.fn();
  guard.onLost(late);
  expect(late).toHaveBeenCalledTimes(1);
  expect(c.connect).toHaveBeenCalledTimes(1);
  expect(c.query).toHaveBeenCalledTimes(1);
  await guard.release();
});
it('一个失效监听器异常不妨碍其他准入被撤销', async () => {
  const c = new Connection();
  const guard = await acquirePostgresRuntimeOwnership(c);
  guard.onLost(() => {
    throw new Error('listener');
  });
  const fn = vi.fn();
  guard.onLost(fn);
  c.emit('error');
  expect(fn).toHaveBeenCalledOnce();
  await guard.release();
});
it('解除订阅的监听器不被调用', async () => {
  const c = new Connection();
  const g = await acquirePostgresRuntimeOwnership(c);
  const fn = vi.fn();
  g.onLost(fn)();
  c.emit('end');
  expect(fn).not.toHaveBeenCalled();
  await g.release();
});
it('第二连接未获锁明确拒绝且关闭连接，不尝试解锁他人', async () => {
  const c = new Connection();
  c.query.mockResolvedValue({ rows: [{ held: false }] });
  await expect(acquirePostgresRuntimeOwnership(c)).rejects.toMatchObject({
    code: 'RUNTIME_OWNERSHIP_HELD',
  });
  expect(c.end).toHaveBeenCalledOnce();
  expect(c.query).toHaveBeenCalledOnce();
});
it.each([undefined, 'true', null])('异常锁回包%j不能当成功', async (held) => {
  const c = new Connection();
  c.query.mockResolvedValue({ rows: [{ held }] });
  await expect(acquirePostgresRuntimeOwnership(c)).rejects.toMatchObject({
    code: 'RUNTIME_OWNERSHIP_UNAVAILABLE',
  });
  expect(c.end).toHaveBeenCalledOnce();
});
it.each(['connect', 'query'] as const)('%s失败清理且不泄露连接信息', async (step) => {
  const c = new Connection();
  c[step].mockRejectedValue(new Error('postgres://secret:password@host/db'));
  await expect(acquirePostgresRuntimeOwnership(c)).rejects.toMatchObject({
    code: 'RUNTIME_OWNERSHIP_UNAVAILABLE',
  });
  expect(c.end).toHaveBeenCalledOnce();
});
it('锁请求返回前断连，即使随后返回true也不能复活', async () => {
  const c = new Connection();
  c.query.mockImplementation(async () => {
    c.emit('end');
    return { rows: [{ held: true }] };
  });
  await expect(acquirePostgresRuntimeOwnership(c)).rejects.toMatchObject({
    code: 'RUNTIME_OWNERSHIP_LOST',
  });
  expect(c.end).toHaveBeenCalledOnce();
});
it('关闭失败不恢复许可，重入释放共用原失败', async () => {
  const c = new Connection();
  const g = await acquirePostgresRuntimeOwnership(c);
  c.end.mockRejectedValue(new Error('close failed'));
  await expect(g.release()).rejects.toThrow('close failed');
  expect(() => g.assertHeld()).toThrow();
  await expect(g.release()).rejects.toThrow();
  expect(c.end).toHaveBeenCalledOnce();
});
