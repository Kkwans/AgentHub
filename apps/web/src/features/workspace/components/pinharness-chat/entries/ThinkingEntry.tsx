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

/**
 * ThinkingBlock — 主对话与 subagent 共用的 thinking 折叠块。
 * 流式时自动展开 + StreamingDots + Markdown 渐入 + 来源标签；完成后折叠为来源标签。
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
  // 执行中强制展开，完成后折叠为来源标签；用户仍可手动查看全文。
  const [expanded, setExpanded] = useState(streaming);

  useEffect(() => {
    setExpanded(streaming);
  }, [streaming]);

  // Chunk reception timestamps are not evidence of the provider's reasoning duration.
  void durationMs;
  const label = streaming ? 'Agent 正在提供思考内容' : 'Agent 思考内容';
  return (
    <details
      className={cn('thinking-event-row process-thought', streaming && 'running')}
      open={expanded}
    >
      <summary
        role="button"
        className="process-thought-trigger"
        onClick={(event) => {
          event.preventDefault();
          setExpanded((value) => !value);
        }}
        aria-expanded={expanded}
        aria-label={`${label}，${expanded ? '收起' : '展开'}思考内容`}
      >
        <Brain size={15} aria-hidden="true" className="process-thought-icon" />
        <span className="process-thought-label">{label}</span>
        {streaming && <span className="tool-running-dot process-thought-live" aria-hidden="true" />}
        {expanded ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
      </summary>
      <div className="process-thought-body">
        <MarkdownText text={text} streaming={streaming} truncated={false} />
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
