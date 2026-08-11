import { useEffect, useState } from "react";
import {
  computeLineDiff,
  diffStat,
  type StoryRepository,
  type ChangeSet,
} from "@jellytind/story-repository";

interface Props {
  repo: StoryRepository;
  changeId: string;
  onReverted: () => void;
  onClose: () => void;
}

export function DiffViewer({ repo, changeId, onReverted, onClose }: Props) {
  const [change, setChange] = useState<ChangeSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void repo.getChangeSet(changeId).then((c) => {
      if (active) setChange(c);
    });
    return () => {
      active = false;
    };
  }, [repo, changeId]);

  async function revert() {
    setBusy(true);
    setError(null);
    try {
      await repo.revertChangeSet(changeId);
      onReverted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (change === null) {
    return (
      <div className="diff diff--empty">
        <p className="placeholder">Loading change…</p>
      </div>
    );
  }

  const canRevert = change.status === "committed" && change.operation !== "revert";

  return (
    <div className="diff">
      <div className="diff__bar">
        <div>
          <div className="diff__summary">{change.summary}</div>
          <div className="diff__meta">
            {change.id} · {change.actor} · {change.operation} · {change.status}
          </div>
        </div>
        <div className="diff__actions">
          {canRevert && (
            <button className="btn btn--danger" onClick={() => void revert()} disabled={busy}>
              Revert this change
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {error !== null && <p className="diff__error">{error}</p>}
      {change.entitiesChanged.length > 0 && (
        <div className="diff__entities">
          {change.entitiesChanged.map((e) => (
            <span key={e.id} className={`badge badge--${e.change}`}>
              {e.change} {e.id}
            </span>
          ))}
        </div>
      )}
      <div className="diff__files">
        {change.filesChanged.length === 0 && <p className="placeholder">No file changes.</p>}
        {change.filesChanged.map((fc) => {
          const lines = computeLineDiff(fc.before ?? "", fc.after ?? "");
          const stat = diffStat(lines);
          return (
            <div key={fc.path} className="diff__file">
              <div className="diff__file-head">
                <span className="diff__file-path">{fc.path}</span>
                <span className="diff__file-stat">
                  <span className="add">+{stat.added}</span>{" "}
                  <span className="rem">−{stat.removed}</span>
                  {fc.before === null ? " · new" : fc.after === null ? " · deleted" : ""}
                </span>
              </div>
              <pre className="diff__code">
                {lines.map((l, i) => (
                  <div key={i} className={`dl dl--${l.op}`}>
                    <span className="dl__gutter">
                      {l.op === "add" ? "+" : l.op === "remove" ? "−" : " "}
                    </span>
                    {l.text || " "}
                  </div>
                ))}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
