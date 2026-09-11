import { cn } from '@agenthub/ui';
import { MarkdownView } from '../MarkdownView';

export type EditResultMeta = Array<[string, string | number | boolean]>;

export function EditResultFallback({
  fileContent,
  message,
  resultMeta,
}: {
  fileContent: string | null;
  message: string | null;
  resultMeta: EditResultMeta;
}) {
  if (fileContent) {
    const text =
      fileContent.length > 3000
        ? `${fileContent.slice(0, 3000)}\n\n---\n*...content truncated*`
        : fileContent;
    return (
      <div className="max-h-[300px] overflow-auto px-2.5 py-1.5">
        <div className="text-[10px] uppercase tracking-wider mb-0.5 text-[hsl(var(--foreground-muted))]">
          file content
        </div>
        <div className="text-[11px] leading-relaxed text-[hsl(var(--foreground))]">
          <MarkdownView text={text} />
        </div>
      </div>
    );
  }
  if (message) {
    return <div className="px-3 py-2 text-[11px] text-[hsl(var(--foreground))]">{message}</div>;
  }
  if (resultMeta.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-[hsl(var(--foreground-muted))]">
        Agent 未返回可展开的变更详情。
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
      {resultMeta.map(([key, value]) => {
        const positive = value === true || key === 'pass' || key === 'success';
        return (
          <span
            key={key}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px]',
              positive
                ? 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-300'
                : 'border-[hsl(var(--border))]/45 bg-[hsl(var(--surface-muted))]/55 text-[hsl(var(--foreground-muted))]',
            )}
          >
            <span className="opacity-60">{key}</span>
            <span className="font-semibold">{String(value)}</span>
          </span>
        );
      })}
    </div>
  );
}
