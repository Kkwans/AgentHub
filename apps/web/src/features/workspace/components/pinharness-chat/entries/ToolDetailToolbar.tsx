import { Check, Copy, Download, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseReadResult } from './ToolReadDetail';

const lineCache = new Map<string, string[]>();

function cachedLines(text: string): string[] {
  const cached = lineCache.get(text);
  if (cached) return cached;
  const lines = text.split('\n');
  if (lineCache.size >= 40) lineCache.delete(lineCache.keys().next().value ?? '');
  lineCache.set(text, lines);
  return lines;
}

export function readableToolOutput(rawOutput?: string | null): string {
  if (!rawOutput) return '';
  const readResult = parseReadResult(rawOutput);
  return readResult?.content ?? rawOutput;
}

function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name.replace(/[^\w.-]+/g, '-') || 'tool-result'}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ToolDetailToolbar({
  toolName,
  rawOutput,
  isFailed,
  embedded = false,
}: {
  toolName: string;
  rawOutput?: string | null | undefined;
  isFailed: boolean;
  embedded?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const mountedAt = useRef(performance.now());
  const readableOutput = useMemo(() => readableToolOutput(rawOutput), [rawOutput]);
  const lines = useMemo(() => cachedLines(readableOutput), [readableOutput]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    requestAnimationFrame(() => {
      const elapsed = performance.now() - mountedAt.current;
      if (elapsed > 50)
        console.debug(`[tool-detail] ${toolName} mounted in ${elapsed.toFixed(1)}ms`);
    });
  }, [toolName]);

  const copy = async () => {
    if (!readableOutput) return;
    await navigator.clipboard.writeText(readableOutput);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  const actions = (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        disabled={!readableOutput}
        className="tool-detail-action !h-6 !w-6"
        title="复制完整结果"
      >
        {copied ? (
          <Check className="h-3 w-3 text-[hsl(var(--success))]" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
      <button
        type="button"
        onClick={() => readableOutput && downloadText(readableOutput, toolName)}
        disabled={!readableOutput}
        className="tool-detail-action !h-6 !w-6"
        title="下载完整结果"
      >
        <Download className="h-3 w-3" />
      </button>
    </>
  );

  if (embedded && !isFailed) {
    return <div className="flex shrink-0 items-center gap-px">{actions}</div>;
  }

  return (
    <div className="border-b border-[hsl(var(--border))]/30 bg-[hsl(var(--surface-muted))]/18">
      <div className="flex min-h-7 items-center justify-end gap-px px-1">
        {isFailed && (
          <span className="mr-auto inline-flex items-center gap-1 text-[10px] text-[hsl(var(--destructive))]">
            <TriangleAlert className="h-3 w-3" />
            执行失败，优先查看错误输出
          </span>
        )}
        {actions}
      </div>
      {isFailed && readableOutput && (
        <pre className="max-h-20 overflow-auto border-t border-[hsl(var(--destructive))]/15 bg-[hsl(var(--destructive))]/[0.035] px-2.5 py-1 font-mono text-[10px] leading-4 text-[hsl(var(--destructive))]">
          {lines
            .filter((line) => /error|failed|exception|fatal/i.test(line))
            .slice(0, 4)
            .join('\n') || lines.slice(-4).join('\n')}
        </pre>
      )}
    </div>
  );
}
