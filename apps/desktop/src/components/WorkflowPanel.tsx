import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Disagreement,
  WorkflowNodeRecord,
  WorkflowRun,
  WorkflowRunSummary,
} from "@jellytind/domain";
import { describeWorkflowNode, flattenNodes } from "@jellytind/domain";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  DESCRIBE_CLASS,
  WORKFLOWS,
  WorkflowRunner,
  describeCost,
  planCost,
  renderArtifact,
  workflowById,
  type WorkflowDefinition,
} from "@jellytind/orchestration";
import { createAgentWorkExecutor } from "../lib/editing";
import { routingTable } from "../lib/models";

interface Props {
  repo: StoryRepository;
  secrets: SecretStore;
  refreshToken: number;
  onChanged: () => void;
  onSelectEntity: (id: string) => void;
}

/**
 * Multi-agent workflows, shown as what they are.
 *
 * The point of exposing the workflow is that a writer can see which specialist
 * is working, what it produced, and where the run is waiting for them. A
 * pipeline that ran invisibly and returned a chapter would be exactly the
 * uncontrolled agent behaviour this architecture exists to avoid
 * (docs/ORCHESTRATION.md).
 */
export function WorkflowPanel({ repo, secrets, refreshToken, onChanged, onSelectEntity }: Props) {
  const [selectedId, setSelectedId] = useState(WORKFLOWS[0]?.id ?? "");
  const [chapters, setChapters] = useState<Array<{ id: string; title: string }>>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [goal, setGoal] = useState("");
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [history, setHistory] = useState<WorkflowRunSummary[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<AbortController | null>(null);

  const workflow: WorkflowDefinition | null =
    WORKFLOWS.find((entry) => entry.id === selectedId) ?? WORKFLOWS[0] ?? null;

  const load = useCallback(async () => {
    const [list, runs] = await Promise.all([repo.listChapters(), repo.workflowRuns.list(10)]);
    setChapters(list.map((chapter) => ({ id: chapter.id as string, title: chapter.title })));
    setHistory(runs);
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => () => cancel.current?.abort(), []);

  async function execute(what: (runner: WorkflowRunner) => Promise<WorkflowRun>) {
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    cancel.current = controller;
    try {
      const executor = await createAgentWorkExecutor(repo, secrets);
      const runner = new WorkflowRunner({
        repo,
        runs: repo.workflowRuns,
        routing: routingTable(),
        executor,
      });
      setRun(await what(runner));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      cancel.current = null;
      setBusy(false);
      await load();
      onChanged();
    }
  }

  const progress = (event: { run: WorkflowRun }) => setRun(event.run);

  const nodes: readonly WorkflowNodeRecord[] =
    run !== null && run.workflowId === workflow?.id
      ? run.nodes
      : (workflow?.nodes.map((node) => ({
          id: node.id,
          title: node.title,
          kind: node.kind,
          status: "pending" as const,
        })) ?? []);

  const open = (run?.disagreements ?? []).filter((item) => item.resolution === undefined);
  const plan = workflow === null ? null : planCost(workflow);

  return (
    <div className="agent">
      {workflow !== null && (
        <div className="agent__ask">
          <div className="field">
            <span>Workflow</span>
            <select
              value={workflow.id}
              disabled={busy}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setRun(null);
                setInputs({});
              }}
            >
              {WORKFLOWS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">{workflow.description}</p>

          {workflow.inputs.map((input) => (
            <div className="field" key={input.key}>
              <span>{input.label}</span>
              <select
                value={inputs[input.key] ?? ""}
                disabled={busy}
                onChange={(event) =>
                  setInputs((previous) => ({ ...previous, [input.key]: event.target.value }))
                }
              >
                <option value="">Choose…</option>
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.title}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <div className="field">
            <span>What you want</span>
            <input
              value={goal}
              placeholder="Develop and draft Chapter 17."
              disabled={busy}
              onChange={(event) => setGoal(event.target.value)}
            />
          </div>

          <div className="agent__actions">
            <button
              className="btn btn--primary btn--small"
              disabled={busy || goal.trim() === ""}
              onClick={() =>
                void execute((runner) =>
                  runner.start(workflow, goal.trim(), inputs, { onProgress: progress }),
                )
              }
            >
              {busy ? "Running…" : "Start"}
            </button>
            {busy && (
              <button className="btn btn--small" onClick={() => cancel.current?.abort()}>
                Cancel
              </button>
            )}
          </div>

          {plan !== null && (
            <p className="hint">
              This workflow will ask for{" "}
              {Object.entries(plan)
                .filter(([, count]) => count > 0)
                .map(
                  ([routingClass, count]) =>
                    `${String(count)} × ${routingClass.replace(/_/g, " ")}`,
                )
                .join(", ")}
              . Nothing reaches your manuscript without a checkpoint and your approval.
            </p>
          )}
        </div>
      )}

      {error !== null && <p className="status status--error">{error}</p>}

      <section className="agent__section">
        <h3>
          {workflow?.name ?? "Workflow"}{" "}
          {run !== null && (
            <span className="agent__count">
              {run.status.replace(/_/g, " ")}
              {run.resumeCount > 0 ? ` · resumed ${String(run.resumeCount)}×` : ""}
            </span>
          )}
        </h3>
        <ul className="skill__steps" aria-live="polite">
          {nodes.map((node) => (
            <li key={node.id} className={`skill__step skill__step--${node.status}`}>
              <span>{describeWorkflowNode(node)}</span>
              <span className="ctx__why">
                {node.routingClass === undefined ? "" : DESCRIBE_CLASS[node.routingClass]}
              </span>
              {(node.children ?? []).length > 0 && (
                <ul className="skill__steps skill__steps--nested">
                  {(node.children ?? []).map((child) => (
                    <li key={child.id} className={`skill__step skill__step--${child.status}`}>
                      <span>{describeWorkflowNode(child)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      {run !== null && run.pending !== undefined && (
        <section className="agent__section">
          <h3>Your decision</h3>
          <p className="agent__summary">{run.pending.question}</p>

          {open.length > 0 && (
            <>
              <h4 className="agent__label agent__label--inference">
                The specialists disagree — you decide
              </h4>
              <ul className="agent__findings">
                {open.map((item: Disagreement) => (
                  <li key={item.target}>
                    <span className="ctx__id">{item.target}</span>
                    {item.positions.map((position) => (
                      <label key={position.agent} className="workflow__position">
                        <input
                          type="radio"
                          name={`disagreement-${item.target}`}
                          checked={choices[item.target] === position.agent}
                          onChange={() =>
                            setChoices((previous) => ({
                              ...previous,
                              [item.target]: position.agent,
                            }))
                          }
                        />
                        <span>
                          <strong>{position.agent.replace(/_/g, " ")}</strong> would{" "}
                          {position.stance} it — {position.statement}
                        </span>
                      </label>
                    ))}
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="field">
            <span>A note, if you want one recorded</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} />
          </div>
          <div className="agent__actions">
            <button
              className="btn btn--primary btn--small"
              disabled={busy || open.some((item) => choices[item.target] === undefined)}
              onClick={() =>
                void execute((runner) =>
                  runner.approve(
                    run.id,
                    workflowById(run.workflowId),
                    {
                      approved: true,
                      ...(note.trim() === "" ? {} : { note: note.trim() }),
                      resolutions: Object.entries(choices).map(([target, chose]) => ({
                        target,
                        chose,
                      })),
                    },
                    { onProgress: progress },
                  ),
                )
              }
            >
              Approve
            </button>
            <button
              className="btn btn--small"
              disabled={busy}
              onClick={() =>
                void execute((runner) =>
                  runner.approve(run.id, workflowById(run.workflowId), {
                    approved: false,
                    ...(note.trim() === "" ? {} : { note: note.trim() }),
                  }),
                )
              }
            >
              Decline
            </button>
          </div>
          {open.length > 0 && (
            <p className="hint">
              Both positions stay on the record whichever you choose. Nothing is written until you
              approve.
            </p>
          )}
        </section>
      )}

      {run !== null && run.artifacts.length > 0 && (
        <section className="agent__section">
          <h3>
            Handoffs <span className="agent__count">{run.artifacts.length}</span>
          </h3>
          <ul className="agent__findings">
            {run.artifacts.map((artifact) => (
              <li key={artifact.id}>
                <span>
                  <button
                    className="btn btn--ghost btn--small"
                    onClick={() =>
                      setOpenArtifact(openArtifact === artifact.id ? null : artifact.id)
                    }
                  >
                    {artifact.kind.replace(/_/g, " ")}
                  </button>
                  <span className="agent__sources">
                    {artifact.producedBy.replace(/_/g, " ")}
                    {artifact.modelId === undefined ? "" : ` · ${artifact.modelId}`}
                  </span>
                </span>
                {openArtifact === artifact.id && (
                  <pre className="workflow__artifact">
                    {renderArtifact(artifact.kind, artifact.payload)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {run !== null && (run.checkpoints.length > 0 || run.changeSets.length > 0) && (
        <section className="agent__section">
          <h3>What this run touched</h3>
          <ul className="state__knowledge">
            {run.checkpoints.map((id) => (
              <li key={id}>
                Checkpoint <span className="ctx__id">{id}</span> — revert here to undo the run
              </li>
            ))}
            {run.changeSets.map((id) => (
              <li key={id}>
                Change set <span className="ctx__id">{id}</span> — in your ordinary history
              </li>
            ))}
          </ul>
          <p className="hint">{describeCost(run.cost)}</p>
        </section>
      )}

      {history.length > 0 && (
        <section className="agent__section">
          <h3>Recent runs</h3>
          <ul className="agent__tasks">
            {history.map((entry) => (
              <li key={entry.id}>
                <span className={`badge badge--${entry.status}`}>
                  {entry.status.replace(/_/g, " ")}
                </span>
                <span className="agent__goal">
                  {entry.workflowName} — {String(entry.nodesDone)}/{String(entry.nodesTotal)}
                  {entry.openDisagreements > 0
                    ? `, ${String(entry.openDisagreements)} open disagreement(s)`
                    : ""}
                </span>
                <button
                  className="btn btn--ghost btn--small"
                  disabled={busy}
                  onClick={() =>
                    void (async () => {
                      const stored = await repo.workflowRuns.get(entry.id);
                      if (stored !== null) {
                        setRun(stored);
                        setSelectedId(stored.workflowId);
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

      {run !== null && flattenNodes(run.nodes).some((node) => node.artifactId !== undefined) && (
        <p className="hint">
          Run {run.id}. Every step is in the agent activity log, and a draft you approved is an
          ordinary change set you can revert.{" "}
          {typeof run.inputs.chapterId === "string" && (
            <button
              className="btn btn--ghost btn--small"
              onClick={() => onSelectEntity(String(run.inputs.chapterId))}
            >
              Open the chapter record
            </button>
          )}
        </p>
      )}
    </div>
  );
}
