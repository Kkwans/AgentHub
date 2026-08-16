type Listener = (event: Record<string, unknown>) => void;

export class RealtimeClient {
  private socket: WebSocket | undefined;
  private listeners = new Map<string, Set<Listener>>();
  private cursors = new Map<string, number>();
  private reconnectTimer: number | undefined;
  private attempts = 0;
  private suspended = false;
  private stateListeners = new Set<(state: '连接中' | '已连接' | '已断开') => void>();

  subscribe(topic: string, listener: Listener, afterSeq = 0): () => void {
    const topicListeners = this.listeners.get(topic) ?? new Set<Listener>();
    const firstListener = topicListeners.size === 0;
    topicListeners.add(listener);
    this.listeners.set(topic, topicListeners);
    if (firstListener) this.cursors.set(topic, afterSeq);
    this.connect();
    this.sendSubscription([topic]);
    return () => {
      topicListeners.delete(listener);
      if (!topicListeners.size) {
        this.listeners.delete(topic);
        this.cursors.delete(topic);
        this.send({ type: 'unsubscribe', topics: [topic] });
      }
    };
  }

  onState(listener: (state: '连接中' | '已连接' | '已断开') => void): () => void {
    this.stateListeners.add(listener);
    this.connect();
    listener(
      this.socket?.readyState === WebSocket.OPEN
        ? '已连接'
        : this.socket?.readyState === WebSocket.CONNECTING
          ? '连接中'
          : '已断开',
    );
    return () => this.stateListeners.delete(listener);
  }

  reconnect(): void {
    this.suspended = false;
    window.clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.close(1000, '认证信息已更新');
      return;
    }
    if (this.listeners.size) this.connect();
  }

  disconnect(): void {
    this.suspended = true;
    this.attempts = 0;
    window.clearTimeout(this.reconnectTimer);
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, '等待登录');
    }
    this.emitState('已断开');
  }

  private connect(): void {
    if (this.suspended) return;
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)
    )
      return;
    this.emitState('连接中');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`, ['agenthub-v1']);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.attempts = 0;
      this.emitState('已连接');
      this.sendSubscription([...this.listeners.keys()]);
    });
    socket.addEventListener('message', (message) => {
      let decoded: unknown;
      try {
        decoded = JSON.parse(String(message.data));
      } catch {
        // A malformed frame must not escape the event handler and break the
        // rest of the UI. The server-side diagnostic log remains authoritative.
        return;
      }
      if (
        !isRecord(decoded) ||
        decoded.type !== 'event' ||
        typeof decoded.topic !== 'string' ||
        !isRecord(decoded.event)
      )
        return;
      const seq = decoded.event.seq;
      if (typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0) {
        const cursor = this.cursors.get(decoded.topic) ?? 0;
        if (seq <= cursor) return;
        this.cursors.set(decoded.topic, seq);
      }
      for (const listener of this.listeners.get(decoded.topic) ?? []) listener(decoded.event);
    });
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = undefined;
      this.emitState('已断开');
      if (this.suspended || (!this.listeners.size && !this.stateListeners.size)) return;
      this.attempts += 1;
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(
        () => {
          if (!this.suspended) this.connect();
        },
        Math.min(1_000 * 2 ** this.attempts, 15_000),
      );
    });
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private sendSubscription(topics: string[]): void {
    if (!topics.length) return;
    this.send({
      type: 'subscribe',
      topics,
      afterSeq: Object.fromEntries(topics.map((topic) => [topic, this.cursors.get(topic) ?? 0])),
    });
  }

  private emitState(state: '连接中' | '已连接' | '已断开'): void {
    for (const listener of this.stateListeners) listener(state);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export const realtime = new RealtimeClient();
