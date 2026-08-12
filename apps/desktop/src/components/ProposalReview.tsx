import { useMemo, useState } from "react";
import type { EditProposal, ManuscriptEditor } from "@jellytind/editing";
import { computeLineDiff, diffStat, applyHunks } from "@jellytind/story-repository";
import { explainEditError } from "../lib/editing";

interface Props {
  editor: ManuscriptEditor;
  proposal: EditProposal;
  onResolved: (outcome: "accepted" | "rejected") => void;
}

/**
 * Review an AI edit before it exists.
 *
 * The proposal is staged, not applied: this screen is the gate. It shows what
 * the model was told, what context it was given, what it proposes, and a diff
 * the author can take whole, in part, or not at all. Nothing here can change the
 * project except the two buttons at the bottom (docs/AI_EDITING.md).
 */
export function ProposalReview({ editor, proposal, onResolved }: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(proposal.hunks.map((h) => h.id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = useMemo(
    () => computeLineDiff(proposal.before, proposal.after),
    [proposal.before, proposal.after],
  );
  const stat = diffStat(lines);
  const allSelected = selected.size === proposal.hunks.length;
  const noneSelected = selected.size === 0;

  // Which hunk (if any) each diff line belongs to, so rows can be checkable.
  const hunkAtLine = useMemo(() => {
    const map = new Map<number, string>();
    for (const hunk of proposal.hunks) {
      hunk.lines.forEach((_, offset) => map.set(hunk.at + offset, hunk.id));
    }
    return map;
  }, [proposal.hunks]);

  const preview = useMemo(
    () =>
      allSelected ? proposal.after : applyHunks(proposal.before, proposal.after, [...selected]),
    [allSelected, proposal.before, proposal.after, selected],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await editor.accept(proposal.id, allSelected ? {} : { hunkIds: [...selected] });
      onResolved("accepted");
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setError(null);
    try {
      await editor.reject(proposal.id);
      onResolved("rejected");
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="diff review">
      <div className="diff__bar">
        <div>
          <div className="diff__summary">
            {proposal.operation.replace(/_/g, " ")} · {proposal.targetId}
          </div>
          <div className="diff__meta">
            {proposal.path} · <span className="add">+{stat.added}</span>{" "}
            <span className="rem">−{stat.removed}</span> · {proposal.hunks.length} hunk(s)
          </div>
        </div>
        <div className="diff__actions">
          <button
            className="btn btn--primary"
            onClick={() => void accept()}
            disabled={busy || noneSelected}
          >
            {allSelected
              ? "Accept all"
              : `Accept ${String(selected.size)} of ${String(proposal.hunks.length)}`}
          </button>
          <button className="btn btn--danger" onClick={() => void reject()} disabled={busy}>
            Reject
          </button>
        </div>
      </div>

      {error !== null && <p className="diff__error">{error}</p>}

      <div className="review__provenance">
        <div>
          <span className="review__label">Instruction</span>
          <p>{proposal.instruction}</p>
        </div>
        <div>
          <span className="review__label">Context</span>
          <p>
            {proposal.context.recipe} · {proposal.context.itemCount} elements ·{" "}
            {proposal.context.estimatedTokens.toLocaleString()} tokens
            {proposal.context.degradedCount > 0
              ? ` · ${String(proposal.context.degradedCount)} summarised or omitted`
              : ""}
          </p>
        </div>
        <div>
          <span className="review__label">Model</span>
          <p>{proposal.modelId}</p>
        </div>
        {proposal.rationale !== "" && (
          <div>
            <span className="review__label">What the model says it did</span>
            <p>{proposal.rationale}</p>
          </div>
        )}
        {proposal.warnings.length > 0 && (
          <div>
            <span className="review__label review__label--warn">Flagged by the model</span>
            <ul className="review__warnings">
              {proposal.warnings.map((w, i) => (
                <li key={`${String(i)}-${w}`}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="review__toolbar">
        <button
          className="btn btn--ghost btn--small"
          onClick={() => setSelected(new Set(proposal.hunks.map((h) => h.id)))}
          disabled={allSelected}
        >
          Select all
        </button>
        <button
          className="btn btn--ghost btn--small"
          onClick={() => setSelected(new Set())}
          disabled={noneSelected}
        >
          Select none
        </button>
        <span className="hint">Tick a change to keep it; untick to leave that part as it is.</span>
      </div>

      <div className="diff__files">
        <div className="diff__file">
          <pre className="diff__code">
            {lines.map((l, i) => {
              const hunkId = hunkAtLine.get(i);
              const kept = hunkId === undefined || selected.has(hunkId);
              return (
                <div
                  key={i}
                  className={`dl dl--${l.op}${hunkId !== undefined && !kept ? " dl--dropped" : ""}`}
                  onClick={hunkId === undefined ? undefined : () => toggle(hunkId)}
                  role={hunkId === undefined ? undefined : "button"}
                  tabIndex={hunkId === undefined ? undefined : 0}
                  onKeyDown={
                    hunkId === undefined
                      ? undefined
                      : (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle(hunkId);
                          }
                        }
                  }
                >
                  <span className="dl__gutter">
                    {l.op === "add" ? "+" : l.op === "remove" ? "−" : " "}
                  </span>
                  {l.text || " "}
                </div>
              );
            })}
          </pre>
        </div>
      </div>

      {!allSelected && !noneSelected && (
        <details className="review__preview">
          <summary>Preview the file as it would be saved</summary>
          <pre className="diff__code">{preview}</pre>
        </details>
      )}
    </div>
  );
}
