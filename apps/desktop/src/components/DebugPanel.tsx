import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  DEBUG_MODE_LABEL,
  DEBUG_MODES,
  type DebugMode,
  type DebugReport,
  type DebugReportSummary,
  type EvidenceItem,
} from "@jellytind/story-debugger";
import { createDiagnosisAnalyst, explainEditError } from "../lib/editing";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
  onOpenScene: (sceneId: string) => void;
  /** Hand a motivation question to the Character Simulator. */
  onSimulateBehaviour: () => void;
  /**
   * A problem handed in from outside — a semantic finding from the Story
   * Build (Phase 37 §16). Pre-fills the problem statement; the writer still
   * chooses the mode and presses run.
   */
  seedProblem?: string;
  /**
   * A `/debug …` line handed in from the terminal (Phase 39). It runs the
   * deterministic fast path — the same evidence run, with no model in it.
   */
  seedCommand?: string;
}

/** Which pickers each mode needs, and which of them it cannot work without. */
const FIELDS: Readonly<Record<DebugMode, ReadonlyArray<{ key: string; required: boolean }>>> = {
  reveal: [
    { key: "characterId", required: false },
    { key: "threadId", required: false },
    { key: "factId", required: false },
    { key: "revealSceneId", required: false },
  ],
  character_motivation: [
    { key: "characterId", required: true },
    { key: "sceneId", required: true },
  ],
  pacing: [{ key: "chapterId", required: false }],
  continuity: [{ key: "diagnosticId", required: true }],
};

const FIELD_LABEL: Readonly<Record<string, string>> = {
  characterId: "Character",
  threadId: "Plot thread",
  factId: "The proposition revealed",
  revealSceneId: "Reveal scene",
  sceneId: "Scene",
  chapterId: "Chapter (all chapters if unset)",
  diagnosticId: "Build diagnostic",
};

const PROMPT: Readonly<Record<DebugMode, string>> = {
  reveal: "Why doesn't Marcus's betrayal land?",
  character_motivation: "Mara's decision to enter the house feels forced.",
  pacing: "Chapter four drags.",
  continuity: "Where did this come from?",
};

/**
 * The Story Debugger.
 *
 * Three kinds of claim, kept visibly apart, because a writer deciding what to
 * do next needs to know which they are reading: **evidence** is what the
 * project records, **diagnosis** is a model's reading of it, and
 * **interventions** are suggestions nothing has applied (docs/STORY_DEBUGGER.md).
 *
 * The evidence half runs with no model at all, so the panel is useful before
 * one is configured — and when a model does run, its contribution is visibly an
 * addition rather than the substance.
 */
export function DebugPanel({
  repo,
  secrets,
  refreshToken,
  onChanged,
  onSelectEntity,
  onOpenScene,
  onSimulateBehaviour,
  seedProblem,
  seedCommand,
}: Props) {
  const [mode, setMode] = useState<DebugMode>("reveal");
  const [problem, setProblem] = useState("");

  // A semantic finding arriving from the Story Build becomes the problem
  // statement (Phase 37 §16). It seeds; it never runs anything by itself.
  useEffect(() => {
    if (seedProblem !== undefined && seedProblem !== "") setProblem(seedProblem);
  }, [seedProblem]);

  // A terminal `/debug …` line arrives ready to run. The evidence run is
  // deterministic and read-only, so running it on arrival is safe — the same
  // keystroke-saving the panel's own command box offers, from further away.
  const seededRun = useRef<string | null>(null);
  useEffect(() => {
    if (seedCommand === undefined || seedCommand === "" || seededRun.current === seedCommand) {
      return;
    }
    seededRun.current = seedCommand;
    setCommand(seedCommand);
    void runCommand(seedCommand);
  }, [seedCommand]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [command, setCommand] = useState("");
  const [report, setReport] = useState<DebugReport | null>(null);
  const [history, setHistory] = useState<DebugReportSummary[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [diagnostics, setDiagnostics] = useState<Array<{ id: string; message: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const label = useCallback((id: string) => names.get(id) ?? id, [names]);

  const load = useCallback(async () => {
    const [summaries, reports, build] = await Promise.all([
      repo.listEntitySummaries(),
      repo.listDebugReports(20),
      repo.getLatestBuild(),
    ]);
    setNames(new Map(summaries.map((s) => [s.id, s.name])));
    setHistory(reports);
    setDiagnostics(
      (build?.diagnostics ?? []).map((d) => ({ id: d.id, message: `${d.ruleId}: ${d.message}` })),
    );
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
        case "characterId":
          return of("CHAR_");
        case "threadId":
          return of("THREAD_");
        case "factId":
          return of("FACT_");
        case "revealSceneId":
        case "sceneId":
          return of("SCENE_");
        case "chapterId":
          return of("CHAPTER_");
        case "diagnosticId":
          return diagnostics.map((d) => ({ id: d.id, name: d.message }));
        default:
          return [];
      }
    },
    [names, diagnostics],
  );

  const fields = FIELDS[mode];
  const ready = useMemo(() => {
    if (mode === "reveal") {
      return fields.some((f) => (values[f.key] ?? "") !== "");
    }
    return fields.every((f) => !f.required || (values[f.key] ?? "") !== "");
  }, [mode, fields, values]);

  async function run(diagnose: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const request = {
        mode,
        problem: problem.trim() === "" ? PROMPT[mode] : problem.trim(),
        ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "")),
      };
      if (diagnose) {
        const analyst = await createDiagnosisAnalyst(repo, secrets);
        setReport(await analyst.debug(request));
      } else {
        const started = Date.now();
        const trace = await repo.traceStoryProblem(request);
        setReport(await repo.saveDebugReport(trace, { durationMs: Date.now() - started }));
      }
      await load();
      onChanged();
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  /** `/debug betrayal Marcus` — the fast path, with no model in it. */
  async function runCommand(line: string = command): Promise<void> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const parsed = await repo.parseDebugCommand(line);
      setMode(parsed.request.mode);
      setProblem(parsed.request.problem ?? "");
      const started = Date.now();
      const trace = await repo.traceStoryProblem(parsed.request);
      setReport(await repo.saveDebugReport(trace, { durationMs: Date.now() - started }));
      setNote(
        [
          parsed.resolved.join("; "),
          parsed.unresolved.length === 0 ? "" : `Not recognised: ${parsed.unresolved.join(", ")}.`,
        ]
          .filter((part) => part !== "")
          .join(" · "),
      );
      await load();
      onChanged();
    } catch (cause) {
      setError(explainEditError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="state">
      <div className="state__controls">
        <label className="field">
          <span>Ask</span>
          <input
            value={command}
            placeholder="/debug betrayal Marcus"
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && command.trim() !== "") void runCommand();
            }}
            disabled={busy}
          />
        </label>
        <p className="hint">
          Or build the question below. Investigating changes nothing about the story.
        </p>
      </div>

      {error !== null && <p className="status status--error">{error}</p>}
      {note !== null && <p className="hint">{note}</p>}

      <section className="state__section">
        <h3>Investigate</h3>
        <label className="field">
          <span>What is wrong</span>
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as DebugMode);
              setValues({});
            }}
            disabled={busy}
          >
            {DEBUG_MODES.map((m) => (
              <option key={m} value={m}>
                {DEBUG_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>In your words</span>
          <input
            value={problem}
            placeholder={PROMPT[mode]}
            onChange={(e) => setProblem(e.target.value)}
            disabled={busy}
          />
        </label>

        {fields.map((field) => {
          const options = optionsFor(field.key);
          return (
            <label key={field.key} className="field">
              <span>
                {FIELD_LABEL[field.key] ?? field.key}
                {field.required ? " *" : ""}
              </span>
              <select
                value={values[field.key] ?? ""}
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                disabled={busy}
              >
                <option value="">
                  {field.key === "diagnosticId" && options.length === 0
                    ? "no build yet — run a Story Build first"
                    : "—"}
                </option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          );
        })}

        {mode === "reveal" && (
          <p className="hint">Name at least one of these — there is nothing to trace otherwise.</p>
        )}

        <div className="build__links">
          <button
            className="btn btn--primary btn--small"
            disabled={busy || !ready}
            onClick={() => void run(false)}
          >
            {busy ? "Investigating…" : "Gather evidence"}
          </button>
          <button
            className="btn btn--small"
            disabled={busy || !ready}
            onClick={() => void run(true)}
          >
            Gather and diagnose
          </button>
          {mode === "character_motivation" &&
            values.characterId !== undefined &&
            values.sceneId !== undefined && (
              // The same question from the other direction: the debugger asks
              // why a decision feels forced; the simulator asks whether they
              // would do it at all, over the same reconstructed state
              // (docs/SIMULATIONS.md).
              <button className="btn btn--ghost btn--small" onClick={onSimulateBehaviour}>
                Simulate the decision
              </button>
            )}
        </div>
        <p className="hint">
          Diagnosing asks the model to interpret the evidence. Its reading is labelled as such and
          proposes only — nothing is applied.
        </p>
      </section>

      {report !== null && (
        <Report
          report={report}
          label={label}
          onSelectEntity={onSelectEntity}
          onOpenScene={onOpenScene}
        />
      )}

      {history.length > 0 && (
        <section className="state__section">
          <h3>Past investigations</h3>
          <ul className="state__knowledge">
            {history.map((summary) => (
              <li key={summary.id}>
                <button
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() =>
                    void repo.getDebugReport(summary.id).then((stored) => {
                      if (stored !== null) setReport(stored);
                    })
                  }
                >
                  {summary.id}
                </button>{" "}
                {DEBUG_MODE_LABEL[summary.mode]} — {summary.problem}
                <span className="ctx__id">
                  {" "}
                  {summary.evidenceCount} item(s) ·{" "}
                  {summary.diagnosed ? "diagnosed" : "evidence only"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Report({
  report,
  label,
  onSelectEntity,
  onOpenScene,
}: {
  report: DebugReport;
  label: (id: string) => string;
  onSelectEntity: (id: string) => void;
  onOpenScene: (sceneId: string) => void;
}) {
  return (
    <>
      <section className="state__section">
        <h3>
          {report.id} — {DEBUG_MODE_LABEL[report.mode]}
        </h3>
        <p className="build__message">{report.problem}</p>
        <p className="ctx__why">
          {report.scope.summary} Systems traced: {report.scope.systems.join(", ")}.
        </p>
        {report.scope.notInspected.map((gap, i) => (
          <p key={i} className="hint">
            Not inspected: {gap}
          </p>
        ))}
      </section>

      <section className="state__section">
        <h3>
          Evidence <span className="badge debug__badge--fact">deterministic</span>
        </h3>
        {report.evidence.length === 0 ? (
          <p className="hint">Nothing was found to retrieve.</p>
        ) : (
          <ul className="build__list">
            {report.evidence.map((item) => (
              <EvidenceRow
                key={item.id}
                item={item}
                label={label}
                onSelectEntity={onSelectEntity}
                onOpenScene={onOpenScene}
              />
            ))}
          </ul>
        )}
      </section>

      {report.measurements.length > 0 && (
        <section className="state__section">
          <h3>
            Measurements <span className="badge debug__badge--fact">counted, not graded</span>
          </h3>
          <ul className="state__knowledge">
            {report.measurements.map((m, i) => (
              <li key={i}>
                {m.label}: <strong>{m.value}</strong> {m.unit}
                <div className="ctx__why">{m.basis}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="state__section">
        <h3>
          Diagnosis{" "}
          <span className="badge debug__badge--judgement">
            {report.diagnosis === undefined ? "none" : "model judgement"}
          </span>
        </h3>
        {report.diagnosis === undefined ? (
          <p className="hint">
            Not diagnosed. The evidence above stands on its own; nothing has interpreted it.
          </p>
        ) : (
          <div className="debug__diagnosis">
            <p className="build__message">{report.diagnosis.statement}</p>
            <p className="ctx__why">{report.diagnosis.reasoning}</p>
            <p className="ctx__why">
              Confidence: <strong>{report.diagnosis.confidence}</strong> · resting on{" "}
              {report.diagnosis.basis.length === 0
                ? "no cited evidence"
                : report.diagnosis.basis.join(", ")}
            </p>
            {report.diagnosis.unsupported.length > 0 && (
              <p className="status status--error">
                Cited evidence that does not exist: {report.diagnosis.unsupported.join(", ")}
              </p>
            )}
            {report.diagnosis.uncertainty.map((line, i) => (
              <p key={i} className="hint">
                Would change this: {line}
              </p>
            ))}
          </div>
        )}
      </section>

      <section className="state__section">
        <h3>
          Possible interventions <span className="badge debug__badge--suggestion">suggestions</span>
        </h3>
        {report.interventions.length === 0 ? (
          <p className="hint">None proposed.</p>
        ) : (
          <ul className="build__list">
            {report.interventions.map((intervention, i) => (
              <li key={i} className="build__item">
                <div className="build__head">
                  <span className="build__severity build__severity--info">
                    {intervention.kind} · {intervention.effort}
                  </span>
                </div>
                <div className="build__message">{intervention.summary}</div>
                <div className="ctx__why">{intervention.rationale}</div>
                <div className="build__links">
                  {intervention.sceneIds.map((id) => (
                    <button key={id} className="btn btn--small" onClick={() => onOpenScene(id)}>
                      {label(id)}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">Nothing here has been applied. Acting on one is your decision.</p>
      </section>

      <section className="state__section">
        <h3>Affected entities</h3>
        <div className="build__links">
          {report.entities.map((id) => (
            <button key={id} className="btn btn--small" onClick={() => onSelectEntity(id)}>
              {label(id)}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function EvidenceRow({
  item,
  label,
  onSelectEntity,
  onOpenScene,
}: {
  item: EvidenceItem;
  label: (id: string) => string;
  onSelectEntity: (id: string) => void;
  onOpenScene: (sceneId: string) => void;
}) {
  return (
    <li className="build__item">
      <div className="build__head">
        <span className="ctx__id">{item.id}</span>
        <span className="build__severity build__severity--info">
          {item.system.replace(/_/g, " ")}
        </span>
      </div>
      <div className="build__message">{item.statement}</div>
      {item.detail !== undefined && <div className="ctx__why">{item.detail}</div>}
      <div className="build__links">
        {item.sceneId !== undefined && (
          <button className="btn btn--small" onClick={() => onOpenScene(item.sceneId as string)}>
            {label(item.sceneId)}
          </button>
        )}
        {item.entities.map((id) => (
          <button key={id} className="btn btn--small" onClick={() => onSelectEntity(id)}>
            {label(id)}
          </button>
        ))}
      </div>
    </li>
  );
}
