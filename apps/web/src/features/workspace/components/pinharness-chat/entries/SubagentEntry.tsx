/**
 * SubagentEntry — Subagent 嵌套卡片（可折叠，展开后渲染子对话流）
 *
 * 展示子 agent 的：
 *   - 合并后的文本消息（markdown）
 *   - 工具调用列表（带状态、耗时、可展开详情）
 *   - thinking 内容（折叠）
 *   - 右侧摘要侧栏（agents / tools / 耗时）
 */

import type {
  PinHarnessConversationEntry as ConversationEntry,
  PinHarnessDisplayEntry as DisplayEntry,
} from '../types';
import { cn } from '@agenthub/ui';
import {
  Bot,
  ChevronRight,
  CircleCheck,
  Clock,
  Hash,
  Layers,
  LockKeyhole,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownText } from '../MarkdownView';
import { TOOL_THEMES, resolveToolTheme } from '../toolThemes';
import { ThinkingBlock } from './ThinkingEntry';

const SUBAGENT_TOOL_OUTPUT_PREVIEW_CHARS = 600;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: subagent entry renders multiple states
export function SubagentEntry({ entry }: { entry: DisplayEntry }) {
  const data = entry.subagent;
  if (!data) return null;

  const [expanded, setExpanded] = useState(false);
  const isRunning = data.status === 'running' || data.status === 'pending';
  const isFailed = data.status === 'failed';
  const childCount = data.childEntries.length;

  // 统计工具调用数
  const metrics = useMemo(
    () => computeSubagentMetrics(data.rootEntry, data.childEntries),
    [data.rootEntry, data.childEntries],
  );
  const promptText = useMemo(
    () => extractSubagentPrompt(data.rootEntry, data.description),
    [data.rootEntry, data.description],
  );
  const statusLabel = isFailed ? '失败' : isRunning ? '执行中' : '已完成';
  const summaryLabel =
    metrics.toolRuns > 0 ? `${metrics.toolRuns} tools` : `${metrics.entryCount} entries`;

  // 从 rawInput 中提取模型和 subagent 类型
  const rawInput = data.rootEntry.rawInput ?? {};
  // model 字段：优先从 rawInput 取（后端注入），整型或字符串均兼容
  const modelNum =
    typeof rawInput.model === 'number'
      ? rawInput.model
      : typeof rawInput.model === 'string' && rawInput.model !== ''
        ? Number(rawInput.model) || null
        : null;
  const modelName =
    typeof rawInput.model === 'string'
      ? rawInput.model
      : modelNum != null
        ? String(modelNum)
        : null;
  // subagent_type：Claude 调用 task 工具时传入的 agent 类型名
  const subagentType =
    typeof rawInput.subagent_type === 'string'
      ? rawInput.subagent_type
      : typeof rawInput.subagentType === 'string'
        ? rawInput.subagentType
        : null;
  // 托管 subagent 元数据：后端 AgentExecutor 注入
  const managedProfile =
    typeof rawInput.managedProfile === 'string' ? rawInput.managedProfile : null;
  const managedTools: string[] = Array.isArray(rawInput.managedTools)
    ? (rawInput.managedTools as string[]).filter((t) => typeof t === 'string')
    : [];

  const panelId = `subagent-panel-${data.rootEntry.id}`;

  return (
    <section
      className={cn(
        'group/subagent relative my-2 overflow-hidden rounded-xl border bg-[hsl(var(--surface))] shadow-[0_1px_2px_hsl(var(--foreground)/0.03)] animate-[hci-entry_220ms_ease-out_both]',
        isFailed
          ? 'border-red-500/25'
          : expanded
            ? 'border-[hsl(var(--border))]/80 shadow-[0_8px_28px_hsl(var(--foreground)/0.06)]'
            : 'border-[hsl(var(--border))]/55 hover:border-[hsl(var(--border))] hover:shadow-[0_6px_20px_hsl(var(--foreground)/0.05)]',
        isRunning && 'subagent-running',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={childCount > 0 ? panelId : undefined}
        className={cn(
          'relative w-full px-3.5 py-3 text-left outline-none transition-colors duration-200 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--primary))]/50',
          isFailed
            ? 'bg-red-500/[0.035] hover:bg-red-500/[0.06]'
            : 'bg-[hsl(var(--surface))] hover:bg-[hsl(var(--surface-muted))]/30',
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border shadow-sm',
              isFailed
                ? 'border-red-500/20 bg-red-500/10 text-red-500'
                : 'border-[hsl(var(--primary))]/20 bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]',
            )}
          >
            <Bot className={cn('h-4 w-4', isRunning && 'subagent-running-icon')} />
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[hsl(var(--surface))]',
                isFailed
                  ? 'bg-[hsl(var(--destructive))]'
                  : isRunning
                    ? 'subagent-running-dot bg-[hsl(var(--primary))]'
                    : 'bg-[hsl(var(--success))]',
              )}
            />
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em]',
                  isFailed
                    ? 'border-red-500/20 bg-red-500/10 text-red-500'
                    : 'border-[hsl(var(--primary))]/20 bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]',
                )}
              >
                <Sparkles className="h-2.5 w-2.5" />
                SubAgent
                <span className="sr-only">子 Agent</span>
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold',
                  isFailed
                    ? 'bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]'
                    : isRunning
                      ? 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]'
                      : 'bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]',
                )}
              >
                {!isRunning && !isFailed && <CircleCheck className="h-2.5 w-2.5" />}
                {isRunning && (
                  <span className="subagent-running-dot h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
                )}
                {isFailed && <span aria-hidden="true">×</span>}
                {statusLabel}
              </span>
              {subagentType && (
                <span className="max-w-[180px] truncate rounded-md bg-[hsl(var(--primary))]/[0.08] px-1.5 py-0.5 font-mono text-[9px] text-[hsl(var(--primary))]">
                  {subagentType}
                </span>
              )}
              {modelName && (
                <span className="max-w-[180px] truncate rounded-md bg-[hsl(var(--primary))]/[0.08] px-1.5 py-0.5 font-mono text-[9px] text-[hsl(var(--primary))]">
                  {modelName}
                </span>
              )}
              {managedProfile && (
                <span className="inline-flex max-w-[180px] items-center gap-1 truncate rounded-md bg-[hsl(var(--primary))]/[0.08] px-1.5 py-0.5 font-mono text-[9px] text-[hsl(var(--primary))]">
                  <LockKeyhole className="h-2.5 w-2.5 shrink-0" />
                  {managedTools.length} tools
                </span>
              )}
            </span>

            <span
              className={cn(
                'mt-1.5 block line-clamp-2 text-[12px] font-medium leading-5',
                isFailed ? 'text-red-600' : 'text-[hsl(var(--foreground))]',
              )}
            >
              {data.description}
            </span>

            <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-[hsl(var(--foreground-subtle))]">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3 opacity-60" />
                {metrics.durationLabel}
              </span>
              <span className="inline-flex items-center gap-1">
                <Layers className="h-3 w-3 opacity-60" />
                {summaryLabel}
              </span>
              {managedProfile && (
                <span className="inline-flex min-w-0 items-center gap-1 text-[hsl(var(--primary))]/80">
                  <LockKeyhole className="h-3 w-3 shrink-0" />
                  <span className="max-w-[220px] truncate">{managedProfile}</span>
                </span>
              )}
            </span>
          </span>

          <span
            className={cn(
              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[hsl(var(--border))]/60 bg-[hsl(var(--surface))]/70 text-[hsl(var(--foreground-subtle))] transition-[transform,border-color,color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/subagent:border-[hsl(var(--primary))]/25 group-hover/subagent:text-[hsl(var(--primary))]',
              expanded && 'rotate-90',
            )}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </button>

      {childCount > 0 && (
        <div
          id={panelId}
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
            expanded
              ? 'grid-rows-[1fr] opacity-100'
              : 'pointer-events-none grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="min-h-0 border-t border-[hsl(var(--border))]/45 bg-[hsl(var(--surface-muted))]/10">
              <SubagentExpandedContent
                childEntries={data.childEntries}
                metrics={metrics}
                statusLabel={statusLabel}
                promptText={promptText}
                statusTone={isFailed ? 'danger' : isRunning ? 'info' : 'success'}
                modelName={modelName}
                subagentType={subagentType}
                managedProfile={managedProfile}
                managedTools={managedTools}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
// ═══════════════════════════════════════════════════════════════
// 展开后的子对话内容（左对话流 + 右摘要侧栏）
// ═══════════════════════════════════════════════════════════════

/** segment 渲染的入场动画包装（文本/思考/工具共用） */
function SubagentSegmentAnim({ idx, children }: { idx: number; children: React.ReactNode }) {
  return (
    <div
      className="animate-[hci-entry_200ms_var(--ease-out-expo)_both] motion-reduce:animate-none"
      style={{ animationDelay: `${idx * 40}ms`, animationFillMode: 'both' as const }}
    >
      {children}
    </div>
  );
}
function SubagentExpandedContent({
  childEntries,
  metrics,
  statusLabel,
  promptText,
  statusTone,
  modelName,
  subagentType,
  managedProfile,
  managedTools,
}: {
  childEntries: ConversationEntry[];
  metrics: SubagentMetrics;
  statusLabel: string;
  promptText: string;
  statusTone: 'info' | 'success' | 'danger';
  modelName: string | null;
  subagentType: string | null;
  managedProfile: string | null;
  managedTools: string[];
}) {
  const segments = useMemo(() => buildSubagentSegments(childEntries), [childEntries]);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  // 自动滚动到底部（跟随新输出内容）
  const scrollRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: segments.length intentionally triggers scroll on new segment
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [segments.length]);

  return (
    <div className="grid min-h-0 gap-3 p-3 md:h-[clamp(260px,45dvh,480px)] md:grid-cols-[minmax(0,1fr)_minmax(230px,280px)] md:grid-rows-[minmax(0,1fr)]">
      {/* 左侧：完整执行轨迹 */}
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-[hsl(var(--border))]/45 bg-[hsl(var(--surface))]">
        <div className="flex shrink-0 items-center justify-between border-b border-[hsl(var(--border))]/35 px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[hsl(var(--foreground-muted))]">
            <Sparkles className="h-3 w-3 text-[hsl(var(--primary))]" />
            执行轨迹
          </span>
          <span className="font-mono text-[9px] text-[hsl(var(--foreground-faint))]">
            {metrics.entryCount} entries · {metrics.toolRuns} tools
          </span>
        </div>
        <div
          ref={scrollRef}
          className="min-h-[160px] flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-3 py-2.5 md:min-h-0"
        >
          {segments.map((seg, idx) => {
            if (seg.kind === 'text') {
              return (
                <SubagentSegmentAnim key={seg.id} idx={idx}>
                  <SubagentTextSegment text={seg.text} streaming={seg.streaming} />
                </SubagentSegmentAnim>
              );
            }
            if (seg.kind === 'thinking') {
              return (
                <SubagentSegmentAnim key={seg.id} idx={idx}>
                  <ThinkingBlock
                    text={seg.text}
                    streaming={seg.streaming}
                    durationMs={seg.durationMs}
                  />
                </SubagentSegmentAnim>
              );
            }
            if (seg.kind === 'tool') {
              return (
                <SubagentSegmentAnim key={seg.id} idx={idx}>
                  <SubagentToolRow entry={seg.entry} />
                </SubagentSegmentAnim>
              );
            }
            return null;
          })}
        </div>
      </div>

      {/* 右侧：上下文与运行配置；窄屏下改为纵向堆叠，信息不丢失 */}
      <aside className="flex min-h-0 flex-col gap-2 overflow-hidden">
        <div className="shrink-0 rounded-lg border border-[hsl(var(--border))]/45 bg-[hsl(var(--surface))] p-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--foreground-faint))]">
            <Hash className="h-3 w-3 text-[hsl(var(--primary))]" />
            Run overview
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <OverviewMetric label="状态" value={statusLabel} tone={statusTone} />
            <OverviewMetric label="耗时" value={metrics.durationLabel} />
            <OverviewMetric label="条目" value={String(metrics.entryCount)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <MetaChip icon={Bot} value={subagentType ?? 'worker'} />
            {modelName && <MetaChip value={modelName} />}
            {managedProfile && <MetaChip icon={LockKeyhole} value={managedProfile} />}
          </div>
        </div>

        {managedTools.length > 0 && (
          <div className="shrink-0 overflow-hidden rounded-lg border border-[hsl(var(--primary))]/20 bg-[hsl(var(--primary))]/[0.04]">
            <button
              type="button"
              onClick={() => setToolsExpanded((v) => !v)}
              aria-expanded={toolsExpanded}
              className="flex w-full items-center gap-1.5 px-2.5 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[hsl(var(--primary))] outline-none transition-colors hover:bg-[hsl(var(--primary))]/[0.06] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--primary))]/40"
            >
              <Wrench className="h-3 w-3" />
              Managed tools
              <span className="rounded-full bg-[hsl(var(--primary))]/10 px-1.5 py-0.5 tabular-nums">
                {managedTools.length}
              </span>
              <span
                className={cn(
                  'ml-auto inline-flex transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
                  toolsExpanded && 'rotate-90',
                )}
              >
                <ChevronRight className="h-3 w-3" />
              </span>
            </button>
            {toolsExpanded && (
              <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto border-t border-[hsl(var(--primary))]/15 px-2.5 py-2">
                {managedTools.map((tool) => (
                  <span
                    key={tool}
                    className="inline-flex items-center rounded-md border border-[hsl(var(--primary))]/15 bg-[hsl(var(--surface))] px-1.5 py-0.5 font-mono text-[9px] text-[hsl(var(--primary))]"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex min-h-[160px] flex-1 flex-col overflow-hidden rounded-lg border border-[hsl(var(--primary))]/25 bg-gradient-to-b from-[hsl(var(--primary))]/[0.07] to-[hsl(var(--surface))] md:min-h-0">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-[hsl(var(--primary))]/15 px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--primary))]">
            <Layers className="h-3 w-3" />
            Subagent prompt
          </div>
          <pre className="min-h-0 flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[10px] leading-[1.65] text-[hsl(var(--foreground-muted))]">
            {promptText}
          </pre>
        </div>
      </aside>
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'info' | 'success' | 'danger';
}) {
  return (
    <div className="min-w-0 rounded-md bg-[hsl(var(--surface-muted))]/45 px-2 py-1.5">
      <div className="text-[8px] font-medium text-[hsl(var(--foreground-faint))]">{label}</div>
      <div
        className={cn(
          'mt-0.5 truncate font-mono text-[10px] font-semibold tabular-nums',
          tone === 'info' && 'text-[hsl(var(--primary))]',
          tone === 'success' && 'text-[hsl(var(--success))]',
          tone === 'danger' && 'text-[hsl(var(--destructive))]',
          tone === 'neutral' && 'text-[hsl(var(--foreground-muted))]',
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function MetaChip({
  value,
  icon: Icon,
}: {
  value: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}) {
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-[hsl(var(--primary))]/15 bg-[hsl(var(--primary))]/[0.07] px-1.5 py-0.5 font-mono text-[9px] text-[hsl(var(--primary))]"
      title={value}
    >
      {Icon && <Icon className="h-2.5 w-2.5 shrink-0" />}
      <span className="truncate">{value}</span>
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════
// Subagent 指标计算
// ═══════════════════════════════════════════════════════════════

interface SubagentMetrics {
  durationLabel: string;
  entryCount: number;
  toolRuns: number;
  agentLabels: string[];
}

function computeSubagentMetrics(
  rootEntry: ConversationEntry,
  entries: ConversationEntry[],
): SubagentMetrics {
  const entryCount = entries.length;
  const toolEntries = entries.filter((e) => e.entryType === 'tool_use');

  let durationMs =
    typeof rootEntry.toolDurationMs === 'number' && rootEntry.toolDurationMs > 0
      ? rootEntry.toolDurationMs
      : 0;

  if (durationMs <= 0) {
    const childToolDurations = toolEntries
      .map((e) => e.toolDurationMs)
      .filter((d): d is number => typeof d === 'number' && d > 0);
    if (childToolDurations.length > 0) {
      durationMs = Math.max(...childToolDurations);
    }
  }

  if (durationMs <= 0) {
    const latestTs = entries.reduce(
      (max, e) => (e.timestamp > max ? e.timestamp : max),
      rootEntry.timestamp,
    );
    durationMs = Math.max(0, latestTs - rootEntry.timestamp);
  }

  const agentSet = new Set<string>();
  for (const e of entries) {
    if (e.subagentId) {
      agentSet.add(`agent-${e.subagentId.slice(0, 6)}`);
    }
  }

  return {
    durationLabel: formatSubagentDuration(durationMs),
    entryCount,
    toolRuns: toolEntries.length,
    agentLabels: agentSet.size > 0 ? Array.from(agentSet) : ['worker'],
  };
}

function formatSubagentDuration(ms: number): string {
  if (ms <= 0) return '--';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}h ${restMinutes}m`;
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: recursive type narrowing
function coercePromptText(value: unknown, depth = 0): string | null {
  if (depth > 5 || value == null) return null;

  const direct = asNonEmptyString(value);
  if (direct) return direct;

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => coercePromptText(item, depth + 1))
      .filter((item): item is string => typeof item === 'string' && item.length > 0);
    if (parts.length > 0) return parts.join('\n');
    return null;
  }

  if (typeof value !== 'object') return null;

  const obj = value as Record<string, unknown>;

  // OpenAI/Catpaw message block 常见结构：{ type: 'text', text: '...' }
  if (obj.type === 'text') {
    const text = asNonEmptyString(obj.text);
    if (text) return text;
  }

  const textLikeKeys = [
    'prompt',
    'text',
    'content',
    'instruction',
    'query',
    'task',
    'description',
    'message',
    'value',
  ] as const;

  for (const key of textLikeKeys) {
    if (key in obj) {
      const found = coercePromptText(obj[key], depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function findByPaths(raw: Record<string, unknown>, paths: readonly string[]): string | null {
  for (const path of paths) {
    const found = coercePromptText(getByPath(raw, path));
    if (found) return found;
  }
  return null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: recursive object traversal
function findByKeysDeep(value: unknown, keys: readonly string[], depth = 0): string | null {
  if (depth > 5 || !value || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findByKeysDeep(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const obj = value as Record<string, unknown>;

  for (const key of keys) {
    if (key in obj) {
      const direct = coercePromptText(obj[key], depth + 1);
      if (direct) return direct;
    }
  }

  for (const nested of Object.values(obj)) {
    const found = findByKeysDeep(nested, keys, depth + 1);
    if (found) return found;
  }

  return null;
}

function extractSubagentPrompt(rootEntry: ConversationEntry, fallbackDescription: string): string {
  const raw = rootEntry.rawInput;
  if (!raw) return fallbackDescription;

  // task 常见字段：description 只是简述，prompt 才是完整任务。
  // 优先读取 prompt / instruction / query 及其变体，再回落到 task / description。
  const prioritizedPaths = [
    'prompt',
    'taskPrompt',
    'task_prompt',
    'userPrompt',
    'user_prompt',
    'instruction',
    'query',
    'input.prompt',
    'payload.prompt',
    'arguments.prompt',
    'params.prompt',
    'task.prompt',
    'input',
    'task',
    'description',
  ] as const;

  const byPath = findByPaths(raw, prioritizedPaths);
  if (byPath) return byPath;

  const byDeepPrimary = findByKeysDeep(raw, [
    'prompt',
    'taskPrompt',
    'task_prompt',
    'userPrompt',
    'user_prompt',
    'instruction',
    'query',
  ]);
  if (byDeepPrimary) return byDeepPrimary;

  const byDeepFallback = findByKeysDeep(raw, ['task', 'description']);
  if (byDeepFallback) return byDeepFallback;

  try {
    const serialized = JSON.stringify(raw, null, 2);
    return serialized.length > 0 ? serialized : fallbackDescription;
  } catch {
    return fallbackDescription;
  }
}

// ═══════════════════════════════════════════════════════════════
// Segment 类型 & 构建器
// ═══════════════════════════════════════════════════════════════

type SubagentSegment =
  | { id: string; kind: 'text'; text: string; streaming: boolean }
  | {
      id: string;
      kind: 'thinking';
      text: string;
      streaming: boolean;
      durationMs: number;
    }
  | { id: string; kind: 'tool'; toolCallId: string; entry: ConversationEntry };

function buildSubagentSegments(entries: ConversationEntry[]): SubagentSegment[] {
  const result: SubagentSegment[] = [];
  let textBuf = '';
  let thinkBuf = '';
  // 当前累积文本段中，是否包含仍在流式的 assistant_message
  let textStreaming = false;
  // thinking 段的流式状态与耗时窗口（与主对话 ThinkingEntry 同口径：
  // 首条 timestamp → 末条 lastChunkTime）
  let thinkStreaming = false;
  let thinkStartTs = 0;
  let thinkEndTs = 0;
  let segmentSeq = 0;

  const nextSegmentId = (kind: SubagentSegment['kind']) => `${kind}-${segmentSeq++}`;

  const flushText = () => {
    if (textBuf.trim()) {
      result.push({
        id: nextSegmentId('text'),
        kind: 'text',
        text: textBuf.trim(),
        streaming: textStreaming,
      });
    }
    textBuf = '';
    textStreaming = false;
  };

  const flushThinking = () => {
    if (thinkBuf.trim()) {
      result.push({
        id: nextSegmentId('thinking'),
        kind: 'thinking',
        text: thinkBuf.trim(),
        streaming: thinkStreaming,
        durationMs: Math.max(0, thinkEndTs - thinkStartTs),
      });
    }
    thinkBuf = '';
    thinkStreaming = false;
    thinkStartTs = 0;
    thinkEndTs = 0;
  };

  const handleAssistantMessage = (e: ConversationEntry) => {
    flushThinking();
    // 不同 assistant 消息之间必须保留 Markdown 块边界，否则前一条末尾与后一条
    // 标题/列表标记会粘连，ReactMarkdown 只能把整段降级为普通连续文本。
    if (textBuf && e.content) textBuf += '\n\n';
    textBuf += e.content;
    // 该文本段是否仍在流式：以最近一条 assistant_message 的 streaming 为准
    textStreaming = e.streaming ?? false;
  };

  const handleThinking = (e: ConversationEntry) => {
    flushText();
    if (!thinkBuf) thinkStartTs = e.timestamp;
    thinkBuf += e.content;
    // 同样以最近一条 thinking 的 streaming 为准
    thinkStreaming = e.streaming ?? false;
    thinkEndTs = e.lastChunkTime ?? e.timestamp;
  };

  // plan/todo 工具调用已在 Plan 面板展示，子 agent 内也跳过
  const isPlanTodoTool = (e: ConversationEntry) => {
    const name = (e.toolTitle || e.toolKind || e.toolCallId || '').toLowerCase();
    return name.includes('todo') || name.includes('plan');
  };

  for (const e of entries) {
    if (e.entryType === 'assistant_message') {
      handleAssistantMessage(e);
    } else if (e.entryType === 'thinking') {
      handleThinking(e);
    } else if (e.entryType === 'tool_use' && !isPlanTodoTool(e)) {
      flushText();
      flushThinking();
      result.push({
        id: nextSegmentId('tool'),
        kind: 'tool',
        toolCallId: e.toolCallId ?? e.id,
        entry: e,
      });
    }
  }
  flushText();
  flushThinking();

  return result;
}

// ─── 文本段（与主对话一致的流式渐入） ──────────────────────────

function SubagentTextSegment({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className="text-[12px] leading-relaxed text-[hsl(var(--foreground-muted))]">
      <MarkdownText text={text} streaming={streaming} truncated={false} />
    </div>
  );
}

// ─── 工具调用行 ──────────────────────

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: tool row renders multiple states and detail views
function SubagentToolRow({ entry }: { entry: ConversationEntry }) {
  const [showDetail, setShowDetail] = useState(false);
  const [showAllOutput, setShowAllOutput] = useState(false);
  const name = entry.toolTitle || entry.toolCallId || '工具';
  const status = entry.toolStatus;
  const isPending = status === 'pending' || status === 'running';
  const isFailed = status === 'failed';
  const hasDetails = !!(
    (entry.rawInput && Object.keys(entry.rawInput).length > 0) ||
    entry.rawOutput
  );
  const durationMs = entry.toolDurationMs;
  const rawOutputText = entry.rawOutput ?? '';
  const hasLongOutput = rawOutputText.length > SUBAGENT_TOOL_OUTPUT_PREVIEW_CHARS;
  const outputText =
    hasLongOutput && !showAllOutput
      ? `${rawOutputText.slice(0, SUBAGENT_TOOL_OUTPUT_PREVIEW_CHARS)}…\n[已折叠 ${rawOutputText.length - SUBAGENT_TOOL_OUTPUT_PREVIEW_CHARS} 字符]`
      : rawOutputText;

  // 工具类型主题（彩色图标 + 徽章）
  const themeKey = resolveToolTheme(`${name} ${entry.toolKind ?? ''}`);
  const theme = TOOL_THEMES[themeKey];
  const ToolIcon = theme.Icon;

  return (
    <div className="my-px">
      <button
        type="button"
        onClick={() => hasDetails && setShowDetail((v) => !v)}
        disabled={!hasDetails}
        className={cn(
          'group relative z-[1] flex w-full items-center gap-2 rounded-md px-1.5 py-[4px] text-left transition-colors duration-100 motion-reduce:transition-none',
          hasDetails ? 'cursor-pointer hover:bg-[hsl(var(--surface-muted))]/50' : 'cursor-default',
          showDetail && 'bg-[hsl(var(--surface-muted))]/35',
        )}
      >
        {/* 左侧：彩色工具图标 */}
        <span className="shrink-0 flex items-center">
          <ToolIcon className={cn('h-3 w-3', isFailed ? 'text-red-400' : theme.iconColor)} />
        </span>

        {/* 工具名徽章 + 参数摘要 */}
        <span className="min-w-0 flex-1 flex items-center gap-1.5 overflow-hidden">
          <span
            className={cn(
              'shrink-0 inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold leading-none',
              isFailed ? 'bg-red-500/12 text-red-400' : cn(theme.badgeBg, theme.badgeText),
            )}
          >
            {name}
          </span>
          {entry.rawInput && (
            <span className="min-w-0 truncate font-mono text-[10px] text-[hsl(var(--foreground-subtle))]">
              {compactArgs(entry.rawInput)}
            </span>
          )}
        </span>

        {/* 右侧：状态 + 耗时 + 箭头 */}
        <span className="shrink-0 inline-flex items-center gap-1.5">
          {isPending ? (
            <span className={cn('h-1.5 w-1.5 rounded-full', theme.dotColor)} />
          ) : isFailed ? (
            <span className="text-[10px] font-medium text-red-400">✗ 失败</span>
          ) : null}
          {durationMs != null && !isPending && (
            <span className="font-mono tabular-nums text-[10px] text-[hsl(var(--foreground-muted))]">
              {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
            </span>
          )}
          {hasDetails && (
            <span
              className={cn(
                'inline-flex text-[hsl(var(--foreground-subtle))] transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
                showDetail ? 'rotate-90 opacity-100' : 'rotate-0 opacity-0 group-hover:opacity-100',
              )}
            >
              <ChevronRight className="h-3 w-3" />
            </span>
          )}
        </span>
      </button>

      {hasDetails && (
        <div
          className={cn(
            'ml-5 mt-px mb-0.5 grid transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none',
            showDetail
              ? 'grid-rows-[1fr] opacity-100'
              : 'pointer-events-none grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              className={cn(
                'overflow-hidden rounded-md mt-0.5',
                isFailed ? 'bg-red-500/[0.04]' : 'bg-[hsl(var(--surface-muted))]/40',
              )}
            >
              {entry.rawInput && Object.keys(entry.rawInput).length > 0 && (
                <div className="px-2 py-1 border-b border-[hsl(var(--border))]/15">
                  <div className="mb-0.5 inline-flex items-center rounded px-1 py-px text-[8.5px] font-semibold uppercase tracking-wider bg-[hsl(var(--muted))] text-[hsl(var(--foreground-faint))]">
                    input
                  </div>
                  <pre className="max-h-[100px] overflow-auto text-[10px] font-mono leading-relaxed text-[hsl(var(--foreground-muted))]">
                    {JSON.stringify(entry.rawInput, null, 2)}
                  </pre>
                </div>
              )}
              {entry.rawOutput && (
                <div className="px-2 py-1">
                  <div className="mb-0.5 inline-flex items-center rounded px-1 py-px text-[8.5px] font-semibold uppercase tracking-wider bg-[hsl(var(--muted))] text-[hsl(var(--foreground-faint))]">
                    output
                  </div>
                  <pre className="max-h-[100px] overflow-auto text-[10px] font-mono leading-relaxed text-[hsl(var(--foreground-muted))]">
                    {outputText}
                  </pre>
                  {hasLongOutput && (
                    <button
                      type="button"
                      onClick={() => setShowAllOutput((v) => !v)}
                      className="mt-0.5 text-[10px] text-[hsl(var(--primary))]/70 hover:text-[hsl(var(--primary))] transition-colors"
                    >
                      {showAllOutput ? '收起' : '展开完整输出…'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 工具参数摘要 ──────────────────────

function compactArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  const out: string[] = [];
  for (const [k, v] of entries.slice(0, 2)) {
    let s: string;
    if (typeof v === 'string') s = v.length > 20 ? `${v.slice(0, 20)}…` : v;
    else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
    else s = '…';
    out.push(`${k}=${s}`);
  }
  let str = out.join(' ');
  if (entries.length > 2) str += ` +${entries.length - 2}`;
  return str.length > 50 ? `${str.slice(0, 50)}…` : str;
}
