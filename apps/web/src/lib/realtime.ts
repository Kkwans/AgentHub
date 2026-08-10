import { authTokenStore } from './api';

type Listener = (event: Record<string, unknown>) => void;

class RealtimeClient {
  private socket: WebSocket | undefined;
  private listeners = new Map<string, Set<Listener>>();
  private reconnectTimer: number | undefined;
  private attempts = 0;
  private stateListeners = new Set<(state: '连接中' | '已连接' | '已断开') => void>();

  subscribe(topic: string, listener: Listener, afterSeq = 0): () => void {
    const topicListeners = this.listeners.get(topic) ?? new Set<Listener>();
    topicListeners.add(listener);
    this.listeners.set(topic, topicListeners);
    this.connect();
    this.send({ type: 'subscribe', topics: [topic], afterSeq: { [topic]: afterSeq } });
    return () => {
      topicListeners.delete(listener);
      if (!topicListeners.size) {
        this.listeners.delete(topic);
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
    if (this.socket) {
      this.socket.close(1000, '认证信息已更新');
      return;
    }
    if (this.listeners.size) this.connect();
  }

  private connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)
    )
      return;
    this.emitState('连接中');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = authTokenStore.get();
    this.socket = new WebSocket(
      `${protocol}//${location.host}/ws`,
      token ? ['agenthub-v1', `agenthub-token.${token}`] : ['agenthub-v1'],
    );
    this.socket.addEventListener('open', () => {
      this.attempts = 0;
      this.emitState('已连接');
      for (const topic of this.listeners.keys()) this.send({ type: 'subscribe', topics: [topic] });
    });
    this.socket.addEventListener('message', (message) => {
      const decoded = JSON.parse(String(message.data)) as {
        type: string;
        topic?: string;
        event?: Record<string, unknown>;
      };
      if (decoded.type !== 'event' || !decoded.topic || !decoded.event) return;
      for (const listener of this.listeners.get(decoded.topic) ?? []) listener(decoded.event);
    });
    this.socket.addEventListener('close', () => {
      this.emitState('已断开');
      if (!this.listeners.size && !this.stateListeners.size) return;
      this.attempts += 1;
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(
        () => this.connect(),
        Math.min(1_000 * 2 ** this.attempts, 15_000),
      );
    });
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private emitState(state: '连接中' | '已连接' | '已断开'): void {
    for (const listener of this.stateListeners) listener(state);
  }
}

export const realtime = new RealtimeClient();
