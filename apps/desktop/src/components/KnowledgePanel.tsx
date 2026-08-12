import { useCallback, useEffect, useState } from "react";
import type { Fact, Scene } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import type { FactKnowledgeGraph, KnowledgeViolation } from "@jellytind/story-state";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
}

const STATE_ORDER = ["known", "believed", "suspected", "disbelieved", "unknown"] as const;

/**
 * The knowledge graph.
 *
 * Who holds what, at a chosen point in the story — and what the world says is
 * actually true. Deliberately plain: the value of this phase is correct data and
 * queries, so the view is a readable tree rather than a diagram
 * (docs/STORY_STATE.md).
 */
export function KnowledgePanel({ repo, refreshToken }: Props) {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [factId, setFactId] = useState("");
  const [sceneId, setSceneId] = useState("");
  const [position, setPosition] = useState<"before" | "after">("after");
  const [graph, setGraph] = useState<FactKnowledgeGraph | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [violations, setViolations] = useState<KnowledgeViolation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const label = useCallback((id: string) => names.get(id) ?? id, [names]);

  const load = useCallback(async () => {
    const [allFacts, allScenes, summaries] = await Promise.all([
      repo.listFacts(),
      repo.listScenes(),
      repo.listEntitySummaries(),
    ]);
    setFacts(allFacts);
    setScenes(allScenes);
    setNames(new Map(summaries.map((s) => [s.id, s.name])));
    if (allFacts.length > 0 && !allFacts.some((f) => f.id === factId)) {
      setFactId(allFacts[0]?.id ?? "");
    }
    if (allScenes.length > 0 && !allScenes.some((s) => s.id === sceneId)) {
      setSceneId(allScenes[allScenes.length - 1]?.id ?? "");
    }
    setViolations(await repo.checkKnowledge());
  }, [repo, factId, sceneId]);

  const build = useCallback(async () => {
    if (factId === "" || sceneId === "") return;
    try {
      setGraph(await repo.getFactKnowledgeGraph(factId, { sceneId, position }));
      setError(null);
    } catch (cause) {
      setGraph(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [repo, factId, sceneId, position]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    void build();
  }, [build, refreshToken]);

  const holders = [...(graph?.holders ?? [])].sort(
    (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state),
  );

  return (
    <div className="state">
      <div className="state__controls">
        <label className="field">
          <span>Fact</span>
          <select value={factId} onChange={(e) => setFactId(e.target.value)}>
            {facts.length === 0 && <option value="">no facts recorded</option>}
            {facts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.id} — {f.statement}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>At scene</span>
          <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
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

      {graph !== null && (
        <section className="state__section">
          <h3>Who holds it</h3>
          <div className="knowledge__fact">
            <strong>{graph.factId}</strong>
            <span className={`badge badge--${graph.objectiveTruth ? "true" : "false"}`}>
              {graph.objectiveTruth ? "true in the world" : "FALSE in the world"}
            </span>
          </div>
          <ul className="knowledge__tree">
            {holders.map((h) => (
              <li key={h.characterId} className={`knowledge__holder kh--${h.state}`}>
                <span className="knowledge__branch">├──</span>
                <span className="knowledge__name">{label(h.characterId)}</span>
                <span className="knowledge__state">{h.state}</span>
                {h.state !== "unknown" && (
                  <span className="ctx__why">
                    {h.sourceType}
                    {h.sourceEntityId === undefined ? "" : ` by ${label(h.sourceEntityId)}`}
                    {h.acquiredAtSceneId === undefined ? "" : `, ${h.acquiredAtSceneId}`}
                    {h.certainty === undefined ? "" : `, certainty ${String(h.certainty)}`}
                  </span>
                )}
                {h.isFalseBelief && <span className="knowledge__false">false belief</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="state__section">
        <h3>Knowledge checks</h3>
        {violations.length === 0 ? (
          <p className="agent__empty">No contradictions found in the recorded information state.</p>
        ) : (
          <ul className="state__transitions">
            {violations.map((v, i) => (
              <li key={`${String(i)}-${v.kind}`} className={`ctx ctx--${v.severity}`}>
                <div className="ctx__head">
                  <span className="ctx__id">{v.sceneId}</span>
                  <span className="ctx__label">{v.kind.replace(/_/g, " ")}</span>
                  <span className="ctx__tokens">{v.severity}</span>
                </div>
                <div className="ctx__why">{v.message}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
