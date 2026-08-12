import { useCallback, useEffect, useState } from "react";
import type { Chapter, Relationship, Scene } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  describeDimensionChange,
  RELATIONSHIP_DIMENSIONS,
  RELATIONSHIP_EVENT_KINDS,
  QUALITATIVE_LEVELS,
  type QualitativeLevel,
  type RelationshipChange,
  type RelationshipDimension,
  type RelationshipState,
} from "@jellytind/story-state";
import { explainEditError } from "../lib/editing";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
  onChanged: () => void;
}

type DraftKind =
  "relationship_status" | "relationship_type" | "relationship_dimension" | "relationship_event";

/**
 * The relationship timeline.
 *
 * "Elias and Mara are allies" is not an answer — this panel shows what they were
 * at each point the story changed them, chapter by chapter, and lets a writer
 * record the next change. Deliberately plain: correct time-aware data matters
 * more than visual polish at this stage (docs/STORY_STATE.md).
 */
export function RelationshipPanel({ repo, refreshToken, onChanged }: Props) {
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [relId, setRelId] = useState("");
  const [history, setHistory] = useState<RelationshipChange[]>([]);
  const [milestones, setMilestones] = useState<RelationshipState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    sceneId: string;
    kind: DraftKind;
    value: string;
    dimension: RelationshipDimension;
    level: QualitativeLevel | "";
    magnitude: string;
    note: string;
  }>({
    sceneId: "",
    kind: "relationship_status",
    value: "",
    dimension: "trust",
    level: "",
    magnitude: "",
    note: "",
  });

  const label = useCallback((id: string) => names.get(id) ?? id, [names]);

  const load = useCallback(async () => {
    const [rels, allScenes, allChapters, summaries] = await Promise.all([
      repo.listRelationships(),
      repo.listScenes(),
      repo.listChapters(),
      repo.listEntitySummaries(),
    ]);
    setRelationships(rels);
    setScenes(allScenes);
    setChapters(allChapters);
    setNames(new Map(summaries.map((s) => [s.id, s.name])));
    if (rels.length > 0 && !rels.some((r) => r.id === relId)) setRelId(rels[0]?.id ?? "");
    if (allScenes.length > 0 && draft.sceneId === "") {
      setDraft((d) => ({ ...d, sceneId: allScenes[0]?.id ?? "" }));
    }
  }, [repo, relId, draft.sceneId]);

  const reload = useCallback(async () => {
    if (relId === "") return;
    try {
      const [changes, latest] = await Promise.all([
        repo.getRelationshipHistory(relId),
        scenes.length > 0
          ? repo.getRelationshipAfterScene(relId, scenes[scenes.length - 1]?.id ?? "")
          : Promise.resolve(null),
      ]);
      setHistory(changes);
      setMilestones(latest);
      setError(null);
    } catch (cause) {
      setError(explainEditError(cause));
    }
  }, [repo, relId, scenes]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  /** Group the arc by chapter, the way a writer reads their own book. */
  const chapterOf = useCallback(
    (sceneId: string) => {
      const scene = scenes.find((s) => s.id === sceneId);
      const chapter = chapters.find((c) => c.id === scene?.chapterId);
      return chapter === undefined ? "Unassigned" : chapter.title;
    },
    [scenes, chapters],
  );

  const grouped = history.reduce<Map<string, RelationshipChange[]>>((acc, change) => {
    const key = chapterOf(change.sceneId);
    acc.set(key, [...(acc.get(key) ?? []), change]);
    return acc;
  }, new Map());

  async function record() {
    setBusy(true);
    setError(null);
    try {
      const magnitude = draft.magnitude.trim() === "" ? undefined : Number(draft.magnitude);
      await repo.addStateTransitions([
        {
          sceneId: draft.sceneId,
          kind: draft.kind,
          subjectId: relId,
          value: draft.kind === "relationship_dimension" ? "" : draft.value.trim(),
          ...(draft.kind === "relationship_dimension" ? { dimension: draft.dimension } : {}),
          ...(draft.kind === "relationship_dimension" && draft.level !== ""
            ? { level: draft.level }
            : {}),
          ...(draft.kind === "relationship_dimension" && magnitude !== undefined
            ? { magnitude }
            : {}),
          ...(draft.note.trim() === "" ? {} : { note: draft.note.trim() }),
        },
      ]);
      setDraft((d) => ({ ...d, value: "", magnitude: "", note: "" }));
      await reload();
      onChanged();
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  const selected = relationships.find((r) => r.id === relId);

  return (
    <div className="state">
      <div className="state__controls">
        <label className="field">
          <span>Relationship</span>
          <select value={relId} onChange={(e) => setRelId(e.target.value)} disabled={busy}>
            {relationships.length === 0 && <option value="">no relationships recorded</option>}
            {relationships.map((r) => (
              <option key={r.id} value={r.id}>
                {label(r.characterAId)} ↔ {label(r.characterBId)} ({r.id})
              </option>
            ))}
          </select>
        </label>
      </div>

      {error !== null && <p className="status status--error">{error}</p>}

      {selected !== undefined && (
        <section className="state__section">
          <h3>
            {label(selected.characterAId)} → {label(selected.characterBId)}
          </h3>
          {history.length === 0 ? (
            <p className="agent__empty">
              Starts as {selected.type}
              {selected.status === "" ? "" : ` (${selected.status})`}; nothing has changed it yet.
            </p>
          ) : (
            <ul className="rel__timeline">
              {[...grouped.entries()].map(([chapterTitle, changes]) => (
                <li key={chapterTitle}>
                  <div className="rel__chapter">{chapterTitle}</div>
                  <ul className="rel__changes">
                    {changes.map((c, i) => (
                      <li key={`${String(i)}-${c.sceneId}-${c.label}`}>
                        <span className="ctx__id">{c.sceneId}</span>{" "}
                        <span className="rel__label">{c.label.replace(/_/g, " ")}</span>{" "}
                        {c.from === undefined ? (
                          <span className="rel__to">{c.to.replace(/_/g, " ")}</span>
                        ) : (
                          <>
                            <span className="rel__from">{c.from}</span>
                            <span className="rel__arrow">→</span>
                            <span className="rel__to">{c.to}</span>
                          </>
                        )}
                        {c.reason !== undefined && <div className="ctx__why">{c.reason}</div>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {milestones !== null && milestones.events.length > 0 && (
        <section className="state__section">
          <h3>Milestones</h3>
          <ul className="state__knowledge">
            {milestones.events.map((e, i) => (
              <li key={`${String(i)}-${e.sceneId}`}>
                {e.kind.replace(/_/g, " ")} <span className="ctx__why">({e.sceneId})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {milestones !== null && Object.keys(milestones.dimensions).length > 0 && (
        <section className="state__section">
          <h3>Dimensions, latest</h3>
          <ul className="state__knowledge">
            {Object.values(milestones.dimensions).map(
              (d) => d !== undefined && <li key={d.dimension}>{describeDimensionChange(d)}</li>,
            )}
          </ul>
        </section>
      )}

      {selected !== undefined && (
        <section className="state__section">
          <h3>Record a change</h3>
          <label className="field">
            <span>At scene</span>
            <select
              value={draft.sceneId}
              onChange={(e) => setDraft({ ...draft, sceneId: e.target.value })}
              disabled={busy}
            >
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} — {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Change</span>
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as DraftKind })}
              disabled={busy}
            >
              <option value="relationship_status">status becomes</option>
              <option value="relationship_type">type becomes</option>
              <option value="relationship_event">milestone</option>
              <option value="relationship_dimension">dimension moves</option>
            </select>
          </label>

          {draft.kind === "relationship_event" && (
            <label className="field">
              <span>Milestone</span>
              <select
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                disabled={busy}
              >
                <option value="">choose…</option>
                {RELATIONSHIP_EVENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
          )}

          {(draft.kind === "relationship_status" || draft.kind === "relationship_type") && (
            <label className="field">
              <span>New value</span>
              <input
                value={draft.value}
                placeholder={draft.kind === "relationship_type" ? "adversaries" : "strained"}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                disabled={busy}
              />
            </label>
          )}

          {draft.kind === "relationship_dimension" && (
            <>
              <label className="field">
                <span>Dimension</span>
                <select
                  value={draft.dimension}
                  onChange={(e) =>
                    setDraft({ ...draft, dimension: e.target.value as RelationshipDimension })
                  }
                  disabled={busy}
                >
                  {RELATIONSHIP_DIMENSIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Level (optional)</span>
                <select
                  value={draft.level}
                  onChange={(e) =>
                    setDraft({ ...draft, level: e.target.value as QualitativeLevel | "" })
                  }
                  disabled={busy}
                >
                  <option value="">—</option>
                  {QUALITATIVE_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Value 0–1 (optional)</span>
                <input
                  value={draft.magnitude}
                  placeholder="0.31"
                  onChange={(e) => setDraft({ ...draft, magnitude: e.target.value })}
                  disabled={busy}
                />
              </label>
              <p className="hint">
                Dimensions are analytical aids, not literary truth. A level alone is enough.
              </p>
            </>
          )}

          <label className="field">
            <span>Reason (optional)</span>
            <input
              value={draft.note}
              placeholder="Mara lies about the vault."
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              disabled={busy}
            />
          </label>

          <button
            className="btn btn--primary btn--small"
            disabled={busy || relId === "" || draft.sceneId === ""}
            onClick={() => void record()}
          >
            Record
          </button>
        </section>
      )}
    </div>
  );
}
