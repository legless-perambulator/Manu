import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Chapter,
  Character,
  Location,
  ObjectStatus,
  ObjectVisibility,
  Scene,
  StoryObject,
} from "@jellytind/domain";
import {
  describeLocationPath,
  indexLocations,
  OBJECT_STATUSES,
  OBJECT_VISIBILITIES,
} from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import type { ContinuityViolation, ObjectChange, ObjectState } from "@jellytind/story-state";
import { explainEditError } from "../lib/editing";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
}

type TransferKind = "to_character" | "to_location" | "condition" | "status" | "visibility";

/**
 * Object continuity.
 *
 * The panel answers the question a writer actually asks about a tracked object —
 * *where has this been?* — as a trail through the chapters, because that is the
 * form in which a mistake is obvious. A revolver that leaves a flat in chapter
 * 19 and turns up at the manor in chapter 22 is invisible in the manuscript and
 * plain here (docs/OBJECTS_LOCATIONS.md).
 */
export function ObjectPanel({ repo, refreshToken, onChanged, onSelectEntity }: Props) {
  const [objects, setObjects] = useState<StoryObject[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [violations, setViolations] = useState<ContinuityViolation[]>([]);

  const [objectId, setObjectId] = useState("");
  const [history, setHistory] = useState<ObjectChange[]>([]);
  const [state, setState] = useState<ObjectState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<{
    sceneId: string;
    kind: TransferKind;
    value: string;
    reason: string;
  }>({ sceneId: "", kind: "to_character", value: "", reason: "" });

  const label = useCallback((id: string) => names.get(id) ?? id, [names]);
  const locationIndex = useMemo(() => indexLocations(locations), [locations]);

  const load = useCallback(async () => {
    const [objs, chars, locs, allScenes, allChapters, summaries, found] = await Promise.all([
      repo.listObjects(),
      repo.listCharacters(),
      repo.listLocations(),
      repo.listScenes(),
      repo.listChapters(),
      repo.listEntitySummaries(),
      repo.checkContinuity(),
    ]);
    setObjects(objs);
    setCharacters(chars);
    setLocations(locs);
    setScenes(allScenes);
    setChapters(allChapters);
    setNames(new Map(summaries.map((s) => [s.id, s.name])));
    setViolations(found);
    if (objs.length > 0 && !objs.some((o) => o.id === objectId)) setObjectId(objs[0]?.id ?? "");
    if (allScenes.length > 0 && draft.sceneId === "") {
      setDraft((d) => ({ ...d, sceneId: allScenes[0]?.id ?? "" }));
    }
  }, [repo, objectId, draft.sceneId]);

  const reload = useCallback(async () => {
    await load();
    if (objectId === "") {
      setHistory([]);
      setState(null);
      return;
    }
    const [changes, allScenes] = await Promise.all([
      repo.getObjectHistory(objectId),
      repo.listScenes(),
    ]);
    setHistory(changes);
    const last = allScenes.at(-1);
    setState(
      last === undefined
        ? null
        : await repo.getObjectState(objectId, { sceneId: last.id, position: "after" }),
    );
  }, [repo, objectId, load]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  /** Group the trail by chapter, the way a writer reads their own book. */
  const chapterOf = useCallback(
    (sceneId: string) => {
      const scene = scenes.find((s) => s.id === sceneId);
      const chapter = chapters.find((c) => c.id === scene?.chapterId);
      return chapter === undefined ? "Unassigned" : chapter.title;
    },
    [scenes, chapters],
  );

  const grouped = history.reduce<Map<string, ObjectChange[]>>((acc, change) => {
    const key = chapterOf(change.sceneId);
    acc.set(key, [...(acc.get(key) ?? []), change]);
    return acc;
  }, new Map());

  const mine = violations.filter((v) => v.objectId === objectId);

  const place = (id: string): string => {
    const path = describeLocationPath(locationIndex, id);
    return path === "" ? id : path;
  };

  async function record(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const value = draft.value.trim();
      if (draft.kind === "to_character" || draft.kind === "to_location") {
        await repo.recordObjectTransfer({
          objectId,
          sceneId: draft.sceneId,
          ...(draft.kind === "to_character" ? { toCharacterId: value } : { toLocationId: value }),
          ...(draft.reason.trim() === "" ? {} : { reason: draft.reason.trim() }),
        });
      } else {
        await repo.addStateTransitions([
          {
            sceneId: draft.sceneId,
            kind: `object_${draft.kind}` as const,
            subjectId: objectId,
            value,
            ...(draft.reason.trim() === "" ? {} : { note: draft.reason.trim() }),
          },
        ]);
      }
      setDraft({ ...draft, value: "", reason: "" });
      await reload();
      onChanged();
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  const valueOptions: Array<{ id: string; name: string }> =
    draft.kind === "to_character"
      ? characters.map((c) => ({ id: c.id as string, name: c.name }))
      : draft.kind === "to_location"
        ? locations.map((l) => ({
            id: l.id as string,
            name: describeLocationPath(locationIndex, l.id as string),
          }))
        : draft.kind === "status"
          ? OBJECT_STATUSES.map((s: ObjectStatus) => ({ id: s, name: s }))
          : draft.kind === "visibility"
            ? OBJECT_VISIBILITIES.map((v: ObjectVisibility) => ({ id: v, name: v }))
            : [];

  return (
    <div className="state">
      <div className="state__controls">
        <label className="field">
          <span>Object</span>
          <select value={objectId} onChange={(e) => setObjectId(e.target.value)}>
            {objects.length === 0 && <option value="">no tracked objects</option>}
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        {objectId !== "" && (
          <button className="btn btn--small" onClick={() => onSelectEntity(objectId)}>
            Inspect entity
          </button>
        )}
      </div>

      {error !== null && <p className="status status--error">{error}</p>}

      {state !== null && (
        <section className="state__section">
          <h3>Where it stands</h3>
          <div className="state__card">
            <ul className="state__knowledge">
              <li>
                where:{" "}
                {state.placement === "held" && state.holderId !== undefined
                  ? `carried by ${label(state.holderId)}`
                  : state.locationId === undefined
                    ? "nowhere recorded"
                    : place(state.locationId)}
              </li>
              <li>owner: {state.ownerId === undefined ? "unowned" : label(state.ownerId)}</li>
              <li>status: {state.status}</li>
              {state.condition !== undefined && <li>condition: {state.condition}</li>}
              {state.visibility !== "visible" && <li>visibility: {state.visibility}</li>}
            </ul>
          </div>
        </section>
      )}

      <section className="state__section">
        <h3>History</h3>
        {history.length === 0 ? (
          <p className="hint">Nothing recorded for this object yet.</p>
        ) : (
          <ul className="rel__timeline">
            {[...grouped.entries()].map(([chapterTitle, changes]) => (
              <li key={chapterTitle}>
                <div className="rel__chapter">{chapterTitle}</div>
                <ul className="rel__changes">
                  {changes.map((change, i) => (
                    <li key={`${change.sceneId}-${String(i)}`}>
                      <span className="rel__label">{change.kind}</span>{" "}
                      {change.from !== undefined && (
                        <>
                          <span className="rel__from">{valueLabel(change.kind, change.from)}</span>
                          <span className="rel__arrow">→</span>
                        </>
                      )}
                      <span className="rel__to">{valueLabel(change.kind, change.to)}</span>
                      <span className="ctx__id"> {change.sceneId}</span>
                      {change.reason !== undefined && (
                        <div className="ctx__why">{change.reason}</div>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {objectId !== "" && scenes.length > 0 && (
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
              onChange={(e) =>
                setDraft({ ...draft, kind: e.target.value as TransferKind, value: "" })
              }
              disabled={busy}
            >
              <option value="to_character">passes to</option>
              <option value="to_location">is put at</option>
              <option value="condition">condition becomes</option>
              <option value="status">status becomes</option>
              <option value="visibility">visibility becomes</option>
            </select>
          </label>
          <label className="field">
            <span>Value</span>
            {draft.kind === "condition" ? (
              <input
                value={draft.value}
                placeholder="cracked, bloodstained…"
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                disabled={busy}
              />
            ) : (
              <select
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                disabled={busy}
              >
                <option value="">choose…</option>
                {valueOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="field">
            <span>Why (optional)</span>
            <input
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              disabled={busy}
            />
          </label>
          <button
            className="btn btn--primary btn--small"
            disabled={busy || draft.value.trim() === ""}
            onClick={() => void record()}
          >
            Record
          </button>
          <p className="hint">
            Owner and holder are different: a stolen thing still belongs to its owner.
          </p>
        </section>
      )}

      <section className="state__section">
        <h3>Continuity</h3>
        {violations.length === 0 ? (
          <p className="status status--ok">No physical continuity problems found.</p>
        ) : (
          <>
            {mine.length > 0 && (
              <ul className="state__knowledge">
                {mine.map((violation, i) => (
                  <li key={i} className={`ctx--${violation.severity}`}>
                    {violation.message}
                  </li>
                ))}
              </ul>
            )}
            <details>
              <summary className="hint">{violations.length} finding(s) across the project</summary>
              <ul className="state__knowledge">
                {violations.map((violation, i) => (
                  <li key={i} className={`ctx--${violation.severity}`}>
                    {violation.message}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>
    </div>
  );
}

/** Blank values mean "nobody" for people and "nothing" elsewhere. */
function valueLabel(kind: ObjectChange["kind"], value: string): string {
  if (value !== "") return value;
  return kind === "owner" || kind === "holder" ? "nobody" : "—";
}
