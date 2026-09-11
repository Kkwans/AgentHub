/**
 * ToolUseEntry — 工具调用卡片（分类型渲染）
 *
 * 优化：
 *   1. 折叠态展示参数摘要（文件路径 / 命令 / 搜索词 / URL）
 *   2. 展开态按工具类型使用专用面板（终端/文件/搜索等）
 *   3. rawOutput 自动解析 JSON（lines 数组/message 等），渲染为 markdown
 *   4. 不同工具类型配色区分
 */

import { useRunningTimer } from '../hooks/useRunningTimer';
import type { PinHarnessDisplayEntry } from '../types';
import { cn } from '@agenthub/ui';
import { Globe, Search } from 'lucide-react';
import { type ReactNode, memo, useMemo } from 'react';
import { MarkdownView } from '../MarkdownView';
import { TOOL_THEMES, resolveToolTheme } from '../toolThemes';
import type { ToolTheme, ToolThemeKey } from '../toolThemes';
import { DeferredToolDetail } from './DeferredToolDetail';
import { EditResultFallback, type EditResultMeta } from './EditResultFallback';
import { ToolDetailToolbar } from './ToolDetailToolbar';
import { ToolEntryHeader } from './ToolEntryHeader';
import { ToolReadDetail } from './ToolReadDetail';
import { ToolSearchDetail } from './ToolSearchDetail';
import { useToolDetailState } from './useToolDetailState';

// ═══════════════════════════════════════════════════════════════
// rawOutput 解析：JSON → 人类可读文本
// ═══════════════════════════════════════════════════════════════

interface ParsedOutput {
  /** 主要文本内容（可渲染为 markdown） */
  text: string;
  /** 元数据（如 success, edited_file 等）可选展示 */
  meta?: Record<string, unknown> | undefined;
}

/** 从已解析的 JSON 对象中提取文本字段，返回 ParsedOutput 或 null */
function extractTextFromParsed(parsed: Record<string, unknown>): ParsedOutput | null {
  if (Array.isArray(parsed.lines)) {
    const text = (parsed.lines as unknown[]).join('\n');
    const meta = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'lines'));
    return { text, meta: Object.keys(meta).length > 0 ? meta : undefined };
  }
  if (typeof parsed.message === 'string') {
    const { message, ...meta } = parsed;
    return { text: message as string, meta: Object.keys(meta).length > 0 ? meta : undefined };
  }
  if (typeof parsed.content === 'string') {
    const { content, ...meta } = parsed;
    return { text: content as string, meta: Object.keys(meta).length > 0 ? meta : undefined };
  }
  if (typeof parsed.fileContent === 'string') {
    const { fileContent, ...meta } = parsed;
    return { text: fileContent as string, meta: Object.keys(meta).length > 0 ? meta : undefined };
  }
  return null;
}

/**
 * 尝试解析 rawOutput：
 * - 如果是 JSON 且含 lines 数组 → 拼接为文本
 * - 如果是 JSON 且含 message/content → 提取文本
 * - 否则原样返回
 */
function parseRawOutput(raw: string | null | undefined): ParsedOutput | null {
  if (!raw) return null;

  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return (
        extractTextFromParsed(parsed) ?? {
          text: `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``,
        }
      );
    } catch {
      // 非 JSON，原样
    }
  }

  return { text: raw };
}

// ═══════════════════════════════════════════════════════════════
// 参数摘要提取
// ═══════════════════════════════════════════════════════════════

/** 从工具输入中提取主题相关的摘要文本，每种主题独立处理 */
const SUMMARY_EXTRACTORS: Partial<
  Record<ToolThemeKey, (input: Record<string, unknown>) => string>
> = {
  terminal: (input) => {
    const cmd = input.command ?? input.cmd ?? input.script;
    return typeof cmd === 'string' ? truncate(cmd.replace(/\n/g, ' '), 60) : '';
  },
  read: (input) => {
    const path =
      input.target_file ??
      input.file_path ??
      input.path ??
      input.target_directory ??
      input.glob_pattern;
    return typeof path === 'string' ? shortenPath(path) : '';
  },
  edit: (input) => {
    const path = input.file_path ?? input.target_file ?? input.path;
    return typeof path === 'string' ? shortenPath(path) : '';
  },
  search: (input) => {
    const pattern = input.pattern ?? input.query ?? input.search_term;
    return typeof pattern === 'string' ? `"${truncate(pattern, 40)}"` : '';
  },
  fetch: (input) => {
    const urls = input.urls ?? input.url;
    if (Array.isArray(urls) && urls.length > 0) return truncate(String(urls[0]), 50);
    return typeof urls === 'string' ? truncate(urls, 50) : '';
  },
  agent: (input) => {
    const desc = input.description ?? input.prompt ?? input.task;
    return typeof desc === 'string' ? truncate(desc, 45) : '';
  },
  plan: (input) => {
    return Array.isArray(input.todos) ? `${input.todos.length} 项任务` : '';
  },
};

function getResultSummary(rawOutput?: string | null): string {
  if (!rawOutput) return '';
  const sample = rawOutput.slice(0, 600);
  const explicit = sample.match(/(?:Listed|Found|Matched|Modified|Created)\s+(\d+)\s+([^\n,.}]*)/i);
  if (explicit) return `${explicit[1] ?? ''} ${(explicit[2] ?? '').trim()}`;
  const exitCode = sample.match(/(?:exit code|exitCode)["':\s]+(-?\d+)/i);
  if (exitCode) return `退出码 ${exitCode[1]}`;
  return rawOutput.length > 20_000 ? `${Math.ceil(rawOutput.length / 1024)} KB` : '';
}

function extractSummary(toolName: string, rawInput?: Record<string, unknown> | null): string {
  if (!rawInput) return '';
  const theme = resolveToolTheme(toolName);
  const extractor = SUMMARY_EXTRACTORS[theme];
  if (extractor) {
    const result = extractor(rawInput);
    if (result) return result;
  }

  // 通用 fallback：取第一个短字符串值
  for (const v of Object.values(rawInput)) {
    if (typeof v === 'string' && v.length > 0 && v.length < 80) {
      return truncate(v, 45);
    }
  }
  return '';
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** 路径缩短：只保留最后 2~3 段 */
function shortenPath(fullPath: string): string {
  const parts = fullPath.split('/').filter(Boolean);
  if (parts.length <= 3) return fullPath;
  return `…/${parts.slice(-3).join('/')}`;
}

/** 解析命令开头的 sleep 时长，支持秒以及 s/m/h/d 后缀。 */
function parseLeadingSleepDurationMs(command: string | null): number | null {
  if (!command) return null;
  const match = command.match(/^\s*sleep\s+(\d+(?:\.\d+)?)\s*([smhd]?)\b/i);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  const unitMs: Record<string, number> = {
    '': 1_000,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * (unitMs[match[2]?.toLowerCase() ?? ''] ?? 1_000);
}

function openableFilePath(
  themeKey: ToolThemeKey,
  input?: Record<string, unknown> | null,
): string | null {
  if ((themeKey !== 'read' && themeKey !== 'edit') || !input) return null;
  const raw = input.target_file ?? input.file_path ?? input.path ?? input.target_directory;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function openToolFile(
  themeKey: ToolThemeKey,
  filePath: string | null,
  openFile: (path: string) => void,
  openDiff: (path: string) => void,
): void {
  if (!filePath) return;
  if (themeKey === 'edit') openDiff(filePath);
  else openFile(filePath);
}

function hasToolOutput(
  rawOutput?: string | null,
  rawInput?: Record<string, unknown> | null,
): boolean {
  return Boolean(rawOutput) || Boolean(rawInput && Object.keys(rawInput).length > 0);
}

function isToolActive(status: string): boolean {
  return status === 'running' || status === 'pending';
}

function toolCommand(rawInput?: Record<string, unknown> | null): string | null {
  const command = rawInput?.command ?? rawInput?.cmd ?? rawInput?.script;
  return typeof command === 'string' ? command : null;
}

function toolSleepDuration(themeKey: ToolThemeKey, command: string | null): number | null {
  return themeKey === 'terminal' ? parseLeadingSleepDurationMs(command) : null;
}

function remainingSleepDuration(duration: number | null, timestamp: number): number | null {
  return duration == null ? null : duration - Math.max(0, Date.now() - timestamp);
}

function toolDetailVisible(showDetail: boolean, hasOutput: boolean, isActive: boolean): boolean {
  return showDetail && (hasOutput || isActive);
}

export const ToolUseEntry = memo(
  function ToolUseEntry({
    entry,
    onOpenFile,
    onOpenDiff,
  }: {
    entry: PinHarnessDisplayEntry;
    onOpenFile: ((path: string) => void) | undefined;
    onOpenDiff: ((path: string) => void) | undefined;
  }) {
    const e = entry.entry;
    if (!e) return null;
    const toolName = e.toolTitle ?? e.toolCallId ?? 'tool';
    const status = e.toolStatus ?? 'running';
    const hasOutput = hasToolOutput(e.rawOutput, e.rawInput);
    const [showDetail, setShowDetail] = useToolDetailState(e.toolCallId ?? e.id);
    const isActive = isToolActive(status);
    const isFailed = status === 'failed';
    const themeKey = resolveToolTheme(toolName);
    const theme = TOOL_THEMES[themeKey];
    const badgeTheme = isFailed ? 'text-[hsl(var(--destructive))]' : theme.badgeText;
    const summary = extractSummary(toolName, e.rawInput);
    const resultSummary = getResultSummary(e.rawOutput);
    const sleepDurationMs = toolSleepDuration(themeKey, toolCommand(e.rawInput));
    useRunningTimer(isActive && sleepDurationMs != null);
    const sleepRemainingMs = remainingSleepDuration(sleepDurationMs, e.timestamp);
    const openFileInPanel = onOpenFile ?? (() => undefined);
    const openFileDiffInPanel = onOpenDiff ?? openFileInPanel;
    const filePathForOpen = useMemo(
      () => openableFilePath(themeKey, e.rawInput),
      [themeKey, e.rawInput],
    );
    return (
      <div
        className={cn(
          'group/tool tool-entry-motion tool-entry-card',
          isActive && 'tool-entry-card--active',
          isFailed && 'tool-entry-card--failed',
          showDetail && 'tool-entry-card--expanded overflow-hidden',
        )}
      >
        <ToolEntryHeader
          hasOutput={hasOutput}
          showDetail={showDetail}
          isActive={isActive}
          isFailed={isFailed}
          theme={theme}
          badgeTheme={badgeTheme}
          toolName={toolName}
          summary={summary}
          resultSummary={resultSummary}
          sleepRemainingMs={sleepRemainingMs}
          toolDurationMs={e.toolDurationMs}
          filePathForOpen={filePathForOpen}
          onToggle={() => setShowDetail((value) => !value)}
          onOpenFile={() =>
            openToolFile(themeKey, filePathForOpen, openFileInPanel, openFileDiffInPanel)
          }
        />
        <ToolExpandedDetail
          visible={toolDetailVisible(showDetail, hasOutput, isActive)}
          toolName={toolName}
          themeKey={themeKey}
          theme={theme}
          rawInput={e.rawInput}
          rawOutput={e.rawOutput}
          isActive={isActive}
          isFailed={isFailed}
        />
      </div>
    );
  },
  (prev, next) => {
    if (prev.entry.streaming !== next.entry.streaming) return false;
    if (prev.entry.entry?.toolStatus !== next.entry.entry?.toolStatus) return false;
    if (prev.entry.entry?.rawInput !== next.entry.entry?.rawInput) return false;
    if (prev.entry.entry?.rawOutput !== next.entry.entry?.rawOutput) return false;
    if (prev.entry.entry?.toolDurationMs !== next.entry.entry?.toolDurationMs) return false;
    if (prev.entry.entry?.timestamp !== next.entry.entry?.timestamp) return false;
    return true;
  },
);

// ═══════════════════════════════════════════════════════════════
// 专用展开面板
// ═══════════════════════════════════════════════════════════════

interface PanelProps {
  themeKey: ToolThemeKey;
  theme: ToolTheme;
  rawInput?: Record<string, unknown> | null | undefined;
  rawOutput?: string | null | undefined;
  actions?: ReactNode | undefined;
}

interface ExpandedDetailProps extends PanelProps {
  visible: boolean;
  toolName: string;
  isActive: boolean;
  isFailed: boolean;
}

function ToolExpandedDetail({
  visible,
  toolName,
  themeKey,
  theme,
  rawInput,
  rawOutput,
  isActive,
  isFailed,
}: ExpandedDetailProps) {
  if (!visible) return null;
  const actions = isFailed ? undefined : (
    <ToolDetailToolbar toolName={toolName} rawOutput={rawOutput} isFailed={false} embedded />
  );
  return (
    <div className="m-0 overflow-hidden border-t border-[hsl(var(--border))]/35">
      <div className={cn('tool-entry-detail-body', isFailed && 'tool-entry-detail-body--failed')}>
        <DeferredToolDetail>
          {isFailed && <ToolDetailToolbar toolName={toolName} rawOutput={rawOutput} isFailed />}
          {isActive && !rawOutput ? (
            <ToolOutputSkeleton themeKey={themeKey} />
          ) : (
            <ToolDetailPanel
              themeKey={themeKey}
              theme={theme}
              rawInput={rawInput}
              rawOutput={rawOutput}
              actions={actions}
            />
          )}
        </DeferredToolDetail>
      </div>
    </div>
  );
}

function ToolDetailPanel({ themeKey, theme, rawInput, rawOutput, actions }: PanelProps) {
  switch (themeKey) {
    case 'terminal':
      return <TerminalPanel rawInput={rawInput} rawOutput={rawOutput} actions={actions} />;
    case 'read':
      return <ReadPanel rawInput={rawInput} rawOutput={rawOutput} actions={actions} />;
    case 'edit':
      return <EditPanel rawInput={rawInput} rawOutput={rawOutput} actions={actions} />;
    case 'search':
      return <SearchPanel rawInput={rawInput} rawOutput={rawOutput} actions={actions} />;
    case 'fetch':
      return <FetchPanel rawInput={rawInput} rawOutput={rawOutput} actions={actions} />;
    default:
      return (
        <GenericPanel theme={theme} rawInput={rawInput} rawOutput={rawOutput} actions={actions} />
      );
  }
}

// ═══════════════════════════════════════════════════════════════
// 输出内容渲染组件（Markdown 格式）
// ═══════════════════════════════════════════════════════════════

/** 解析 rawOutput 并以 Markdown 格式渲染内容 */
function OutputContent({
  rawOutput,
  maxHeight = 320,
}: {
  rawOutput?: string | null;
  maxHeight?: number;
}) {
  const parsed = useMemo(() => parseRawOutput(rawOutput), [rawOutput]);
  if (!parsed) return null;

  // 只保留简单标量值的 meta，过滤掉对象/数组（会显示为 [object Object]）
  const simpleMeta = parsed.meta
    ? Object.entries(parsed.meta).filter(
        ([, val]) =>
          (typeof val === 'string' && val.length > 0 && val.length < 60) ||
          typeof val === 'number' ||
          typeof val === 'boolean',
      )
    : [];

  return (
    <div className="overflow-auto" style={{ maxHeight: `${maxHeight}px` }}>
      <div className="text-[11px] leading-relaxed text-[hsl(var(--foreground))]">
        <MarkdownView text={parsed.text} />
      </div>
      {simpleMeta.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 border-t border-[hsl(var(--border))]/20 pt-1.5">
          {simpleMeta.map(([key, val]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 rounded bg-[hsl(var(--surface-muted))]/50 px-1.5 py-0.5 font-mono text-[10px] text-[hsl(var(--foreground-subtle))]"
            >
              <span className="opacity-50">{key}:</span>
              <span>
                {typeof val === 'boolean' ? (val ? 'true' : 'false') : truncate(String(val), 40)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Terminal Panel ──────────────────────────────────────────

function TerminalPanel({
  rawInput,
  rawOutput,
  actions,
}: Pick<PanelProps, 'rawInput' | 'rawOutput' | 'actions'>) {
  const commandRaw = rawInput?.command ?? rawInput?.cmd ?? rawInput?.script;
  const command = typeof commandRaw === 'string' ? commandRaw : null;
  const parsed = useMemo(() => parseRawOutput(rawOutput), [rawOutput]);
  const lineCount = parsed ? parsed.text.split('\n').length : 0;

  return (
    <div
      className="overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #1c1c1e 0%, #161617 100%)' }}
    >
      <div className="flex min-h-7 items-center gap-2 border-b border-white/[0.06] pl-2.5 pr-1 [&_.tool-detail-action]:text-white/30 [&_.tool-detail-action:hover]:bg-white/[0.08] [&_.tool-detail-action:hover]:text-white/65">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="flex-1 text-center font-mono text-[9px] uppercase tracking-widest text-white/25">
          shell
        </span>
        {lineCount > 0 && (
          <span className="font-mono tabular-nums text-[9px] text-white/25">{lineCount}L</span>
        )}
        {actions}
      </div>
      {command && (
        <div className="px-2.5 pb-1 pt-1.5">
          <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all text-emerald-300/90">
            <span className="text-white/25 select-none mr-1">$</span>
            {command}
          </pre>
        </div>
      )}
      {parsed && (
        <div
          className={cn('px-2.5 pb-1.5', command ? 'border-t border-white/[0.04] pt-1' : 'pt-1.5')}
        >
          <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.15rem] text-white/70 [scrollbar-color:rgba(255,255,255,0.15)_transparent] [scrollbar-width:thin]">
            {parsed.text}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Read/List Panel ─────────────────────────────────────────

function ReadPanel({
  rawInput,
  rawOutput,
  actions,
}: Pick<PanelProps, 'rawInput' | 'rawOutput' | 'actions'>) {
  return <ToolReadDetail rawInput={rawInput} rawOutput={rawOutput} actions={actions} />;
}

// ─── Edit Panel 子组件 ────────────────────────────────────────

/** 方式 2：从 rawOutput.diffInfo.hunks 渲染 diff */
function DiffHunkList({ hunks }: { hunks: DiffHunkData[] }) {
  return (
    <div className="max-h-[340px] overflow-auto divide-y divide-[hsl(var(--border))]/28">
      {hunks.slice(0, 10).map((hunk, i) => (
        <DiffHunk key={hunk.header ?? i} hunk={hunk} />
      ))}
      {hunks.length > 10 && (
        <div className="px-2.5 py-1 text-center text-[11px] text-[hsl(var(--foreground-muted))] italic">
          +{hunks.length - 10} more hunks…
        </div>
      )}
    </div>
  );
}

/** 方式 3：从 rawInput.edits（MultiEdit）渲染多组 diff */
function MultiEditList({ edits }: { edits: unknown[] }) {
  const editList = edits as Array<{ old_string?: string; new_string?: string }>;
  return (
    <div className="max-h-[340px] overflow-auto divide-y divide-[hsl(var(--border))]/28">
      {editList.slice(0, 8).map((edit) => (
        <UnifiedDiff
          key={`${String(edit.old_string ?? '').slice(0, 32)}:${String(edit.new_string ?? '').slice(0, 8)}`}
          oldStr={String(edit.old_string ?? '')}
          newStr={String(edit.new_string ?? '')}
        />
      ))}
      {edits.length > 8 && (
        <div className="px-2.5 py-1 text-center text-[11px] text-[hsl(var(--foreground-muted))] italic">
          +{edits.length - 8} more changes…
        </div>
      )}
    </div>
  );
}

/** 方式 4：write 工具 — 展示写入内容 */
function WriteContentsView({ contents }: { contents: string }) {
  const text =
    contents.length > 3000
      ? `${contents.slice(0, 3000)}\n\n---\n*...content truncated (${contents.length} chars total)*`
      : contents;
  return (
    <div className="max-h-[340px] overflow-auto px-2.5 py-1.5">
      <div className="text-[11px] leading-relaxed text-[hsl(var(--foreground))]">
        <MarkdownView text={text} />
      </div>
    </div>
  );
}

// ─── Edit Panel ──────────────────────────────────────────────

function EditPanel({
  rawInput,
  rawOutput,
  actions,
}: Pick<PanelProps, 'rawInput' | 'rawOutput' | 'actions'>) {
  const oldStr = rawInput?.old_string;
  const newStr = rawInput?.new_string;
  const edits = rawInput?.edits; // MultiEdit
  const writeContents = rawInput?.contents; // write 工具的整体写入内容

  // 从 rawOutput JSON 中提取 diffInfo（后端返回格式：{ diffInfo: { stats, hunks } }）
  const editOutputInfo = useMemo(() => {
    if (!rawOutput) return null;
    try {
      const parsed = JSON.parse(rawOutput) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const resultMeta = Object.entries(parsed).flatMap(([key, value]) => {
        if (
          ['message', 'edited_file', 'diffInfo', 'fileContent'].includes(key) ||
          (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
        ) {
          return [];
        }
        return [[key, value] as EditResultMeta[number]];
      });
      return {
        message: typeof parsed.message === 'string' ? parsed.message : null,
        diffInfo: parsed.diffInfo as DiffInfo | null | undefined,
        fileContent: typeof parsed.fileContent === 'string' ? parsed.fileContent : null,
        resultMeta,
      };
    } catch {
      return {
        message: rawOutput,
        diffInfo: null,
        fileContent: null,
        resultMeta: [],
      };
    }
  }, [rawOutput]);

  const hasDiffFromInput = typeof oldStr === 'string' && typeof newStr === 'string';
  const diffInfo = editOutputInfo?.diffInfo;

  const statsText = hasDiffFromInput
    ? getDiffStats(oldStr as string, newStr as string)
    : diffInfo?.stats
      ? `${diffInfo.stats}`
      : Array.isArray(edits)
        ? `${edits.length} changes`
        : '';

  // 直接用条件 JSX（代替 render 函数），避免每次渲染都创建新的函数引用
  const bodyContent = (() => {
    if (hasDiffFromInput) {
      return (
        <div className="max-h-[300px] overflow-auto">
          <UnifiedDiff oldStr={oldStr as string} newStr={newStr as string} />
        </div>
      );
    }
    if (diffInfo?.hunks && diffInfo.hunks.length > 0) {
      return <DiffHunkList hunks={diffInfo.hunks} />;
    }
    if (Array.isArray(edits)) {
      return <MultiEditList edits={edits as unknown[]} />;
    }
    if (typeof writeContents === 'string') {
      return <WriteContentsView contents={writeContents} />;
    }
    return (
      <EditResultFallback
        fileContent={editOutputInfo?.fileContent ?? null}
        message={editOutputInfo?.message ?? null}
        resultMeta={editOutputInfo?.resultMeta ?? []}
      />
    );
  })();

  return (
    <div className="overflow-hidden bg-[hsl(var(--surface))]/45">
      <div className="flex min-h-7 items-center gap-1.5 border-b border-[hsl(var(--border))]/30 bg-[hsl(var(--surface-muted))]/28 pl-2 pr-1">
        <span className="min-w-0 flex-1 text-[10px] font-medium text-[hsl(var(--foreground-muted))]">
          变更内容
        </span>
        {statsText && (
          <span className="shrink-0 rounded bg-[hsl(var(--surface-muted))]/75 px-1.5 py-px font-mono text-[9px] text-[hsl(var(--foreground-muted))]">
            {statsText}
          </span>
        )}
        {actions}
      </div>
      {bodyContent}
    </div>
  );
}

/** diffInfo 可能的数据结构 */
interface DiffInfo {
  stats?: string;
  hunks?: DiffHunkData[];
  [key: string]: unknown;
}

interface DiffHunkData {
  /** 行号头 */
  header?: string;
  /** 变更行 */
  lines?: Array<{ type: 'add' | 'del' | 'ctx'; content: string }>;
  /** 或简单的 old/new 格式 */
  oldStr?: string;
  newStr?: string;
}

/** 渲染单个 diff hunk */
function DiffHunk({ hunk }: { hunk: DiffHunkData }) {
  // 如果 hunk 有 lines 格式
  if (hunk.lines && hunk.lines.length > 0) {
    return (
      <div className="font-mono text-[11px] leading-[1.6]">
        {hunk.header && (
          <div className="px-2 py-0.5 text-[10px] text-[hsl(var(--foreground-muted))] bg-[hsl(var(--muted))]">
            {hunk.header}
          </div>
        )}
        {hunk.lines.slice(0, 30).map((line) => {
          const lineKey = `${line.type}:${line.content}`;
          if (line.type === 'del') {
            return (
              <div
                key={lineKey}
                className="flex bg-red-500/[0.08] dark:bg-red-500/[0.12] border-l-2 border-l-red-500/60"
              >
                <span className="select-none w-6 shrink-0 text-right pr-1 text-red-500/50 text-[10px]">
                  −
                </span>
                <span className="flex-1 px-1 text-red-800 dark:text-red-300 whitespace-pre-wrap break-all">
                  {line.content || ' '}
                </span>
              </div>
            );
          }
          if (line.type === 'add') {
            return (
              <div
                key={lineKey}
                className="flex bg-green-500/[0.08] dark:bg-green-500/[0.12] border-l-2 border-l-green-500/60"
              >
                <span className="select-none w-6 shrink-0 text-right pr-1 text-green-500/50 text-[10px]">
                  +
                </span>
                <span className="flex-1 px-1 text-green-800 dark:text-green-300 whitespace-pre-wrap break-all">
                  {line.content || ' '}
                </span>
              </div>
            );
          }
          // context
          return (
            <div key={lineKey} className="flex">
              <span className="select-none w-6 shrink-0 text-right pr-1 text-[hsl(var(--foreground-muted))] text-[10px]">
                {' '}
              </span>
              <span className="flex-1 px-1 text-[hsl(var(--foreground))] whitespace-pre-wrap break-all">
                {line.content || ' '}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // fallback: old/new 格式
  if (hunk.oldStr != null || hunk.newStr != null) {
    return <UnifiedDiff oldStr={hunk.oldStr ?? ''} newStr={hunk.newStr ?? ''} />;
  }

  return null;
}

/** 计算 diff 统计 */
function getDiffStats(oldStr: string, newStr: string): string {
  const oldCount = oldStr.split('\n').length;
  const newCount = newStr.split('\n').length;
  const parts: string[] = [];
  if (oldCount > 0) parts.push(`-${oldCount}`);
  if (newCount > 0) parts.push(`+${newCount}`);
  return parts.join(' ');
}

/** Unified Diff 视图 — 类 IDE 风格 */
function UnifiedDiff({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const maxLines = 20;
  // 缓存分割 + 截断结果，避免每次渲染重复计算
  const { truncatedOld, truncatedNew, hasMoreOld, hasMoreNew } = useMemo(() => {
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');
    return {
      truncatedOld: oldLines.slice(0, maxLines),
      truncatedNew: newLines.slice(0, maxLines),
      hasMoreOld: oldLines.length > maxLines,
      hasMoreNew: newLines.length > maxLines,
      oldTotal: oldLines.length,
      newTotal: newLines.length,
    };
  }, [oldStr, newStr]);

  return (
    <div className="font-mono text-[11px] leading-[1.6]">
      {/* 删除行 */}
      {truncatedOld.map((line, lineIdx) => (
        <div
          key={`del:${lineIdx}:${line}`}
          className="flex bg-red-500/[0.08] dark:bg-red-500/[0.12] border-l-2 border-l-red-500/60"
        >
          <span className="select-none w-6 shrink-0 text-right pr-1 text-red-500/50 text-[10px]">
            −
          </span>
          <span className="flex-1 px-1 text-red-800 dark:text-red-300 whitespace-pre-wrap break-all">
            {line || ' '}
          </span>
        </div>
      ))}
      {hasMoreOld && (
        <div className="pl-7 text-[10px] text-red-500/50 italic py-0.5">
          …{truncatedOld.length} more lines (truncated)
        </div>
      )}
      {/* 分隔线 */}
      {truncatedOld.length > 0 && truncatedNew.length > 0 && (
        <div className="border-t border-dashed border-[hsl(var(--border))] my-0" />
      )}
      {/* 新增行 */}
      {truncatedNew.map((line, lineIdx) => (
        <div
          key={`add:${lineIdx}:${line}`}
          className="flex bg-green-500/[0.08] dark:bg-green-500/[0.12] border-l-2 border-l-green-500/60"
        >
          <span className="select-none w-6 shrink-0 text-right pr-1 text-green-500/50 text-[10px]">
            +
          </span>
          <span className="flex-1 px-1 text-green-800 dark:text-green-300 whitespace-pre-wrap break-all">
            {line || ' '}
          </span>
        </div>
      ))}
      {hasMoreNew && (
        <div className="pl-7 text-[10px] text-green-500/50 italic py-0.5">
          …{truncatedNew.length} more lines (truncated)
        </div>
      )}
    </div>
  );
}

// ─── Search/Grep Panel ───────────────────────────────────────

function SearchPanel({
  rawInput,
  rawOutput,
  actions,
}: Pick<PanelProps, 'rawInput' | 'rawOutput' | 'actions'>) {
  const pathRaw = rawInput?.path ?? rawInput?.target_directories;
  const pathText =
    pathRaw == null
      ? ''
      : Array.isArray(pathRaw)
        ? (pathRaw as string[]).join(', ')
        : String(pathRaw);

  return (
    <div className="overflow-hidden bg-[hsl(var(--surface))]/45">
      <div className="flex min-h-7 items-center gap-1.5 border-b border-[hsl(var(--border))]/30 bg-[hsl(var(--surface-muted))]/28 pl-2 pr-1">
        <Search className="h-3 w-3 shrink-0 text-violet-500" />
        <span className="shrink-0 text-[10px] font-medium text-[hsl(var(--foreground-muted))]">
          搜索结果
        </span>
        {pathText ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-[hsl(var(--foreground-faint))]">
            {pathText}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {actions}
      </div>
      {rawOutput && <ToolSearchDetail rawOutput={parseRawOutput(rawOutput)?.text ?? rawOutput} />}
    </div>
  );
}

// ─── Fetch/Web Panel ─────────────────────────────────────────

function FetchPanel({
  rawInput,
  rawOutput,
  actions,
}: Pick<PanelProps, 'rawInput' | 'rawOutput' | 'actions'>) {
  const urls = rawInput?.urls ?? rawInput?.url;
  const urlCount = Array.isArray(urls) ? urls.length : typeof urls === 'string' ? 1 : 0;

  return (
    <div className="overflow-hidden bg-[hsl(var(--surface))]/45">
      <div className="flex min-h-7 items-center gap-1.5 border-b border-[hsl(var(--border))]/30 bg-[hsl(var(--surface-muted))]/28 pl-2 pr-1">
        <Globe className="h-3 w-3 shrink-0 text-cyan-500" />
        <span className="min-w-0 flex-1 text-[10px] font-medium text-[hsl(var(--foreground-muted))]">
          响应内容
        </span>
        {urlCount > 1 && (
          <span className="shrink-0 rounded bg-[hsl(var(--surface-muted))]/75 px-1.5 py-px text-[9px] text-[hsl(var(--foreground-muted))]">
            {urlCount} URLs
          </span>
        )}
        {actions}
      </div>
      {rawOutput && (
        <div className="px-2.5 py-1.5">
          <OutputContent rawOutput={rawOutput} maxHeight={260} />
        </div>
      )}
    </div>
  );
}

// ─── Generic Fallback Panel ──────────────────────────────────

function GenericPanel({
  theme,
  rawInput,
  rawOutput,
  actions,
}: Omit<PanelProps, 'toolName' | 'themeKey'>) {
  return (
    <div className="overflow-hidden bg-[hsl(var(--surface))]/45">
      <div className="flex min-h-7 items-center border-b border-[hsl(var(--border))]/30 bg-[hsl(var(--surface-muted))]/28 pl-2 pr-1">
        <span className="min-w-0 flex-1 text-[10px] font-medium text-[hsl(var(--foreground-muted))]">
          执行详情
        </span>
        {actions}
      </div>
      {rawInput && Object.keys(rawInput).length > 0 && (
        <div className="px-2.5 py-1.5">
          <span
            className={cn(
              'mb-1 inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
              theme.headerColor,
              theme.badgeBg,
            )}
          >
            input
          </span>
          <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-[hsl(var(--foreground-muted))]">
            {JSON.stringify(rawInput, null, 2)}
          </pre>
        </div>
      )}
      {rawOutput && (
        <div
          className={cn(
            'px-2.5 py-1.5',
            rawInput &&
              Object.keys(rawInput).length > 0 &&
              'border-t border-[hsl(var(--border))]/20',
          )}
        >
          <span
            className={cn(
              'mb-1 inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
              theme.headerColor,
              theme.badgeBg,
            )}
          >
            output
          </span>
          <OutputContent rawOutput={rawOutput} maxHeight={220} />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Skeleton 加载态
// ═══════════════════════════════════════════════════════════════

function ToolOutputSkeleton({ themeKey }: { themeKey: ToolThemeKey }) {
  const isTerminal = themeKey === 'terminal';
  return (
    <div className={cn('px-2.5 py-2', isTerminal && 'bg-[#1c1c1e]')}>
      <div className="space-y-2 animate-pulse">
        <div
          className={cn(
            'h-2.5 w-3/4 rounded',
            isTerminal ? 'bg-white/10' : 'bg-[hsl(var(--border))]/60',
          )}
        />
        <div
          className={cn(
            'h-2.5 w-1/2 rounded',
            isTerminal ? 'bg-white/10' : 'bg-[hsl(var(--border))]/60',
          )}
        />
        <div
          className={cn(
            'h-2.5 w-5/6 rounded',
            isTerminal ? 'bg-white/10' : 'bg-[hsl(var(--border))]/60',
          )}
        />
      </div>
    </div>
  );
}
