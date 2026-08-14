import { useEffect, useMemo, useRef, useState } from "react";
import { findMatches, type Match } from "../lib/markdown";

interface Props {
  /** The text being searched — the prose, not the file's front matter. */
  text: string;
  /** Where the caret is, so "next" means next from here. */
  caret: number;
  onGo: (match: Match) => void;
  onReplace: (match: Match, replacement: string) => void;
  onReplaceAll: (query: string, replacement: string, options: Options) => void;
  onClose: () => void;
}

export interface Options {
  caseSensitive: boolean;
  wholeWord: boolean;
}

/**
 * Find, and replace when asked.
 *
 * Replace is behind a disclosure rather than always present: finding a word is
 * something a writer does twenty times a day and replacing one is something
 * they do twice a month, and the difference should be visible in how much room
 * each takes (§25).
 *
 * The count is always shown — "3 of 17" — because the useful question is
 * usually how many, not where the next one is.
 */
export function FindBar({ text, caret, onGo, onReplace, onReplaceAll, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [options, setOptions] = useState<Options>({ caseSensitive: false, wholeWord: false });
  const [index, setIndex] = useState(0);
  const field = useRef<HTMLInputElement | null>(null);

  const matches = useMemo(() => findMatches(text, query, options), [text, query, options]);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  // A changed query starts again from where the writer is looking. `caret` is
  // deliberately not a dependency: moving the caret while typing in the find
  // field would make the counter jump under the writer's hands.
  const from = useRef(caret);
  from.current = caret;
  useEffect(() => {
    const at = matches.findIndex((match) => match.start >= from.current);
    setIndex(at === -1 ? 0 : at);
  }, [query, options, text, matches]);

  function step(by: number) {
    if (matches.length === 0) return;
    const next = (index + by + matches.length) % matches.length;
    setIndex(next);
    const match = matches[next];
    if (match !== undefined) onGo(match);
  }

  const current = matches[index];

  return (
    <div className="find" role="search">
      <div className="find__row">
        <input
          ref={field}
          className="find__field"
          value={query}
          placeholder="Find in this document"
          aria-label="Find in this document"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <span className="find__count" role="status">
          {query === "" ? "" : matches.length === 0 ? "None" : `${index + 1} of ${matches.length}`}
        </span>
        <button
          className="btn btn--ghost btn--small"
          onClick={() => step(-1)}
          disabled={matches.length === 0}
          aria-label="Previous match"
          title="Previous match"
        >
          ↑
        </button>
        <button
          className="btn btn--ghost btn--small"
          onClick={() => step(1)}
          disabled={matches.length === 0}
          aria-label="Next match"
          title="Next match"
        >
          ↓
        </button>
        <button
          className={`btn btn--ghost btn--small${showReplace ? " btn--on" : ""}`}
          aria-expanded={showReplace}
          onClick={() => setShowReplace((on) => !on)}
        >
          Replace
        </button>
        <button className="btn btn--ghost btn--small" onClick={onClose} aria-label="Close find">
          ✕
        </button>
      </div>

      <div className="find__row find__row--options">
        <label className="find__option">
          <input
            type="checkbox"
            checked={options.caseSensitive}
            onChange={(event) => setOptions((o) => ({ ...o, caseSensitive: event.target.checked }))}
          />
          <span>Match case</span>
        </label>
        <label className="find__option">
          <input
            type="checkbox"
            checked={options.wholeWord}
            onChange={(event) => setOptions((o) => ({ ...o, wholeWord: event.target.checked }))}
          />
          <span>Whole words</span>
        </label>
      </div>

      {showReplace && (
        <div className="find__row">
          <input
            className="find__field"
            value={replacement}
            placeholder="Replace with"
            aria-label="Replace with"
            onChange={(event) => setReplacement(event.target.value)}
          />
          <button
            className="btn btn--small"
            disabled={current === undefined}
            onClick={() => {
              if (current !== undefined) onReplace(current, replacement);
            }}
          >
            Replace
          </button>
          <button
            className="btn btn--small"
            disabled={matches.length === 0}
            onClick={() => onReplaceAll(query, replacement, options)}
          >
            Replace all
          </button>
        </div>
      )}
    </div>
  );
}
