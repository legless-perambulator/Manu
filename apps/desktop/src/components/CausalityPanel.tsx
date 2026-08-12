import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEPENDENCY_KINDS,
  DEPENDENCY_KIND_INFO,
  describeDependency,
  isDependencyNode,
  type Dependency,
  type DependencyKind,
} from "@jellytind/domain";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { describePath, type BlastRadius, type DependencyStep } from "@jellytind/story-causality";
import { createDependencyAnalyst, explainEditError } from "../lib/editing";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
  onOpenScene: (sceneId: string) => void;
}

/**
 * The causality graph.
 *
 * Deliberately not a spider's web on a canvas. A writer asking "what depends on
 * this scene?" is answered better by three readable columns — what it rests on,
 * the thing itself, what rests on it — than by a picture they have to untangle
 * (docs/STORY_REFACTOR.md). Clicking any node re-centres the view, so walking
 * the graph is how you explore it.
 */
export function CausalityPanel({
  repo,
  secrets,
  refreshToken,
  onChanged,
  onSelectEntity,
  onOpenScene,
}: Props) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [upstream, setUpstream] = useState<DependencyStep[]>([]);
  const [downstream, setDownstream] = useState<DependencyStep[]>([]);
  const [radius, setRadius] = useState<BlastRadius | null>(null);
  const [kinds, setKinds] = useState<DependencyKind[]>([...DEPENDENCY_KINDS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [draft, setDraft] = useState<{
    fromId: string;
    kind: DependencyKind;
    toId: string;
    description: string;
  }>({
    fromId: "",
    kind: "causes",
    toId: "",
    description: "",
  });
  const [scope, setScope] = useState<string[]>([]);

  const label = useCallback((id: string) => names.get(id) ?? id, [names]);

  const load = useCallback(async () => {
    const [all, summaries] = await Promise.all([
      repo.listDependencies(),
      repo.listEntitySummaries(),
    ]);
    setDependencies(all);
    setNames(new Map(summaries.map((s) => [s.id, s.name || s.id])));
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const focus = useCallback(
    async (id: string | null) => {
      setFocusId(id);
      if (id === null) {
        setUpstream([]);
        setDownstream([]);
        setRadius(null);
        return;
      }
      const options = { kinds };
      const [up, down, blast] = await Promise.all([
        repo.getDependenciesOf(id, options),
        repo.getDependentsOf(id, options),
        repo.calculateBlastRadius(id, options),
      ]);
      setUpstream(up);
      setDownstream(down);
      setRadius(blast);
    },
    [repo, kinds],
  );

  useEffect(() => {
    if (focusId !== null) void focus(focusId);
    // Re-running when the filter changes is the point of the filter.
  }, [focus, focusId, refreshToken]);

  const nodes = useMemo(
    () =>
      [...names.entries()]
        .filter(([id]) => isDependencyNode(id))
        .sort((a, b) => a[0].localeCompare(b[0])),
    [names],
  );

  const proposals = dependencies.filter((d) => d.status === "proposed");

  async function act(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
      if (focusId !== null) await focus(focusId);
      onChanged();
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="state">
      {error !== null && <p className="status status--error">{error}</p>}
      {note !== null && <p className="hint">{note}</p>}

      <div className="state__controls">
        <label className="field">
          <span>Look at</span>
          <select
            value={focusId ?? ""}
            onChange={(e) => void focus(e.target.value === "" ? null : e.target.value)}
            disabled={busy}
          >
            <option value="">choose a story element…</option>
            {nodes.map(([id, name]) => (
              <option key={id} value={id}>
                {name} ({id})
              </option>
            ))}
          </select>
        </label>
        <div className="causality__filters">
          {DEPENDENCY_KINDS.map((kind) => (
            <label
              key={kind}
              className="causality__filter"
              title={DEPENDENCY_KIND_INFO[kind].description}
            >
              <input
                type="checkbox"
                checked={kinds.includes(kind)}
                onChange={(e) =>
                  setKinds(
                    e.target.checked
                      ? [...kinds, kind]
                      : kinds.filter((existing) => existing !== kind),
                  )
                }
              />{" "}
              {kind.replace(/_/g, " ")}
            </label>
          ))}
        </div>
      </div>

      {focusId === null ? (
        <p className="hint">
          Choose something to see what it rests on and what rests on it. Registered dependencies are
          the links the manuscript does not contain — nothing in the prose says the confrontation
          only happens because of the letter.
        </p>
      ) : (
        <>
          <section className="state__section">
            <h3>What it rests on</h3>
            {upstream.length === 0 ? (
              <p className="hint">Nothing registered upstream.</p>
            ) : (
              <ul className="causality__list">
                {upstream.map((step) => (
                  <NodeRow
                    key={step.dependencyId}
                    id={step.causeId}
                    relation={`${DEPENDENCY_KIND_INFO[step.kind].arrowVerb} this`}
                    label={label}
                    onFocus={(id) => void focus(id)}
                    onSelectEntity={onSelectEntity}
                    onOpenScene={onOpenScene}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="state__section causality__focus">
            <h3>{label(focusId)}</h3>
            <p className="ctx__id">{focusId}</p>
            <div className="build__links">
              <button className="btn btn--small" onClick={() => onSelectEntity(focusId)}>
                Inspect
              </button>
              {focusId.startsWith("SCENE_") && (
                <button className="btn btn--small" onClick={() => onOpenScene(focusId)}>
                  Open prose
                </button>
              )}
            </div>
          </section>

          <section className="state__section">
            <h3>What rests on it</h3>
            {downstream.length === 0 ? (
              <p className="hint">Nothing registered downstream.</p>
            ) : (
              <ul className="causality__list">
                {downstream.map((step) => (
                  <NodeRow
                    key={step.dependencyId}
                    id={step.effectId}
                    relation={`this ${DEPENDENCY_KIND_INFO[step.kind].arrowVerb} it`}
                    label={label}
                    onFocus={(id) => void focus(id)}
                    onSelectEntity={onSelectEntity}
                    onOpenScene={onOpenScene}
                  />
                ))}
              </ul>
            )}
          </section>

          {radius !== null && (
            <section className="state__section">
              <h3>
                Blast radius{" "}
                <span className="badge">
                  {radius.total} element{radius.total === 1 ? "" : "s"}
                </span>
              </h3>
              {radius.total === 0 ? (
                <p className="hint">Nothing registered depends on this.</p>
              ) : (
                <>
                  <p className="ctx__why">
                    Changing {label(focusId)} may affect:
                    {radius.cyclic ? " (the graph loops here; traversal handled it)" : ""}
                  </p>
                  <ul className="build__list">
                    {radius.affected.map((affected) => (
                      <li key={affected.id} className="build__item">
                        <div className="build__head">
                          <span className="build__severity build__severity--warning">
                            {affected.direct ? "direct" : `${affected.distance} steps`}
                          </span>
                          <strong>{label(affected.id)}</strong>
                          <span className="ctx__id">{affected.id}</span>
                        </div>
                        {affected.paths.map((path, i) => (
                          <div key={i} className="ctx__why">
                            {describePath(path, label)}
                          </div>
                        ))}
                        <div className="build__links">
                          <button
                            className="btn btn--small"
                            onClick={() => void focus(affected.id)}
                          >
                            Look at
                          </button>
                          <button
                            className="btn btn--small"
                            onClick={() =>
                              affected.id.startsWith("SCENE_")
                                ? onOpenScene(affected.id)
                                : onSelectEntity(affected.id)
                            }
                          >
                            Open
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </>
      )}

      {proposals.length > 0 && (
        <section className="state__section">
          <h3>
            Proposed <span className="badge debug__badge--judgement">model judgement</span>
          </h3>
          <p className="hint">
            Out of the graph until you accept them. A dependency you did not check is one a refactor
            would be planned against.
          </p>
          <ul className="build__list">
            {proposals.map((dependency) => (
              <li key={dependency.id} className="build__item">
                <div className="build__message">{describeDependency(dependency, label)}</div>
                {dependency.description !== undefined && (
                  <div className="ctx__why">{dependency.description}</div>
                )}
                {dependency.evidence !== undefined && (
                  <div className="ctx__why">Evidence: {dependency.evidence}</div>
                )}
                <div className="build__links">
                  <button
                    className="btn btn--small"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await repo.updateDependency(dependency.id, { status: "confirmed" });
                      })
                    }
                  >
                    Accept
                  </button>
                  <button
                    className="btn btn--small"
                    disabled={busy}
                    onClick={() => void act(() => repo.deleteDependency(dependency.id))}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="state__section">
        <h3>Register a dependency</h3>
        <p className="hint">
          Write it as a sentence. Direction is worked out from the relation, so you never have to
          think backwards.
        </p>
        <label className="field">
          <span>This</span>
          <select
            value={draft.fromId}
            onChange={(e) => setDraft({ ...draft, fromId: e.target.value })}
            disabled={busy}
          >
            <option value="">choose…</option>
            {nodes.map(([id, name]) => (
              <option key={id} value={id}>
                {name} ({id})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Relation</span>
          <select
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as DependencyKind })}
            disabled={busy}
          >
            {DEPENDENCY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {DEPENDENCY_KIND_INFO[kind].verb} — {DEPENDENCY_KIND_INFO[kind].description}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>That</span>
          <select
            value={draft.toId}
            onChange={(e) => setDraft({ ...draft, toId: e.target.value })}
            disabled={busy}
          >
            <option value="">choose…</option>
            {nodes.map(([id, name]) => (
              <option key={id} value={id}>
                {name} ({id})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Why (optional)</span>
          <input
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            disabled={busy}
          />
        </label>

        {draft.fromId !== "" && draft.toId !== "" && (
          <p className="test__preview">
            <strong>{describeDependency(draft, label)}</strong>
          </p>
        )}

        <button
          className="btn btn--primary btn--small"
          disabled={busy || draft.fromId === "" || draft.toId === "" || draft.fromId === draft.toId}
          onClick={() =>
            void act(async () => {
              await repo.addDependencies([
                {
                  kind: draft.kind,
                  fromId: draft.fromId,
                  toId: draft.toId,
                  ...(draft.description.trim() === ""
                    ? {}
                    : { description: draft.description.trim() }),
                },
              ]);
              setDraft({ ...draft, description: "" });
            })
          }
        >
          Register
        </button>
      </section>

      <section className="state__section">
        <h3>Ask the model to propose</h3>
        <label className="field">
          <span>Scenes to analyse</span>
          <select
            multiple
            size={6}
            value={scope}
            onChange={(e) => setScope([...e.target.selectedOptions].map((option) => option.value))}
            disabled={busy}
          >
            {nodes
              .filter(([id]) => id.startsWith("SCENE_"))
              .map(([id, name]) => (
                <option key={id} value={id}>
                  {name} ({id})
                </option>
              ))}
          </select>
        </label>
        <button
          className="btn btn--small"
          disabled={busy || scope.length === 0}
          onClick={() =>
            void act(async () => {
              const analyst = await createDependencyAnalyst(repo, secrets);
              const proposal = await analyst.analyseScope(scope);
              setNote(
                `${String(proposal.proposed.length)} proposed for review; ${String(proposal.rejected.length)} unusable${
                  proposal.rejected.length === 0
                    ? ""
                    : `: ${proposal.rejected.map((r) => r.problem ?? "").join(" ")}`
                }`,
              );
            })
          }
        >
          Propose dependencies
        </button>
        <p className="hint">Nothing it proposes joins the graph until you accept it.</p>
      </section>

      <section className="state__section">
        <h3>All registered ({dependencies.filter((d) => d.status === "confirmed").length})</h3>
        <ul className="state__knowledge">
          {dependencies
            .filter((d) => d.status === "confirmed")
            .map((dependency) => (
              <li key={dependency.id}>
                <button className="btn btn--small" onClick={() => void focus(dependency.fromId)}>
                  {describeDependency(dependency, label)}
                </button>
                <button
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() => void act(() => repo.deleteDependency(dependency.id))}
                >
                  Remove
                </button>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

function NodeRow({
  id,
  relation,
  label,
  onFocus,
  onSelectEntity,
  onOpenScene,
}: {
  id: string;
  relation: string;
  label: (id: string) => string;
  onFocus: (id: string) => void;
  onSelectEntity: (id: string) => void;
  onOpenScene: (sceneId: string) => void;
}) {
  return (
    <li className="causality__node">
      <button className="btn btn--small" onClick={() => onFocus(id)}>
        {label(id)}
      </button>
      <span className="ctx__why"> {relation}</span>
      <button
        className="btn btn--small"
        onClick={() => (id.startsWith("SCENE_") ? onOpenScene(id) : onSelectEntity(id))}
      >
        Open
      </button>
    </li>
  );
}
