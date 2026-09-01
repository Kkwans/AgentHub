import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { AhButton, SquareTerminal, X } from '@agenthub/ui';
import terminalStyles from '../terminal.module.css';

export type TerminalCapability = {
  available: boolean;
  message?: string;
  code?: string;
};

export type TerminalRecord = {
  id: string;
  projectId: string;
  cwd: string;
  shell: string;
  topic: string;
};

export type TerminalEvent = {
  type?: string;
  data?: unknown;
  exitCode?: unknown;
  signal?: unknown;
};

export type TerminalOpenInput = {
  projectId: string;
  path?: string;
  cols: number;
  rows: number;
};

export type TerminalDockProps = {
  capability: TerminalCapability | undefined;
  capabilityError: Error | null;
  projectId: string | undefined;
  projectRoot: string | undefined;
  cwd: string;
  openTerminal: (input: TerminalOpenInput) => Promise<TerminalRecord>;
  sendInput: (terminalId: string, data: string) => Promise<unknown>;
  resizeTerminal: (terminalId: string, input: { cols: number; rows: number }) => Promise<unknown>;
  closeTerminal: (terminalId: string) => Promise<unknown>;
  subscribe: (topic: string, listener: (event: TerminalEvent) => void) => () => void;
};

type TerminalState = 'closed' | 'opening' | 'open' | 'exited' | 'error';

export function TerminalDock({
  capability,
  capabilityError,
  projectId,
  projectRoot,
  cwd,
  openTerminal,
  sendInput,
  resizeTerminal,
  closeTerminal,
  subscribe,
}: TerminalDockProps) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<TerminalState>('closed');
  const [error, setError] = useState<string>();
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded || !capability?.available || !projectId || !viewportRef.current) return;

    let disposed = false;
    let record: TerminalRecord | undefined;
    let terminal: Terminal | undefined;
    let fitAddon: FitAddon | undefined;
    let unsubscribe: () => void = () => undefined;
    let resizeObserver: ResizeObserver | undefined;
    let dataDisposable: { dispose: () => void } | undefined;
    let resizeDisposable: { dispose: () => void } | undefined;

    const showError = (cause: unknown) => {
      if (disposed) return;
      const message = cause instanceof Error ? cause.message : 'Terminal 连接失败';
      setError(message);
      setState('error');
      terminal?.write(`\r\n\u001b[31m[Terminal] ${message}\u001b[0m\r\n`);
    };

    const resize = () => {
      if (!terminal || !fitAddon) return;
      try {
        fitAddon.fit();
      } catch {
        // The viewport may be hidden during a responsive layout transition.
      }
    };

    const createTerminal = async () => {
      setState('opening');
      setError(undefined);
      terminal = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.35,
        scrollback: 5_000,
        theme: {
          background: '#17191d',
          foreground: '#e7e9ec',
          cursor: '#e17b3a',
          selectionBackground: '#49515d',
          black: '#17191d',
          brightBlack: '#6f7782',
          red: '#ef8d83',
          brightRed: '#ffb4aa',
          green: '#9fc58f',
          brightGreen: '#c0e4ad',
          yellow: '#e4c27b',
          brightYellow: '#f2d89b',
          blue: '#8fb6e8',
          brightBlue: '#b5d4ff',
          magenta: '#d2a8d8',
          brightMagenta: '#edc7f0',
          cyan: '#8fd0ce',
          brightCyan: '#b4efeb',
          white: '#d7dbe1',
          brightWhite: '#ffffff',
        },
      });
      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(viewportRef.current!);
      resize();

      const path = relativeWorkspacePath(projectRoot, cwd);
      record = await openTerminal({
        projectId,
        ...(path ? { path } : {}),
        cols: terminal.cols,
        rows: terminal.rows,
      });
      if (disposed) return;

      unsubscribe = subscribe(record.topic, (event) => {
        const message = event as TerminalEvent;
        if (message.type === 'terminal.output' && typeof message.data === 'string') {
          terminal?.write(message.data);
        }
        if (message.type === 'terminal.closed') {
          terminal?.write('\r\n\u001b[90m[Terminal 已关闭]\u001b[0m\r\n');
          setState('exited');
        }
        if (message.type === 'terminal.exited') {
          terminal?.write(
            `\r\n\u001b[90m[Terminal 已退出${formatExit(message.exitCode, message.signal)}]\u001b[0m\r\n`,
          );
          setState('exited');
        }
      });

      dataDisposable = terminal.onData((data) => {
        if (!record) return;
        void sendInput(record.id, data).catch(showError);
      });
      resizeDisposable = terminal.onResize(({ cols, rows }) => {
        if (!record) return;
        void resizeTerminal(record.id, { cols, rows }).catch(showError);
      });
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(viewportRef.current!);
      resize();
      setState('open');
    };

    void createTerminal().catch(showError);

    return () => {
      disposed = true;
      unsubscribe();
      resizeObserver?.disconnect();
      dataDisposable?.dispose();
      resizeDisposable?.dispose();
      if (record) void closeTerminal(record.id).catch(() => undefined);
      terminal?.dispose();
    };
  }, [
    capability?.available,
    closeTerminal,
    cwd,
    expanded,
    openTerminal,
    projectId,
    projectRoot,
    resizeTerminal,
    sendInput,
    subscribe,
  ]);

  const close = () => setExpanded(false);
  const canOpen = Boolean(capability?.available && projectId);
  const capabilityLoading = !capability && !capabilityError;
  const unavailableReason = capabilityLoading
    ? '正在检查 Terminal 能力'
    : (capabilityError?.message ??
      capability?.message ??
      (projectId ? '本机 PTY 未就绪' : '当前 Session 尚未绑定 Project'));

  if (!expanded) {
    return (
      <button
        type="button"
        className={`${terminalStyles.owner} terminal-launcher`}
        disabled={!canOpen}
        onClick={() => setExpanded(true)}
        title={canOpen ? '打开 Terminal' : unavailableReason}
        aria-label={canOpen ? '打开 Terminal' : `打开 Terminal，不可用：${unavailableReason}`}
      >
        <SquareTerminal size={14} aria-hidden="true" />
        <span>Terminal</span>
      </button>
    );
  }

  return (
    <section
      className={`${terminalStyles.owner} terminal-dock-shell expanded`}
      aria-label="Terminal"
    >
      <div className="terminal-dock-toolbar">
        <div className="terminal-dock-heading">
          <SquareTerminal size={16} aria-hidden="true" />
          <strong>Terminal</strong>
          <span>Local Project</span>
        </div>
        <AhButton size="xs" variant="light" color="gray" onClick={close}>
          <X size={14} /> 关闭
        </AhButton>
      </div>
      <div className="terminal-dock-body">
        <div ref={viewportRef} className="terminal-viewport" aria-label="Terminal 输入区" />
        {state === 'opening' && <span className="terminal-dock-status">正在打开 Terminal…</span>}
        {state === 'exited' && (
          <span className="terminal-dock-status">Terminal 已退出，可重新打开。</span>
        )}
        {state === 'error' && (
          <span className="terminal-dock-status error" role="alert">
            {error ?? 'Terminal 连接失败'}
          </span>
        )}
      </div>
    </section>
  );
}

function relativeWorkspacePath(root: string | undefined, cwd: string): string | undefined {
  if (!root) return undefined;
  const normalizedRoot = root.replace(/\/+$/, '');
  if (cwd === normalizedRoot) return undefined;
  if (!cwd.startsWith(`${normalizedRoot}/`)) return undefined;
  return cwd.slice(normalizedRoot.length + 1);
}

function formatExit(exitCode: unknown, signal: unknown): string {
  if (typeof exitCode === 'number') return `，exit ${exitCode}`;
  if (typeof signal === 'number') return `，signal ${signal}`;
  return '';
}
