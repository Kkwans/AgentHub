// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RealtimeClient } from './realtime';

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly protocols: string[];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];

  constructor(url: string | URL, protocols?: string | string[]) {
    super();
    this.url = String(url);
    this.protocols = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  send(data: string): void {
    this.sent.push(data);
  }

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  receiveRaw(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
}

function messages(socket: FakeWebSocket): Array<Record<string, unknown>> {
  return socket.sent.map((message) => JSON.parse(message) as Record<string, unknown>);
}

describe('RealtimeClient cursor 补流', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('连接建立前订阅仍携带 afterSeq', () => {
    const client = new RealtimeClient();
    client.subscribe('session:session-1', () => undefined, 12);
    const socket = FakeWebSocket.instances[0]!;

    expect(socket.sent).toHaveLength(0);
    socket.open();

    expect(messages(socket)).toContainEqual({
      type: 'subscribe',
      topics: ['session:session-1'],
      afterSeq: { 'session:session-1': 12 },
    });
    client.disconnect();
  });

  it('收到事件后在重连订阅中使用最新 cursor 并忽略重复事件', () => {
    vi.useFakeTimers();
    const client = new RealtimeClient();
    const listener = vi.fn();
    client.subscribe('session:session-1', listener, 7);
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.receive({ type: 'event', topic: 'session:session-1', event: { seq: 8 } });
    first.receive({ type: 'event', topic: 'session:session-1', event: { seq: 8 } });
    expect(listener).toHaveBeenCalledTimes(1);

    first.close();
    vi.runOnlyPendingTimers();
    const second = FakeWebSocket.instances[1]!;
    second.open();

    expect(messages(second)).toContainEqual({
      type: 'subscribe',
      topics: ['session:session-1'],
      afterSeq: { 'session:session-1': 8 },
    });
    client.disconnect();
  });

  it('最后一个 listener 取消订阅后清除旧 cursor', () => {
    const client = new RealtimeClient();
    const unsubscribe = client.subscribe('session:session-1', () => undefined, 20);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    unsubscribe();
    client.subscribe('session:session-1', () => undefined, 3);

    expect(messages(socket).at(-1)).toEqual({
      type: 'subscribe',
      topics: ['session:session-1'],
      afterSeq: { 'session:session-1': 3 },
    });
    client.disconnect();
  });

  it('忽略畸形 WebSocket frame，不让原生解析异常打断实时订阅', () => {
    const client = new RealtimeClient();
    const listener = vi.fn();
    client.subscribe('session:session-1', listener);
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    expect(() => socket.receiveRaw('{not-json')).not.toThrow();
    socket.receive({ type: 'event', topic: 'session:session-1', event: 'not-an-object' });
    expect(listener).not.toHaveBeenCalled();

    socket.receive({ type: 'event', topic: 'session:session-1', event: { seq: 1 } });
    expect(listener).toHaveBeenCalledTimes(1);
    client.disconnect();
  });
});
