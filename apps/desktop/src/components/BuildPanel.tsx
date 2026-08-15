import { useCallback, useEffect, useState } from "react";
import type { Chapter } from "@jellytind/domain";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  SEMANTIC_CATEGORY_LABELS,
  SEMANTIC_RULES,
  debugQuestionFor,
  runSemanticBuild,
  runSemanticStoryTests,
} from "@jellytind/story-compiler";
import type {
  BuildComparison,
  BuildSummary,
  Diagnostic,
  RuleOutcome,
  SemanticBuild,
  SemanticDepth,
  SemanticFinding,
  StoryBuild,
} from "@jellytind/story-compiler";
import { explainEditError } from "../lib/editing";
import { createRoutedModel } from "../lib/routing";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  refreshToken: number;
  onChanged: () => void;
  /** Open the entity a diagnostic points at. */
  onSelectEntity: (id: string) => void;
  /** Open the chapter file a diagnostic's scene sits in. */
  onOpenScene: (sceneId: string) => void;
  /** Hand a semantic finding to the Story Debugger as its starting question. */
  onDebugFinding: (question: string) => void;
}

/**
 * The Story Build.
 *
 * The writer presses Build Story and gets real continuity diagnostics from
 * structured state — not a model's reading of the prose. Every finding names
 * what it is about and why, and clicking one goes there, because a diagnostic
 * you cannot act on is a diagnostic you learn to ignore
 * (docs/STORY_COMPILER.md).
 */
export function BuildPanel({
  repo,
  secrets,
  refreshToken,
  onChanged,
  onSelectEntity,
  onOpenScene,
  onDebugFinding,
}: Props) {
  const [build, setBuild] = useState<StoryBuild | null>(null);
  const [comparison, setComparison] = useState<BuildComparison | null>(null);
  const [history, setHistory] = useState<BuildSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dormantAfter, setDormantAfter] = useState("");
  const [showPassing, setShowPassing] = useState(true);
  const [semantic, setSemantic] = useState<SemanticBuild | null>(null);
  const [semBusy, setSemBusy] = useState(false);
  const [semError, setSemError] = useState<string | null>(null);
  const [semScope, setSemScope] = useState("book");
  const [chapters, setChapters] = useState<readonly Chapter[]>([]);
  const [disabledRules, setDisabledRules] = useState<readonly string[]>([]);
  const [showRules, setShowRules] = useState(false);

  const load = useCallback(async () => {
    const [latest, builds, lastSemantic, disabled, chapterList] = await Promise.all([
      repo.getLatestBuild(),
      repo.listBuilds(20),
      repo.semantic.lastBuild(),
      repo.semantic.disabledRules(),
      repo.listChapters(),
    ]);
    setBuild(latest);
    setHistory(builds);
    setSemantic(lastSemantic);
    setDisabledRules(disabled);
    setChapters([...chapterList].sort((a, b) => a.order - b.order));
    setComparison(latest === null ? null : await repo.compareToPreviousBuild(latest.id));
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const threshold = Number.parseInt(dormantAfter, 10);
      const result = await repo.buildStory(
        Number.isFinite(threshold) && threshold > 0
          ? { config: { options: { dormantAfterScenes: threshold } } }
          : {},
      );
      setBuild(result);
      setComparison(await repo.compareToPreviousBuild(result.id));
      setHistory(await repo.listBuilds(20));
      onChanged();
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The semantic run (§11–§12): Quick is the model-free heuristics; Full adds
   * the model judgements through the Model Router. Both respect the scope, the
   * disabled rules, the cache and the writer's lifecycle words.
   */
  async function runSemantic(depth: SemanticDepth): Promise<void> {
    setSemBusy(true);
    setSemError(null);
    try {
      const context = await repo.semanticContext();
      const routed =
        depth === "full"
          ? await createRoutedModel(repo, secrets, "semantic_analysis").catch(() => undefined)
          : undefined;
      if (depth === "full" && routed === undefined) {
        setSemError("A full analysis needs a model. Add one in Settings → AI Providers.");
        return;
      }
      const statuses = await repo.semantic.statuses();
      const result = await runSemanticBuild({
        rules: SEMANTIC_RULES,
        context,
        scope: semScope === "book" ? { kind: "book" } : { kind: "chapter", chapterId: semScope },
        depth,
        ...(routed !== undefined ? { model: routed.model } : {}),
        config: { disabledRules },
        ports: {
          statuses,
          cache: {
            get: (key) => repo.semantic.cacheGet(key),
            set: (key, entry) => repo.semantic.cacheSet(key, entry),
          },
        },
      });
      const tests =
        depth === "full" && routed !== undefined
          ? await runSemanticStoryTests({
              tests: await repo.listStoryTests(),
              context,
              model: routed.model,
            })
          : undefined;
      const finished = tests !== undefined ? { ...result, tests } : result;
      await repo.semantic.saveLastBuild(finished);
      await repo.semantic.prune(result.resolved);
      setSemantic(finished);
    } catch (cause) {
      setSemError(explainEditError(cause));
    } finally {
      setSemBusy(false);
    }
  }

  /** §14: the writer's word on a finding. `null` reopens it. */
  async function mark(
    finding: SemanticFinding,
    status: "acknowledged" | "ignored" | null,
  ): Promise<void> {
    await repo.semantic.setStatus(
      finding.id,
      status === null ? null : { status, at: new Date().toISOString() },
    );
    setSemantic((held) =>
      held === null
        ? null
        : {
            ...held,
            findings: held.findings.map((entry) =>
              entry.id === finding.id ? { ...entry, status: status ?? "open" } : entry,
            ),
          },
    );
  }

  async function toggleRule(ruleId: string): Promise<void> {
    const next = disabledRules.includes(ruleId)
      ? disabledRules.filter((id) => id !== ruleId)
      : [...disabledRules, ruleId];
    setDisabledRules(next);
    await repo.semantic.setDisabledRules(next);
  }

  const isNew = (id: string): boolean =>
    comparison !== null && comparison.added.some((d) => d.id === id);

  const passed = (build?.rules ?? []).filter((r) => r.status === "passed");
  const skipped = (build?.rules ?? []).filter((r) => r.status === "skipped");

  return (
    <div className="state">
      <div className="state__controls">
        <button className="btn btn--primary" disabled={busy} onClick={() => void run()}>
          {busy ? "Building…" : "Build Story"}
        </button>
        <label className="field">
          <span>Report threads quiet for at least (scenes)</span>
          <input
            value={dormantAfter}
            placeholder="off — you choose what counts as long"
            onChange={(e) => setDormantAfter(e.target.value.replace(/\D/g, ""))}
            disabled={busy}
          />
        </label>
      </div>

      {error !== null && <p className="status status--error">{error}</p>}

      {build === null ? (
        <p className="hint">
          No build yet. Building runs deterministic continuity checks over the project&rsquo;s
          structured state; it changes nothing.
        </p>
      ) : (
        <>
          <section className="state__section">
            <h3>
              Story build {build.number}
              <span
                className={`build__verdict severity severity--${
                  build.status === "failed"
                    ? "error"
                    : build.status === "passed_with_warnings"
                      ? "warning"
                      : "passed"
                } build__verdict--${build.status}`}
              >
                {build.status === "failed"
                  ? `${String(build.counts.error)} error(s)`
                  : build.status === "passed_with_warnings"
                    ? `${String(build.counts.warning)} warning(s)`
                    : "clean"}
              </span>
            </h3>
            <p className="ctx__why">
              {build.counts.error} error(s), {build.counts.warning} warning(s), {build.counts.info}{" "}
              note(s) · {build.durationMs}ms
              {comparison !== null && comparison.previousBuildId !== undefined && (
                <>
                  {" "}
                  · {comparison.added.length} new, {comparison.resolved.length} resolved,{" "}
                  {comparison.persistent.length} still open
                </>
              )}
            </p>
          </section>

          <section className="state__section">
            <h3>
              Deterministic story tests
              <span
                className={`build__verdict severity severity--${
                  build.tests.deterministic.failed > 0 ? "error" : "passed"
                } build__verdict--${build.tests.deterministic.failed > 0 ? "failed" : "passed"}`}
              >
                {build.tests.deterministic.passed} / {build.tests.deterministic.total} passed
              </span>
            </h3>
            {build.tests.results.length === 0 ? (
              <p className="hint">
                No story tests. A story test records an intention — what must be true, and when — so
                a later revision cannot quietly break it.
              </p>
            ) : (
              <ul className="state__knowledge">
                {build.tests.results
                  .filter((result) => result.status === "failed" || result.status === "errored")
                  .map((result) => (
                    <li key={result.testId} className="ctx--error">
                      {result.name} — {result.statement}
                      {result.failures[0] !== undefined && (
                        <span className="ctx__why"> {result.failures[0].actual}</span>
                      )}
                    </li>
                  ))}
              </ul>
            )}
            {build.tests.semantic.total > 0 && (
              <p className="hint">
                {build.tests.semantic.total} semantic test(s) recorded, not evaluated. They need a
                model&rsquo;s reading, which the build does not do — an unanswered question is not a
                passing one.
              </p>
            )}
            {build.tests.skipped > 0 && (
              <p className="hint">{build.tests.skipped} test(s) disabled and not run.</p>
            )}
          </section>

          {showPassing && passed.length > 0 && (
            <section className="state__section">
              <h3>Passed</h3>
              <ul className="build__passed">
                {passed.map((rule: RuleOutcome) => (
                  <li key={rule.ruleId}>
                    <span className="build__tick">✓</span> {rule.name}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {skipped.length > 0 && (
            <section className="state__section">
              <h3>Not checked</h3>
              <ul className="state__knowledge">
                {skipped.map((rule) => (
                  <li key={rule.ruleId}>
                    {rule.name} — {rule.reason}
                  </li>
                ))}
              </ul>
              <p className="hint">
                A skipped check is not a passed one. Nothing above was looked for.
              </p>
            </section>
          )}

          {comparison !== null && comparison.resolved.length > 0 && (
            <section className="state__section">
              <h3>Resolved since the last build</h3>
              <ul className="state__knowledge">
                {comparison.resolved.map((diagnostic) => (
                  <li key={diagnostic.id} className="build__resolved">
                    {diagnostic.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="state__section">
            <h3>Findings</h3>
            {build.diagnostics.length === 0 ? (
              <p className="status status--ok">Nothing to report.</p>
            ) : (
              <ul className="build__list">
                {build.diagnostics.map((diagnostic) => (
                  <DiagnosticRow
                    key={diagnostic.id}
                    diagnostic={diagnostic}
                    isNew={isNew(diagnostic.id)}
                    onSelectEntity={onSelectEntity}
                    onOpenScene={onOpenScene}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="state__section">
            <h3>History</h3>
            <ul className="state__knowledge">
              {history.map((summary) => (
                <li key={summary.id}>
                  <button
                    className="btn btn--small"
                    onClick={() =>
                      void repo.getBuild(summary.id).then(async (stored) => {
                        if (stored === null) return;
                        setBuild(stored);
                        setComparison(await repo.compareToPreviousBuild(stored.id));
                      })
                    }
                  >
                    Build {summary.number}
                  </button>{" "}
                  <span className={`ctx--${summary.status === "failed" ? "error" : "warning"}`}>
                    {summary.counts.error} error(s), {summary.counts.warning} warning(s)
                  </span>
                  <span className="ctx__id">
                    {" "}
                    {summary.finishedAt.slice(0, 16).replace("T", " ")}
                  </span>
                </li>
              ))}
            </ul>
            <label className="field">
              <span>
                <input
                  type="checkbox"
                  checked={showPassing}
                  onChange={(e) => setShowPassing(e.target.checked)}
                />{" "}
                Show passing checks
              </span>
            </label>
          </section>
        </>
      )}

      {/* §1, §15: the semantic layer, visually and conceptually apart. Nothing
          here is an error; everything is judgement, and looks softer. */}
      <section className="state__section sem">
        <h3 className="sem__title">Semantic — judgement, not errors</h3>
        <p className="hint">
          Heuristics and model readings of the prose itself: pacing, tension, voice, purpose. These
          can be wrong, and none of them fails a build.
        </p>
        <div className="sem__controls">
          <select
            aria-label="Semantic scope"
            value={semScope}
            onChange={(event) => setSemScope(event.target.value)}
            disabled={semBusy}
          >
            <option value="book">Whole book</option>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id as string}>
                {chapter.title}
              </option>
            ))}
          </select>
          <button
            className="btn btn--small"
            disabled={semBusy}
            onClick={() => void runSemantic("quick")}
          >
            {semBusy ? "Working…" : "Quick check"}
          </button>
          <button
            className="btn btn--small"
            disabled={semBusy}
            onClick={() => void runSemantic("full")}
          >
            {semBusy ? "Working…" : "Full analysis"}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => setShowRules((held) => !held)}
          >
            Rules…
          </button>
        </div>
        <p className="hint">
          Quick runs the model-free heuristics only. Full adds model judgements, routed and counted
          like any other AI work.
        </p>
        {semError !== null && <p className="status status--error">{semError}</p>}

        {showRules && (
          <ul className="sem__rules">
            {SEMANTIC_RULES.map((rule) => (
              <li key={rule.id}>
                <label className="sem__rule">
                  <input
                    type="checkbox"
                    checked={!disabledRules.includes(rule.id)}
                    onChange={() => void toggleRule(rule.id)}
                  />
                  <span>
                    <strong>{rule.name}</strong>{" "}
                    <span className="hint">
                      {SEMANTIC_CATEGORY_LABELS[rule.category]} ·{" "}
                      {rule.requiresModel ? "model judgement" : "heuristic"} — {rule.description}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {semantic !== null && (
          <SemanticResults
            semantic={semantic}
            onOpenScene={onOpenScene}
            onSelectEntity={onSelectEntity}
            onDebug={(finding) => onDebugFinding(debugQuestionFor(finding))}
            onMark={(finding, status) => void mark(finding, status)}
          />
        )}
      </section>
    </div>
  );
}

function SemanticResults({
  semantic,
  onOpenScene,
  onSelectEntity,
  onDebug,
  onMark,
}: {
  semantic: SemanticBuild;
  onOpenScene: (sceneId: string) => void;
  onSelectEntity: (id: string) => void;
  onDebug: (finding: SemanticFinding) => void;
  onMark: (finding: SemanticFinding, status: "acknowledged" | "ignored" | null) => void;
}) {
  const open = semantic.findings.filter((finding) => finding.status === "open");
  const settled = semantic.findings.filter((finding) => finding.status !== "open");
  const counts = new Map<string, number>();
  for (const finding of open) {
    counts.set(finding.category, (counts.get(finding.category) ?? 0) + 1);
  }
  const skippedModel = semantic.rules.filter(
    (rule) => rule.status === "skipped" && rule.reason?.includes("model") === true,
  ).length;

  return (
    <>
      <p className="sem__summary">
        {open.length === 0
          ? "No open findings."
          : [...counts.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(
                ([category, count]) =>
                  `${SEMANTIC_CATEGORY_LABELS[category as SemanticFinding["category"]]} ${String(count)}`,
              )
              .join(" · ")}
        <span className="ctx__id">
          {" "}
          · {semantic.depth === "quick" ? "quick check" : "full analysis"} ·{" "}
          {semantic.at.slice(0, 16).replace("T", " ")}
          {skippedModel > 0 ? ` · ${String(skippedModel)} model rule(s) not run` : ""}
        </span>
      </p>

      {open.length > 0 && (
        <ul className="sem__list">
          {open.map((finding) => (
            <li key={finding.id} className="sem__item">
              <div className="sem__head">
                <span className="sem__kind">
                  {finding.kind === "model_judgement" ? "model judgement" : "heuristic"}
                </span>
                <span className="sem__cat">{SEMANTIC_CATEGORY_LABELS[finding.category]}</span>
                <span className={`sem__confidence sem__confidence--${finding.confidence}`}>
                  confidence {finding.confidence}
                </span>
              </div>
              <div className="sem__message">{finding.message}</div>
              {finding.detail !== undefined && <div className="hint">{finding.detail}</div>}
              <ul className="sem__evidence">
                {finding.evidence.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
              <div className="build__links">
                {finding.evidence.sceneIds.map((sceneId) => (
                  <button
                    key={sceneId}
                    className="btn btn--small"
                    onClick={() => onOpenScene(sceneId)}
                  >
                    {sceneId}
                  </button>
                ))}
                {finding.evidence.entities.map((id) => (
                  <button key={id} className="btn btn--small" onClick={() => onSelectEntity(id)}>
                    {id}
                  </button>
                ))}
              </div>
              {finding.suggestedAction !== undefined && (
                <div className="build__action">{finding.suggestedAction}</div>
              )}
              <div className="sem__verbs">
                <button className="btn btn--ghost btn--small" onClick={() => onDebug(finding)}>
                  Debug
                </button>
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => onMark(finding, "acknowledged")}
                >
                  This is intentional
                </button>
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => onMark(finding, "ignored")}
                >
                  Ignore
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {settled.length > 0 && (
        <details className="sem__settled">
          <summary>
            {settled.length} finding(s) you have acknowledged or ignored — kept quiet, not repeated
          </summary>
          <ul className="sem__list">
            {settled.map((finding) => (
              <li key={finding.id} className="sem__item sem__item--settled">
                <span className="sem__kind">{finding.status}</span> {finding.message}
                <button className="btn btn--ghost btn--small" onClick={() => onMark(finding, null)}>
                  Reopen
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {semantic.tests !== undefined && (
        <div className="sem__tests">
          <h4 className="sem__title">Semantic story tests</h4>
          <p className="ctx__why">
            {semantic.tests.pass} pass · {semantic.tests.concern} concern ·{" "}
            {semantic.tests.inconclusive} inconclusive
          </p>
          <ul className="sem__list">
            {semantic.tests.results.map((result) => (
              <li key={result.testId} className="sem__item">
                <div className="sem__head">
                  <span className={`sem__verdict sem__verdict--${result.verdict}`}>
                    {result.verdict}
                  </span>
                  <span className={`sem__confidence sem__confidence--${result.uncertainty}`}>
                    uncertainty {result.uncertainty}
                  </span>
                </div>
                <div className="sem__message">{result.statement}</div>
                <div className="hint">{result.judgement}</div>
                <div className="ctx__id">
                  {result.contextSummary}
                  {result.modelId !== undefined ? ` · ${result.modelId}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="hint">
        A semantic finding is a reading, not a fact. Debug hands it to the Story Debugger; changes
        go through the ordinary revision tools — nothing is rewritten from here.
      </p>
    </>
  );
}

function DiagnosticRow({
  diagnostic,
  isNew,
  onSelectEntity,
  onOpenScene,
}: {
  diagnostic: Diagnostic;
  isNew: boolean;
  onSelectEntity: (id: string) => void;
  onOpenScene: (sceneId: string) => void;
}) {
  return (
    <li className={`build__item ctx--${diagnostic.severity}`}>
      <div className="build__head">
        {/* The glyph and the word carry the severity; the colour only
            reinforces it (docs/BRAND.md). */}
        <span
          className={`build__severity severity severity--${diagnostic.severity} build__severity--${diagnostic.severity}`}
        >
          {diagnostic.severity}
        </span>
        {isNew && <span className="badge">new</span>}
        <span className="ctx__id">{diagnostic.ruleId}</span>
      </div>
      <div className="build__message">{diagnostic.message}</div>
      <div className="ctx__why">{diagnostic.evidence}</div>
      {diagnostic.suggestedAction !== undefined && (
        <div className="build__action">{diagnostic.suggestedAction}</div>
      )}
      <div className="build__links">
        {diagnostic.sceneId !== undefined && (
          <button
            className="btn btn--small"
            onClick={() => onOpenScene(diagnostic.sceneId as string)}
          >
            {diagnostic.sceneId}
          </button>
        )}
        {diagnostic.entities.map((id) => (
          <button key={id} className="btn btn--small" onClick={() => onSelectEntity(id)}>
            {id}
          </button>
        ))}
      </div>
    </li>
  );
}
