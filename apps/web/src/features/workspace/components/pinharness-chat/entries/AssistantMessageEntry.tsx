/**
 * AssistantMessageEntry — PinHarness source message surface.
 *
 * AgentHub keeps transport/error presentation in ChatEntryRenderer, while the
 * normal assistant branch uses this copied source-shaped component so the
 * conversation body, streaming dots and entry animation stay in one visual
 * language.
 */
import { memo } from 'react';

import { MarkdownText } from '../MarkdownView';
import { StreamingDots } from '../StreamingDots';
import type { PinHarnessDisplayEntry } from '../types';

export const AssistantMessageEntry = memo(function AssistantMessageEntry({
  entry,
}: {
  entry: PinHarnessDisplayEntry;
}) {
  const content = entry.entry?.content ?? '';
  const streaming = entry.streaming ?? false;
  if (!content && !streaming) return null;

  return (
    <div className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-1 duration-200 text-[13px] leading-relaxed text-[hsl(var(--foreground))]">
      {content && (
        <div
          className={streaming ? 'streaming-active-block motion-reduce:animate-none' : undefined}
        >
          <MarkdownText text={content} streaming={streaming} truncated={false} />
        </div>
      )}
      {streaming && !content && <StreamingDots variant="primary" />}
    </div>
  );
});
