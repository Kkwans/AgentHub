import { once } from 'node:events';
import { createServer } from 'node:http';

import request from 'supertest';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { createApp } from './app.js';
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
});
