import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Assertion,
  Chapter,
  PlotThreadStatus,
  Scene,
  StoryTest,
  TestScope,
  TestSeverity,
} from "@jellytind/domain";
import {
  describeTest,
  DETERMINISTIC_ASSERTION_KINDS,
  PLOT_THREAD_STATUSES,
  SEMANTIC_ASSERTION_KINDS,
  SCOPE_KINDS,
  TEST_SEVERITIES,
} from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import type { TestResult, TestRunSummary } from "@jellytind/story-compiler";
import { explainEditError } from "../lib/editing";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
  onOpenScene: (sceneId: string) => void;
}

/** Which entity pickers an assertion needs, in the order it needs them. */
const FIELDS: Readonly<Record<string, readonly string[]>> = {
  character_knows_fact: ["characterId", "factId"],
  character_does_not_know_fact: ["characterId", "factId"],
  character_alive: ["characterId"],
  character_dead: ["characterId"],
  character_at_location: ["characterId", "locationId"],
  object_at_location: ["objectId", "locationId"],
  object_owned_by: ["objectId", "characterId"],
  plot_thread_status: ["threadId", "status"],
  fact_true: ["factId"],
  relationship_status: ["relationshipId", "status"],
  reader_suspicion: ["characterId", "comparison", "level"],
  relationship_progression: ["relationshipId", "expected"],
  character_disposition: ["characterId", "expected"],
  free_form: ["statement"],
};

const FIELD_LABEL: Readonly<Record<string, string>> = {
  characterId: "Character",
  factId: "Fact",
  locationId: "Location",
  objectId: "Object",
  threadId: "Plot thread",
  relationshipId: "Relationship",
  status: "Status",
  comparison: "Comparison",
  level: "Level",
  expected: "Expected",
  statement: "Statement",
};

const STATUS_TONE: Readonly<Record<string, string>> = {
  passed: "ok",
  failed: "error",
  errored: "warning",
  skipped: "warning",
  not_evaluated: "warning",
};

/**
 * Story tests: a writer's intentions, held to.
 *
 * The builder is structured because nobody should have to write code to say
 * *Elias must not know the killer's identity before chapter 37* — and because a
 * form can only produce assertions the engine can actually decide. The sentence
 * under the form is the test read back in plain words, so what you built is
 * legible before you save it (docs/STORY_TESTS.md).
 */
export function StoryTestPanel({
  repo,
  refreshToken,
  onChanged,
  onSelectEntity,
  onOpenScene,
}: Props) {
  const [tests, setTests] = useState<StoryTest[]>([]);
  const [run, setRun] = useState<TestRunSummary | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<{
    name: string;
    kind: string;
    values: Record<string, string>;
    scopeKind: TestScope["kind"];
    anchorId: string;
    untilId: string;
    severity: TestSeverity;
  }>({
    name: "",
    kind: "character_does_not_know_fact",
    values: {},
    scopeKind: "always",
    anchorId: "",
    untilId: "",
    severity: "error",
  });

  const label = useCallback((id: string) => names.get(id) ?? id, [names]);

  const load = useCallback(async () => {
    const [allTests, summaries, allScenes, allChapters, result] = await Promise.all([
      repo.listStoryTests(),
      repo.listEntitySummaries(),
      repo.listScenes(),
      repo.listChapters(),
      repo.runStoryTests(),
    ]);
    setTests(allTests);
    setNames(new Map(summaries.map((s) => [s.id, s.name])));
    setScenes(allScenes);
    setChapters(allChapters);
    setRun(result);
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  /** Candidates for one field of the assertion being built. */
  const optionsFor = useCallback(
    (field: string): Array<{ id: string; name: string }> => {
      const of = (prefix: string) =>
        [...names.entries()]
          .filter(([id]) => id.startsWith(prefix))
          .map(([id, name]) => ({ id, name }));
      switch (field) {
        case "characterId":
          return of("CHAR_");
        case "factId":
          return of("FACT_");
        case "locationId":
          return of("LOC_");
        case "objectId":
          return of("OBJECT_");
        case "threadId":
          return of("THREAD_");
        case "relationshipId":
          return of("REL_");
        case "status":
          return draft.kind === "plot_thread_status"
            ? PLOT_THREAD_STATUSES.map((s: PlotThreadStatus) => ({ id: s, name: s }))
            : [];
        case "comparison":
          return [
            { id: "below", name: "below" },
            { id: "above", name: "above" },
          ];
        default:
          return [];
      }
    },
    [names, draft.kind],
  );

  const assertion = useMemo(
    () => ({ kind: draft.kind, ...draft.values }) as unknown as Assertion,
    [draft.kind, draft.values],
  );

  const scope = useMemo<TestScope>(() => {
    if (draft.scopeKind === "always") return { kind: "always" };
    if (draft.scopeKind === "between") {
      return {
        kind: "between",
        anchorId: draft.anchorId as never,
        untilId: draft.untilId as never,
      };
    }
    return { kind: draft.scopeKind, anchorId: draft.anchorId as never };
  }, [draft.scopeKind, draft.anchorId, draft.untilId]);

  const required = FIELDS[draft.kind] ?? [];
  const complete =
    draft.name.trim() !== "" &&
    required.every((field) => (draft.values[field] ?? "").trim() !== "") &&
    (draft.scopeKind === "always" ||
      (draft.anchorId !== "" && (draft.scopeKind !== "between" || draft.untilId !== "")));

  const preview = complete ? describeTest({ assertion, scope }, label) : null;

  async function act(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
      onChanged();
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  const resultFor = (id: string): TestResult | undefined =>
    run?.results.find((r) => r.testId === id);

  const anchorOptions = [
    ...chapters.map((c) => ({ id: c.id as string, name: `${c.title} (chapter)` })),
    ...scenes.map((s) => ({ id: s.id as string, name: `${s.title} (scene)` })),
  ];

  return (
    <div className="state">
      {run !== null && (
        <div className="state__card">
          <strong>Deterministic story tests</strong>{" "}
          <span className={run.deterministic.failed > 0 ? "ctx--error" : "status status--ok"}>
            {run.deterministic.passed} / {run.deterministic.total} passed
          </span>
          {run.semantic.total > 0 && (
            <div className="ctx__why">
              {run.semantic.total} semantic test(s) — not evaluated. Model judgement is not yet
              implemented, and an unanswered question is not a passing one.
            </div>
          )}
          {run.skipped > 0 && <div className="ctx__why">{run.skipped} disabled.</div>}
        </div>
      )}

      {error !== null && <p className="status status--error">{error}</p>}

      <section className="state__section">
        <h3>Tests</h3>
        {tests.length === 0 ? (
          <p className="hint">
            No tests yet. A story test records an intention — what must be true, and when — so a
            later revision cannot quietly break it.
          </p>
        ) : (
          <ul className="build__list">
            {tests.map((test) => {
              const result = resultFor(test.id as string);
              return (
                <li
                  key={test.id}
                  className={`build__item ctx--${STATUS_TONE[result?.status ?? "skipped"] ?? "warning"}`}
                >
                  <div className="build__head">
                    <span
                      className={`build__severity build__severity--${result?.status === "failed" ? "error" : "info"}`}
                    >
                      {result?.status ?? "unrun"}
                    </span>
                    <strong>{test.name}</strong>
                    {test.type === "semantic" && <span className="badge">semantic</span>}
                    <span className="ctx__id">{test.id}</span>
                  </div>
                  <div className="ctx__why">{describeTest(test, label)}</div>
                  {result?.reason !== undefined && <div className="ctx__why">{result.reason}</div>}

                  {(result?.failures ?? []).map((failure, i) => (
                    <div key={i} className="test__failure">
                      <div>
                        expected <strong>{failure.expected}</strong>
                      </div>
                      <div>
                        actual <strong>{failure.actual}</strong>
                      </div>
                      <div className="ctx__why">{failure.evidence}</div>
                      <div className="build__links">
                        <button
                          className="btn btn--small"
                          onClick={() => onOpenScene(failure.sceneId)}
                        >
                          {failure.sceneId}
                        </button>
                        {failure.entities.map((id) => (
                          <button
                            key={id}
                            className="btn btn--small"
                            onClick={() => onSelectEntity(id)}
                          >
                            {label(id)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div className="build__links">
                    <button
                      className="btn btn--small"
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          repo
                            .setStoryTestEnabled(test.id as string, !test.enabled)
                            .then(() => undefined),
                        )
                      }
                    >
                      {test.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      className="btn btn--small"
                      disabled={busy}
                      onClick={() => void act(() => repo.deleteStoryTest(test.id as string))}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="state__section">
        <h3>New test</h3>
        <label className="field">
          <span>Name</span>
          <input
            value={draft.name}
            placeholder="Elias must not know the killer's identity"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            disabled={busy}
          />
        </label>

        <label className="field">
          <span>Expect</span>
          <select
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value, values: {} })}
            disabled={busy}
          >
            <optgroup label="Deterministic">
              {DETERMINISTIC_ASSERTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replace(/_/g, " ")}
                </option>
              ))}
            </optgroup>
            <optgroup label="Semantic — recorded, not yet evaluated">
              {SEMANTIC_ASSERTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replace(/_/g, " ")}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        {required.map((field) => {
          const options = optionsFor(field);
          return (
            <label key={field} className="field">
              <span>{FIELD_LABEL[field] ?? field}</span>
              {options.length === 0 ? (
                <input
                  value={draft.values[field] ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, values: { ...draft.values, [field]: e.target.value } })
                  }
                  disabled={busy}
                />
              ) : (
                <select
                  value={draft.values[field] ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, values: { ...draft.values, [field]: e.target.value } })
                  }
                  disabled={busy}
                >
                  <option value="">choose…</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              )}
            </label>
          );
        })}

        <label className="field">
          <span>When</span>
          <select
            value={draft.scopeKind}
            onChange={(e) => setDraft({ ...draft, scopeKind: e.target.value as TestScope["kind"] })}
            disabled={busy}
          >
            {SCOPE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind === "always" ? "throughout" : kind}
              </option>
            ))}
          </select>
        </label>

        {draft.scopeKind !== "always" && (
          <label className="field">
            <span>{draft.scopeKind === "between" ? "From" : "Point"}</span>
            <select
              value={draft.anchorId}
              onChange={(e) => setDraft({ ...draft, anchorId: e.target.value })}
              disabled={busy}
            >
              <option value="">choose…</option>
              {anchorOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {draft.scopeKind === "between" && (
          <label className="field">
            <span>To</span>
            <select
              value={draft.untilId}
              onChange={(e) => setDraft({ ...draft, untilId: e.target.value })}
              disabled={busy}
            >
              <option value="">choose…</option>
              {anchorOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>If it fails</span>
          <select
            value={draft.severity}
            onChange={(e) => setDraft({ ...draft, severity: e.target.value as TestSeverity })}
            disabled={busy}
          >
            {TEST_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {severity}
              </option>
            ))}
          </select>
        </label>

        {preview !== null && (
          <p className="test__preview">
            EXPECT <strong>{preview}</strong>
          </p>
        )}

        <button
          className="btn btn--primary btn--small"
          disabled={busy || !complete}
          onClick={() =>
            void act(async () => {
              await repo.addStoryTest({
                name: draft.name.trim(),
                assertion,
                scope,
                severity: draft.severity,
              });
              setDraft({ ...draft, name: "", values: {} });
            })
          }
        >
          Add test
        </button>
      </section>
    </div>
  );
}
