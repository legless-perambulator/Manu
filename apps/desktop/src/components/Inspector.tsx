import { useCallback, useEffect, useState } from "react";
import { entityKindOf } from "@jellytind/domain";
import type { ReferenceEdge, StoryRepository } from "@jellytind/story-repository";
import {
  KIND_LABEL,
  SCALAR_FIELDS,
  SELECT_FIELDS,
  ALIAS_KINDS,
  type Kind,
} from "../entities/entityMeta";

type Rec = Record<string, unknown>;
interface Option {
  id: string;
  name: string;
}

interface Props {
  repo: StoryRepository;
  entityId: string | null;
  onChanged: () => void;
  onDeleted: () => void;
  /** Run a scene-level AI operation. Absent when editing is unavailable. */
  onSceneEdit?: (operation: "rewrite_scene" | "continue_scene", sceneId: string) => void;
  aiBusy?: boolean;
}

const isId = (v: unknown): v is string => typeof v === "string" && /^[A-Z]+_/.test(v);

export function Inspector({
  repo,
  entityId,
  onChanged,
  onDeleted,
  onSceneEdit,
  aiBusy = false,
}: Props) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [draft, setDraft] = useState<Rec | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReferenceEdge[] | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setPendingDelete(null);
    if (entityId === null) {
      setDraft(null);
      setKind(null);
      return;
    }
    const k = entityKindOf(entityId);
    const entity = await repo.getEntity<Rec>(entityId);
    if (entity === null || k === null || k === "project") {
      setDraft(null);
      setKind(null);
      return;
    }
    setKind(k as Kind);
    setDraft({ ...entity });
    setDirty(false);

    const summaries = await repo.listEntitySummaries();
    const nameMap = new Map<string, string>();
    const opts: Record<string, Option[]> = {};
    for (const s of summaries) {
      nameMap.set(s.id, s.name || s.id);
      (opts[s.kind] ??= []).push({ id: s.id, name: s.name || s.id });
    }
    setNames(nameMap);
    setOptions(opts);
  }, [repo, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (entityId === null || draft === null || kind === null) {
    return (
      <div className="inspector inspector--empty">
        <p className="placeholder">Select an entity to inspect its structured profile.</p>
      </div>
    );
  }

  const setField = (key: string, value: unknown) => {
    setDraft((d) => (d === null ? d : { ...d, [key]: value }));
    setDirty(true);
  };

  async function save() {
    if (draft === null) return;
    setError(null);
    try {
      await repo.updateEntity<Rec & { id: string }>(
        String(draft.id),
        draft as Rec & { id: string },
      );
      setDirty(false);
      onChanged();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function requestDelete() {
    setError(null);
    try {
      const refs = await repo.findReferences(String(draft?.id));
      if (refs.length === 0) {
        await repo.deleteEntity(String(draft?.id));
        onChanged();
        onDeleted();
      } else {
        setPendingDelete(refs);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirmUnlinkDelete() {
    try {
      await repo.deleteEntity(String(draft?.id), { mode: "unlink" });
      onChanged();
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const scalarFields = SCALAR_FIELDS[kind];
  const selectFields = SELECT_FIELDS[kind] ?? [];
  const showAliases = ALIAS_KINDS.has(kind);

  return (
    <div className="inspector">
      <div className="inspector__head">
        <span className="inspector__kind">{KIND_LABEL[kind].replace(/s$/, "")}</span>
        <span className="inspector__id">{String(draft.id)}</span>
      </div>

      {scalarFields.map((f) =>
        f.multiline ? (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <textarea
              rows={f.key === "description" ? 4 : 2}
              value={String(draft[f.key] ?? "")}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          </label>
        ) : (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <input
              value={String(draft[f.key] ?? "")}
              onChange={(e) => setField(f.key, e.target.value)}
            />
          </label>
        ),
      )}

      {selectFields.map((f) => (
        <label key={f.key} className="field">
          <span>{f.label}</span>
          <select
            value={String(draft[f.key] ?? "")}
            onChange={(e) => setField(f.key, e.target.value)}
          >
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      ))}

      {showAliases && (
        <label className="field">
          <span>Aliases (comma-separated)</span>
          <input
            value={(Array.isArray(draft.aliases) ? (draft.aliases as string[]) : []).join(", ")}
            onChange={(e) =>
              setField(
                "aliases",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0),
              )
            }
          />
        </label>
      )}

      {kind === "scene" && onSceneEdit !== undefined && (
        <div className="inspector__ai">
          <span className="review__label">AI operations</span>
          <div className="inspector__ai-row">
            <button
              className="btn btn--small"
              disabled={aiBusy}
              onClick={() => onSceneEdit("rewrite_scene", entityId)}
            >
              Rewrite scene
            </button>
            <button
              className="btn btn--small"
              disabled={aiBusy}
              onClick={() => onSceneEdit("continue_scene", entityId)}
            >
              Continue scene
            </button>
          </div>
          <p className="hint">Both produce a proposal to review — nothing is written directly.</p>
        </div>
      )}
      {kind === "scene" ? (
        <SceneLinks draft={draft} options={options} setField={setField} />
      ) : (
        <ReferenceView draft={draft} names={names} scalarKeys={scalarFields.map((f) => f.key)} />
      )}

      {error !== null && <p className="inspector__error">{error}</p>}

      {pendingDelete !== null ? (
        <div className="inspector__danger">
          <p>
            Referenced by {pendingDelete.length}{" "}
            {pendingDelete.length === 1 ? "entity" : "entities"}:{" "}
            {pendingDelete.map((r) => names.get(r.fromId) ?? r.fromId).join(", ")}.
          </p>
          <div className="inspector__actions">
            <button className="btn btn--danger" onClick={() => void confirmUnlinkDelete()}>
              Unlink &amp; delete
            </button>
            <button className="btn" onClick={() => setPendingDelete(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="inspector__actions">
          <button className="btn btn--primary" onClick={() => void save()} disabled={!dirty}>
            Save
          </button>
          <button className="btn btn--danger" onClick={() => void requestDelete()}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/** Read-only resolved view of an entity's ID references. */
function ReferenceView({
  draft,
  names,
  scalarKeys,
}: {
  draft: Rec;
  names: Map<string, string>;
  scalarKeys: string[];
}) {
  const rows: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(draft)) {
    if (key === "id" || key === "filePath" || scalarKeys.includes(key)) continue;
    if (isId(value)) {
      rows.push({ label: key, value: names.get(value) ?? value });
    } else if (Array.isArray(value) && value.every(isId) && value.length > 0) {
      rows.push({ label: key, value: value.map((v) => names.get(v) ?? v).join(", ") });
    }
  }
  if (rows.length === 0) return null;
  return (
    <div className="inspector__refs">
      <div className="inspector__refs-title">Links</div>
      {rows.map((r) => (
        <div key={r.label} className="inspector__ref">
          <span className="inspector__ref-label">{r.label}</span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Editable link controls for a scene (POV, location, participants, threads, objects, purpose). */
function SceneLinks({
  draft,
  options,
  setField,
}: {
  draft: Rec;
  options: Record<string, Option[]>;
  setField: (key: string, value: unknown) => void;
}) {
  const characters = options.character ?? [];
  const locations = options.location ?? [];
  const threads = options.plot_thread ?? [];
  const objects = options.object ?? [];
  const idArray = (key: string): string[] =>
    Array.isArray(draft[key]) ? (draft[key] as string[]) : [];
  const toggle = (key: string, id: string) => {
    const cur = idArray(key);
    setField(key, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  return (
    <div className="inspector__refs">
      <div className="inspector__refs-title">Links</div>
      <label className="field">
        <span>POV</span>
        <select
          value={String(draft.pov ?? "")}
          onChange={(e) => setField("pov", e.target.value === "" ? undefined : e.target.value)}
        >
          <option value="">— none —</option>
          {characters.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Location</span>
        <select
          value={String(draft.locationId ?? "")}
          onChange={(e) =>
            setField("locationId", e.target.value === "" ? undefined : e.target.value)
          }
        >
          <option value="">— none —</option>
          {locations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <CheckboxList
        label="Participants"
        items={characters}
        selected={idArray("characterIds")}
        onToggle={(id) => toggle("characterIds", id)}
      />
      <CheckboxList
        label="Plot threads"
        items={threads}
        selected={idArray("plotThreadIds")}
        onToggle={(id) => toggle("plotThreadIds", id)}
      />
      <CheckboxList
        label="Objects"
        items={objects}
        selected={idArray("objectIds")}
        onToggle={(id) => toggle("objectIds", id)}
      />
      <label className="field">
        <span>Purpose (one per line)</span>
        <textarea
          rows={3}
          value={(Array.isArray(draft.purpose) ? (draft.purpose as string[]) : []).join("\n")}
          onChange={(e) =>
            setField(
              "purpose",
              e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
            )
          }
        />
      </label>
    </div>
  );
}

function CheckboxList({
  label,
  items,
  selected,
  onToggle,
}: {
  label: string;
  items: Option[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="checklist">
        {items.length === 0 && <span className="placeholder">none available</span>}
        {items.map((o) => (
          <label key={o.id} className="checklist__item">
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              onChange={() => onToggle(o.id)}
            />
            {o.name}
          </label>
        ))}
      </div>
    </div>
  );
}
