import { Button } from '@agenthub/ui';
import {
  type CompositionEvent,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
} from 'react';

import type { RunRecord } from '../../../lib/api';
import { SlashCommandMenu, type ComposerCommand } from './SlashCommandMenu';

export function ComposerSurface({
  text,
  inputRef,
  inputHeight,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  activeRun,
  stopPending,
  inputDisabled,
  readOnly,
  focused,
  placeholder,
  onTextChange,
  onKeyDown,
  onFocus,
  onBlur,
  onCompositionStart,
  onCompositionEnd,
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
  inputHeight: number;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeMove: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeEnd: (event: PointerEvent<HTMLDivElement>) => void;
  activeRun: RunRecord | undefined;
  stopPending: boolean;
  inputDisabled: boolean;
  readOnly: boolean;
  focused: boolean;
  placeholder: string;
  onTextChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (event: CompositionEvent<HTMLTextAreaElement>) => void;
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
    if (!activeRun && !inputDisabled) inputRef.current?.focus();
  }, [activeRun, inputDisabled, inputRef]);

  return (
    <>
      <div
        className="composer-input-surface relative flex min-w-0 items-end gap-2 bg-transparent px-3 pb-2 pt-3 sm:px-4"
        data-focused={focused || undefined}
        data-read-only={readOnly || undefined}
      >
        <div
          className="group/resize absolute inset-x-0 top-0 z-20 -translate-y-1/2 flex h-3 touch-none cursor-ns-resize select-none items-center justify-center"
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整输入框高度"
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
        >
          <span
            aria-hidden="true"
            className="h-0.5 w-8 rounded-full bg-[hsl(var(--foreground-faint))] opacity-0 transition-opacity group-hover/resize:opacity-60"
          />
        </div>
        <textarea
          ref={inputRef}
          aria-label="给 Agent 发送工程指令"
          autoComplete="off"
          name="message"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder={placeholder}
          rows={2}
          disabled={inputDisabled}
          readOnly={readOnly}
          data-active-run={activeRun ? 'true' : undefined}
          className="w-full resize-none overflow-y-auto border-0 bg-transparent px-0 pb-1.5 pt-2 text-[13px] leading-[1.45] text-[hsl(var(--foreground))] placeholder-[hsl(var(--foreground-faint))] outline-none transition-[color] duration-150 focus:outline-none focus-visible:shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-0 sm:pb-2.5 sm:pt-2.5"
          style={{ height: `${inputHeight}px`, boxShadow: 'none' }}
        />
        {slashMenuOpen ? (
          <SlashCommandMenu
            commands={commands}
            activeIndex={activeCommandIndex}
            onSelect={onSelectCommand}
          />
        ) : null}
      </div>
      {stopError ? (
        <div
          className="composer-feedback flex items-center gap-2 border-t border-[hsl(var(--destructive))]/15 px-3 py-2 text-xs text-[hsl(var(--destructive))]"
          role="alert"
        >
          <span>停止 Run 失败：{stopError}</span>
          <Button size="xs" variant="destructive" disabled={stopPending} onClick={onRetryStop}>
            重试停止
          </Button>
        </div>
      ) : null}
      {sendError ? (
        <span
          className="composer-feedback border-t border-[hsl(var(--destructive))]/15 px-3 py-2 text-xs text-[hsl(var(--destructive))]"
          role="alert"
        >
          {sendError}
        </span>
      ) : null}
      {commandNotice ? (
        <span
          className="composer-feedback border-t border-[hsl(var(--border))]/50 px-3 py-2 text-xs text-[hsl(var(--foreground-muted))]"
          role="status"
        >
          {commandNotice}
        </span>
      ) : null}
      {lockHint ? (
        <span className="sr-only" role="status">
          {lockHint}
        </span>
      ) : null}
    </>
  );
}
