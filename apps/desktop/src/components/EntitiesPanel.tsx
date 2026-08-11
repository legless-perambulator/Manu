import { useCallback, useEffect, useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import { KIND_LABEL, KIND_ORDER, CREATABLE, type Kind } from "../entities/entityMeta";

interface Summary {
  id: string;
  kind: Kind;
  name: string;
}

interface Props {
  repo: StoryRepository;
  selectedId: string | null;
  onSelect: (id: string) => void;
  refreshToken: number;
  onChanged: () => void;
}

export function EntitiesPanel({ repo, selectedId, onSelect, refreshToken, onChanged }: Props) {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [newKind, setNewKind] = useState<Kind>("character");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setSummaries((await repo.listEntitySummaries()) as Summary[]);
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  async function create() {
    setBusy(true);
    try {
      const created = await createDefault(repo, newKind);
      if (created !== null) {
        onChanged();
        onSelect(created);
      }
    } finally {
      setBusy(false);
    }
  }

  const byKind = (kind: Kind): Summary[] => summaries.filter((s) => s.kind === kind);

  return (
    <div className="entities">
      <div className="entities__new">
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as Kind)}>
          {CREATABLE.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k].replace(/s$/, "")}
            </option>
          ))}
        </select>
        <button className="btn btn--small" onClick={() => void create()} disabled={busy}>
          ＋ New
        </button>
      </div>
      <div className="entities__list">
        {KIND_ORDER.map((kind) => {
          const items = byKind(kind);
          if (items.length === 0) return null;
          return (
            <div key={kind} className="entities__group">
              <div className="entities__group-title">{KIND_LABEL[kind]}</div>
              {items.map((s) => (
                <button
                  key={s.id}
                  className={`entities__row${s.id === selectedId ? " entities__row--active" : ""}`}
                  onClick={() => onSelect(s.id)}
                  title={s.id}
                >
                  {s.name || s.id}
                </button>
              ))}
            </div>
          );
        })}
        {summaries.length === 0 && (
          <p className="placeholder">
            No entities yet. Create a character, location, scene, and more with “＋ New”.
          </p>
        )}
      </div>
    </div>
  );
}

/** Create a default instance of a kind; returns the new id, or null if unsupported. */
async function createDefault(repo: StoryRepository, kind: Kind): Promise<string | null> {
  switch (kind) {
    case "character":
      return (await repo.addCharacter({ name: "New Character" })).id;
    case "location":
      return (await repo.addLocation({ name: "New Location" })).id;
    case "object":
      return (await repo.addObject({ name: "New Object" })).id;
    case "scene":
      return (await repo.addScene({ title: "New Scene" })).id;
    case "plot_thread":
      return (await repo.addPlotThread({ name: "New Thread" })).id;
    case "fact":
      return (await repo.addFact({ statement: "New fact." })).id;
    case "world_rule":
      return (await repo.addWorldRule({ name: "New Rule" })).id;
    case "event":
      return (await repo.addEvent({ name: "New Event" })).id;
    case "chapter":
      return (await repo.addChapter({ title: "New Chapter" })).id;
    default:
      return null; // relationships require two existing characters (create via inspector)
  }
}
