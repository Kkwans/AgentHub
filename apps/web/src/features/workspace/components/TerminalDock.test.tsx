// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TerminalDock } from './TerminalDock';

const terminalRecord = {
  id: 'terminal-1',
  projectId: 'project-1',
  cwd: '/workspace/src',
  shell: '/bin/bash',
  topic: 'terminal:terminal-1',
};

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    write() {}
    dispose() {}
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TerminalDock', () => {
  const terminalActions = () => ({
    openTerminal: vi.fn(async () => terminalRecord),
    sendInput: vi.fn(async () => undefined),
    resizeTerminal: vi.fn(async () => undefined),
    closeTerminal: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
  });

  it('在能力不可用时说明原因并禁用打开动作', () => {
    const actions = terminalActions();
    render(
      <TerminalDock
        capability={{
          available: false,
          code: 'PTY_NATIVE_BINDING_UNAVAILABLE',
          message: '当前环境缺少 node-pty native binding',
        }}
        capabilityError={null}
        projectId="project-1"
        projectRoot="/workspace"
        cwd="/workspace/src"
        {...actions}
      />,
    );

    expect(screen.queryByText('Terminal 暂不可用')).not.toBeInTheDocument();
    expect(screen.queryByText('当前环境缺少 node-pty native binding')).not.toBeInTheDocument();
    expect(screen.queryByText('PTY_NATIVE_BINDING_UNAVAILABLE')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开 Terminal/ })).toHaveAttribute(
      'title',
      '当前环境缺少 node-pty native binding',
    );
    expect(screen.getByRole('button', { name: /打开 Terminal/ })).toBeDisabled();
  });

  it('打开时只把当前 Project 内的相对 cwd 交给 Terminal，并复用 terminal topic', async () => {
    const actions = terminalActions();

    render(
      <TerminalDock
        capability={{ available: true, code: 'READY', message: 'Terminal PTY 可用' }}
        capabilityError={null}
        projectId="project-1"
        projectRoot="/workspace"
        cwd="/workspace/src"
        {...actions}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开 Terminal/ }));
    await waitFor(() =>
      expect(actions.openTerminal).toHaveBeenCalledWith({
        projectId: 'project-1',
        path: 'src',
        cols: 80,
        rows: 24,
      }),
    );
    expect(actions.subscribe).toHaveBeenCalledWith('terminal:terminal-1', expect.any(Function));

    fireEvent.click(screen.getByRole('button', { name: /关闭/ }));
    await waitFor(() => expect(actions.closeTerminal).toHaveBeenCalledWith('terminal-1'));
  });
});
