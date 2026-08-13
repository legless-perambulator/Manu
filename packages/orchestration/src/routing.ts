import { EMPTY_COST, ROUTING_CLASSES } from "@jellytind/domain";
import type { RoutingClass, RunCost } from "@jellytind/domain";
import type { WorkflowDefinition, WorkflowNode } from "./types";

/**
 * Which model a step gets, and what the run actually spent.
 *
 * A step declares a **class of work**, never a model: structure wants
 * reasoning, prose wants a prose model, bulk reading is fine on something
 * smaller, and metadata wants no model at all. The routing table is the one
 * place a class becomes a model id, so changing provider is a settings change
 * rather than an edit to seven workflows (docs/MODEL_ROUTER.md).
 *
 * Cost is **counted, never estimated in money**. Manu does not know what the
 * writer pays, prices change, and a number in pounds that turned out to be
 * wrong is worse than no number. What it reports is calls and tokens per
 * class, which is what the writer can act on.
 */

export interface RoutingTable {
  /** Model id for each class. A class with no entry runs with no model. */
  readonly models: Readonly<Partial<Record<RoutingClass, string>>>;
}

export interface RoutingDecision {
  readonly routingClass: RoutingClass;
  readonly modelId?: string;
  /** Set when the class has no model configured. */
  readonly unavailable?: string;
}

export const DESCRIBE_CLASS: Readonly<Record<RoutingClass, string>> = {
  premium_reasoning: "premium reasoning — structure, causality, diagnosis",
  premium_prose: "premium prose — text the writer will read",
  cheap_analysis: "cheap analysis — bulk reading where a smaller model is enough",
  local_metadata: "local metadata — no model; the project answers it",
};

export function route(table: RoutingTable, routingClass: RoutingClass): RoutingDecision {
  if (routingClass === "local_metadata") {
    return { routingClass };
  }
  const modelId = table.models[routingClass];
  return modelId === undefined
    ? {
        routingClass,
        unavailable: `no model is configured for ${routingClass.replace(/_/g, " ")}`,
      }
    : { routingClass, modelId };
}

/**
 * What a workflow will ask for, before it runs.
 *
 * A plan in calls, by class — so a writer can see that a chapter workflow is
 * three premium-reasoning steps and one premium-prose step before spending
 * any of it.
 */
export function planCost(workflow: WorkflowDefinition): Record<RoutingClass, number> {
  const plan = Object.fromEntries(ROUTING_CLASSES.map((entry) => [entry, 0])) as Record<
    RoutingClass,
    number
  >;
  const walk = (nodes: readonly WorkflowNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "agent") plan[node.routingClass] += 1;
      if (node.kind === "parallel") walk(node.branches);
      if (node.kind === "conditional") walk(node.children);
    }
  };
  walk(workflow.nodes);
  return plan;
}

/** Add one step's usage to a run's ledger. */
export function addCost(
  cost: RunCost,
  routingClass: RoutingClass,
  usage: { calls?: number; inputTokens?: number; outputTokens?: number },
): RunCost {
  const calls = usage.calls ?? 1;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const existing = cost.byClass[routingClass] ?? { calls: 0, inputTokens: 0, outputTokens: 0 };

  return {
    byClass: {
      ...cost.byClass,
      [routingClass]: {
        calls: existing.calls + calls,
        inputTokens: existing.inputTokens + inputTokens,
        outputTokens: existing.outputTokens + outputTokens,
      },
    },
    calls: cost.calls + calls,
    inputTokens: cost.inputTokens + inputTokens,
    outputTokens: cost.outputTokens + outputTokens,
  };
}

export { EMPTY_COST };

/** The ledger in one line: counts, with no money invented. */
export function describeCost(cost: RunCost): string {
  if (cost.calls === 0) return "No model calls.";
  const parts = Object.entries(cost.byClass).map(
    ([routingClass, entry]) => `${String(entry.calls)} ${routingClass.replace(/_/g, " ")}`,
  );
  return `${String(cost.calls)} model call(s) — ${parts.join(", ")} · ${String(cost.inputTokens)} in / ${String(cost.outputTokens)} out tokens`;
}
