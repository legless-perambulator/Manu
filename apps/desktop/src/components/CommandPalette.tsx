import { useEffect, useMemo, useRef, useState } from "react";

export interface Command {
  readonly id: string;
  readonly label: string;
  /** Where the command lives, shown to the left of the label. */
  readonly section: string;
  readonly hint?: string;
  readonly run: () => void;
}

interface Props {
  commands: readonly Command[];
  onClose: () => void;
}

/**
 * A minimal command palette: every panel and every global action, reachable by
 * typing its name. It exists so grouping the sidebar costs nobody a click.
 */
export function CommandPalette({ commands, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const listId = "command-palette-list";

  useEffect(() => {
    input.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return commands;
    return commands.filter((command) =>
      `${command.section} ${command.label} ${command.hint ?? ""}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  // Keep the highlight inside the result list as it shrinks.
  const index = matches.length === 0 ? 0 : Math.min(active, matches.length - 1);

  function choose(command: Command | undefined) {
    if (command === undefined) return;
    onClose();
    command.run();
  }

  return (
    <div
      className="palette__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={input}
          className="palette__input"
          value={query}
          placeholder="Go to a panel, or type a command…"
          aria-controls={listId}
          aria-activedescendant={matches[index] ? `command-${matches[index].id}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((n) => (matches.length === 0 ? 0 : (n + 1) % matches.length));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((n) =>
                matches.length === 0 ? 0 : (n - 1 + matches.length) % matches.length,
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(matches[index]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <ul className="palette__list" id={listId} role="listbox">
          {matches.map((command, i) => (
            <li key={command.id}>
              <button
                id={`command-${command.id}`}
                type="button"
                role="option"
                aria-selected={i === index}
                className={`palette__item${i === index ? " palette__item--active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(command)}
              >
                <span className="palette__section">{command.section}</span>
                <span className="palette__label">{command.label}</span>
                {command.hint !== undefined && (
                  <span className="palette__hint">{command.hint}</span>
                )}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="palette__empty">Nothing matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}
