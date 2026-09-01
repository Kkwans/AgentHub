import { AhButton, AhIconButton, CircleStop, Send } from '@agenthub/ui';
import { type KeyboardEvent, type RefObject, useEffect } from 'react';

import type { RunRecord } from '../../../lib/api';
import { SlashCommandMenu, type ComposerCommand } from './SlashCommandMenu';

export function ComposerSurface({
  text,
  inputRef,
  activeRun,
  sendPending,
  stopPending,
  sendingBlocked,
  inputDisabled,
  placeholder,
  onTextChange,
  onKeyDown,
  onSend,
  onStop,
  commandNotice,
  lockHint,
  sendError,
  stopError,
  onRetryStop,
  commands,
  activeCommandIndex,
  onSelectCommand,
}: {
  text: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  activeRun: RunRecord | undefined;
  sendPending: boolean;
  stopPending: boolean;
  sendingBlocked: boolean;
  inputDisabled: boolean;
  placeholder: string;
  onTextChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  commandNotice: string | undefined;
  lockHint: string | undefined;
  sendError: string | undefined;
  stopError: string | undefined;
  onRetryStop: () => void;
  commands: ComposerCommand[];
  activeCommandIndex: number;
  onSelectCommand: (command: ComposerCommand) => void;
}) {
  const slashMenuOpen = commands.length > 0;

  useEffect(() => {
    if (!activeRun) inputRef.current?.focus();
  }, [activeRun, inputRef]);

  return (
    <>
      <div className="composer-input">
        <textarea
          ref={inputRef}
          aria-label="给 Agent 发送工程指令"
          autoComplete="off"
          name="message"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={2}
          disabled={inputDisabled}
        />
        {slashMenuOpen ? (
          <SlashCommandMenu
            commands={commands}
            activeIndex={activeCommandIndex}
            onSelect={onSelectCommand}
          />
        ) : null}
        {activeRun ? (
          <AhIconButton
            className="send-button stop"
            color="red"
            onClick={onStop}
            disabled={stopPending}
            label={stopPending ? '正在停止 Run' : '停止 Run'}
          >
            <CircleStop size={18} />
          </AhIconButton>
        ) : (
          <AhIconButton
            className="send-button"
            disabled={sendingBlocked}
            aria-busy={sendPending}
            onClick={onSend}
            label="发送"
          >
            <Send size={18} />
          </AhIconButton>
        )}
      </div>
      {stopError ? (
        <div className="workspace-query-error" role="alert">
          <span>停止 Run 失败：{stopError}</span>
          <AhButton
            color="red"
            size="xs"
            variant="light"
            disabled={stopPending}
            onClick={onRetryStop}
          >
            重试停止
          </AhButton>
        </div>
      ) : null}
      {sendError ? (
        <span className="composer-error" role="alert">
          {sendError}
        </span>
      ) : null}
      {commandNotice ? (
        <span className="composer-hint composer-command-notice" role="status">
          {commandNotice}
        </span>
      ) : null}
      {lockHint ? (
        <span className="composer-hint composer-lock-hint" role="status">
          {lockHint}
        </span>
      ) : null}
    </>
  );
}
