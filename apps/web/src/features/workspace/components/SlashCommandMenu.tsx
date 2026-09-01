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
    <div className="composer-command-menu" role="listbox" aria-label="可用命令">
      {commands.map((command, index) => (
        <button
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={index === activeIndex ? 'active' : ''}
          key={command.name}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(command)}
        >
          <strong>/{command.name}</strong>
          <span>{command.label}</span>
          <small>{command.description}</small>
          {command.hint && <code>{command.hint}</code>}
        </button>
      ))}
    </div>
  );
}
