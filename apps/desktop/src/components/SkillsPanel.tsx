import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SkillRun, SkillRunSummary, SkillStepRecord } from "@jellytind/domain";
import { describeStep, isResumable } from "@jellytind/domain";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  BUILT_IN_SKILLS,
  SkillRunner,
  loadCustomSkills,
  operationById,
  parseSkillCommand,
  skillById,
  type SkillDefinition,
} from "@jellytind/skills";
import { createSkillAnalyst } from "../lib/editing";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
  onOpenScene: (sceneId: string) => void;
}

const KIND_LABEL: Readonly<Record<string, string>> = {
  conflict: "conflict",
  gap: "not recorded",
  attention: "look at",
  measurement: "measured",
  proposal: "proposal",
};

/**
 * Writing Skills: repeatable workflows over the project.
 *
 * The panel shows a skill as what it is — a list of steps — before it runs,
 * while it runs, and after. A writer watching a character pass can see that
 * step three reconstructed knowledge and step five found no dialogue, which is
 * a different thing from a paragraph of prose appearing at the end
 * (docs/WRITING_SKILLS.md).
 */
export function SkillsPanel({
  repo,
  secrets,
  refreshToken,
  onChanged,
  onSelectEntity,
  onOpenScene,
}: Props) {
  const [custom, setCustom] = useState<SkillDefinition[]>([]);
  const [problems, setProblems] = useState<Array<{ path: string; reason: string }>>([]);
  const [selectedId, setSelectedId] = useState<string>(BUILT_IN_SKILLS[0]?.id ?? "");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [entities, setEntities] = useState<Array<{ id: string; kind: string; name: string }>>([]);
  const [history, setHistory] = useState<SkillRunSummary[]>([]);
  const [run, setRun] = useState<SkillRun | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<AbortController | null>(null);

  const skills = useMemo(() => [...BUILT_IN_SKILLS, ...custom], [custom]);
  const skill = useMemo(
    () => skills.find((entry) => entry.id === selectedId) ?? skills[0] ?? null,
    [skills, selectedId],
  );

  const load = useCallback(async () => {
    const [summaries, runs, loaded] = await Promise.all([
      repo.listEntitySummaries(),
      repo.skillRuns.list(12),
      loadCustomSkills(repo),
    ]);
    setEntities(summaries);
    setHistory(runs);
    setCustom([...loaded.skills]);
    setProblems([...loaded.problems]);
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => () => cancel.current?.abort(), []);

  const optionsFor = (entityKind: string | undefined) =>
    entityKind === undefined ? [] : entities.filter((entry) => entry.kind === entityKind);

  const label = (id: string) => entities.find((entry) => entry.id === id)?.name ?? id;

  async function execute(what: (runner: SkillRunner) => Promise<SkillRun>) {
    setBusy(true);
    setError(null);
    setLines([]);
    const controller = new AbortController();
    cancel.current = controller;
    try {
      const analyst = await createSkillAnalyst(secrets);
      const runner = new SkillRunner({ repo, runs: repo.skillRuns, analyst });
      const finished = await what(runner);
      setRun(finished);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      cancel.current = null;
      setBusy(false);
      await load();
      onChanged();
    }
  }

  const progress = (event: { line: string; run: SkillRun }) => {
    setLines((previous) => [...previous, event.line]);
    setRun(event.run);
  };

  const steps: readonly SkillStepRecord[] =
    run !== null && run.skillId === skill?.id
      ? run.steps
      : (skill?.steps.map((step) => ({
          id: step.id,
          title: step.title,
          operationId: step.operationId,
          status: "pending" as const,
        })) ?? []);

  return (
    <div className="agent">
      {skill !== null && (
        <div className="agent__ask">
          <div className="field">
            <span>Skill</span>
            <select
              value={skill.id}
              disabled={busy}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setInputs({});
                setRun(null);
                setLines([]);
              }}
            >
              {skills.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.command} — {entry.name}
                  {entry.custom === true ? " (yours)" : ""}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">{skill.description}</p>

          {skill.inputs.map((input) => (
            <div className="field" key={input.key}>
              <span>
                {input.label}
                {input.required ? "" : " (optional)"}
              </span>
              <select
                value={inputs[input.key] ?? ""}
                disabled={busy}
                onChange={(event) =>
                  setInputs((previous) => ({ ...previous, [input.key]: event.target.value }))
                }
              >
                <option value="">{input.required ? "Choose…" : "The whole book"}</option>
                {optionsFor(input.entityKind).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <div className="agent__actions">
            <button
              className="btn btn--primary btn--small"
              disabled={busy}
              onClick={() =>
                void execute((runner) =>
                  runner.start(skill, inputs, {
                    onProgress: progress,
                    ...(cancel.current === null ? {} : { signal: cancel.current.signal }),
                  }),
                )
              }
            >
              {busy ? "Running…" : `Run ${skill.command}`}
            </button>
            {busy && (
              <button className="btn btn--small" onClick={() => cancel.current?.abort()}>
                Cancel
              </button>
            )}
            {run !== null && isResumable(run) && !busy && (
              <button
                className="btn btn--small"
                onClick={() =>
                  void execute((runner) =>
                    runner.resume(run.id, skillById(run.skillId, custom), {
                      onProgress: progress,
                    }),
                  )
                }
              >
                Resume from step{" "}
                {String(
                  run.steps.findIndex((s) => s.status !== "ok" && s.status !== "skipped") + 1,
                )}
              </button>
            )}
          </div>
          <div className="field">
            <span>Or type the command</span>
            <input
              value={command}
              placeholder="/character-pass Mara"
              disabled={busy}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || command.trim() === "") return;
                try {
                  const parsed = parseSkillCommand(command, entities, custom);
                  setSelectedId(parsed.skill.id);
                  setInputs({ ...parsed.inputs });
                  void execute((runner) =>
                    runner.start(parsed.skill, parsed.inputs, { onProgress: progress }),
                  );
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              }}
            />
          </div>

          <p className="hint">
            Every step is a query against your project, in the same order every time. Steps that
            need a model are skipped — and say so — when none is configured. Nothing a skill
            produces changes the manuscript.
          </p>
        </div>
      )}

      {problems.length > 0 && (
        <section className="agent__section">
          <h3>Custom skills that could not be loaded</h3>
          <ul className="agent__uncertainties">
            {problems.map((problem) => (
              <li key={problem.path}>
                <span className="ctx__id">{problem.path}</span> {problem.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {error !== null && <p className="status status--error">{error}</p>}

      <section className="agent__section">
        <h3>
          Steps{" "}
          {run !== null && (
            <span className="agent__count">
              {run.status}
              {run.resumeCount > 0 ? ` · resumed ${String(run.resumeCount)}×` : ""}
            </span>
          )}
        </h3>
        <ul className="skill__steps" aria-live="polite">
          {steps.map((step) => (
            <li key={step.id} className={`skill__step skill__step--${step.status}`}>
              <span>{describeStep(step)}</span>
              <span className="ctx__why">
                {operationById(step.operationId).kind === "semantic" ? "needs a model" : ""}
              </span>
            </li>
          ))}
        </ul>
        {lines.length > 0 && busy && <p className="hint">{lines[lines.length - 1]}</p>}
      </section>

      {run !== null && run.findings.length > 0 && (
        <section className="agent__section">
          <h3>
            Findings <span className="agent__count">{run.findings.length}</span>
          </h3>
          <ul className="agent__findings">
            {run.findings.map((item) => (
              <li key={item.id}>
                <span>
                  <span className={`badge badge--${item.kind}`}>
                    {KIND_LABEL[item.kind] ?? item.kind}
                  </span>{" "}
                  {item.statement}
                </span>
                {item.detail !== undefined && <span className="ctx__why">{item.detail}</span>}
                <span className="agent__sources">
                  {item.source === "model"
                    ? "model reading — not project canon"
                    : "from the project"}
                  {item.basis === undefined ? "" : ` · ${item.basis}`}
                </span>
                {(item.sceneIds ?? []).length > 0 && (
                  <span className="agent__sources">
                    {(item.sceneIds ?? []).slice(0, 6).map((sceneId) => (
                      <button
                        key={sceneId}
                        className="btn btn--ghost btn--small"
                        onClick={() => onOpenScene(sceneId)}
                      >
                        {sceneId}
                      </button>
                    ))}
                  </span>
                )}
                {(item.entities ?? []).length > 0 && (
                  <span className="agent__sources">
                    {(item.entities ?? []).slice(0, 6).map((id) => (
                      <button
                        key={id}
                        className="btn btn--ghost btn--small"
                        onClick={() => onSelectEntity(id)}
                      >
                        {label(id)}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {run !== null && (run.measurements.length > 0 || run.notMeasured.length > 0) && (
        <section className="agent__section">
          <h3>Measurements</h3>
          <ul className="state__knowledge">
            {run.measurements.map((measurement) => (
              <li key={`${measurement.label}-${String(measurement.value)}`}>
                {measurement.label}: <strong>{measurement.value}</strong> {measurement.unit}
                <span className="ctx__why">{measurement.basis}</span>
              </li>
            ))}
          </ul>
          {run.notMeasured.length > 0 && (
            <p className="hint">
              <strong>Not measured:</strong> {run.notMeasured.join("; ")}.
            </p>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="agent__section">
          <h3>Recent runs</h3>
          <ul className="agent__tasks">
            {history.map((entry) => (
              <li key={entry.id}>
                <span className={`badge badge--${entry.status}`}>{entry.status}</span>
                <span className="agent__goal">
                  {entry.skillName} — {String(entry.stepsDone)}/{String(entry.stepsTotal)} steps,{" "}
                  {String(entry.findingCount)} finding(s)
                </span>
                <button
                  className="btn btn--ghost btn--small"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      const stored = await repo.skillRuns.get(entry.id);
                      if (stored !== null) {
                        setRun(stored);
                        setSelectedId(stored.skillId);
                      }
                    })()
                  }
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
