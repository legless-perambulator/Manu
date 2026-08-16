import { useCallback, useEffect, useState } from "react";
import {
  FLOW_TEMPLATES,
  exportAgentPackage,
  exportFlowPackage,
  importPackage,
  permissionSummary,
  testAgent,
  validateAgent,
  validateFlow,
  type CustomAgentDefinition,
  type FlowDefinition,
  type FlowRunState,
  type FlowStep,
  type ModelPolicy,
  type SandboxResult,
} from "@jellytind/agent-builder";
import { SPECIALIST_IDS } from "@jellytind/agent-runtime";
import type { StoryRepository } from "@jellytind/story-repository";
import { sandboxProject, type StudioRuntime } from "../lib/studio";
import {
  pickManuscriptFile,
  pickSaveFile,
  readExternalFile,
  writeExternalFile,
} from "../lib/external-files";
import { isTauri } from "../tauri";

interface Props {
  repo: StoryRepository;
  runtime: StudioRuntime | null;
  refreshToken: number;
  onChanged: () => void;
}

/**
 * The Studio (Phase 43): create agents and multi-step skills without code.
 *
 * Simple mode is a concise form — name, purpose, instructions, what it may
 * touch, what it hands back. Advanced mode adds the model policy, the
 * per-tool allowlist, a context recipe and a /command alias. The permission
 * summary is always in view before saving, the sandbox runs an agent without
 * applying anything, and flows pause at their approval gates right here.
 */

const BLANK_AGENT: CustomAgentDefinition = {
  id: "",
  name: "",
  purpose: "",
  instructions: "",
  permissions: ["read_manuscript", "read_canon"],
  tools: ["search_project", "read_file", "get_chapter", "get_character"],
  model: { kind: "routing" },
  context: { currentChapter: true, charactersPresent: true },
  output: { kind: "notes" },
  scope: "project",
  revision: 1,
  metadata: { compatibility: { app: "manu", builder: "1.0" } },
};

const CONTEXT_CHOICES: ReadonlyArray<{
  key: keyof CustomAgentDefinition["context"] & string;
  label: string;
}> = [
  { key: "currentScene", label: "Current scene" },
  { key: "currentChapter", label: "Current chapter" },
  { key: "charactersPresent", label: "Characters present" },
  { key: "relevantResearch", label: "Relevant research" },
  { key: "plotThreads", label: "Plot threads" },
  { key: "authorVoice", label: "Author Voice" },
];

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function StudioPanel({ repo, runtime, refreshToken, onChanged }: Props) {
  const [agents, setAgents] = useState<readonly CustomAgentDefinition[]>([]);
  const [flows, setFlows] = useState<readonly FlowDefinition[]>([]);
  const [problems, setProblems] = useState<ReadonlyArray<{ path: string; reason: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [draft, setDraft] = useState<CustomAgentDefinition | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [draftProblems, setDraftProblems] = useState<readonly string[]>([]);
  const [sandbox, setSandbox] = useState<SandboxResult | null>(null);

  const [flowDraft, setFlowDraft] = useState<FlowDefinition | null>(null);
  const [flowProblems, setFlowProblems] = useState<readonly string[]>([]);
  const [run, setRun] = useState<FlowRunState | null>(null);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
  const [runFlow, setRunFlow] = useState<FlowDefinition | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (runtime === null) return;
    setAgents(await runtime.agents());
    setFlows(await runtime.flows());
    setProblems(await runtime.problems());
  }, [runtime]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  async function guarded(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      await reload();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (runtime === null) {
    return (
      <div className="state">
        <section className="state__section">
          <h3>Studio</h3>
          <p className="placeholder">Loading the Studio…</p>
        </section>
      </div>
    );
  }

  const validation = {
    ...runtime.validation,
    availableAgents: [...SPECIALIST_IDS, ...agents.map((held) => held.id)],
  };

  function patchDraft(patch: Partial<CustomAgentDefinition>) {
    setDraft((held) => (held === null ? held : { ...held, ...patch }));
  }

  async function saveDraft() {
    await guarded(async () => {
      if (draft === null) return;
      const ready = { ...draft, id: draft.id === "" ? slug(draft.name) : draft.id };
      const found = validateAgent(ready, validation);
      setDraftProblems(found);
      if (found.length > 0) throw new Error("The agent is not ready — see the problems below.");
      const store = ready.scope === "global" ? runtime!.stores.global : runtime!.stores.project;
      await store.saveAgent(ready);
      setDraft(null);
      setSandbox(null);
      setNotice(`${ready.name} saved.`);
    });
  }

  async function runSandbox() {
    await guarded(async () => {
      if (draft === null) return;
      setSandbox(
        await testAgent(draft, { project: sandboxProject(repo), invoker: runtime!.invoker }),
      );
    });
  }

  async function exportDefinition(kind: "agent" | "skill", body: string, name: string) {
    await guarded(async () => {
      if (!isTauri()) throw new Error("Exporting needs the desktop application.");
      const path = await pickSaveFile(
        kind === "agent" ? "Export agent" : "Export skill",
        `${name}.manu-${kind}.json`,
        "json",
      );
      if (path === null) return;
      await writeExternalFile(path, new TextEncoder().encode(body));
      setNotice("Exported. The package carries no credentials or project data.");
    });
  }

  async function importDefinition() {
    await guarded(async () => {
      if (!isTauri()) throw new Error("Importing needs the desktop application.");
      const path = await pickManuscriptFile();
      if (path === null) return;
      const raw = new TextDecoder().decode(await readExternalFile(path));
      const result = importPackage(raw);
      if (result.agent !== undefined) {
        const found = validateAgent(result.agent, validation);
        if (found.length > 0) throw new Error(found[0]);
        await runtime!.stores.project.saveAgent(result.agent);
        setNotice(`${result.agent.name} imported.`);
      } else if (result.flow !== undefined) {
        const found = validateFlow(result.flow, validation);
        if (found.length > 0) throw new Error(found[0]);
        await runtime!.stores.project.saveFlow(result.flow);
        setNotice(`${result.flow.name} imported.`);
      }
    });
  }

  function patchFlow(patch: Partial<FlowDefinition>) {
    setFlowDraft((held) => (held === null ? held : { ...held, ...patch }));
  }

  async function saveFlowDraft() {
    await guarded(async () => {
      if (flowDraft === null) return;
      const ready = { ...flowDraft, id: flowDraft.id === "" ? slug(flowDraft.name) : flowDraft.id };
      const found = validateFlow(ready, validation);
      setFlowProblems(found);
      if (found.length > 0) throw new Error("The skill is not ready — see the problems below.");
      await runtime!.stores.project.saveFlow(ready);
      setFlowDraft(null);
      setNotice(`${ready.name} saved.`);
    });
  }

  async function startRun(flow: FlowDefinition) {
    await guarded(async () => {
      setRunFlow(flow);
      const state = await runtime!.runner.start(flow, runInputs);
      setRun(state);
      setAccepted(new Set(state.proposals.map((held) => held.id)));
    });
  }

  const agentEditor =
    draft !== null ? (
      <section className="state__section studio__editor">
        <h3>{draft.name === "" ? "New agent" : draft.name}</h3>
        <label className="field">
          <span>Name</span>
          <input value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Purpose</span>
          <input
            value={draft.purpose}
            placeholder="Check historical plausibility and flag anachronisms."
            onChange={(e) => patchDraft({ purpose: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Instructions</span>
          <textarea
            rows={4}
            value={draft.instructions}
            onChange={(e) => patchDraft({ instructions: e.target.value })}
          />
        </label>

        <p className="hint">May use:</p>
        <div className="studio__groups">
          {runtime.catalog.map((group) => {
            const groupNames = group.tools.map((tool) => tool.name);
            const all = groupNames.every((name) => draft.tools.includes(name));
            return (
              <div key={group.id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={all}
                    onChange={(e) => {
                      const next = new Set(draft.tools);
                      for (const name of groupNames) {
                        if (e.target.checked) next.add(name);
                        else next.delete(name);
                      }
                      const tools = [...next];
                      // Permissions follow the chosen tools, so simple mode
                      // can never produce a tool/permission mismatch.
                      const permissions = [
                        ...new Set(
                          runtime.catalog
                            .flatMap((held) => held.tools)
                            .filter((tool) => tools.includes(tool.name))
                            .map((tool) => tool.permission),
                        ),
                      ];
                      patchDraft({ tools, permissions });
                    }}
                  />
                  {group.label}
                </label>
                {advanced && (
                  <div className="studio__tools">
                    {group.tools.map((tool) => (
                      <label key={tool.name} className="check">
                        <input
                          type="checkbox"
                          checked={draft.tools.includes(tool.name)}
                          onChange={(e) => {
                            const next = new Set(draft.tools);
                            if (e.target.checked) next.add(tool.name);
                            else next.delete(tool.name);
                            const tools = [...next];
                            const permissions = [
                              ...new Set(
                                runtime.catalog
                                  .flatMap((held) => held.tools)
                                  .filter((t) => tools.includes(t.name))
                                  .map((t) => t.permission),
                              ),
                            ];
                            patchDraft({ tools, permissions });
                          }}
                        />
                        {tool.title}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="hint">Working context:</p>
        <div className="studio__groups">
          {CONTEXT_CHOICES.map((choice) => (
            <label key={choice.key} className="check">
              <input
                type="checkbox"
                checked={draft.context[choice.key] === true}
                onChange={(e) =>
                  patchDraft({ context: { ...draft.context, [choice.key]: e.target.checked } })
                }
              />
              {choice.label}
            </label>
          ))}
        </div>

        <label className="field">
          <span>Hands back</span>
          <select
            value={draft.output.kind}
            onChange={(e) =>
              patchDraft({
                output: { kind: e.target.value === "proposals" ? "proposals" : "notes" },
              })
            }
          >
            <option value="notes">Notes and findings, for me to read</option>
            <option value="proposals">Proposed edits, staged for my approval</option>
          </select>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={advanced}
            onChange={(e) => setAdvanced(e.target.checked)}
          />
          Advanced configuration
        </label>
        {advanced && (
          <>
            <label className="field">
              <span>Model</span>
              <select
                value={
                  draft.model.kind === "class"
                    ? `class:${draft.model.modelClass}`
                    : draft.model.kind
                }
                onChange={(e) => {
                  const value = e.target.value;
                  const model: ModelPolicy = value.startsWith("class:")
                    ? { kind: "class", modelClass: value.slice(6) as never }
                    : value === "pinned"
                      ? { kind: "pinned", modelId: validation.availableModels[0] ?? "" }
                      : { kind: "routing" };
                  patchDraft({ model });
                }}
              >
                <option value="routing">Use Manu routing policy</option>
                <option value="class:drafting">Use Drafting model</option>
                <option value="class:reasoning">Use Reasoning model</option>
                <option value="class:fast">Use Utility model</option>
                <option value="pinned">Pin a specific model</option>
              </select>
            </label>
            {draft.model.kind === "pinned" && (
              <label className="field">
                <span>Pinned model</span>
                <select
                  value={draft.model.modelId}
                  onChange={(e) =>
                    patchDraft({ model: { kind: "pinned", modelId: e.target.value } })
                  }
                >
                  {validation.availableModels.map((modelId) => (
                    <option key={modelId} value={modelId}>
                      {modelId}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Context recipe (detailed)</span>
              <select
                value={draft.context.recipe ?? ""}
                onChange={(e) =>
                  patchDraft({
                    context: {
                      ...draft.context,
                      ...(e.target.value === ""
                        ? { recipe: undefined }
                        : { recipe: e.target.value }),
                    },
                  })
                }
              >
                <option value="">From the choices above</option>
                <option value="scene_inspection">Scene inspection</option>
                <option value="scene_rewrite">Scene rewrite</option>
                <option value="chapter_inspection">Chapter inspection</option>
              </select>
            </label>
            <label className="field">
              <span>Command alias</span>
              <input
                value={draft.commandAlias ?? ""}
                placeholder="my-historical-editor"
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    ...(e.target.value === ""
                      ? { commandAlias: undefined }
                      : { commandAlias: e.target.value }),
                  } as CustomAgentDefinition)
                }
              />
            </label>
            <label className="field">
              <span>Where it lives</span>
              <select
                value={draft.scope}
                onChange={(e) =>
                  patchDraft({ scope: e.target.value === "global" ? "global" : "project" })
                }
              >
                <option value="project">This project</option>
                <option value="global">Everywhere (global)</option>
              </select>
            </label>
          </>
        )}

        {(() => {
          const summary = permissionSummary(draft, runtime.catalog);
          return (
            <div className="studio__summary">
              <p className="hint">This agent can:</p>
              <ul>
                {summary.can.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="hint">This agent cannot:</p>
              <ul>
                {summary.cannot.map((line) => (
                  <li key={line} className="studio__cannot">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}

        {draftProblems.map((problem) => (
          <p key={problem} className="status status--error">
            {problem}
          </p>
        ))}
        {sandbox !== null && (
          <div className="studio__sandbox">
            <p className="hint">
              Test run — context: {sandbox.contextUsed.join("; ") || "none"} · tools allowed:{" "}
              {sandbox.toolsAllowed.length}
            </p>
            {sandbox.skipped !== undefined && <p className="status">{sandbox.skipped}</p>}
            {sandbox.notes.map((note, index) => (
              <div key={index} className="term__text">
                {note}
              </div>
            ))}
            {sandbox.proposedMutations.map((edit) => (
              <div key={edit.id} className="term__text">
                {edit.id}: “{edit.find}” → “{edit.replace}” — {edit.reason} (not applied)
              </div>
            ))}
          </div>
        )}
        <div className="mapping__actions">
          <button className="btn btn--primary" disabled={busy} onClick={() => void saveDraft()}>
            Save agent
          </button>
          <button className="btn" disabled={busy} onClick={() => void runSandbox()}>
            Test agent
          </button>
          <button className="btn btn--ghost" onClick={() => setDraft(null)}>
            Discard
          </button>
        </div>
      </section>
    ) : null;

  const stepLine = (step: FlowStep): string => {
    switch (step.kind) {
      case "run_agent":
        return `${step.title} — agent: ${step.agent}`;
      case "run_tool":
        return `${step.title} — tool: ${step.tool}`;
      case "search_project":
        return `${step.title} — search: ${step.query}`;
      case "branch":
        return `${step.title} — if ${step.condition.measure.replace(/_/g, " ")} ${
          step.condition.comparison === "equals" ? "=" : ">"
        } ${String(step.condition.value)}`;
      default:
        return step.title;
    }
  };

  const flowEditor =
    flowDraft !== null ? (
      <section className="state__section studio__editor">
        <h3>{flowDraft.name === "" ? "New skill" : flowDraft.name}</h3>
        <label className="field">
          <span>Name</span>
          <input value={flowDraft.name} onChange={(e) => patchFlow({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Description</span>
          <input
            value={flowDraft.description}
            onChange={(e) => patchFlow({ description: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Command alias</span>
          <input
            value={flowDraft.commandAlias ?? ""}
            placeholder="my-character-audit"
            onChange={(e) =>
              setFlowDraft({
                ...flowDraft,
                ...(e.target.value === ""
                  ? { commandAlias: undefined }
                  : { commandAlias: e.target.value }),
              } as FlowDefinition)
            }
          />
        </label>
        <p className="hint">Steps, in order:</p>
        <ol className="studio__steps">
          {flowDraft.steps.map((step, index) => (
            <li key={step.id}>
              <span>{stepLine(step)}</span>
              <span className="mapping__actions">
                <button
                  className="btn btn--ghost btn--small"
                  disabled={index === 0}
                  onClick={() => {
                    const steps = [...flowDraft.steps];
                    const [held] = steps.splice(index, 1);
                    if (held !== undefined) steps.splice(index - 1, 0, held);
                    patchFlow({ steps });
                  }}
                >
                  ↑
                </button>
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() =>
                    patchFlow({ steps: flowDraft.steps.filter((held) => held.id !== step.id) })
                  }
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
        <AddStep
          agents={[...SPECIALIST_IDS, ...agents.map((held) => held.id)]}
          onAdd={(step) => patchFlow({ steps: [...flowDraft.steps, step] })}
        />
        {flowProblems.map((problem) => (
          <p key={problem} className="status status--error">
            {problem}
          </p>
        ))}
        <div className="mapping__actions">
          <button className="btn btn--primary" disabled={busy} onClick={() => void saveFlowDraft()}>
            Save skill
          </button>
          <button className="btn btn--ghost" onClick={() => setFlowDraft(null)}>
            Discard
          </button>
        </div>
      </section>
    ) : null;

  return (
    <div className="state studio">
      <section className="state__section">
        <h3>Studio</h3>
        <p className="hint">
          Build your own agents and multi-step skills — a form and a sequence, never code. Every
          agent runs under the same enforced permissions as Manu's own specialists.
        </p>
        {error !== null && <p className="status status--error">{error}</p>}
        {notice !== null && <p className="status status--ok">{notice}</p>}
        {problems.map((problem) => (
          <p key={problem.path} className="status status--warn">
            {problem.path}: {problem.reason}
          </p>
        ))}
        <div className="mapping__actions">
          <button
            className="btn btn--primary"
            disabled={busy || draft !== null}
            onClick={() => {
              setDraft(BLANK_AGENT);
              setDraftProblems([]);
              setSandbox(null);
            }}
          >
            New agent
          </button>
          <button
            className="btn"
            disabled={busy || flowDraft !== null}
            onClick={() =>
              setFlowDraft({
                id: "",
                name: "",
                description: "",
                inputs: [],
                steps: [],
                output: "report",
                scope: "project",
                revision: 1,
                metadata: { compatibility: { app: "manu", builder: "1.0" } },
              })
            }
          >
            New skill
          </button>
          <button
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => void importDefinition()}
          >
            Import…
          </button>
        </div>
        {flowDraft === null && (
          <p className="hint">
            Or start a skill from a template:{" "}
            {FLOW_TEMPLATES.map((template) => (
              <button
                key={template.id}
                className="btn btn--ghost btn--small"
                onClick={() =>
                  setFlowDraft({ ...template, id: "", commandAlias: undefined } as FlowDefinition)
                }
              >
                {template.name}
              </button>
            ))}
          </p>
        )}
      </section>

      {agentEditor}
      {flowEditor}

      {agents.length > 0 && (
        <section className="state__section">
          <h3>Your agents</h3>
          {agents.map((agent) => (
            <div key={`${agent.scope}:${agent.id}`} className="studio__row">
              <div>
                <strong>{agent.name}</strong>{" "}
                <span className="hint">
                  rev {agent.revision} · {agent.scope}
                  {agent.commandAlias !== undefined ? ` · /${agent.commandAlias}` : ""}
                </span>
                <p className="hint">{agent.purpose}</p>
              </div>
              <div className="mapping__actions">
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => {
                    setDraft(agent);
                    setDraftProblems([]);
                    setSandbox(null);
                  }}
                >
                  Edit
                </button>
                <button
                  className="btn btn--ghost btn--small"
                  disabled={busy}
                  onClick={() =>
                    void exportDefinition("agent", exportAgentPackage(agent), agent.id)
                  }
                >
                  Export
                </button>
                <button
                  className="btn btn--ghost btn--small"
                  disabled={busy}
                  onClick={() =>
                    void guarded(() =>
                      (agent.scope === "global"
                        ? runtime.stores.global
                        : runtime.stores.project
                      ).remove("agents", agent.id),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {flows.length > 0 && (
        <section className="state__section">
          <h3>Your skills</h3>
          {flows.map((flow) => (
            <div key={`${flow.scope}:${flow.id}`} className="studio__row">
              <div>
                <strong>{flow.name}</strong>{" "}
                <span className="hint">
                  rev {flow.revision} · {flow.steps.length} step(s)
                  {flow.commandAlias !== undefined ? ` · /${flow.commandAlias}` : ""}
                </span>
                <p className="hint">{flow.description}</p>
              </div>
              <div className="mapping__actions">
                <button
                  className="btn btn--small"
                  disabled={busy}
                  onClick={() => {
                    setRunFlow(flow);
                    setRunInputs({});
                    setRun(null);
                  }}
                >
                  Run
                </button>
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => {
                    setFlowDraft(flow);
                    setFlowProblems([]);
                  }}
                >
                  Edit
                </button>
                <button
                  className="btn btn--ghost btn--small"
                  disabled={busy}
                  onClick={() => void exportDefinition("skill", exportFlowPackage(flow), flow.id)}
                >
                  Export
                </button>
                <button
                  className="btn btn--ghost btn--small"
                  disabled={busy}
                  onClick={() =>
                    void guarded(() => runtime.stores.project.remove("flows", flow.id))
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {runFlow !== null && (
        <section className="state__section studio__run">
          <h3>{runFlow.name}</h3>
          {run === null ? (
            <>
              {runFlow.inputs.map((input) => (
                <label key={input.key} className="field">
                  <span>{input.label}</span>
                  <input
                    value={runInputs[input.key] ?? ""}
                    onChange={(e) =>
                      setRunInputs((held) => ({ ...held, [input.key]: e.target.value }))
                    }
                  />
                </label>
              ))}
              <div className="mapping__actions">
                <button
                  className="btn btn--primary"
                  disabled={busy}
                  onClick={() => void startRun(runFlow)}
                >
                  Start
                </button>
                <button className="btn btn--ghost" onClick={() => setRunFlow(null)}>
                  Close
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="hint">
                Run {run.id} — {run.status.replace(/_/g, " ")}
                {run.agentsUsed.length > 0
                  ? ` · agents: ${run.agentsUsed.map((held) => `${held.id} rev ${String(held.revision)}`).join(", ")}`
                  : ""}
              </p>
              {run.steps.map((step) => (
                <div key={step.id} className="term__text">
                  {step.status === "done" ? "✓" : step.status === "failed" ? "✕" : "…"} {step.title}{" "}
                  — {step.summary}
                </div>
              ))}
              {run.status === "awaiting_approval" && (
                <div className="studio__approval">
                  <p className="status">{run.approval?.question}</p>
                  {run.proposals.map((edit) => (
                    <label key={edit.id} className="check">
                      <input
                        type="checkbox"
                        checked={accepted.has(edit.id)}
                        onChange={(e) => {
                          const next = new Set(accepted);
                          if (e.target.checked) next.add(edit.id);
                          else next.delete(edit.id);
                          setAccepted(next);
                        }}
                      />
                      “{edit.find}” → “{edit.replace}” — {edit.reason}
                    </label>
                  ))}
                  <div className="mapping__actions">
                    <button
                      className="btn btn--primary"
                      disabled={busy}
                      onClick={() =>
                        void guarded(async () => {
                          setRun(await runtime.runner.approve(run.id, [...accepted]));
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void guarded(async () => {
                          setRun(await runtime.runner.reject(run.id));
                        })
                      }
                    >
                      Reject — apply nothing
                    </button>
                  </div>
                </div>
              )}
              {run.report !== undefined && (
                <pre className="universe__context">{run.report.lines.join("\n")}</pre>
              )}
              <div className="mapping__actions">
                <button className="btn btn--ghost" onClick={() => setRunFlow(null)}>
                  Close
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** One row that appends a step of a chosen kind with its minimal fields. */
function AddStep({
  agents,
  onAdd,
}: {
  agents: readonly string[];
  onAdd: (step: FlowStep) => void;
}) {
  const [kind, setKind] = useState<FlowStep["kind"]>("run_agent");
  const [agent, setAgent] = useState(agents[0] ?? "");
  const [instruction, setInstruction] = useState("");
  const [query, setQuery] = useState("");
  const [question, setQuestion] = useState("Apply the accepted changes?");
  const seq = useState(() => ({ n: 0 }))[0];

  const add = () => {
    seq.n += 1;
    const id = `step-${String(Date.now())}-${String(seq.n)}`;
    switch (kind) {
      case "run_agent":
        onAdd({ kind, id, title: `Run ${agent}`, agent, instruction });
        return;
      case "search_project":
        onAdd({ kind, id, title: `Search: ${query}`, query });
        return;
      case "request_approval":
        onAdd({ kind, id, title: "Author approval", question });
        return;
      case "run_story_build":
        onAdd({ kind, id, title: "Run Story Build" });
        return;
      case "run_story_tests":
        onAdd({ kind, id, title: "Run story tests" });
        return;
      case "apply_staged_changes":
        onAdd({ kind, id, title: "Apply accepted edits" });
        return;
      case "generate_report":
        onAdd({ kind, id, title: "Produce the report" });
        return;
      default:
        return;
    }
  };

  return (
    <div className="studio__add">
      <select value={kind} onChange={(e) => setKind(e.target.value as FlowStep["kind"])}>
        <option value="run_agent">Run agent</option>
        <option value="search_project">Search project</option>
        <option value="run_story_build">Run Story Build</option>
        <option value="run_story_tests">Run story tests</option>
        <option value="request_approval">Request approval</option>
        <option value="apply_staged_changes">Apply staged changes</option>
        <option value="generate_report">Generate report</option>
      </select>
      {kind === "run_agent" && (
        <>
          <select value={agent} onChange={(e) => setAgent(e.target.value)}>
            {agents.map((held) => (
              <option key={held} value={held}>
                {held}
              </option>
            ))}
          </select>
          <input
            placeholder="Instruction for the agent"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </>
      )}
      {kind === "search_project" && (
        <input
          placeholder="Search text, or {input.key}"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {kind === "request_approval" && (
        <input value={question} onChange={(e) => setQuestion(e.target.value)} />
      )}
      <button className="btn btn--small" onClick={add}>
        Add step
      </button>
    </div>
  );
}
