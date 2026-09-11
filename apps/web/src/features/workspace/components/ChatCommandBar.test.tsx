// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AgentRecord,
  EventRecord,
  ProjectRecord,
  ResolvedPromptContextRecord,
  RunRecord,
  SessionConfigurationRecord,
  SessionRecord,
} from '../../../lib/api';
import { ChatCommandBar } from './ChatCommandBar';

const session: SessionRecord = {
  id: 'session-composer',
  projectId: 'project-composer',
  agentId: 'agent-composer',
  taskId: null,
  title: 'Composer 细节',
  cwd: '/volume2/Project/AgentHub',
  branch: 'main',
  status: 'READY',
  model: null,
  mode: null,
  reasoningEffort: null,
  lastActiveAt: '2026-09-12T00:00:00.000Z',
};

const agent: AgentRecord = {
  id: session.agentId,
  targetId: 'target-composer',
  name: 'Composer Agent',
  agentKind: 'CODEX',
  adapterKind: 'ACP_STDIO',
  status: 'READY',
  enabled: true,
  detectedVersion: null,
  defaultModel: 'gpt-5.6',
  defaultMode: 'default',
  capabilitiesJson: {},
  lastPreflightAt: null,
};

const project: ProjectRecord = {
  id: session.projectId,
  name: 'AgentHub',
  description: null,
  targetId: 'target-composer',
  rootPath: session.cwd,
  realRootPath: session.cwd,
  repoKind: 'GIT',
  kind: 'STANDARD',
  status: 'ACTIVE',
};

const promptContext: ResolvedPromptContextRecord = {
  ready: true,
  finalContext: '',
  missingVariables: [],
  items: [],
};

const configuration: SessionConfigurationRecord = {
  supported: false,
  current: { model: null, mode: null, reasoningEffort: null },
  options: { models: [], modes: [], reasoningEfforts: [] },
};

const events: {
  data: EventRecord[];
  error: Error | null;
  isLoading: boolean;
  refetch: () => unknown;
} = {
  data: [],
  error: null,
  isLoading: false,
  refetch: vi.fn(),
};

const baseRun: RunRecord = {
  id: 'run-composer',
  sessionId: session.id,
  status: 'RUNNING',
  startedAt: '2026-09-12T00:00:01.000Z',
  finishedAt: null,
  gitBeforeSha: null,
  gitAfterSha: null,
  errorCode: null,
};

function renderComposer(overrides: Partial<React.ComponentProps<typeof ChatCommandBar>> = {}) {
  const onSend = vi.fn(async () => ({ id: 'run-created' }));
  const onStop = vi.fn(async () => ({ id: 'run-stopped' }));
  const onUpdateConfiguration = vi.fn(async () => configuration);
  const props: React.ComponentProps<typeof ChatCommandBar> = {
    session,
    agent,
    project,
    activeRun: undefined,
    events,
    promptContext,
    promptContextLoading: false,
    promptContextError: null,
    promptContextRetry: vi.fn(),
    promptVariables: {},
    setPromptVariables: vi.fn(),
    configuration,
    configurationLoading: false,
    configurationError: null,
    onSend,
    onStop,
    onUpdateConfiguration,
    ...overrides,
  };
  render(<ChatCommandBar {...props} />);
  return { onSend, onStop, onUpdateConfiguration };
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ChatCommandBar PinHarness composer interactions', () => {
  it('restores a session draft, sends with Return and clears only after success', async () => {
    window.sessionStorage.setItem('agenthub.workspace.composer.session-composer', '保留这段草稿');
    const { onSend } = renderComposer();
    const textarea = await screen.findByRole('textbox', { name: '给 Agent 发送工程指令' });

    expect(textarea).toHaveValue('保留这段草稿');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith({ text: '保留这段草稿', promptVariables: {} }),
    );
    expect(textarea).toHaveValue('');
    await waitFor(() =>
      expect(
        window.sessionStorage.getItem('agenthub.workspace.composer.session-composer'),
      ).toBeNull(),
    );
  });

  it('does not send during IME composition and keeps the card focused across toolbar focus', async () => {
    const { onSend } = renderComposer();
    const textarea = await screen.findByRole('textbox', { name: '给 Agent 发送工程指令' });
    const card = document.querySelector('.chat-command-card');
    expect(card).toBeInTheDocument();

    fireEvent.click(card!);
    expect(document.activeElement).toBe(textarea);
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '中文指令' } });
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea);
    await waitFor(() => expect(textarea).toHaveValue('中文指令'));
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));

    fireEvent.change(textarea, { target: { value: '下一条' } });
    const contextButton = screen.getByRole('button', { name: /PromptOS/ });
    fireEvent.focus(contextButton);
    fireEvent.blur(textarea, { relatedTarget: contextButton });
    expect(card).toHaveAttribute('data-focused', 'true');
  });

  it('keeps the textarea editable while a Run is active and swaps send for stop in place', async () => {
    const { onStop } = renderComposer({ activeRun: baseRun });
    const textarea = await screen.findByRole('textbox', { name: '给 Agent 发送工程指令' });
    expect(textarea).not.toBeDisabled();
    expect(textarea).toHaveAttribute(
      'placeholder',
      'Agent 正在运行，可先写下一条指令，停止当前 Run 后发送…',
    );
    expect(textarea).toHaveAttribute('data-active-run', 'true');
    fireEvent.change(textarea, { target: { value: '不要打断当前 Run' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onStop).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('当前 Run 正在运行，请先停止后再发送。');

    const stop = screen.getByRole('button', { name: '停止 Run' });
    expect(stop).toBeVisible();
    expect(document.querySelector('button[aria-label="发送"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    fireEvent.click(stop);
    await waitFor(() => expect(onStop).toHaveBeenCalledWith(baseRun.id));
  });

  it('keeps a failed draft and does not clear it when a local configuration command succeeds', async () => {
    const onSend = vi.fn(async () => {
      throw new Error('网络暂时不可用');
    });
    const onUpdateConfiguration = vi.fn(async () => configuration);
    renderComposer({ onSend, onUpdateConfiguration });
    const textarea = await screen.findByRole('textbox', { name: '给 Agent 发送工程指令' });

    fireEvent.change(textarea, { target: { value: '网络失败后仍要保留' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(textarea).toHaveValue('网络失败后仍要保留');
    expect(await screen.findByRole('alert')).toHaveTextContent('网络暂时不可用');

    fireEvent.change(textarea, { target: { value: '/model gpt-5.6' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onUpdateConfiguration).toHaveBeenCalledWith({ model: 'gpt-5.6' }));
    expect(textarea).toHaveValue('/model gpt-5.6');
  });
});
