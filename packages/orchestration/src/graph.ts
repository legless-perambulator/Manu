import type { ArtifactKind, RoutingClass, WorkflowRun } from "@jellytind/domain";
import type { SpecialistId } from "@jellytind/agent-runtime";
import { agentById, canEdit } from "@jellytind/agent-runtime";
import { openDisagreements } from "./conflicts";
import type { BuildResult } from "./artifacts";
import {
  OrchestrationError,
  type AgentNode,
  type WorkflowCondition,
  type WorkflowDefinition,
  type WorkflowNode,
} from "./types";

/**
 * The workflow graph.
 *
 * Deterministic and checked before it runs: every node that reads an artifact
 * must have an earlier node producing it, every agent named must exist, and a
 * step that writes must be run by a specialist permitted to write. A workflow
 * that cannot work is refused at definition time with a sentence naming the
 * node — not discovered at step six of a chapter (docs/ORCHESTRATION.md).
 */

/** Every node, in execution order, including parallel branches and conditionals. */
export function walkNodes(nodes: readonly WorkflowNode[]): WorkflowNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "parallel") return [node, ...node.branches];
    if (node.kind === "conditional") return [node, ...walkNodes(node.children)];
    return [node];
  });
}

export function nodeById(workflow: WorkflowDefinition, id: string): WorkflowNode {
  const found = walkNodes(workflow.nodes).find((node) => node.id === id);
  if (found === undefined) {
    throw new OrchestrationError("unknown_node", `No node "${id}" in ${workflow.name}.`, {
      details: { node: id },
    });
  }
  return found;
}

function producedBy(node: WorkflowNode): ArtifactKind | null {
  switch (node.kind) {
    case "agent":
      return node.produces;
    case "merge":
      return node.produces;
    case "build":
      return node.produces;
    default:
      return null;
  }
}

function readsOf(node: WorkflowNode): readonly ArtifactKind[] {
  switch (node.kind) {
    case "agent":
    case "merge":
    case "approval":
    case "apply":
      return node.reads;
    default:
      return [];
  }
}

/**
 * Validate a workflow.
 *
 * The rules are deliberately boring, and all of them have caught something:
 * unique ids, no unknown conditions, no reading an artifact nobody produces,
 * no writing agent that lacks `edit_manuscript`, and no `apply` without a
 * checkpoint and an approval before it.
 */
export function validateWorkflowGraph(
  workflow: Omit<WorkflowDefinition, "agents" | "routingClasses">,
  conditions: ReadonlyMap<string, WorkflowCondition>,
): void {
  const nodes = workflow.nodes;
  if (nodes.length === 0) {
    throw new OrchestrationError("invalid_workflow", "A workflow needs at least one node.");
  }

  const seen = new Set<string>();
  const available = new Set<ArtifactKind>();
  let checkpointed = false;
  let approved = false;

  const visit = (list: readonly WorkflowNode[]): void => {
    for (const node of list) {
      if (seen.has(node.id)) {
        throw new OrchestrationError("invalid_workflow", `Two nodes share the id "${node.id}".`);
      }
      seen.add(node.id);

      for (const kind of readsOf(node)) {
        if (!available.has(kind)) {
          throw new OrchestrationError(
            "invalid_workflow",
            `Node "${node.id}" reads ${kind}, which no earlier node produces.`,
            { details: { node: node.id, reads: kind } },
          );
        }
      }

      switch (node.kind) {
        case "agent": {
          assertAgent(node);
          break;
        }
        case "parallel": {
          if (node.branches.length < 2) {
            throw new OrchestrationError(
              "invalid_workflow",
              `Parallel node "${node.id}" needs at least two branches; one branch is a sequence.`,
            );
          }
          // Branches are independent by definition: none may read what another
          // produces, or "parallel" would be a lie about the ordering.
          const produced = new Set(node.branches.map((branch) => branch.produces));
          for (const branch of node.branches) {
            if (seen.has(branch.id)) {
              throw new OrchestrationError(
                "invalid_workflow",
                `Two nodes share the id "${branch.id}".`,
              );
            }
            seen.add(branch.id);
            assertAgent(branch);
            for (const kind of branch.reads) {
              if (produced.has(kind)) {
                throw new OrchestrationError(
                  "invalid_workflow",
                  `Branch "${branch.id}" reads ${kind}, which a sibling branch produces. Parallel branches must be independent.`,
                );
              }
              if (!available.has(kind)) {
                throw new OrchestrationError(
                  "invalid_workflow",
                  `Branch "${branch.id}" reads ${kind}, which no earlier node produces.`,
                );
              }
            }
          }
          for (const branch of node.branches) available.add(branch.produces);
          break;
        }
        case "conditional": {
          if (!conditions.has(node.when)) {
            throw new OrchestrationError(
              "invalid_workflow",
              `Node "${node.id}" is guarded by "${node.when}", which is not a condition Manu has.`,
              { details: { condition: node.when } },
            );
          }
          visit(node.children);
          break;
        }
        case "checkpoint":
          checkpointed = true;
          break;
        case "approval":
          approved = true;
          break;
        case "apply": {
          if (!checkpointed) {
            throw new OrchestrationError(
              "invalid_workflow",
              `Node "${node.id}" writes to the manuscript with no checkpoint before it.`,
            );
          }
          if (!approved) {
            throw new OrchestrationError(
              "invalid_workflow",
              `Node "${node.id}" writes to the manuscript with no approval gate before it.`,
            );
          }
          break;
        }
        default:
          break;
      }

      const produces = producedBy(node);
      if (produces !== null && node.kind !== "parallel") available.add(produces);
    }
  };

  visit(nodes);
}

function assertAgent(node: AgentNode): void {
  let definition;
  try {
    definition = agentById(node.agent);
  } catch (cause) {
    throw new OrchestrationError(
      "invalid_workflow",
      `Node "${node.id}" names "${node.agent}", which is not a specialist Manu has.`,
      { cause },
    );
  }
  // A step producing prose must be run by a specialist allowed to write it.
  if (node.produces === "draft" && !canEdit(definition)) {
    throw new OrchestrationError(
      "invalid_workflow",
      `Node "${node.id}" produces a draft, but ${definition.name} does not hold edit_manuscript.`,
      { details: { agent: node.agent } },
    );
  }
}

/** The specialists and routing classes a workflow uses, derived from its nodes. */
export function surfaceOf(nodes: readonly WorkflowNode[]): {
  agents: readonly SpecialistId[];
  routingClasses: readonly RoutingClass[];
} {
  const agents = new Set<SpecialistId>();
  const classes = new Set<RoutingClass>();
  for (const node of walkNodes(nodes)) {
    if (node.kind !== "agent") continue;
    agents.add(node.agent);
    classes.add(node.routingClass);
  }
  return { agents: [...agents], routingClasses: [...classes] };
}

// ── Conditions ──────────────────────────────────────────────────────────────

/**
 * The predicates a conditional node may name.
 *
 * A closed registry, like the skills operation registry, and for the same
 * reason: a workflow definition is data, and data must not be able to execute
 * something nobody wrote.
 */
export const CONDITIONS: readonly WorkflowCondition[] = [
  {
    id: "build_has_errors",
    description: "The last Story Build in this run reported at least one error.",
    holds: ({ run }) => {
      const build = latestBuild(run);
      return build !== null && build.errors > 0;
    },
  },
  {
    id: "build_is_clean",
    description: "The last Story Build in this run reported no errors.",
    holds: ({ run }) => {
      const build = latestBuild(run);
      return build !== null && build.errors === 0;
    },
  },
  {
    id: "has_open_disagreements",
    description: "Specialists disagree about something nobody has settled.",
    holds: ({ run }) => openDisagreements(run.disagreements).length > 0,
  },
  {
    id: "review_wants_changes",
    description: "A reviewer asked for something to be revised or cut.",
    holds: ({ run }) => {
      const merged = run.artifacts.find((artifact) => artifact.kind === "merged_review");
      if (merged === undefined) return false;
      const notes = (merged.payload as { notes?: ReadonlyArray<{ stance: string }> }).notes ?? [];
      return notes.some((note) => note.stance === "revise" || note.stance === "cut");
    },
  },
];

const CONDITION_MAP = new Map(CONDITIONS.map((condition) => [condition.id, condition]));

export function conditionById(id: string): WorkflowCondition {
  const found = CONDITION_MAP.get(id);
  if (found === undefined) {
    throw new OrchestrationError("invalid_workflow", `No condition named "${id}".`);
  }
  return found;
}

export function conditionMap(): ReadonlyMap<string, WorkflowCondition> {
  return CONDITION_MAP;
}

function latestBuild(run: WorkflowRun): BuildResult | null {
  const builds = run.artifacts.filter((artifact) => artifact.kind === "build_result");
  const last = builds.at(-1);
  return last === undefined ? null : (last.payload as BuildResult);
}
