import { useCallback, useEffect, useMemo, useState } from "react";
import { StateExtractor, type ProposedTransition } from "@jellytind/editing";
import type { SecretStore } from "@jellytind/model-router";
import type { Scene } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  describeTransition,
  TRANSITION_KINDS,
  type StateTransition,
  type TransitionKind,
  type WorldState,
} from "@jellytind/story-state";
import { createConfiguredModel } from "../lib/models";
import { explainEditError, MANUSCRIPT_EDIT_GRANT } from "../lib/editing";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  refreshToken: number;
  onChanged: () => void;
}

const KIND_LABELS: Record<TransitionKind, string> = {
  character_location: "character is at",
  character_status: "character becomes",
  object_owner: "object owned by",
  object_holder: "object carried by",
  object_location: "object is at",
  object_condition: "object condition becomes",
  object_status: "object status becomes",
  object_visibility: "object visibility becomes",
  fact_established: "fact becomes true",
  knowledge_changed: "character's position on a fact",
  relationship_type: "relationship type becomes",
  relationship_status: "relationship status becomes",
  relationship_dimension: "relationship dimension moves",
  relationship_event: "relationship milestone",
  thread_status: "thread lifecycle becomes",
  thread_appearance: "scene touches thread",
};

/**
 * Inspect and correct story state.
 *
 * The state engine is only trustworthy if a writer can see what it believes and
 * fix it. This panel reconstructs the world at a chosen scene boundary, lists
 * the transitions recorded at that scene with their provenance, and lets the
 * author add, correct, confirm, reject or delete any of them
 * (docs/STORY_STATE.md).
 */
export function StatePanel({ repo, secrets, refreshToken, onChanged }: Props) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [sceneId, setSceneId] = useState("");
  const [position, setPosition] = useState<"before" | "after">("before");
  const [world, setWorld] = useState<WorldState | null>(null);
  const [atScene, setAtScene] = useState<StateTransition[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState<ProposedTransition[] | null>(null);
  const [draft, setDraft] = useState<{ kind: TransitionKind; subjectId: string; value: string }>({
    kind: "character_location",
    subjectId: "",
    value: "",
  });

  const label = useCallback((id: string) => (id === "" ? "—" : (names.get(id) ?? id)), [names]);

  const load = useCallback(async () => {
    const [all, summaries] = await Promise.all([repo.listScenes(), repo.listEntitySummaries()]);
    setScenes(all);
    setNames(new Map(summaries.map((s) => [s.id, s.name])));
    if (all.length > 0 && !all.some((s) => s.id === sceneId)) setSceneId(all[0]?.id ?? "");
  }, [repo, sceneId]);

  const reconstruct = useCallback(async () => {
    if (sceneId === "") return;
    const timeline = await repo.getStoryTimeline();
    try {
      setWorld(timeline.worldStateAt({ sceneId, position }));
      setAtScene(timeline.transitionsAtScene(sceneId));
      setError(null);
    } catch (cause) {
      // A scene with no chapter is not in the story order yet.
      setWorld(null);
      setAtScene([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [repo, sceneId, position]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    void reconstruct();
  }, [reconstruct, refreshToken]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reconstruct();
      onChanged();
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function analyse() {
    setBusy(true);
    setError(null);
    try {
      const model = await createConfiguredModel(secrets, "utility");
      const extractor = new StateExtractor({
        repo,
        model,
        grant: {
          ...MANUSCRIPT_EDIT_GRANT,
          permissions: ["read_manuscript", "read_canon", "edit_story_state"],
          allowedTools: ["analyse_state_changes"],
        },
      });
      const proposal = await extractor.analyseScene(sceneId);
      setProposed([...proposal.transitions, ...proposal.rejected]);
      await reconstruct();
      onChanged();
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  const pending = useMemo(
    () => atScene.filter((t) => t.confirmationStatus === "proposed"),
    [atScene],
  );

  return (
    <div className="state">
      <div className="state__controls">
        <label className="field">
          <span>Scene</span>
          <select value={sceneId} onChange={(e) => setSceneId(e.target.value)} disabled={busy}>
            {scenes.length === 0 && <option value="">no scenes yet</option>}
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} — {s.title}
              </option>
            ))}
          </select>
        </label>
        <div className="state__toggle">
          {(["before", "after"] as const).map((p) => (
            <button
              key={p}
              className={`tab${position === p ? " tab--active" : ""}`}
              onClick={() => setPosition(p)}
            >
              {p} this scene
            </button>
          ))}
        </div>
      </div>

      {error !== null && <p className="status status--error">{error}</p>}

      {world !== null && (
        <section className="state__section">
          <h3>
            World {position} {sceneId}
          </h3>
          {world.characters.length === 0 && world.objects.length === 0 && (
            <p className="agent__empty">Nothing recorded at this point in the story.</p>
          )}
          {world.characters.map((c) => (
            <div key={c.characterId} className="state__card">
              <div className="state__card-head">
                <strong>{label(c.characterId)}</strong>
                <span className={`badge badge--${c.status}`}>{c.status}</span>
              </div>
              <div className="ctx__why">location: {label(c.locationId ?? "")}</div>
              {c.inventory.length > 0 && (
                <div className="ctx__why">carrying: {c.inventory.map(label).join(", ")}</div>
              )}
              {c.knowledge.length > 0 && (
                <ul className="state__knowledge">
                  {c.knowledge.map((k) => (
                    <li key={k.factId}>
                      {k.state} {label(k.factId)}{" "}
                      <span className="ctx__why">
                        ({k.sourceType}
                        {k.sourceEntityId === undefined ? "" : ` by ${label(k.sourceEntityId)}`}
                        {k.acquiredAtSceneId === undefined ? "" : `, since ${k.acquiredAtSceneId}`}
                        {k.certainty === undefined ? "" : `, certainty ${String(k.certainty)}`})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {world.objects.map((o) => (
            <div key={o.objectId} className="state__card">
              <div className="state__card-head">
                <strong>{label(o.objectId)}</strong>
              </div>
              <div className="ctx__why">
                owner: {label(o.ownerId ?? "")} · location: {label(o.locationId ?? "")}
              </div>
            </div>
          ))}
          {world.establishedFacts.length > 0 && (
            <div className="state__card">
              <div className="state__card-head">
                <strong>Established facts</strong>
              </div>
              <ul className="state__knowledge">
                {world.establishedFacts.map((f) => (
                  <li key={f}>{label(f)}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="state__section">
        <h3>Transitions at {sceneId}</h3>
        <button
          className="btn btn--small"
          onClick={() => void analyse()}
          disabled={busy || sceneId === ""}
        >
          Analyse state changes
        </button>
        <p className="hint">
          The model proposes; nothing becomes canon until you confirm it.
          {pending.length > 0 ? ` ${String(pending.length)} awaiting review.` : ""}
        </p>

        {proposed !== null && proposed.some((p) => p.problem !== undefined) && (
          <ul className="state__rejected">
            {proposed
              .filter((p) => p.problem !== undefined)
              .map((p, i) => (
                <li key={`${String(i)}-${p.subjectId}`}>
                  Discarded: {p.kind} {p.subjectId} → {p.value} — {p.problem}
                </li>
              ))}
          </ul>
        )}

        {atScene.length === 0 ? (
          <p className="agent__empty">No transitions recorded at this scene.</p>
        ) : (
          <ul className="state__transitions">
            {atScene.map((t) => (
              <li key={t.id} className={`ctx ctx--${t.confirmationStatus}`}>
                <div className="ctx__head">
                  <span className="ctx__id">{t.id}</span>
                  <span className="ctx__label">
                    {describeTransition(t)
                      .replace(t.subjectId, label(t.subjectId))
                      .replace(t.value, label(t.value))}
                  </span>
                  <span className="ctx__tokens">{t.confirmationStatus}</span>
                </div>
                <div className="ctx__why">
                  {t.source}
                  {t.modelId === undefined ? "" : ` · ${t.modelId}`}
                  {t.certainty === undefined ? "" : ` · certainty ${t.certainty}`}
                  {t.note === undefined ? "" : ` · ${t.note}`}
                </div>
                <div className="state__actions">
                  {t.confirmationStatus !== "confirmed" && (
                    <button
                      className="btn btn--small"
                      disabled={busy}
                      onClick={() => void run(() => repo.setTransitionStatus(t.id, "confirmed"))}
                    >
                      Confirm
                    </button>
                  )}
                  {t.confirmationStatus !== "rejected" && (
                    <button
                      className="btn btn--small"
                      disabled={busy}
                      onClick={() => void run(() => repo.setTransitionStatus(t.id, "rejected"))}
                    >
                      Reject
                    </button>
                  )}
                  <button
                    className="btn btn--danger btn--small"
                    disabled={busy}
                    onClick={() => void run(() => repo.deleteStateTransition(t.id))}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="state__section">
        <h3>Record a transition</h3>
        <label className="field">
          <span>Change</span>
          <select
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as TransitionKind })}
            disabled={busy}
          >
            {TRANSITION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Subject ID</span>
          <input
            value={draft.subjectId}
            placeholder="CHAR_0001 / OBJECT_0001 / FACT_0001"
            onChange={(e) => setDraft({ ...draft, subjectId: e.target.value.trim() })}
            disabled={busy}
          />
        </label>
        <label className="field">
          <span>Value</span>
          <input
            value={draft.value}
            placeholder="LOC_0001 / CHAR_0001 / FACT_0001 / deceased"
            onChange={(e) => setDraft({ ...draft, value: e.target.value.trim() })}
            disabled={busy}
          />
        </label>
        <button
          className="btn btn--primary btn--small"
          disabled={busy || sceneId === "" || draft.subjectId === ""}
          onClick={() =>
            void run(async () => {
              await repo.addStateTransitions([{ sceneId, ...draft }]);
              setDraft({ ...draft, subjectId: "", value: "" });
            })
          }
        >
          Record
        </button>
      </section>
    </div>
  );
}
