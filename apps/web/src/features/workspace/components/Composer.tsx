import { Button, CircleStop, GitBranch, IconButton, Plus, Send, ShieldCheck } from '@agenthub/ui';
import { useEffect, useMemo, useState } from 'react';

import { ErrorState, LoadingState } from '../../../components/Common';
import type {
  AgentRecord,
  EventRecord,
  ProjectRecord,
  ResolvedPromptContextRecord,
  RunRecord,
  SessionConfigurationRecord,
  SessionRecord,
} from '../../../lib/api';
import {
  labelPromptBindingSlot,
  labelPromptBindingTarget,
  labelReasoningEffort,
  labelSessionMode,
} from '../../../presentation/domain-labels';
import type { QueryState } from '../workspace-types';
import { SessionConfigurationControl } from './SessionConfigurationControl';

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

export function Composer({
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
}) {
  const [text, setText] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [variablesDraft, setVariablesDraft] = useState(() =>
    JSON.stringify(promptVariables, null, 2),
  );
  const [variablesError, setVariablesError] = useState<string>();
  const [commandNotice, setCommandNotice] = useState<string>();
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const send = useWorkspaceAction<void, unknown>(async () => {
    const result = await onSend({ text, promptVariables });
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
      setText('');
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
  const contextStatus = promptContextLoading
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
  return (
    <div className="composer">
      <div className="composer-context">
        <button
          type="button"
          className={`composer-context-action${contextOpen ? ' active' : ''}`}
          onClick={() => setContextOpen(!contextOpen)}
          aria-expanded={contextOpen}
          aria-label={`PromptOS ${contextStatus.label}`}
        >
          <Plus size={15} />
          <span>上下文</span>
          <small>{contextStatus.label}</small>
        </button>
        <span className="composer-permission">
          <ShieldCheck size={15} />
          <strong>按需审批</strong>
        </span>
        <SessionConfigurationControl
          configuration={configuration}
          loading={configurationLoading}
          model={modelValue || agent?.defaultModel || ''}
          mode={modeValue || agent?.defaultMode || ''}
          reasoningEffort={reasoningEffortValue}
          updatingModel={updatingModel}
          updatingMode={updatingMode}
          updatingReasoningEffort={updatingReasoningEffort}
          onChange={(patch) => updateConfiguration.mutate(patch)}
        />
      </div>
      {configurationError && (
        <div className="composer-error" role="alert">
          配置读取失败：{configurationError.message}
        </div>
      )}
      {updateConfiguration.isError && (
        <div className="composer-error" role="alert">
          {updateConfiguration.error?.message}
        </div>
      )}
      {contextOpen && (
        <div className="composer-context-preview">
          <div className="context-preview-heading">
            <div>
              <strong>PromptOS 上下文预览</strong>
              <span>发送 Run 前解析，版本、标签与 content hash 会写入来源记录。</span>
            </div>
            <span className={contextStatus.kind}>{contextStatus.label}</span>
          </div>
          {promptContextLoading ? (
            <LoadingState label="正在解析 PromptOS 上下文" />
          ) : promptContextError ? (
            <div className="prompt-context-error">
              <ErrorState error={promptContextError} />
              <Button color="red" size="1" variant="soft" onClick={() => promptContextRetry()}>
                重新解析
              </Button>
            </div>
          ) : (
            <>
              <div className="composer-session-facts" aria-label="会话上下文事实">
                <div>
                  <span>Project</span>
                  <strong>{project?.name ?? '未知'}</strong>
                </div>
                <div className="cwd-chip">
                  <span>cwd</span>
                  <code>{session.cwd}</code>
                </div>
                <div>
                  <span>branch</span>
                  <strong>
                    <GitBranch size={13} /> {session.branch || '无 Git'}
                  </strong>
                </div>
                <div>
                  <span>Tools</span>
                  <strong>自动</strong>
                </div>
                <div>
                  <span>Skill</span>
                  <strong>自动</strong>
                </div>
              </div>
              <div className="composer-context-grid">
                <div className="composer-provenance">
                  {!promptContext?.items.length ? (
                    <p>当前 Project、Agent、Task 没有生效的绑定。</p>
                  ) : (
                    promptContext.items.map((item) => (
                      <div key={item.bindingId}>
                        <span>{labelPromptBindingSlot(item.slot)}</span>
                        <code>
                          {item.promptKey}@{item.label ?? `v${item.version}`}
                        </code>
                        <small>
                          {labelPromptBindingTarget(item.targetType)}，v{item.version}，hash{' '}
                          {item.contentHash.slice(0, 10)}
                        </small>
                      </div>
                    ))
                  )}
                </div>
                <label>
                  变量 JSON
                  <textarea
                    className="mono"
                    value={variablesDraft}
                    onChange={(event) => setVariablesDraft(event.target.value)}
                    rows={4}
                  />
                  <Button
                    color="gray"
                    size="1"
                    variant="soft"
                    onClick={() => {
                      try {
                        const parsed = JSON.parse(variablesDraft) as unknown;
                        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                          throw new Error();
                        setVariablesError(undefined);
                        setPromptVariables(parsed as Record<string, unknown>);
                      } catch {
                        setVariablesError('变量必须是合法 JSON object');
                      }
                    }}
                  >
                    应用并重新解析
                  </Button>
                  {variablesError && (
                    <small className="context-variable-error" role="alert">
                      {variablesError}
                    </small>
                  )}
                  {promptContext?.ready === false && !variablesError && (
                    <small className="context-variable-error">
                      缺少：{promptContext.missingVariables.join('、')}
                    </small>
                  )}
                </label>
              </div>
            </>
          )}
        </div>
      )}
      <div className="composer-input">
        <textarea
          aria-label="给 Agent 发送工程指令"
          autoComplete="off"
          name="message"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setCommandNotice(undefined);
          }}
          onKeyDown={(event) => {
            if (!slashMenuOpen || !filteredSlashCommands.length) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveCommandIndex((index) => (index + 1) % filteredSlashCommands.length);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveCommandIndex(
                (index) =>
                  (index - 1 + filteredSlashCommands.length) % filteredSlashCommands.length,
              );
            } else if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              const command = filteredSlashCommands[activeCommandIndex];
              if (command) setText(`/${command.name} `);
            }
          }}
          placeholder={sessionLockMessage ?? '给 Agent 发送工程指令…'}
          rows={2}
          disabled={Boolean(activeRun) || sessionLocked}
        />
        {slashMenuOpen && filteredSlashCommands.length > 0 && (
          <div className="composer-command-menu" role="listbox" aria-label="可用命令">
            {filteredSlashCommands.map((command, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === activeCommandIndex}
                className={index === activeCommandIndex ? 'active' : ''}
                key={command.name}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setText(`/${command.name} `)}
              >
                <strong>/{command.name}</strong>
                <span>{command.label}</span>
                <small>{command.description}</small>
                {command.hint && <code>{command.hint}</code>}
              </button>
            ))}
          </div>
        )}
        {activeRun ? (
          <IconButton
            className="send-button stop"
            color="red"
            onClick={() => stop.mutate(undefined)}
            disabled={stop.isPending}
            aria-label={stop.isPending ? '正在停止 Run' : '停止 Run'}
          >
            <CircleStop size={18} />
          </IconButton>
        ) : (
          <IconButton
            className="send-button"
            disabled={
              !text.trim() ||
              send.isPending ||
              updateConfiguration.isPending ||
              (contextBlocked && !localSlashCommand) ||
              Boolean(variablesError) ||
              sessionLocked
            }
            onClick={() => {
              if (!executeLocalSlashCommand()) send.mutate(undefined);
            }}
            aria-label="发送"
          >
            <Send size={18} />
          </IconButton>
        )}
      </div>
      {stop.error && (
        <div className="workspace-query-error" role="alert">
          <span>停止 Run 失败：{stop.error.message}</span>
          <Button
            color="red"
            size="1"
            variant="soft"
            disabled={stop.isPending}
            onClick={() => stop.mutate(undefined)}
          >
            重试停止
          </Button>
        </div>
      )}
      {send.error && (
        <span className="composer-error" role="alert">
          {send.error.message}
        </span>
      )}
      {commandNotice && (
        <span className="composer-hint composer-command-notice" role="status">
          {commandNotice}
        </span>
      )}
      {sessionLockMessage && (
        <span className="composer-hint composer-lock-hint" role="status">
          {sessionLockMessage}
        </span>
      )}
    </div>
  );
}

interface ComposerCommand {
  name: string;
  label: string;
  description: string;
  hint?: string;
}

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
