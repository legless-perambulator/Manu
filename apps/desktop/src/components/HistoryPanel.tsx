import { useCallback, useEffect, useState } from "react";
import type { StoryRepository, ChangeSetSummary, Checkpoint } from "@jellytind/story-repository";

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

  const reload = useCallback(async () => {
    const [c, cp] = await Promise.all([repo.listChangeSets(), repo.listCheckpoints()]);
    setChanges(c);
    setCheckpoints(cp);
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
          >
            <div className="change__summary">{c.summary}</div>
            <div className="change__meta">
              <span className={`badge badge--${c.actor}`}>{c.actor}</span>
              {c.status !== "committed" && <span className="badge badge--muted">{c.status}</span>}
              <span className="change__id">{c.id}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
