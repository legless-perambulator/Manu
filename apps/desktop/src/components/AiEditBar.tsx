import { useState } from "react";
import { REWRITE_DIRECTIVES, type EditRequest, type RewriteDirective } from "@jellytind/editing";

interface Props {
  /** The prose the user has selected, if any. */
  selection: { text: string; start: number; end: number } | null;
  path: string;
  /** Scene the selection belongs to, when the user has one open. */
  sceneId: string | null;
  busy: boolean;
  dirty: boolean;
  onRun: (request: EditRequest) => void;
}

const LABELS: Record<RewriteDirective, string> = {
  rewrite: "Rewrite",
  shorten: "Shorten",
  expand: "Expand",
  strengthen_dialogue: "Strengthen dialogue",
  increase_tension: "Increase tension",
  remove_exposition: "Remove exposition",
};

/**
 * AI actions for the passage under the cursor.
 *
 * Deliberately selection-first: the author says *what* to change by selecting
 * it, and the harness supplies the story context around it. Nothing here writes
 * — every button produces a proposal to review.
 */
export function AiEditBar({ selection, path, sceneId, busy, dirty, onRun }: Props) {
  const [note, setNote] = useState("");
  const hasSelection = selection !== null && selection.text.trim() !== "";

  if (dirty) {
    return (
      <div className="aibar aibar--hint">
        Save this file before running an AI edit, so the proposal is built from what is on disk.
      </div>
    );
  }

  if (!hasSelection) {
    return (
      <div className="aibar aibar--hint">
        Select a passage to rewrite it with AI
        {sceneId === null ? "" : `, or use the scene actions in the Inspector for ${sceneId}`}.
      </div>
    );
  }

  const words = selection.text.trim().split(/\s+/).length;

  return (
    <div className="aibar">
      <div className="aibar__row">
        <span className="aibar__count">{words} words selected</span>
        <input
          className="aibar__note"
          value={note}
          placeholder="Optional extra guidance"
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="aibar__row">
        {REWRITE_DIRECTIVES.map((directive) => (
          <button
            key={directive}
            className="btn btn--small"
            disabled={busy}
            onClick={() =>
              onRun({
                operation: "rewrite_selection",
                path,
                range: { start: selection.start, end: selection.end },
                selectedText: selection.text,
                directive,
                ...(sceneId !== null ? { sceneId } : {}),
                ...(note.trim() === "" ? {} : { instruction: note.trim() }),
              })
            }
          >
            {LABELS[directive]}
          </button>
        ))}
      </div>
    </div>
  );
}
