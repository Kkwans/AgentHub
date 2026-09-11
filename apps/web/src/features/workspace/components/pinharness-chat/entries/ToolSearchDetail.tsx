import { FileSearch } from 'lucide-react';
import { useMemo, useState } from 'react';

interface MatchGroup {
  path: string;
  matches: Array<{ line: string; text: string }>;
}

function parseGroups(rawOutput: string): MatchGroup[] {
  const groups = new Map<string, MatchGroup['matches']>();
  for (const row of rawOutput.split('\n')) {
    const match = row.match(/^(.+?):(\d+):(.*)$/);
    const path = match?.[1] ?? '结果';
    const matches = groups.get(path) ?? [];
    matches.push({ line: match?.[2] ?? '', text: match?.[3] ?? row });
    groups.set(path, matches);
  }
  return [...groups].map(([path, matches]) => ({ path, matches }));
}

export function ToolSearchDetail({ rawOutput }: { rawOutput: string }) {
  const groups = useMemo(() => parseGroups(rawOutput), [rawOutput]);
  const [visible, setVisible] = useState(8);
  const shown = groups.slice(0, visible);

  return (
    <div className="max-h-[360px] overflow-auto divide-y divide-[hsl(var(--border))]/30">
      {shown.map((group) => (
        <section key={group.path} className="py-1">
          <header className="flex items-center gap-1.5 px-2 pb-0.5 font-mono text-[10px] text-[hsl(var(--foreground-muted))]">
            <FileSearch className="h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={group.path}>
              {group.path}
            </span>
            <span className="text-[hsl(var(--foreground-faint))]">{group.matches.length}</span>
          </header>
          <div className="space-y-px">
            {group.matches.slice(0, 30).map((match, index) => (
              <div
                key={`${match.line}:${index}`}
                className="flex px-2 font-mono text-[10px] leading-[1.15rem] hover:bg-[hsl(var(--surface-muted))]/40"
              >
                <span className="w-9 shrink-0 select-none text-right text-[hsl(var(--foreground-faint))]">
                  {match.line}
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-all pl-2 text-[hsl(var(--foreground))]">
                  {match.text || ' '}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
      {groups.length > visible && (
        <button
          type="button"
          onClick={() => setVisible((count) => count + 8)}
          className="w-full py-1.5 text-[10px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--surface-muted))]/35"
        >
          继续加载 {Math.min(8, groups.length - visible)} 个文件
        </button>
      )}
    </div>
  );
}
