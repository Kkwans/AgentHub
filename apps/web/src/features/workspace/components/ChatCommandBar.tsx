/**
 * ChatCommandBar — direct AgentHub port of
 * /volume2/Project/PinHarness/web/src/components/run/chat/ChatCommandBar.tsx.
 *
 * The PinHarness surface/toolbar order and motion classes are kept intact.
 * Only the callback and record types are adapted to AgentHub's REST/WS
 * contract; no attachment or backend event semantics are added here.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CompositionEvent,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import type {
  AgentRecord,
  EventRecord,
  ProjectRecord,
  ResolvedPromptContextRecord,
  RunRecord,
  SessionConfigurationRecord,
  SessionRecord,
} from '../../../lib/api';
import type { QueryState } from '../workspace-types';
import { ComposerSurface } from './ComposerSurface';
import { ComposerToolbar, type ComposerContextStatus } from './ComposerToolbar';
import { ContextPopover } from './ContextPopover';
import type { ComposerCommand } from './SlashCommandMenu';

function useWorkspaceAction<TInput, TResult>(action: (input: TInput) => Promise<TResult>) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error>();
  const [variables, setVariables] = useState<TInput>();
  const mutateAsync = async (input: TInput): Promise<TResult> => {
    setVariables(input);
    setError(undefined);
    setIsPending(true);
    try {
      return await action(input);
    } catch (cause) {
      const next = cause instanceof Error ? cause : new Error('操作失败。');
      setError(next);
      throw next;
    } finally {
      setIsPending(false);
    }
  };
  const mutate = (input: TInput) => {
    // Event handlers use the fire-and-forget form. The hook already exposes
    // the failure through `error`; swallow the rejected promise here so a
    // transport failure cannot surface as an unhandled browser rejection.
    void mutateAsync(input).catch(() => undefined);
  };
  return {
    mutate,
    mutateAsync,
    reset: () => setError(undefined),
    isPending,
    isError: Boolean(error),
    error,
    variables,
  };
}

/** PinHarness source component name; AgentHub keeps Composer as a compatibility export. */
export function ChatCommandBar({
  session,
  agent,
  project,
  activeRun,
  events,
  promptContext,
  promptContextLoading,
  promptContextError,
  promptContextRetry,
  promptVariables,
  setPromptVariables,
  configuration,
  configurationLoading,
  configurationError,
  onSend,
  onStop,
  onUpdateConfiguration,
  terminalLauncherSlotRef,
}: {
  session: SessionRecord;
  agent: AgentRecord | undefined;
  project: ProjectRecord | undefined;
  activeRun: RunRecord | undefined;
  events: QueryState<EventRecord[]>;
  promptContext: ResolvedPromptContextRecord | undefined;
  promptContextLoading: boolean;
  promptContextError: Error | null;
  promptContextRetry: () => unknown;
  promptVariables: Record<string, unknown>;
  setPromptVariables: (variables: Record<string, unknown>) => void;
  configuration: SessionConfigurationRecord | undefined;
  configurationLoading: boolean;
  configurationError: Error | null;
  onSend: (input: { text: string; promptVariables: Record<string, unknown> }) => Promise<unknown>;
  onStop: (runId: string) => Promise<unknown>;
  onUpdateConfiguration: (patch: {
    model?: string;
    mode?: string;
    reasoningEffort?: string;
  }) => Promise<SessionConfigurationRecord>;
  /** Portal target for the workspace Terminal trigger inside the PinHarness toolbar. */
  terminalLauncherSlotRef?: RefObject<HTMLElement | null>;
}) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [inputHeight, setInputHeight] = useState(40);
  const [focused, setFocused] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [variablesDraft, setVariablesDraft] = useState(() =>
    JSON.stringify(promptVariables, null, 2),
  );
  const [variablesError, setVariablesError] = useState<string>();
  const [commandNotice, setCommandNotice] = useState<string>();
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);

  const draftKey = `agenthub.workspace.composer.${session.id}`;
  useEffect(() => {
    try {
      const draft = window.sessionStorage.getItem(draftKey);
      setText(draft ?? '');
    } catch {
      setText('');
    }
    setInputHeight(40);
  }, [draftKey]);

  useEffect(() => {
    try {
      if (text) window.sessionStorage.setItem(draftKey, text);
      else window.sessionStorage.removeItem(draftKey);
    } catch {
      // Draft persistence is best-effort and must never block sending.
    }
  }, [draftKey, text]);

  useEffect(() => {
    setVariablesDraft(JSON.stringify(promptVariables, null, 2));
  }, [promptVariables]);

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      resizeStateRef.current = { startY: event.clientY, startHeight: inputHeight };
    },
    [inputHeight],
  );

  const handleResizeMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState) return;
    const nextHeight = resizeState.startHeight + resizeState.startY - event.clientY;
    setInputHeight(Math.min(320, Math.max(40, nextHeight)));
  }, []);

  const handleResizeEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    resizeStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);
  const send = useWorkspaceAction<void, unknown>(async () => {
    const result = await onSend({ text, promptVariables });
    if (result === false) return result;
    setText('');
    setCommandNotice(undefined);
    return result;
  });
  const stop = useWorkspaceAction(async () => {
    if (!activeRun) throw new Error('当前没有可停止的 Run');
    return onStop(activeRun.id);
  });
  const updateConfiguration = useWorkspaceAction(
    async (patch: { model?: string; mode?: string; reasoningEffort?: string }) => {
      const result = await onUpdateConfiguration(patch);
      setCommandNotice(undefined);
      return result;
    },
  );
  const sessionLocked = session.status !== 'READY';
  const sessionLockMessage =
    sessionLocked && !activeRun
      ? session.status === 'CLOSED'
        ? '会话已关闭，无法继续发送指令。'
        : session.status === 'DISCONNECTED'
          ? 'Agent 连接已中断，请先恢复会话。'
          : '会话正在准备中，请稍候。'
      : undefined;
  const composerPlaceholder = activeRun
    ? 'Agent 正在运行，可先写下一条指令，停止当前 Run 后发送…'
    : (sessionLockMessage ?? '给 Agent 发送工程指令…');
  const modelOptions = configuration?.options?.models ?? [];
  const modeOptions = configuration?.options?.modes ?? [];
  const reasoningEffortOptions = configuration?.options?.reasoningEfforts ?? [];
  const modelValue = configuration?.current?.model ?? session.model ?? '';
  const modeValue = configuration?.current?.mode ?? session.mode ?? '';
  const reasoningEffortValue = configuration?.current?.reasoningEffort ?? '';
  const updatingModel =
    updateConfiguration.isPending && updateConfiguration.variables?.model !== undefined;
  const updatingMode =
    updateConfiguration.isPending && updateConfiguration.variables?.mode !== undefined;
  const updatingReasoningEffort =
    updateConfiguration.isPending && updateConfiguration.variables?.reasoningEffort !== undefined;
  const agentCommands = useMemo(() => readAgentCommands(events.data), [events.data]);
  const planSummary = useMemo(() => readPlanSummary(events.data), [events.data]);
  const slashCommands = useMemo(() => {
    const builtins: ComposerCommand[] = [
      {
        name: 'model',
        label: '切换模型',
        description: '切换当前 Session 后续 Run 使用的模型',
        hint: modelOptions.length ? modelOptions.map((option) => option.id).join('、') : '模型 ID',
      },
      {
        name: 'mode',
        label: '切换运行模式',
        description: '切换当前 Session 的运行模式',
        hint: modeOptions.length ? modeOptions.map((option) => option.id).join('、') : '模式 ID',
      },
      ...(reasoningEffortOptions.length
        ? [
            {
              name: 'effort',
              label: '切换推理强度',
              description: '切换当前 Session 的推理强度',
              hint: reasoningEffortOptions.map((option) => option.id).join('、'),
            },
          ]
        : []),
      ...(modeOptions.some((option) => option.id === 'plan')
        ? [
            {
              name: 'plan',
              label: '切换计划模式',
              description: '在计划模式与标准模式之间切换',
              hint: '无需参数',
            },
          ]
        : []),
      {
        name: 'help',
        label: '查看命令帮助',
        description: '查看当前 Session 可用的命令',
        hint: '无需参数',
      },
    ];
    const commands = new Map(builtins.map((command) => [command.name, command]));
    for (const command of agentCommands) {
      if (!commands.has(command.name)) commands.set(command.name, command);
    }
    return [...commands.values()];
  }, [agentCommands, modeOptions, modelOptions, reasoningEffortOptions]);
  const slashQuery = text.startsWith('/') && !text.includes('\n') ? text.slice(1) : null;
  const slashMenuOpen =
    slashQuery !== null &&
    !slashQuery.includes(' ') &&
    !slashQuery.includes('\t') &&
    slashCommands.length > 0;
  const filteredSlashCommands = slashMenuOpen
    ? slashCommands.filter((command) =>
        command.name.toLocaleLowerCase().startsWith(slashQuery.toLocaleLowerCase()),
      )
    : [];
  useEffect(() => {
    setActiveCommandIndex(0);
  }, [slashQuery]);
  const localSlashCommand = parseLocalSlashCommand(text, {
    hasPlanMode: modeOptions.some((option) => option.id === 'plan'),
    hasDefaultMode: modeOptions.some((option) => option.id === 'default'),
    currentMode: modeValue,
  });
  const executeLocalSlashCommand = () => {
    if (!localSlashCommand) return false;
    if (localSlashCommand.kind === 'help') {
      setCommandNotice(
        '可用命令：/model <模型 ID>、/mode <模式 ID>、/effort <推理强度 ID>。Agent 提供的命令会在列表中显示。',
      );
      return true;
    }
    if (!localSlashCommand.value || !localSlashCommand.patch) {
      setCommandNotice(`用法：/${localSlashCommand.name} <值>；可选值见输入框上方的命令提示。`);
      return true;
    }
    updateConfiguration.mutate(localSlashCommand.patch);
    return true;
  };
  const contextBlocked =
    promptContextLoading ||
    Boolean(promptContextError) ||
    !promptContext ||
    Boolean(variablesError) ||
    promptContext.ready === false;
  const contextStatus: ComposerContextStatus = promptContextLoading
    ? { label: '解析中', kind: 'loading' }
    : variablesError
      ? { label: '解析失败', kind: 'error' }
      : promptContextError
        ? { label: '服务失败', kind: 'error' }
        : !promptContext
          ? { label: '等待解析', kind: 'loading' }
          : promptContext.ready === false
            ? { label: `缺 ${promptContext.missingVariables.length} 项变量`, kind: 'missing' }
            : promptContext.items.length === 0
              ? { label: '无绑定', kind: 'empty' }
              : { label: `${promptContext.items.length} 项`, kind: 'ready' };
  const sendingBlocked =
    !text.trim() ||
    send.isPending ||
    updateConfiguration.isPending ||
    (contextBlocked && !localSlashCommand) ||
    Boolean(variablesError) ||
    sessionLocked;
  const applyVariables = () => {
    try {
      const parsed = JSON.parse(variablesDraft) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      setVariablesError(undefined);
      setPromptVariables(parsed as Record<string, unknown>);
    } catch {
      setVariablesError('变量必须是合法 JSON object');
    }
  };
  const sendCurrentText = () => {
    if (!text.trim()) return;
    if (send.isPending) return;
    if (activeRun) {
      setCommandNotice('当前 Run 正在运行，请先停止后再发送。');
      return;
    }
    if (!executeLocalSlashCommand()) send.mutate(undefined);
  };
  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      if (contextOpen) {
        event.preventDefault();
        setContextOpen(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      return;
    }
    if (slashMenuOpen && filteredSlashCommands.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveCommandIndex((index) => (index + 1) % filteredSlashCommands.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveCommandIndex(
          (index) => (index - 1 + filteredSlashCommands.length) % filteredSlashCommands.length,
        );
        return;
      }
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !composingRef.current &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        const command = filteredSlashCommands[activeCommandIndex];
        if (command) setText(`/${command.name} `);
        return;
      }
    }
    // PinHarness sends on Return and keeps Shift+Return for an explicit line
    // break. Ctrl/Cmd+Return naturally follows the same path for desktop
    // muscle memory, while IME composition is left untouched.
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !composingRef.current &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      sendCurrentText();
    }
  };
  const handleCardClick = () => {
    if (focused || (sessionLocked && !activeRun) || send.isPending) return;
    inputRef.current?.focus();
  };
  return (
    <section
      className="composer-shell relative z-20 w-full shrink-0 min-w-0"
      role="group"
      aria-label="Composer 命令栏"
    >
      <div
        ref={cardRef}
        // The whole PinHarness card is a text-entry target. Keep clicks on
        // the empty surface ergonomic without stealing toolbar focus.
        // biome-ignore lint/a11y/useKeyWithClickEvents: card click focuses its textarea
        onClick={handleCardClick}
        className={`chat-command-card relative flex min-w-0 cursor-text flex-col overflow-visible rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))]/98 shadow-[0_1px_3px_hsl(var(--foreground)/0.05),0_1px_2px_hsl(var(--foreground)/0.04)] backdrop-blur-sm transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:border-[hsl(var(--border-strong))] focus-within:border-[hsl(var(--primary))]/45 focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.07),0_2px_6px_hsl(var(--foreground)/0.06)] motion-reduce:transition-none ${send.isPending ? 'pointer-events-none' : ''}`}
        data-focused={focused || undefined}
        data-running={Boolean(activeRun) || undefined}
        data-sending={send.isPending || undefined}
        aria-busy={send.isPending}
      >
        {contextOpen && (
          <ContextPopover
            project={project}
            session={session}
            promptContext={promptContext}
            promptContextLoading={promptContextLoading}
            promptContextError={promptContextError}
            promptContextRetry={promptContextRetry}
            variablesDraft={variablesDraft}
            variablesError={variablesError}
            contextStatus={contextStatus}
            onVariablesDraftChange={setVariablesDraft}
            onApplyVariables={applyVariables}
          />
        )}
        <ComposerSurface
          text={text}
          inputRef={inputRef}
          inputHeight={inputHeight}
          onResizeStart={handleResizeStart}
          onResizeMove={handleResizeMove}
          onResizeEnd={handleResizeEnd}
          activeRun={activeRun}
          stopPending={stop.isPending}
          // PinHarness keeps the editor usable while the current Run is active;
          // only a locked Session without an active Run should disable input.
          inputDisabled={sessionLocked && !activeRun}
          readOnly={send.isPending}
          focused={focused}
          placeholder={composerPlaceholder}
          onTextChange={(value) => {
            setText(value);
            setCommandNotice(undefined);
          }}
          onKeyDown={handleInputKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={(event: FocusEvent<HTMLTextAreaElement>) => {
            // Preserve the focused card state when moving from the textarea
            // to a PromptOS/configuration control inside the same surface.
            if (cardRef.current?.contains(event.relatedTarget as Node | null)) return;
            setFocused(false);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event: CompositionEvent<HTMLTextAreaElement>) => {
            composingRef.current = false;
            // 让浏览器先提交 IME 文本，再允许下一次 Enter 触发发送。
            const value = event.currentTarget.value;
            requestAnimationFrame(() => {
              setText(value);
            });
          }}
          commandNotice={commandNotice}
          lockHint={sessionLockMessage}
          sendError={send.error?.message}
          stopError={stop.error?.message}
          onRetryStop={() => stop.mutate(undefined)}
          commands={slashMenuOpen ? filteredSlashCommands : []}
          activeCommandIndex={activeCommandIndex}
          onSelectCommand={(command) => {
            setText(`/${command.name} `);
            setCommandNotice(undefined);
            inputRef.current?.focus();
          }}
        />
        <ComposerToolbar
          contextOpen={contextOpen}
          contextStatus={contextStatus}
          {...(planSummary ? { planSummary } : {})}
          onToggleContext={() => setContextOpen((open) => !open)}
          configuration={configuration}
          configurationLoading={configurationLoading}
          model={modelValue || agent?.defaultModel || ''}
          mode={modeValue || agent?.defaultMode || ''}
          reasoningEffort={reasoningEffortValue}
          updatingModel={updatingModel}
          updatingMode={updatingMode}
          updatingReasoningEffort={updatingReasoningEffort}
          onChangeConfiguration={(patch) => updateConfiguration.mutate(patch)}
          activeRun={Boolean(activeRun)}
          sessionStatus={session.status}
          sendPending={send.isPending}
          stopPending={stop.isPending}
          sendingBlocked={sendingBlocked}
          onSend={sendCurrentText}
          onStop={() => stop.mutate(undefined)}
          {...(terminalLauncherSlotRef ? { terminalLauncherSlotRef } : {})}
        />
        {configurationError && (
          <div
            className="border-t border-[hsl(var(--destructive))]/15 px-3 py-2 text-xs text-[hsl(var(--destructive))]"
            role="alert"
          >
            配置读取失败：{configurationError.message}
          </div>
        )}
        {updateConfiguration.isError && (
          <div
            className="border-t border-[hsl(var(--destructive))]/15 px-3 py-2 text-xs text-[hsl(var(--destructive))]"
            role="alert"
          >
            {updateConfiguration.error?.message}
          </div>
        )}
      </div>
    </section>
  );
}

export const Composer = ChatCommandBar;

function readAgentCommands(events: EventRecord[] | undefined): ComposerCommand[] {
  const latest = [...(events ?? [])]
    .reverse()
    .find((event) => event.type === 'agent.commands.updated');
  const commands = latest?.payloadJson.commands;
  if (!Array.isArray(commands)) return [];
  return commands.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    if (typeof record.name !== 'string' || !record.name.trim()) return [];
    return [
      {
        name: record.name,
        label: 'Agent 命令',
        description: describeAgentCommand(record.name),
        ...(typeof record.hint === 'string' ? { hint: record.hint } : {}),
      },
    ];
  });
}

export type ComposerPlanSummary = {
  completed: number;
  total: number;
};

/**
 * Reduce the latest plan snapshots into the compact progress fact used by the
 * PinHarness CommandBar. The detailed plan remains an inline timeline entry;
 * this helper only reads already-normalized AgentHub event payloads.
 */
export function readPlanSummary(
  events: EventRecord[] | undefined,
): ComposerPlanSummary | undefined {
  const entries = new Map<string, string>();
  for (const event of [...(events ?? [])].sort((left, right) => left.seq - right.seq)) {
    if (event.type !== 'agent.plan.updated') continue;
    const update = isRecord(event.payloadJson.update)
      ? event.payloadJson.update
      : event.payloadJson;
    if (!Array.isArray(update.entries)) continue;
    for (const rawEntry of update.entries) {
      if (!isRecord(rawEntry) || typeof rawEntry.content !== 'string') continue;
      entries.set(
        rawEntry.content,
        typeof rawEntry.status === 'string' ? rawEntry.status.toLowerCase() : 'pending',
      );
    }
  }
  if (entries.size === 0) return undefined;
  return {
    completed: [...entries.values()].filter((status) => status === 'completed' || status === 'done')
      .length,
    total: entries.size,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const AGENT_COMMAND_DESCRIPTIONS: Record<string, string> = {
  plan: '切换计划模式',
  mcp: '查看已配置的 MCP 工具',
  skills: '查看可用 Skill',
  status: '查看当前 Session 配置和 token 用量',
  review: '审阅未提交修改，可附加说明',
  'review-branch': '按基准分支审阅修改',
  'review-commit': '审阅指定提交',
  compact: '压缩对话上下文，释放可用空间',
  goal: '设置持续推进的 Goal',
  logout: '退出 Codex 登录',
};

function describeAgentCommand(name: string): string {
  const normalized = name.trim().toLocaleLowerCase();
  return (
    AGENT_COMMAND_DESCRIPTIONS[normalized] ??
    (normalized.startsWith('$') ? '调用对应的 Agent Skill' : 'Agent 提供的命令')
  );
}

function parseLocalSlashCommand(
  text: string,
  options: { hasPlanMode: boolean; hasDefaultMode: boolean; currentMode: string },
):
  | {
      name: string;
      kind: 'configuration' | 'help';
      value?: string;
      patch?: { model?: string; mode?: string; reasoningEffort?: string };
    }
  | undefined {
  const match = /^\/(model|mode|effort|reasoning-effort|plan|help)(?:\s+(.+))?$/i.exec(text.trim());
  if (!match) return undefined;
  const name = match[1]!.toLocaleLowerCase();
  const value = match[2]?.trim();
  if (name === 'help') return { name, kind: 'help' };
  if (name === 'plan') {
    if (!options.hasPlanMode) return undefined;
    const nextMode = options.currentMode === 'plan' && options.hasDefaultMode ? 'default' : 'plan';
    return { name, kind: 'configuration', value: nextMode, patch: { mode: nextMode } };
  }
  if (!value) return { name, kind: 'configuration' };
  if (name === 'model') return { name, kind: 'configuration', value, patch: { model: value } };
  if (name === 'mode') return { name, kind: 'configuration', value, patch: { mode: value } };
  return {
    name,
    kind: 'configuration',
    value,
    patch: { reasoningEffort: value },
  };
}
