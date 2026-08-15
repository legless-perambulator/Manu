import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CommandHistory,
  carriesSensitiveValue,
  complete,
  parseCommandLine,
  type CatalogEntry,
  type ChapterRef,
  type Suggestion,
} from "@jellytind/command-language";
import type { CommandEnvironment, ManuCommands, StepOutcome } from "../lib/commands";

interface Props {
  commands: ManuCommands | null;
  environment: CommandEnvironment;
  refreshToken: number;
  /** A line handed in from outside — the palette running a command here. */
  seedLine?: { line: string; nonce: number } | null;
}

const HISTORY_KEY = "manu.terminal-history";

function loadHistory(): CommandHistory {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const lines: unknown = raw === null ? [] : JSON.parse(raw);
    return new CommandHistory(
      Array.isArray(lines) ? lines.filter((line): line is string => typeof line === "string") : [],
    );
  } catch {
    return new CommandHistory();
  }
}

interface LogEntry {
  readonly id: number;
  readonly step: StepOutcome;
}

/**
 * The writing terminal.
 *
 * Concise access to real structured operations: every line is parsed by the
 * command language's own parser — there is no shell underneath and no model
 * behind the prompt. Output that is a view opens as a view; only reports and
 * errors are terminal text (docs/COMMAND_LANGUAGE.md).
 */
export function TerminalPanel({ commands, environment, refreshToken, seedLine }: Props) {
  const [input, setInput] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [catalog, setCatalog] = useState<readonly CatalogEntry[]>([]);
  const [chapters, setChapters] = useState<readonly ChapterRef[]>([]);
  const history = useRef<CommandHistory>(loadHistory());
  const nextId = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // The completion data: the project's own entities and chapters.
  useEffect(() => {
    let active = true;
    void (async () => {
      const [summaries, chapterList] = await Promise.all([
        environment.repo.listEntitySummaries(),
        environment.repo.listChapters(),
      ]);
      if (!active) return;
      setCatalog(summaries);
      setChapters(
        [...chapterList]
          .sort((a, b) => a.order - b.order)
          .map((chapter) => ({
            id: chapter.id as string,
            title: chapter.title,
            order: chapter.order,
          })),
      );
    })();
    return () => {
      active = false;
    };
  }, [environment.repo, refreshToken]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const append = useCallback((steps: readonly StepOutcome[]) => {
    setLog((current) => [
      ...current,
      ...steps.map((step) => ({ id: (nextId.current += 1), step })),
    ]);
  }, []);

  const execute = useCallback(
    async (line: string) => {
      const trimmed = line.trim();
      if (trimmed === "" || commands === null) return;
      setBusy(true);
      try {
        // History first, unless the line carries a value marked sensitive.
        const parsed = parseCommandLine(trimmed, commands.registry);
        const sensitive = parsed.ok && carriesSensitiveValue(parsed.invocation);
        if (!sensitive) {
          history.current.push(trimmed);
          try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify([...history.current.entries()]));
          } catch {
            // History is a convenience; a full disk must not break the command.
          }
        }
        const steps = await commands.execute(trimmed, environment);
        append(steps);
        for (const step of steps) {
          if (step.outcome.kind === "opened") environment.showPanel(step.outcome.panel);
        }
      } finally {
        setBusy(false);
      }
    },
    [commands, environment, append],
  );

  // The palette shares the registry (§6): a command chosen there runs here.
  const seenSeed = useRef(0);
  useEffect(() => {
    if (seedLine == null || seedLine.nonce === seenSeed.current) return;
    seenSeed.current = seedLine.nonce;
    void execute(seedLine.line);
  }, [seedLine, execute]);

  const refreshSuggestions = useCallback(
    (line: string) => {
      if (commands === null || line === "" || !line.startsWith("/")) {
        setSuggestions([]);
        return;
      }
      setSuggestions(complete(line, commands.registry, catalog, chapters));
      setActiveSuggestion(0);
    },
    [commands, catalog, chapters],
  );

  function applySuggestion(suggestion: Suggestion) {
    const next = input.slice(0, suggestion.from) + suggestion.value;
    setInput(next);
    refreshSuggestions(next);
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length > 0 && (event.key === "Tab" || event.key === "ArrowRight")) {
      const chosen = suggestions[activeSuggestion];
      if (chosen !== undefined && event.key === "Tab") {
        event.preventDefault();
        applySuggestion(chosen);
        return;
      }
    }
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setActiveSuggestion((n) => (n + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setActiveSuggestion((n) => (n - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const line = history.current.previous(input);
      if (line !== null) {
        setInput(line);
        setSuggestions([]);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const line = history.current.next();
      if (line !== null) {
        setInput(line);
        setSuggestions([]);
      }
      return;
    }
    if (event.key === "Escape") {
      setSuggestions([]);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = suggestions[activeSuggestion];
      // Enter accepts a highlighted completion only while one is showing and
      // the line would not already parse — otherwise Enter always runs.
      if (
        chosen !== undefined &&
        commands !== null &&
        !parseCommandLine(input, commands.registry).ok &&
        suggestions.length > 0
      ) {
        applySuggestion(chosen);
        return;
      }
      const line = input;
      setInput("");
      setSuggestions([]);
      void execute(line);
    }
  }

  /** Re-run an ambiguous line with the chosen candidate's stable ID. */
  function disambiguate(line: string, query: string, id: string) {
    const rewritten = line.replace(query, id);
    void execute(rewritten);
  }

  const placeholder = useMemo(
    () => (commands === null ? "Loading commands…" : "/help — every command; ⌘` opens this"),
    [commands],
  );

  return (
    <div className="term">
      <div className="term__log" ref={logRef} aria-live="polite">
        {log.length === 0 && (
          <p className="placeholder">
            Manu's command line. /inspect Mara, /trace thread …, /build chapter 17 — /help lists
            everything. Commands run real project operations; nothing here is a chat.
          </p>
        )}
        {log.map(({ id, step }) => (
          <div key={id} className="term__entry">
            <div className="term__line">
              <span className="term__prompt">›</span> {step.line}
            </div>
            {step.outcome.kind === "report" && (
              <div className="term__report">
                <div className="term__title">{step.outcome.title}</div>
                {step.outcome.lines.map((line, index) => (
                  <div key={index} className="term__text">
                    {line}
                  </div>
                ))}
              </div>
            )}
            {step.outcome.kind === "opened" && (
              <div className="term__note">{step.outcome.note}</div>
            )}
            {step.outcome.kind === "error" && (
              <div className="term__error">
                {step.outcome.message}
                {step.outcome.usage !== undefined && (
                  <span className="term__usage"> — {step.outcome.usage}</span>
                )}
              </div>
            )}
            {step.outcome.kind === "ambiguous" && (
              <div className="term__ambiguous">
                <div className="term__text">“{step.outcome.query}” could be:</div>
                {step.outcome.candidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    className="btn btn--ghost btn--small"
                    onClick={() => {
                      if (step.outcome.kind === "ambiguous") {
                        disambiguate(step.line, step.outcome.query, candidate.id);
                      }
                    }}
                  >
                    {candidate.name}
                    <span className="term__kind"> {candidate.kind.replace(/_/g, " ")}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="term__inputrow">
        <span className="term__prompt" aria-hidden="true">
          ›
        </span>
        <input
          ref={inputRef}
          className="term__input"
          value={input}
          placeholder={placeholder}
          disabled={busy}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Command input"
          onChange={(event) => {
            setInput(event.target.value);
            refreshSuggestions(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {suggestions.length > 0 && (
        <ul className="term__suggestions" role="listbox" aria-label="Completions">
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.label}-${index}`}>
              <button
                role="option"
                aria-selected={index === activeSuggestion}
                className={`term__suggestion${index === activeSuggestion ? " is-active" : ""}`}
                onMouseEnter={() => setActiveSuggestion(index)}
                onClick={() => applySuggestion(suggestion)}
              >
                <span>{suggestion.label}</span>
                {suggestion.detail !== undefined && (
                  <span className="term__kind">{suggestion.detail}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
