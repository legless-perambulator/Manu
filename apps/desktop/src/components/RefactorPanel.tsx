import { useCallback, useEffect, useMemo, useState } from "react";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  REFACTOR_KINDS,
  REFACTOR_KIND_LABEL,
  analyseRefactor,
  failedValidation,
  planRefactor,
  stageRefactor,
  type RefactorAnalysis,
  type RefactorKind,
  type RefactorPlan,
  type RefactorRequest,
  type RefactorRun,
  type StagedRefactor,
} from "@jellytind/story-refactor";
import { computeLineDiff } from "@jellytind/story-repository";
import { createRefactorPlanner, explainEditError, STORY_REFACTOR_GRANT } from "../lib/editing";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
  /** Open the Story Map's causality view on the change's target (Phase 38 §17). */
  onVisualiseImpact?: (entityId: string) => void;
}

/** What each refactor class needs the writer to fill in. */
const FIELDS: Readonly<Record<RefactorKind, readonly string[]>> = {
  rename_entity: ["entityId", "newName"],
  change_relationship: ["relationshipId", "newType", "newStatus", "oldTerms", "newTerm"],
  change_character_attribute: ["characterId", "field", "newValue", "oldTerms", "newTerm"],
  move_story_event: ["sceneId", "toChapterId"],
};

const FIELD_LABEL: Readonly<Record<string, string>> = {
  entityId: "What to rename",
  newName: "New name",
  relationshipId: "Relationship",
  newType: "They become",
  newStatus: "Status (optional)",
  characterId: "Character",
  field: "Which field",
  newValue: "New value",
  sceneId: "Scene to move",
  toChapterId: "Into chapter",
  oldTerms: "Words the prose uses now (comma-separated)",
  newTerm: "Word to use instead",
};

/**
 * The Refactor workspace.
 *
 * A dedicated place rather than a chat message, because a structural change to
 * a novel is a decision made from evidence: what it reaches, what it risks,
 * what it will do, what the compiler and the writer's own tests say about the
 * result — and only then a button (docs/STORY_REFACTOR.md).
 *
 * Nothing here is applied until the writer says so. The staged refactor holds
 * the edits; walking away costs nothing.
 */
export function RefactorPanel({
  repo,
  secrets,
  refreshToken,
  onChanged,
  onSelectEntity,
  onVisualiseImpact,
}: Props) {
  const [kind, setKind] = useState<RefactorKind>("change_relationship");
  const [instruction, setInstruction] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [analysis, setAnalysis] = useState<RefactorAnalysis | null>(null);
  const [plan, setPlan] = useState<RefactorPlan | null>(null);
  const [staged, setStaged] = useState<StagedRefactor | null>(null);
  const [run, setRun] = useState<RefactorRun | null>(null);
  const [history, setHistory] = useState<
    Array<{ id: string; kind: string; status: string; instruction: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const label = useCallback((id: string) => names.get(id) ?? id, [names]);

  const load = useCallback(async () => {
    const [summaries, runs] = await Promise.all([
      repo.listEntitySummaries(),
      repo.listRefactorRuns(20),
    ]);
    setNames(new Map(summaries.map((s) => [s.id, s.name || s.id])));
    setHistory(runs);
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const optionsFor = useCallback(
    (key: string): Array<{ id: string; name: string }> => {
      const of = (prefix: string) =>
        [...names.entries()]
          .filter(([id]) => id.startsWith(prefix))
          .map(([id, name]) => ({ id, name }));
      switch (key) {
        case "entityId":
          return [...names.entries()].map(([id, name]) => ({ id, name }));
        case "relationshipId":
          return of("REL_");
        case "characterId":
          return of("CHAR_");
        case "sceneId":
          return of("SCENE_");
        case "toChapterId":
          return of("CHAPTER_");
        case "field":
          return ["role", "description", "goals"].map((f) => ({ id: f, name: f }));
        default:
          return [];
      }
    },
    [names],
  );

  const request = useMemo((): RefactorRequest => {
    const raw = values.oldTerms ?? "";
    const terms =
      raw.trim() === ""
        ? undefined
        : raw
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t !== "");
    return {
      kind,
      ...(instruction.trim() === "" ? {} : { instruction: instruction.trim() }),
      ...Object.fromEntries(
        Object.entries(values).filter(([k, v]) => k !== "oldTerms" && v !== ""),
      ),
      ...(terms === undefined ? {} : { oldTerms: terms }),
    } as unknown as RefactorRequest;
  }, [kind, instruction, values]);

  const ready = FIELDS[kind]
    .filter((f) => !["newStatus", "oldTerms", "newTerm"].includes(f))
    .every((f) => (values[f] ?? "") !== "");

  async function act(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  const reset = (): void => {
    setStaged(null);
    setRun(null);
    setNote(null);
  };

  return (
    <div className="state">
      {error !== null && <p className="status status--error">{error}</p>}
      {note !== null && <p className="hint">{note}</p>}

      <section className="state__section">
        <h3>Requested transformation</h3>
        <label className="field">
          <span>In your words</span>
          <input
            value={instruction}
            placeholder="Make Marcus Elias's childhood friend instead."
            onChange={(e) => setInstruction(e.target.value)}
            disabled={busy || staged !== null}
          />
        </label>
        <label className="field">
          <span>Kind of change</span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as RefactorKind);
              setValues({});
              reset();
              setAnalysis(null);
              setPlan(null);
            }}
            disabled={busy || staged !== null}
          >
            {REFACTOR_KINDS.map((k) => (
              <option key={k} value={k}>
                {REFACTOR_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>

        {FIELDS[kind].map((key) => {
          const options = optionsFor(key);
          return (
            <label key={key} className="field">
              <span>{FIELD_LABEL[key] ?? key}</span>
              {options.length === 0 ? (
                <input
                  value={values[key] ?? ""}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                  disabled={busy || staged !== null}
                />
              ) : (
                <select
                  value={values[key] ?? ""}
                  onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                  disabled={busy || staged !== null}
                >
                  <option value="">choose…</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} ({option.id})
                    </option>
                  ))}
                </select>
              )}
            </label>
          );
        })}

        <div className="build__links">
          <button
            className="btn btn--primary btn--small"
            disabled={busy || !ready || staged !== null}
            onClick={() =>
              void act(async () => {
                const found = await analyseRefactor(repo, request);
                setAnalysis(found);
                setPlan(await planRefactor(repo, request, found));
                setNote(null);
              })
            }
          >
            Analyse
          </button>
          <button
            className="btn btn--small"
            disabled={busy || analysis === null || staged !== null}
            onClick={() =>
              void act(async () => {
                const planner = await createRefactorPlanner(repo, secrets);
                const enriched = await planner.enrich(
                  analysis as RefactorAnalysis,
                  plan as RefactorPlan,
                );
                setPlan(enriched);
                setNote(
                  enriched.rejectedRewrites.length === 0
                    ? "The model added its reading of the consequences."
                    : `${String(enriched.rejectedRewrites.length)} model rewrite(s) rejected: ${enriched.rejectedRewrites
                        .map((r) => r.problem)
                        .join(" ")}`,
                );
              })
            }
          >
            Ask the model to add consequences
          </button>
        </div>
      </section>

      {analysis !== null && staged === null && (
        <>
          <section className="state__section">
            <h3>Blast radius</h3>
            <p className="ctx__why">{analysis.summary}</p>
            {onVisualiseImpact !== undefined && analysis.targets[0] !== undefined && (
              <button
                className="btn btn--small"
                onClick={() => onVisualiseImpact(analysis.targets[0] as string)}
              >
                Visualise impact on the Story Map
              </button>
            )}
            <ul className="state__knowledge">
              {Object.entries(analysis.counts)
                .filter(([, count]) => count > 0)
                .sort()
                .map(([entityKind, count]) => (
                  <li key={entityKind}>
                    {entityKind.replace(/_/g, " ")}: <strong>{count}</strong>
                  </li>
                ))}
            </ul>
            <ul className="build__list">
              {analysis.affected.map((entry) => (
                <li key={entry.id} className="build__item">
                  <div className="build__head">
                    <span className="build__severity build__severity--info">
                      {entry.direct ? "direct" : "indirect"}
                    </span>
                    <strong>{entry.name}</strong>
                    <span className="ctx__id">{entry.id}</span>
                  </div>
                  <div className="ctx__why">{entry.why}</div>
                  <div className="build__links">
                    <button className="btn btn--small" onClick={() => onSelectEntity(entry.id)}>
                      Inspect
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="state__section">
            <h3>Affected manuscript</h3>
            {analysis.manuscriptReferences.length === 0 ? (
              <p className="hint">No prose mentions the words involved.</p>
            ) : (
              <ul className="state__knowledge">
                {analysis.manuscriptReferences.map((reference, i) => (
                  <li key={i}>
                    {reference.path} — &ldquo;{reference.term}&rdquo; ×{reference.occurrences}
                    <div className="ctx__why">{reference.excerpt}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="state__section">
            <h3>Risks</h3>
            {analysis.risks.length === 0 ? (
              <p className="hint">Nothing the structured systems flag.</p>
            ) : (
              <ul className="build__list">
                {analysis.risks.map((risk, i) => (
                  <li
                    key={i}
                    className={`build__item ctx--${risk.level === "high" ? "error" : "warning"}`}
                  >
                    <div className="build__head">
                      <span
                        className={`badge ${risk.source === "structured" ? "debug__badge--fact" : "debug__badge--judgement"}`}
                      >
                        {risk.source === "structured" ? "recorded" : "model judgement"}
                      </span>
                      <span className="build__severity build__severity--warning">{risk.level}</span>
                    </div>
                    <div className="build__message">{risk.summary}</div>
                    <div className="ctx__why">{risk.detail}</div>
                  </li>
                ))}
              </ul>
            )}
            {(plan?.consequences ?? []).length > 0 && (
              <>
                <h3>
                  Consequences{" "}
                  <span className="badge debug__badge--judgement">model judgement</span>
                </h3>
                <ul className="state__knowledge">
                  {(plan?.consequences ?? []).map((claim, i) => (
                    <li
                      key={i}
                      className={claim.grounded ? undefined : "agent__finding--unverified"}
                    >
                      {claim.statement}
                      {claim.basis.length > 0 && (
                        <span className="agent__sources">{claim.basis.join(" · ")}</span>
                      )}
                      {!claim.grounded && (
                        <span className="agent__unverified">
                          {claim.unsupported.length > 0
                            ? `Unsupported — ${claim.unsupported.join(", ")} is not among the entities this change reaches.`
                            : "Unsupported — no affected entity was cited."}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {(plan?.modelNotes ?? []).length > 0 && (
              <ul className="state__knowledge">
                {(plan?.modelNotes ?? []).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="state__section">
            <h3>Proposed changes</h3>
            <ul className="state__knowledge">
              {(plan?.steps ?? []).map((step, i) => (
                <li key={i} className={step.kind === "manual" ? "ctx--warning" : ""}>
                  <strong>{step.kind.replace(/_/g, " ")}</strong>{" "}
                  {step.kind === "update_entity"
                    ? `${label(step.entityId)} (${step.entityId})`
                    : step.kind === "replace_text"
                      ? `${step.path}: "${step.find}" → "${step.replace}" ×${step.occurrences.length}`
                      : step.kind === "rewrite_passage"
                        ? `${step.path}: "${step.excerpt}"`
                        : step.kind === "move_scene"
                          ? `${label(step.sceneId)} → ${label(step.toChapterId)}`
                          : step.description}
                  <div className="ctx__why">{step.reason}</div>
                </li>
              ))}
            </ul>

            <button
              className="btn btn--primary btn--small"
              disabled={busy || plan === null}
              onClick={() =>
                void act(async () => {
                  const result = await stageRefactor(
                    request,
                    { repo, grant: STORY_REFACTOR_GRANT },
                    plan ?? undefined,
                  );
                  setStaged(result);
                  setRun(result.run);
                  onChanged();
                })
              }
            >
              Stage refactor
            </button>
            <p className="hint">
              Staging takes a checkpoint, prepares the edits and runs the compiler and your story
              tests against the result. Nothing is applied.
            </p>
          </section>
        </>
      )}

      {run !== null && (
        <>
          <section className="state__section">
            <h3>
              Validation{" "}
              <span
                className={`build__verdict build__verdict--${failedValidation(run) ? "failed" : "passed"}`}
              >
                {run.introduced.filter((d) => d.severity === "error").length} new error(s)
              </span>
            </h3>
            <p className="ctx__why">
              Story tests: {run.after?.testsPassed} / {run.after?.testsTotal} passed (was{" "}
              {run.before?.testsPassed} / {run.before?.testsTotal})
            </p>
            {run.introduced.length === 0 ? (
              <p className="status status--ok">The change introduces no new diagnostics.</p>
            ) : (
              <ul className="build__list">
                {run.introduced.map((diagnostic) => (
                  <li key={diagnostic.id} className={`build__item ctx--${diagnostic.severity}`}>
                    <div className="build__head">
                      <span className={`build__severity build__severity--${diagnostic.severity}`}>
                        {diagnostic.severity}
                      </span>
                      <span className="ctx__id">{diagnostic.ruleId}</span>
                    </div>
                    <div className="build__message">{diagnostic.message}</div>
                    <div className="ctx__why">{diagnostic.evidence}</div>
                  </li>
                ))}
              </ul>
            )}
            {(run.after?.failedTestIds ?? [])
              .filter((id) => !(run.before?.failedTestIds ?? []).includes(id))
              .map((id) => (
                <p key={id} className="status status--error">
                  {id}: newly failing.
                </p>
              ))}
          </section>

          <section className="state__section">
            <h3>Diffs ({run.stagedFiles.length} file(s))</h3>
            {run.stagedFiles.map((change) => (
              <details key={change.path} className="refactor__diff">
                <summary>{change.path}</summary>
                <pre className="diff">
                  {computeLineDiff(change.before ?? "", change.after ?? "")
                    .filter((line) => line.op !== "context")
                    .map(
                      (line, i) =>
                        `${line.op === "add" ? "+" : "-"} ${line.text}${i === 0 ? "" : ""}\n`,
                    )}
                </pre>
              </details>
            ))}
          </section>

          <section className="state__section">
            <div className="build__links">
              <button
                className="btn btn--primary btn--small"
                disabled={busy || staged === null}
                onClick={() =>
                  void act(async () => {
                    const committed = await (staged as StagedRefactor).commit();
                    setRun(committed);
                    setStaged(null);
                    setNote(`Applied as ${committed.changeSetId ?? "one change set"}.`);
                    await load();
                    onChanged();
                  })
                }
              >
                {failedValidation(run) ? "Accept anyway" : "Accept"}
              </button>
              <button
                className="btn btn--small"
                disabled={busy || staged === null}
                onClick={() =>
                  void act(async () => {
                    await (staged as StagedRefactor).discard();
                    reset();
                    setNote("Discarded. Nothing was applied.");
                    await load();
                  })
                }
              >
                Discard
              </button>
            </div>
            {run.checkpointId !== undefined && (
              <p className="hint">
                A checkpoint was taken before staging ({run.checkpointId}), and the change is one
                revertible change set once applied.
              </p>
            )}
          </section>
        </>
      )}

      {history.length > 0 && (
        <section className="state__section">
          <h3>Past refactors</h3>
          <ul className="state__knowledge">
            {history.map((entry) => (
              <li key={entry.id}>
                <span className="ctx__id">{entry.id}</span> {entry.instruction}
                <span className="ctx__id"> — {entry.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
