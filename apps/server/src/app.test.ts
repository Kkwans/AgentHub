import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { ApiTokenRepository, createPgliteDatabase } from '@agenthub/db';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { createApp } from './app.js';
import { AuthService } from './auth/auth-service.js';
import { TopicBroker, type ReplayEventSource } from './websocket.js';

describe('HTTP 基线', () => {
  const app = createApp({
    logger: pino({ level: 'silent' }),
    health: async () => ({ database: 'pglite' }),
    eventSource: {
      listAfter: async (_sessionId, afterSeq) => [{ seq: afterSeq + 1, type: 'fixture.event' }],
    },
  });

  it('返回健康状态和 request ID', async () => {
    const response = await request(app).get('/api/v1/health').set('x-request-id', 'req-test-1');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe('req-test-1');
    expect(response.body).toEqual({
      data: { status: 'ok', version: '0.1.0', database: 'pglite' },
      requestId: 'req-test-1',
    });
  });

  it('使用稳定英文 code 与中文错误信息', async () => {
    const response = await request(app).get('/api/v1/sessions/not-a-uuid/events?afterSeq=-1');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.message).toBe('请求参数不符合要求');
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });

  it('对未知接口返回统一错误信封', async () => {
    const response = await request(app).get('/api/v1/unknown');

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({
      code: 'ROUTE_NOT_FOUND',
      message: '请求的接口不存在',
    });
  });
});

describe('HTTP token auth', () => {
  it('认证状态公开，其余 API 拒绝无 token 请求并接受 Bearer token', async () => {
    const database = await createPgliteDatabase({ dataDir: 'memory://' });
    try {
      const auth = new AuthService(
        new ApiTokenRepository(database.db),
        'token',
        'test-bootstrap-token',
      );
      const app = createApp({ auth, logger: pino({ level: 'silent' }) });
      expect((await request(app).get('/api/v1/auth/status')).body.data).toEqual({
        mode: 'token',
        localTrusted: false,
      });
      const unauthorized = await request(app).get('/api/v1');
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.body.error.code).toBe('AUTH_REQUIRED');
      const authorized = await request(app)
        .get('/api/v1')
        .set('authorization', 'Bearer test-bootstrap-token');
      expect(authorized.status).toBe(200);
    } finally {
      await database.close();
    }
  }, 15_000);
});

describe('Production Web 入口', () => {
  it('托管静态资源并为前端路由返回 SPA index，不吞掉 API 404', async () => {
    const webDist = await mkdtemp(join(tmpdir(), 'agenthub-web-'));
    try {
      await writeFile(join(webDist, 'index.html'), '<!doctype html><title>AgentHub Web</title>');
      await writeFile(join(webDist, 'asset.txt'), 'asset-ok');
      const app = createApp({ webDist, logger: pino({ level: 'silent' }) });
      expect((await request(app).get('/asset.txt')).text).toBe('asset-ok');
      const spa = await request(app).get('/tasks').set('accept', 'text/html');
      expect(spa.status).toBe(200);
      expect(spa.text).toContain('AgentHub Web');
      const api = await request(app).get('/api/v1/not-real');
      expect(api.status).toBe(404);
      expect(api.body.error.code).toBe('ROUTE_NOT_FOUND');
    } finally {
      await rm(webDist, { recursive: true, force: true });
    }
  });
});

describe('统一 WebSocket topic', () => {
  const openSockets: WebSocket[] = [];
  const openBrokers: TopicBroker[] = [];

  afterEach(async () => {
    for (const socket of openSockets) socket.close();
    for (const broker of openBrokers) await broker.close();
    openSockets.length = 0;
    openBrokers.length = 0;
  });

  it('支持订阅、afterSeq 补流与实时事件', async () => {
    const replaySource: ReplayEventSource = {
      listAfter: async (sessionId, afterSeq) => [
        { sessionId, seq: afterSeq + 1, type: 'assistant.message.completed' },
      ],
    };
    const httpServer = createServer(
      createApp({ eventSource: replaySource, logger: pino({ level: 'silent' }) }),
    );
    const broker = new TopicBroker(httpServer, replaySource);
    openBrokers.push(broker);
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('测试 Server 未取得 TCP 端口');

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    openSockets.push(socket);
    const messages: Array<Record<string, unknown>> = [];
    const waiters: Array<(message: Record<string, unknown>) => void> = [];
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else messages.push(message);
    });
    const nextMessage = async () => {
      const existing = messages.shift();
      if (existing) return existing;
      return new Promise<Record<string, unknown>>((resolve) => waiters.push(resolve));
    };

    await once(socket, 'open');
    expect(await nextMessage()).toMatchObject({ type: 'connection.ready' });
    socket.send(
      JSON.stringify({
        type: 'subscribe',
        topics: ['session:11111111-1111-4111-8111-111111111111'],
        afterSeq: { 'session:11111111-1111-4111-8111-111111111111': 7 },
      }),
    );
    expect(await nextMessage()).toMatchObject({ type: 'subscribed' });
    expect(await nextMessage()).toMatchObject({
      type: 'event',
      event: { seq: 8, type: 'assistant.message.completed' },
    });

    broker.publish('session:11111111-1111-4111-8111-111111111111', {
      seq: 9,
      type: 'usage.updated',
    });
    expect(await nextMessage()).toMatchObject({
      type: 'event',
      event: { seq: 9, type: 'usage.updated' },
    });

    socket.close();
    await once(socket, 'close');
    await broker.close();
    openBrokers.length = 0;
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('token 模式拒绝未认证连接并接受浏览器 subprotocol token', async () => {
    const httpServer = createServer(createApp({ logger: pino({ level: 'silent' }) }));
    const broker = new TopicBroker(httpServer, undefined, {
      authorizeHeader: async (header) => Boolean(header?.includes('agenthub-token.good-token')),
    });
    openBrokers.push(broker);
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('测试 Server 未取得 TCP 端口');

    const rejected = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    rejected.on('error', () => undefined);
    const rejection = once(rejected, 'unexpected-response');
    const [, response] = await rejection;
    expect((response as { statusCode: number }).statusCode).toBe(401);

    const accepted = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, [
      'agenthub-v1',
      'agenthub-token.good-token',
    ]);
    openSockets.push(accepted);
    await once(accepted, 'open');
    expect(accepted.protocol).toBe('agenthub-v1');
    accepted.close();
    await once(accepted, 'close');
    await broker.close();
    openBrokers.length = 0;
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  });
});
