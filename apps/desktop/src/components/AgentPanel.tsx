import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentAnswer, AgentTask, SpecialistId } from "@jellytind/agent-runtime";
import { agentById, recommendSpecialist } from "@jellytind/agent-runtime";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { startInvestigation, type InvestigationHandle } from "../lib/agent";
import { explainModelError } from "../lib/models";
import { SpecialistPicker } from "./SpecialistPicker";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  /** Notify the shell so the activity bar can show the latest line. */
  onActivityLine: (line: string | null) => void;
}

const EXAMPLE =
  "Find every scene containing Mara and tell me what changes in her relationship with Elias.";

/**
 * The Agent panel: ask an investigative question about the project.
 *
 * The agent answers by using read-only tools against the Story Repository, not
 * by being handed the manuscript. What the user sees is the **activity** — which
 * tool ran against what — and then a grounded answer that keeps retrieved
 * project content separate from the model's interpretation. Private model
 * reasoning is never requested, stored or displayed (MASTER_BUILD.md §5;
 * AGENTS.md — "Canon vs Inference").
 */
export function AgentPanel({ repo, secrets, onActivityLine }: Props) {
  const [question, setQuestion] = useState("");
  const [specialistId, setSpecialistId] = useState<SpecialistId | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [answer, setAnswer] = useState<AgentAnswer | null>(null);
  /** Who actually ran, which is not necessarily who is selected now. */
  const [ranAs, setRanAs] = useState<SpecialistId | null>(null);
  const [task, setTask] = useState<AgentTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<AgentTask[]>([]);
  const handle = useRef<InvestigationHandle | null>(null);

  // The Author Agent's suggestion, offered from the writer's own words. It
  // never changes who runs — only the writer does that.
  const suggestion = useMemo(() => recommendSpecialist(question), [question]);

  const reloadHistory = useCallback(async () => {
    setHistory((await repo.agents.listTasks()).slice(0, 8));
  }, [repo]);

  useEffect(() => {
    void reloadHistory();
  }, [reloadHistory]);

  useEffect(
    () => () => {
      handle.current?.cancel();
      onActivityLine(null);
    },
    [onActivityLine],
  );

  async function ask() {
    const goal = question.trim();
    if (goal === "" || running) return;

    setRunning(true);
    setLines([]);
    setAnswer(null);
    setError(null);
    setTask(null);

    try {
      const started = await startInvestigation({
        repo,
        secrets,
        question: goal,
        ...(specialistId === null ? {} : { specialistId }),
        onActivity: (_event, line) => {
          setLines((prev) => [...prev, line]);
          onActivityLine(line);
        },
      });
      handle.current = started;
      const result = await started.result;
      setTask(result.task);
      setAnswer(result.answer ?? null);
      setRanAs(specialistId);
    } catch (cause) {
      setError(explainModelError(cause));
    } finally {
      handle.current = null;
      setRunning(false);
      onActivityLine(null);
      void reloadHistory();
    }
  }

  return (
    <div className="agent">
      <div className="agent__ask">
        <SpecialistPicker
          value={specialistId}
          onChange={setSpecialistId}
          suggestion={suggestion}
          disabled={running}
        />
        <textarea
          className="agent__input"
          rows={3}
          placeholder={EXAMPLE}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={running}
        />
        <div className="agent__actions">
          <button
            className="btn btn--primary btn--small"
            onClick={() => void ask()}
            disabled={running || question.trim() === ""}
          >
            {running ? "Working…" : specialistId === null ? "Investigate" : "Ask the specialist"}
          </button>
          {running && (
            <button className="btn btn--small" onClick={() => handle.current?.cancel()}>
              Cancel
            </button>
          )}
          {!running && question === "" && (
            <button className="btn btn--ghost btn--small" onClick={() => setQuestion(EXAMPLE)}>
              Use example
            </button>
          )}
        </div>
        <p className="hint">
          Read-only: whichever agent runs, it inspects the project through typed tools and cannot
          change it. Edits reach the manuscript only as proposals you review.
        </p>
      </div>

      {lines.length > 0 && (
        <section className="agent__section">
          {/* What ran, against what — not what the model was thinking. Private
              reasoning is never requested, stored or shown. */}
          <h3>
            Activity <span className="agent__count">{lines.length} step(s)</span>
          </h3>
          <ul className="agent__activity" aria-live="polite" aria-label="Agent activity">
            {lines.map((line, i) => (
              <li key={`${String(i)}-${line}`}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {error !== null && <p className="status status--error">{error}</p>}

      {task !== null && task.status !== "completed" && error === null && (
        <p className="status">
          Task {task.id} ended as {task.status}
          {task.failureReason === undefined ? "." : `: ${task.failureReason}`}
        </p>
      )}

      {answer !== null && (
        <section className="agent__section">
          <h3>
            Answer {ranAs !== null && <span className="agent__count">{agentById(ranAs).name}</span>}
          </h3>
          <p className="agent__summary">{answer.summary}</p>

          <h4 className="agent__label">From the project</h4>
          {answer.findings.length === 0 ? (
            <p className="agent__empty">Nothing in the project matched.</p>
          ) : (
            <ul className="agent__findings">
              {/*
                A finding whose citations did not resolve is shown, and shown as
                unverified. Hiding it would conceal that the model invented
                something; presenting it like the rest would be the fabrication
                the whole check exists to prevent (MANU-007).
              */}
              {answer.findings.map((finding, i) => (
                <li
                  key={`${String(i)}-${finding.statement}`}
                  className={finding.grounded ? undefined : "agent__finding--unverified"}
                >
                  <span>{finding.statement}</span>
                  {finding.sources.length > 0 && (
                    <span className="agent__sources">
                      {finding.sources
                        .filter((source) => !finding.unverified.includes(source))
                        .join(" · ")}
                    </span>
                  )}
                  {!finding.grounded && (
                    <span className="agent__unverified">
                      {finding.unverified.length > 0
                        ? `Unverified — ${finding.unverified.join(", ")} was not returned by any tool in this run.`
                        : "Unverified — the agent cited no source for this."}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {answer.interpretation !== "" && (
            <>
              <h4 className="agent__label agent__label--inference">
                Model interpretation — not project canon
              </h4>
              <p className="agent__interpretation">{answer.interpretation}</p>
            </>
          )}

          {answer.uncertainties.length > 0 && (
            <>
              <h4 className="agent__label">Not settled by the project</h4>
              <ul className="agent__uncertainties">
                {answer.uncertainties.map((item, i) => (
                  <li key={`${String(i)}-${item}`}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="agent__section">
          <h3>Recent tasks</h3>
          <ul className="agent__tasks">
            {history.map((t) => (
              <li key={t.id}>
                <span className={`badge badge--${t.status}`}>{t.status}</span>
                <span className="agent__goal">{t.goal}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
