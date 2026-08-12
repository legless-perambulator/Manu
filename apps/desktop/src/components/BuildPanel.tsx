import { useCallback, useEffect, useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import type {
  BuildComparison,
  BuildSummary,
  Diagnostic,
  RuleOutcome,
  StoryBuild,
} from "@jellytind/story-compiler";
import { explainEditError } from "../lib/editing";

interface Props {
  repo: StoryRepository;
  refreshToken: number;
  onChanged: () => void;
  /** Open the entity a diagnostic points at. */
  onSelectEntity: (id: string) => void;
  /** Open the chapter file a diagnostic's scene sits in. */
  onOpenScene: (sceneId: string) => void;
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
export function BuildPanel({ repo, refreshToken, onChanged, onSelectEntity, onOpenScene }: Props) {
  const [build, setBuild] = useState<StoryBuild | null>(null);
  const [comparison, setComparison] = useState<BuildComparison | null>(null);
  const [history, setHistory] = useState<BuildSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dormantAfter, setDormantAfter] = useState("");
  const [showPassing, setShowPassing] = useState(true);

  const load = useCallback(async () => {
    const [latest, builds] = await Promise.all([repo.getLatestBuild(), repo.listBuilds(20)]);
    setBuild(latest);
    setHistory(builds);
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
    </div>
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
