import { useMemo } from "react";
import type { AgentDefinition, SpecialistId } from "@jellytind/agent-runtime";
import { AGENTS, agentById, canEdit } from "@jellytind/agent-runtime";

interface Props {
  value: SpecialistId | null;
  onChange: (id: SpecialistId | null) => void;
  /** What the wording of the request suggests, if anything. */
  suggestion: AgentDefinition | null;
  disabled: boolean;
}

/** Every tool any specialist can reach, so "cannot reach" is derived, not asserted. */
const ALL_TOOLS = [...new Set(AGENTS.flatMap((a) => a.tools))].sort();

const readable = (value: string) => value.replace(/_/g, " ");

/**
 * Choose which specialist answers, and see what that choice actually changes.
 *
 * The point of this panel is that the difference between two specialists is
 * inspectable: not a sentence about temperament, but the tools each one can
 * reach, the context recipe it compiles, the model class it runs on and the
 * shape of what it returns. A writer who wants to know why the Copy Editor did
 * not comment on the plot can read that it never had the tools to see it
 * (docs/SPECIALIST_AGENTS.md).
 */
export function SpecialistPicker({ value, onChange, suggestion, disabled }: Props) {
  const agent = value === null ? null : agentById(value);
  const denied = useMemo(
    () => (agent === null ? [] : ALL_TOOLS.filter((tool) => !agent.tools.includes(tool))),
    [agent],
  );

  return (
    <div className="specialist">
      <div className="field">
        <span>Agent</span>
        <select
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : (e.target.value as SpecialistId))
          }
        >
          <option value="">Author Agent — general investigation</option>
          {AGENTS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {suggestion !== null && suggestion.id !== value && (
        <p className="specialist__suggestion">
          This reads like work for the <strong>{suggestion.name}</strong>.{" "}
          <button
            className="btn btn--ghost btn--small"
            disabled={disabled}
            onClick={() => onChange(suggestion.id)}
          >
            Use it
          </button>
          <span className="hint">
            A recommendation, not a redirection — any agent can be asked anything.
          </span>
        </p>
      )}

      {agent !== null && (
        <div className="specialist__card">
          <p className="specialist__role">{agent.role}</p>

          <dl className="specialist__facts">
            <dt>Model class</dt>
            <dd>{agent.modelClass}</dd>
            <dt>Context</dt>
            <dd>
              {agent.contextRecipe === null
                ? "none — works on the passage alone"
                : readable(agent.contextRecipe)}
            </dd>
            <dt>Returns</dt>
            <dd>{readable(agent.outputShape)}</dd>
            <dt>Manuscript</dt>
            <dd>{canEdit(agent) ? "may propose edits" : "read-only"}</dd>
          </dl>

          <h4 className="agent__label">Responsible for</h4>
          <ul className="specialist__list">
            {agent.responsibilities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <h4 className="agent__label agent__label--inference">Deliberately not its job</h4>
          <ul className="specialist__list specialist__list--out">
            {agent.outOfScope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <details className="specialist__tools">
            <summary>
              {agent.tools.length} tool(s) it can reach · {denied.length} it cannot
            </summary>
            <p className="specialist__toolset">{agent.tools.join(" · ")}</p>
            {denied.length > 0 && (
              <>
                <h4 className="agent__label agent__label--inference">Refused by the executor</h4>
                <p className="specialist__toolset specialist__toolset--denied">
                  {denied.join(" · ")}
                </p>
              </>
            )}
          </details>

          {agent.handsOffTo.length > 0 && (
            <p className="hint">
              Usually hands off to {agent.handsOffTo.map((id) => agentById(id).name).join(", ")}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
