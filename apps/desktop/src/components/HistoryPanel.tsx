import { useCallback, useEffect, useState } from "react";
import type { StoryRepository, ChangeSetSummary, Checkpoint } from "@jellytind/story-repository";
import { humaniseSummary } from "../lib/naming";

interface Props {
  repo: StoryRepository;
  selectedChangeId: string | null;
  onSelectChange: (id: string) => void;
  refreshToken: number;
  onChanged: () => void;
}

export function HistoryPanel({
  repo,
  selectedChangeId,
  onSelectChange,
  refreshToken,
  onChanged,
}: Props) {
  const [changes, setChanges] = useState<ChangeSetSummary[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * What the writer calls each document.
   *
   * A change set records `Edit manuscript/CHAPTER_0002.md`, which is exactly
   * right as a record and wrong as a sentence. The path is swapped for the
   * chapter's title at display time; nothing in History is rewritten.
   */
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map());

  const reload = useCallback(async () => {
    const [c, cp, chapters] = await Promise.all([
      repo.listChangeSets(),
      repo.listCheckpoints(),
      repo.listChapters(),
    ]);
    setChanges(c);
    setCheckpoints(cp);
    setTitles(new Map(chapters.map((chapter) => [chapter.filePath, chapter.title])));
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  async function createCheckpoint() {
    const name = label.trim();
    if (name === "") return;
    setBusy(true);
    try {
      await repo.createCheckpoint(name);
      setLabel("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function revertToCheckpoint(id: string) {
    setBusy(true);
    try {
      await repo.revertToCheckpoint(id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="history">
      <div className="history__section-title">Checkpoints</div>
      <div className="history__new">
        <input
          className="history__input"
          placeholder="New checkpoint label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button className="btn btn--small" onClick={() => void createCheckpoint()} disabled={busy}>
          ＋
        </button>
      </div>
      <div className="history__list">
        {checkpoints.map((cp) => (
          <div key={cp.id} className="checkpoint">
            <span className="checkpoint__label">{cp.label}</span>
            <button
              className="btn btn--small"
              onClick={() => void revertToCheckpoint(cp.id)}
              disabled={busy}
              title="Revert whole project to this checkpoint"
            >
              revert
            </button>
          </div>
        ))}
      </div>

      <div className="history__section-title">Changes</div>
      <div className="history__list">
        {changes.map((c) => (
          <button
            key={c.id}
            className={`change${c.id === selectedChangeId ? " change--active" : ""}`}
            onClick={() => onSelectChange(c.id)}
            title={`${c.id} · ${c.summary}`}
          >
            <div className="change__summary">{humaniseSummary(c.summary, titles)}</div>
            <div className="change__meta">
              <span className={`badge badge--${c.actor}`}>{c.actor}</span>
              {c.status !== "committed" && <span className="badge badge--muted">{c.status}</span>}
              {/* The change's own ID is real and occasionally needed for a bug
                  report, so it stays — one hover away, not on every row. */}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
