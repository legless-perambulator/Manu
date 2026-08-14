import { useState } from "react";
import { REWRITE_DIRECTIVES, type EditRequest, type RewriteDirective } from "@jellytind/editing";
import { countWords, type BlockStyle, type InlineMark } from "../lib/markdown";

interface Props {
  /** The prose the writer has selected, in file offsets. */
  selection: { text: string; start: number; end: number };
  path: string;
  /** Scene the selection belongs to, when the writer has one open. */
  sceneId: string | null;
  aiBusy: boolean;
  /** Unsaved prose means an AI proposal would be built from stale text. */
  dirty: boolean;
  onFormat: (mark: InlineMark) => void;
  onBlock: (style: BlockStyle) => void;
  onRunEdit?: ((request: EditRequest) => void) | undefined;
}

const DIRECTIVE_LABEL: Record<RewriteDirective, string> = {
  rewrite: "Rewrite",
  shorten: "Shorten",
  expand: "Expand",
  strengthen_dialogue: "Strengthen dialogue",
  increase_tension: "Increase tension",
  remove_exposition: "Remove exposition",
};

/**
 * What you can do to the passage you just selected.
 *
 * Appears only while there is a selection, and appears **in the editor's own
 * chrome rather than floating over the prose**. A popover that covers the
 * sentence you are working on is the commonest way an AI writing tool makes
 * itself unusable, and it is the thing §20 rules out.
 *
 * Formatting first, because it is what a writer reaches for constantly, and
 * because it needs no model and no network. The AI actions are behind one
 * disclosure — nothing here writes anything: every one of them produces a
 * proposal to review, through the same staged path as before (docs/AI_EDITING.md).
 */
export function SelectionBar({
  selection,
  path,
  sceneId,
  aiBusy,
  dirty,
  onFormat,
  onBlock,
  onRunEdit,
}: Props) {
  const [showAi, setShowAi] = useState(false);
  const [note, setNote] = useState("");
  const words = countWords(selection.text);

  return (
    <div className="selbar" role="toolbar" aria-label="Selection">
      <span className="selbar__count">
        {words} {words === 1 ? "word" : "words"}
      </span>

      <span className="selbar__group">
        <button
          className="selbar__btn selbar__btn--bold"
          onClick={() => onFormat("bold")}
          title="Bold — ⌘B"
          aria-label="Bold"
        >
          B
        </button>
        <button
          className="selbar__btn selbar__btn--italic"
          onClick={() => onFormat("italic")}
          title="Italic — ⌘I"
          aria-label="Italic"
        >
          I
        </button>
        <button
          className="selbar__btn selbar__btn--strike"
          onClick={() => onFormat("strikethrough")}
          title="Strikethrough — ⇧⌘X"
          aria-label="Strikethrough"
        >
          S
        </button>
        <button
          className="selbar__btn"
          onClick={() => onBlock("quote")}
          title="Block quote — ⇧⌘."
          aria-label="Block quote"
        >
          ❝
        </button>
      </span>

      <span className="selbar__spacer" />

      {onRunEdit !== undefined && (
        <button
          className={`btn btn--ghost btn--small${showAi ? " btn--on" : ""}`}
          aria-expanded={showAi}
          onClick={() => setShowAi((on) => !on)}
        >
          Ask Manu
        </button>
      )}

      {showAi && onRunEdit !== undefined && (
        <div className="selbar__ai">
          {dirty ? (
            <p className="hint">
              Save this document first, so the proposal is built from what is on disk.
            </p>
          ) : (
            <>
              <input
                className="selbar__note"
                value={note}
                placeholder="Optional extra guidance"
                aria-label="Extra guidance"
                onChange={(event) => setNote(event.target.value)}
                disabled={aiBusy}
              />
              <div className="selbar__directives">
                {REWRITE_DIRECTIVES.map((directive) => (
                  <button
                    key={directive}
                    className="btn btn--small"
                    disabled={aiBusy}
                    onClick={() =>
                      onRunEdit({
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
                    {DIRECTIVE_LABEL[directive]}
                  </button>
                ))}
              </div>
              <p className="hint">
                Manu proposes. Nothing reaches the manuscript until you accept it.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
