import { cn } from '@agenthub/ui';

export type ComposerCommand = {
  name: string;
  label: string;
  description: string;
  hint?: string;
};

export function SlashCommandMenu({
  commands,
  activeIndex,
  onSelect,
}: {
  commands: ComposerCommand[];
  activeIndex: number;
  onSelect: (command: ComposerCommand) => void;
}) {
  if (!commands.length) return null;
  return (
    <div
      className="absolute bottom-[calc(100%+0.5rem)] left-2 right-12 z-30 grid max-h-64 overflow-auto rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] p-1.5 text-[hsl(var(--foreground))] shadow-[var(--shadow-lg)] animate-[hci-fade-in_140ms_ease-out_both] motion-reduce:animate-none"
      role="listbox"
      aria-label="可用命令"
    >
      {commands.map((command, index) => (
        <button
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={cn(
            'grid min-w-0 grid-cols-[116px_minmax(0,1fr)] gap-x-2 gap-y-0.5 rounded-[var(--radius)] px-2 py-2 text-left transition-[background-color,color] duration-[var(--motion-fast)] hover:bg-[hsl(var(--primary-soft))] hover:text-[hsl(var(--foreground))]',
            index === activeIndex && 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--foreground))]',
          )}
          key={command.name}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(command)}
        >
          <strong className="row-span-2 font-mono text-xs font-semibold text-[hsl(var(--primary))]">
            /{command.name}
          </strong>
          <span className="min-w-0 truncate text-xs">{command.label}</span>
          <small className="min-w-0 truncate text-[11px] text-[hsl(var(--foreground-muted))]">
            {command.description}
          </small>
          {command.hint && (
            <code className="col-start-2 min-w-0 truncate font-mono text-[11px] text-[hsl(var(--foreground-faint))]">
              {command.hint}
            </code>
          )}
        </button>
      ))}
    </div>
  );
}
