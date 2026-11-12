import { once } from 'node:events';
import { createServer } from 'node:http';
import {
  browserSessions,
  ApiTokenRepository,
  createPgliteDatabase,
  LocalAuthRepository,
} from '@agenthub/db';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../app.js';
import { TopicBroker, type ReplayEventSource } from '../websocket.js';
import { WebSocketUpgradeRouter } from '../websocket-upgrade.js';
import { AuthService } from './auth-service.js';
import type { TerminalService } from '../terminal/terminal-service.js';

const topic = 'session:11111111-1111-4111-8111-111111111111';

describe('认证撤销与真实 HTTP/WebSocket 连接', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function fixture(replay: ReplayEventSource = { listAfter: async () => [] }) {
    const database = await createPgliteDatabase({ dataDir: 'memory://' });
    const localAuth = new LocalAuthRepository(database.db);
    const auth = new AuthService(new ApiTokenRepository(database.db), localAuth, 'token');
    const terminalInput = vi.fn(async () => ({ id: 'terminal' }));
    const server = createServer(
      createApp({
        auth,
        terminal: { input: terminalInput } as unknown as TerminalService,
        logger: pino({ level: 'silent' }),
      }),
    );
    const router = new WebSocketUpgradeRouter(server);
    const broker = new TopicBroker(router, replay, auth);
    const sockets: WebSocket[] = [];
    cleanups.push(async () => {
      for (const socket of sockets) socket.terminate();
      await broker.close();
      router.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.close();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('无测试监听端口');
    const base = `http://127.0.0.1:${address.port}`;
    async function http(path: string, body?: unknown, cookie?: string, method = 'POST') {
      const response = await fetch(`${base}/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        cookie: response.headers.get('set-cookie')?.split(';')[0],
        body: (await response.json()) as { data: Record<string, unknown> },
      };
    }
    async function connect(headers: Record<string, string>, waitForReady = true, topics = [topic]) {
      const socket = new WebSocket(`${base.replace('http:', 'ws:')}/ws`, { headers });
      sockets.push(socket);
      const queued: Record<string, unknown>[] = [];
      const waiters: Array<(value: Record<string, unknown>) => void> = [];
      const closed = new Promise<string>((resolve) => socket.on('close', () => resolve('closed')));
      socket.on('message', (data) => {
        const value = JSON.parse(data.toString()) as Record<string, unknown>;
        const waiter = waiters.shift();
        if (waiter) waiter(value);
        else queued.push(value);
      });
      const next = async () =>
        queued.shift() ?? new Promise<Record<string, unknown>>((resolve) => waiters.push(resolve));
      await once(socket, 'open');
      if (!waitForReady) return { socket, next, closed };
      expect(await next()).toMatchObject({ type: 'connection.ready' });
      socket.send(JSON.stringify({ type: 'subscribe', topics }));
      expect(await next()).toMatchObject({ type: 'subscribed' });
      return { socket, next, closed };
    }
    const setup = await http('/auth/setup', {
      username: 'admin',
      password: 'original-password-123',
    });
    expect(setup.status).toBe(201);
    return {
      database,
      localAuth,
      auth,
      http,
      connect,
      broker,
      terminalInput,
      cookie: setup.cookie!,
    };
  }

  it('注销关闭旧浏览器流且不影响另一个登录会话', async () => {
    const f = await fixture();
    const old = await f.connect({ cookie: f.cookie });
    const login = await f.http('/auth/login', {
      username: 'admin',
      password: 'original-password-123',
    });
    const healthy = await f.connect({ cookie: login.cookie! });
    expect((await f.http('/auth/logout', {}, f.cookie)).status).toBe(200);
    expect((await f.http('', undefined, f.cookie, 'GET')).status).toBe(401);
    f.broker.publish(topic, { seq: 9, type: 'test.after-revocation' });
    expect(await Promise.race([old.closed, old.next().then(() => 'message')])).toBe('closed');
    expect(await healthy.next()).toMatchObject({ type: 'event', event: { seq: 9 } });
  });

  it('改密关闭所有旧浏览器流但保留 API token 和新会话', async () => {
    const f = await fixture();
    const old = await f.connect({ cookie: f.cookie });
    const login = await f.http('/auth/login', {
      username: 'admin',
      password: 'original-password-123',
    });
    const second = await f.connect({ cookie: login.cookie! });
    const token = await f.auth.createToken('独立集成');
    const healthy = await f.connect({ authorization: `Bearer ${token.token}` });
    const changed = await f.http(
      '/auth/account/password',
      { currentPassword: 'original-password-123', newPassword: 'new-password-12345' },
      f.cookie,
      'PUT',
    );
    expect(changed.status).toBe(200);
    expect((await f.http('', undefined, changed.cookie!, 'GET')).status).toBe(200);
    f.broker.publish(topic, { seq: 10 });
    expect(await Promise.race([old.closed, old.next().then(() => 'message')])).toBe('closed');
    expect(await Promise.race([second.closed, second.next().then(() => 'message')])).toBe('closed');
    expect(await healthy.next()).toMatchObject({ type: 'event', event: { seq: 10 } });
  });

  it('撤销 API token 关闭对应流但不影响管理员浏览器', async () => {
    const f = await fixture();
    const token = await f.auth.createToken('待撤销集成');
    const old = await f.connect({ authorization: `Bearer ${token.token}` });
    const healthy = await f.connect({ cookie: f.cookie });
    expect((await f.http(`/auth/tokens/${token.id}`, undefined, f.cookie, 'DELETE')).status).toBe(
      200,
    );
    f.broker.publish(topic, { seq: 11 });
    expect(await Promise.race([old.closed, old.next().then(() => 'message')])).toBe('closed');
    expect(await healthy.next()).toMatchObject({ type: 'event', event: { seq: 11 } });
  });

  it('注销后丢弃已发起但尚未返回的历史补流', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const f = await fixture({
      listAfter: async () => {
        entered();
        await gate;
        return [{ seq: 99, text: '不能继续发送的历史记录' }];
      },
    });
    const old = await f.connect({ cookie: f.cookie });
    await started;
    expect((await f.http('/auth/logout', {}, f.cookie)).status).toBe(200);
    release();
    expect(await Promise.race([old.closed, old.next().then(() => 'message')])).toBe('closed');
  });

  it('浏览器会话到期主动关闭空闲流', async () => {
    const f = await fixture();
    await f.database.db.update(browserSessions).set({ expiresAt: new Date(Date.now() + 1000) });
    const old = await f.connect({ cookie: f.cookie });
    expect(await old.closed).toBe('closed');
    expect((await f.http('', undefined, f.cookie, 'GET')).status).toBe(401);
  });

  it('升级后的认证读取与注销交错时不安装过期租约', async () => {
    const f = await fixture();
    const original = f.localAuth.findActiveSession.bind(f.localAuth);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let reads = 0;
    const spy = vi.spyOn(f.localAuth, 'findActiveSession').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (++reads === 2) {
        entered();
        await gate;
      }
      return result;
    });
    const old = await f.connect({ cookie: f.cookie }, false);
    await started;
    expect((await f.http('/auth/logout', {}, f.cookie)).status).toBe(200);
    release();
    expect(await Promise.race([old.closed, old.next().then(() => 'message')])).toBe('closed');
    spy.mockRestore();
  });

  it('客户端在租约读取期间关闭不会重新激活连接', async () => {
    const f = await fixture();
    const original = f.auth.authorizeConnection.bind(f.auth);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const dispose = vi.fn();
    const spy = vi.spyOn(f.auth, 'authorizeConnection').mockImplementation(async (...args) => {
      const lease = await original(...args);
      entered();
      await gate;
      if (!lease) return lease;
      return {
        isActive: lease.isActive,
        dispose: () => {
          dispose();
          lease.dispose();
        },
      };
    });
    const old = await f.connect({ cookie: f.cookie }, false);
    await started;
    old.socket.close();
    await old.closed;
    release();
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect((await f.http('/auth/logout', {}, f.cookie)).status).toBe(200);
    expect(dispose).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('Terminal 输出随认证撤销且旧 Cookie 不能继续通过 HTTP 输入', async () => {
    const f = await fixture();
    const terminalId = '22222222-2222-4222-8222-222222222222';
    const terminalTopic = `terminal:${terminalId}`;
    const old = await f.connect({ cookie: f.cookie }, true, [terminalTopic]);
    const login = await f.http('/auth/login', {
      username: 'admin',
      password: 'original-password-123',
    });
    const healthy = await f.connect({ cookie: login.cookie! }, true, [terminalTopic]);
    expect(
      (await f.http(`/terminals/${terminalId}/input`, { data: 'healthy' }, login.cookie!)).status,
    ).toBe(200);
    expect(f.terminalInput).toHaveBeenCalledOnce();
    expect((await f.http('/auth/logout', {}, f.cookie)).status).toBe(200);
    expect(
      (await f.http(`/terminals/${terminalId}/input`, { data: 'revoked' }, f.cookie)).status,
    ).toBe(401);
    expect(f.terminalInput).toHaveBeenCalledOnce();
    f.broker.publish(terminalTopic, { type: 'terminal.output', data: 'private output' });
    expect(await Promise.race([old.closed, old.next().then(() => 'message')])).toBe('closed');
    expect(await healthy.next()).toMatchObject({
      type: 'event',
      event: { type: 'terminal.output' },
    });
  });
});
