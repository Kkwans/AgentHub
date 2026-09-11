import { cn } from '@agenthub/ui';
import { formatPreviewContent } from '../previewFormat';
import { type ReactNode, useMemo, useState } from 'react';

interface ReadResult {
  content: string;
  filePath: string | null;
}

const resultCache = new Map<string, ReadResult>();
const PAGE_SIZE = 100;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseReadResult(rawOutput?: string | null): ReadResult | null {
  if (!rawOutput) return null;
  const cached = resultCache.get(rawOutput);
  if (cached) return cached;
  try {
    const parsed = JSON.parse(rawOutput) as unknown;
    const root = asRecord(parsed);
    if (!root)
      return { content: Array.isArray(parsed) ? parsed.join('\n') : rawOutput, filePath: null };
    const file = asRecord(root.file);
    const content = file?.content ?? root.fileContent ?? root.content ?? root.message;
    const lines = Array.isArray(root.lines) ? root.lines.join('\n') : null;
    const result = {
      content: typeof content === 'string' ? content : (lines ?? JSON.stringify(parsed, null, 2)),
      filePath: typeof file?.filePath === 'string' ? file.filePath : null,
    };
    if (resultCache.size >= 30) resultCache.delete(resultCache.keys().next().value ?? '');
    resultCache.set(rawOutput, result);
    return result;
  } catch {
    return { content: rawOutput, filePath: null };
  }
}

function inputPath(rawInput?: Record<string, unknown> | null): string | null {
  const value =
    rawInput?.target_file ??
    rawInput?.file_path ??
    rawInput?.path ??
    rawInput?.target_directory ??
    rawInput?.glob_pattern;
  return typeof value === 'string' ? value : null;
}

export function ToolReadDetail({
  rawInput,
  rawOutput,
  actions,
}: {
  rawInput?: Record<string, unknown> | null | undefined;
  rawOutput?: string | null | undefined;
  actions?: ReactNode | undefined;
}) {
  const result = useMemo(() => parseReadResult(rawOutput), [rawOutput]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  if (!result) {
    const filePath = inputPath(rawInput);
    return (
      <div className="overflow-hidden bg-[hsl(var(--surface))]/45">
        <div className="flex min-h-7 items-center gap-1.5 border-b border-[hsl(var(--border))]/30 bg-[hsl(var(--surface-muted))]/28 px-2 text-[10px] font-medium text-[hsl(var(--foreground-muted))]">
          <span className="min-w-0 flex-1">文件内容</span>
          {actions}
        </div>
        <div className="px-2.5 py-2 text-[11px] leading-relaxed text-[hsl(var(--foreground-muted))]">
          <p>Agent 未返回可展开的文件内容。</p>
          {filePath && <code className="mt-1 block truncate text-[10px]">{filePath}</code>}
        </div>
      </div>
    );
  }

  const filePath = result.filePath ?? inputPath(rawInput);
  const offset = Number(rawInput?.offset ?? 1);
  const isFile = Boolean(result.filePath || rawInput?.target_file || rawInput?.file_path);
  const displayContent = formatPreviewContent(result.content, 'json');
  const lines = displayContent.split('\n');
  const visibleLines = lines.slice(0, visibleCount);
  const preview = {
    lineCount: lines.length,
    content: visibleLines.join('\n'),
    lineNumbers: visibleLines.map((_, index) => offset + index).join('\n'),
    visibleCount: visibleLines.length,
  };

  return (
    <div className="overflow-hidden bg-[hsl(var(--surface))]/45">
      <div className="flex min-h-7 items-center gap-1.5 border-b border-[hsl(var(--border))]/30 bg-[hsl(var(--surface-muted))]/28 pl-2 pr-1">
        <span className="min-w-0 flex-1 text-[10px] font-medium text-[hsl(var(--foreground-muted))]">
          {filePath ? '文件内容' : '输出'}
        </span>
        <span className="shrink-0 rounded bg-[hsl(var(--surface-muted))]/75 px-1.5 py-px text-[9px] tabular-nums text-[hsl(var(--foreground-muted))]">
          {preview.lineCount} 行
        </span>
        {actions}
      </div>
      <div className="max-h-[380px] overflow-auto overscroll-contain">
        {isFile ? (
          <div className="flex min-w-full w-max py-0.5 font-mono text-[11px] leading-[1.15rem]">
            <pre className="sticky left-0 shrink-0 select-none border-r border-[hsl(var(--border))]/25 bg-[hsl(var(--surface-muted))]/55 px-2 text-right text-[hsl(var(--foreground-faint))]">
              {preview.lineNumbers}
            </pre>
            <pre className="whitespace-pre px-2.5 text-[hsl(var(--foreground))]">
              {preview.content}
            </pre>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words px-2.5 py-1.5 font-mono text-[11px] leading-[1.15rem] text-[hsl(var(--foreground))]">
            {preview.content}
          </pre>
        )}
        {preview.lineCount > preview.visibleCount && (
          <div
            className={cn(
              'sticky bottom-0 border-t px-2.5 py-1 text-center text-[10px]',
              'border-[hsl(var(--border))]/45 bg-[hsl(var(--surface))] text-[hsl(var(--foreground-muted))]',
            )}
          >
            <button
              type="button"
              onClick={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, lines.length))}
              className="font-medium text-[hsl(var(--primary))] hover:underline"
            >
              继续加载 {Math.min(PAGE_SIZE, preview.lineCount - preview.visibleCount)} 行
            </button>
            <span className="ml-2">
              已显示 {preview.visibleCount}/{preview.lineCount} 行
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
