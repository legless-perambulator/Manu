import { MODEL_CLASSES, isMutating, type AgentPermission } from "@jellytind/agent-runtime";
import { catalogTools, isReadOnlyTool, type CatalogGroup } from "./catalog";
import {
  CONDITION_MEASURES,
  CONTEXT_RECIPES,
  FLOW_OUTPUTS,
  type CustomAgentDefinition,
  type FlowDefinition,
  type FlowStep,
} from "./types";

/**
 * Validation before activation (§24).
 *
 * Everything here answers before anything runs: a missing tool, a pinned
 * model that is not configured, a permission the allowlist cannot work
 * under, an unknown agent, a condition outside the closed set, an
 * unsupported nested branch. The result is a list of sentences, because the
 * writer fixing a definition deserves sentences.
 */

const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export interface ValidationContext {
  readonly catalog: readonly CatalogGroup[];
  /** Model ids actually configured, for pinned policies. */
  readonly availableModels: readonly string[];
  /** Shipped specialist ids plus saved custom agent ids, for flows. */
  readonly availableAgents: readonly string[];
}

export function validateAgent(
  agent: CustomAgentDefinition,
  context: ValidationContext,
): readonly string[] {
  const problems: string[] = [];
  if (!ID_PATTERN.test(agent.id)) {
    problems.push(`"${agent.id}" is not a usable id — lowercase words joined by - or _.`);
  }
  if (agent.name.trim() === "") problems.push("The agent needs a name.");
  if (agent.purpose.trim() === "") problems.push("The agent needs a purpose.");
  if (agent.instructions.trim() === "") problems.push("The agent needs instructions.");

  const tools = catalogTools(context.catalog);
  for (const name of agent.tools) {
    const tool = tools.get(name);
    if (tool === undefined) {
      problems.push(`The tool "${name}" does not exist in this project.`);
      continue;
    }
    if (!agent.permissions.includes(tool.permission)) {
      problems.push(
        `"${tool.title}" needs the "${tool.permission.replace(/_/g, " ")}" permission, which this agent was not given.`,
      );
    }
  }

  // The reverse mismatch: a mutating permission granted with no tool that
  // uses it widens the grant for nothing. Unsafe by default; say so.
  for (const permission of agent.permissions) {
    if (!isMutating(permission)) continue;
    const used = agent.tools.some((name) => tools.get(name)?.permission === permission);
    if (!used && permission !== "edit_manuscript") {
      problems.push(
        `The "${permission.replace(/_/g, " ")}" permission is granted but no chosen tool uses it. Remove it or add the tool.`,
      );
    }
  }

  if (agent.model.kind === "class" && !MODEL_CLASSES.includes(agent.model.modelClass)) {
    problems.push(`"${String(agent.model.modelClass)}" is not a model class Manu has.`);
  }
  if (agent.model.kind === "pinned" && !context.availableModels.includes(agent.model.modelId)) {
    problems.push(
      `The pinned model "${agent.model.modelId}" is not configured. Configure it or use routing.`,
    );
  }

  if (
    agent.context.recipe !== undefined &&
    !(CONTEXT_RECIPES as readonly string[]).includes(agent.context.recipe)
  ) {
    problems.push(`"${agent.context.recipe}" is not a context recipe Manu has.`);
  }

  if (agent.output.kind !== "notes" && agent.output.kind !== "proposals") {
    problems.push("The agent's output must be notes or proposals.");
  }
  // Proposals still never apply themselves; the permission records intent and
  // gates nothing extra, but an agent proposing edits without the manuscript
  // in front of it cannot do the work.
  if (agent.output.kind === "proposals" && !agent.permissions.includes("read_manuscript")) {
    problems.push("An agent that proposes edits needs to read the manuscript.");
  }

  if (agent.commandAlias !== undefined && !/^[a-z][a-z0-9-]*$/.test(agent.commandAlias)) {
    problems.push(`"${agent.commandAlias}" is not a usable command name.`);
  }
  return problems;
}

function* walk(steps: readonly FlowStep[]): Generator<FlowStep> {
  for (const step of steps) {
    yield step;
    if (step.kind === "branch") {
      yield* walk(step.then);
      yield* walk(step.otherwise);
    }
  }
}

export function validateFlow(flow: FlowDefinition, context: ValidationContext): readonly string[] {
  const problems: string[] = [];
  if (!ID_PATTERN.test(flow.id)) {
    problems.push(`"${flow.id}" is not a usable id — lowercase words joined by - or _.`);
  }
  if (flow.name.trim() === "") problems.push("The skill needs a name.");
  if (flow.steps.length === 0) problems.push("The skill needs at least one step.");
  if (!FLOW_OUTPUTS.includes(flow.output)) {
    problems.push(`"${String(flow.output)}" is not an output a skill can produce.`);
  }

  const tools = catalogTools(context.catalog);
  const ids = new Set<string>();
  let sawApproval = false;
  for (const step of walk(flow.steps)) {
    if (ids.has(step.id)) problems.push(`Two steps share the id "${step.id}".`);
    ids.add(step.id);
    if (step.title.trim() === "") problems.push(`Step "${step.id}" needs a title.`);

    switch (step.kind) {
      case "run_agent": {
        if (!context.availableAgents.includes(step.agent)) {
          problems.push(
            `Step "${step.title}" uses the agent "${step.agent}", which does not exist here.`,
          );
        }
        if (
          step.retry !== undefined &&
          (step.retry.maxAttempts < 1 || step.retry.maxAttempts > 3)
        ) {
          problems.push(`Step "${step.title}" retries out of bounds — 1 to 3 attempts.`);
        }
        break;
      }
      case "run_tool": {
        const tool = tools.get(step.tool);
        if (tool === undefined) {
          problems.push(`Step "${step.title}" uses the tool "${step.tool}", which does not exist.`);
        } else if (!isReadOnlyTool(tool) && tool.pluginId === undefined) {
          problems.push(
            `Step "${step.title}" uses "${tool.title}", which changes the project. Changes go through Apply staged changes.`,
          );
        }
        break;
      }
      case "search_project": {
        if (step.query.trim() === "") problems.push(`Step "${step.title}" searches for nothing.`);
        const match = /^\{input\.([a-z0-9_]+)\}$/.exec(step.query.trim());
        if (match !== null && !flow.inputs.some((input) => input.key === match[1])) {
          problems.push(
            `Step "${step.title}" searches for the input "${match[1] ?? ""}", which this skill does not declare.`,
          );
        }
        break;
      }
      case "compile_context": {
        if (!(CONTEXT_RECIPES as readonly string[]).includes(step.recipe)) {
          problems.push(`Step "${step.title}" names a context recipe Manu does not have.`);
        }
        break;
      }
      case "branch": {
        if (!CONDITION_MEASURES.includes(step.condition.measure)) {
          problems.push(
            `Step "${step.title}" tests "${String(step.condition.measure)}", which is not a measure.`,
          );
        }
        if (!Number.isFinite(step.condition.value) || step.condition.value < 0) {
          problems.push(`Step "${step.title}" compares against an unusable number.`);
        }
        for (const child of [...step.then, ...step.otherwise]) {
          if (child.kind === "branch") {
            problems.push(
              `Step "${step.title}" nests a branch inside a branch, which Manu does not support yet.`,
            );
          }
        }
        break;
      }
      case "request_approval": {
        sawApproval = true;
        if (step.question.trim() === "") {
          problems.push(`Step "${step.title}" asks for approval without a question.`);
        }
        break;
      }
      case "apply_staged_changes": {
        if (!sawApproval) {
          problems.push(
            `Step "${step.title}" applies changes with no approval gate before it. Add one.`,
          );
        }
        break;
      }
      case "run_story_build":
      case "run_story_tests":
      case "generate_report":
        break;
    }
  }

  if (flow.commandAlias !== undefined && !/^[a-z][a-z0-9-]*$/.test(flow.commandAlias)) {
    problems.push(`"${flow.commandAlias}" is not a usable command name.`);
  }
  return problems;
}

/**
 * The permission summary shown before saving (§5): what this agent can do
 * and — just as loudly — what it cannot.
 */
export function permissionSummary(
  agent: CustomAgentDefinition,
  catalog: readonly CatalogGroup[],
): { readonly can: readonly string[]; readonly cannot: readonly string[] } {
  const tools = catalogTools(catalog);
  const can: string[] = [];
  const cannot: string[] = [];

  const has = (permission: AgentPermission) => agent.permissions.includes(permission);
  if (has("read_manuscript")) can.push("Read the manuscript");
  else cannot.push("Read the manuscript");
  if (has("read_canon")) can.push("Read the story record — characters, facts, threads");
  else cannot.push("Read the story record");
  if (has("run_research")) can.push("Save sourced research items");
  if (has("edit_plans")) can.push("Draft and revise scene plans");
  const pluginNames = agent.tools.flatMap((name) => {
    const tool = tools.get(name);
    return tool !== undefined && tool.pluginId !== undefined ? [tool.title] : [];
  });
  if (pluginNames.length > 0) can.push(`Use approved plugin tools: ${pluginNames.join(", ")}`);

  if (agent.output.kind === "proposals") {
    can.push("Propose manuscript edits — staged for your review, never applied by itself");
  }
  cannot.push(
    has("edit_manuscript") ? "Apply edits without your approval" : "Modify the manuscript",
  );
  if (!has("delete_entities")) cannot.push("Delete anything from the story record");
  if (!has("apply_refactors")) cannot.push("Run Story Refactor changes");
  if (!has("use_external_services") && pluginNames.length === 0) {
    cannot.push("Reach anything outside this project");
  }
  return { can, cannot };
}
