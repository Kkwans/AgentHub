/**
 * ThinkingEntry — Extended Thinking 展示（执行中展开，完成后折叠）
 *
 * 性能：
 *   - React.memo 精细比较 content + streaming，防止兄弟 entry 更新时的无效重渲染
 *   - StreamingDots 独立 memo 组件，复用 bounce 动画 VNode
 */

import type { PinHarnessDisplayEntry } from '../types';
import { cn } from '@agenthub/ui';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { MarkdownText } from '../MarkdownView';
import { StreamingDots } from '../StreamingDots';

/**
 * ThinkingBlock — 主对话与 subagent 共用的 thinking 折叠块。
 * 流式时自动展开 + StreamingDots + Markdown 渐入 + 实时耗时；完成后折叠为耗时摘要。
 *
 * memo：SubagentEntry 每个 chunk 都会整体重渲染，已完成 thinking 段的
 * props（原始值）不变即可跳过，避免长转录下折叠头全部重渲染。
 */
export const ThinkingBlock = memo(function ThinkingBlock({
  text,
  streaming,
  durationMs,
}: {
  text: string;
  streaming: boolean;
  durationMs: number;
}) {
  // 执行中强制展开，完成后折叠为耗时摘要；用户仍可手动查看全文。
  const [expanded, setExpanded] = useState(streaming);

  useEffect(() => {
    setExpanded(streaming);
  }, [streaming]);

  const thinkingDuration = formatThinkingDuration(durationMs);
  // 流式期间展示实时耗时（随 chunk 更新，不额外起定时器以免破坏 memo）；
  // 不足 1 秒时 formatThinkingDuration 返回「不到 1 秒」，流式态下省略更自然。
  const label = streaming
    ? thinkingDuration === '不到 1 秒'
      ? '思考中…'
      : `思考中 ${thinkingDuration}`
    : `思考了 ${thinkingDuration}`;

  return (
    <details className={cn('thinking-event-row', streaming && 'running')} open={expanded}>
      <summary className="list-none [&::-webkit-details-marker]:hidden">
        <div className="my-1 overflow-hidden rounded-lg border border-violet-200/60 bg-gradient-to-r from-violet-500/[0.04] to-indigo-500/[0.02] animate-[hci-entry_220ms_ease-out_both] dark:border-violet-500/20 dark:from-violet-500/[0.08] dark:to-indigo-500/[0.04]">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              setExpanded((v) => !v);
            }}
            aria-label={streaming ? '正在思考，展开思考过程' : '展开思考过程'}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-all duration-150 hover:bg-violet-500/[0.06] active:scale-[0.995] dark:hover:bg-violet-400/[0.08]"
          >
            {/* 图标区域 */}
            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-violet-100 to-indigo-100 dark:from-violet-800/50 dark:to-indigo-800/40">
              {streaming ? (
                <StreamingDots variant="violet" />
              ) : (
                <Brain className="h-3 w-3 text-violet-500 dark:text-violet-400" />
              )}
            </span>

            {/* 文字区域 */}
            <span className="font-medium text-[11.5px] text-violet-600/90 dark:text-violet-300/90">
              {label}
              {streaming && <span className="sr-only">正在思考</span>}
            </span>
            <span className="ml-auto shrink-0">
              {expanded ? (
                <ChevronDown className="h-3 w-3 text-violet-400/70 dark:text-violet-400/60" />
              ) : (
                <ChevronRight className="h-3 w-3 text-violet-400/50 dark:text-violet-500/40" />
              )}
            </span>
          </button>
        </div>
      </summary>

      {/* 展开内容：grid 行高过渡实现平滑动画 */}
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
          expanded
            ? 'grid-rows-[1fr] opacity-100'
            : 'pointer-events-none grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-violet-200/50 bg-[hsl(var(--surface))]/60 px-3 py-2 dark:border-violet-500/15">
            <div className="text-[11.5px] leading-relaxed text-[hsl(var(--foreground-subtle))] [&_p]:mb-1.5">
              <MarkdownText text={text} streaming={streaming} truncated={false} />
            </div>
          </div>
        </div>
      </div>
    </details>
  );
});

export const ThinkingEntry = memo(
  function ThinkingEntry({ entry }: { entry: PinHarnessDisplayEntry }) {
    const text = entry.entry?.content ?? '';
    const streaming = entry.streaming ?? false;
    const durationMs = Math.max(
      0,
      (entry.entry?.lastChunkTime ?? entry.entry?.timestamp ?? 0) - (entry.entry?.timestamp ?? 0),
    );

    return <ThinkingBlock text={text} streaming={streaming} durationMs={durationMs} />;
  },
  (prev, next) => {
    if (prev.entry.streaming !== next.entry.streaming) return false;
    if (prev.entry.entry?.content !== next.entry.entry?.content) return false;
    if (prev.entry.entry?.timestamp !== next.entry.entry?.timestamp) return false;
    if (prev.entry.entry?.lastChunkTime !== next.entry.entry?.lastChunkTime) return false;
    return true;
  },
);

function formatThinkingDuration(durationMs: number): string {
  if (durationMs < 1000) return '不到 1 秒';

  const seconds = Math.round(durationMs / 1000);
  if (seconds <= 60) return `${seconds} 秒`;

  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}
