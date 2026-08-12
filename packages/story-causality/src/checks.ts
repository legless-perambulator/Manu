import { describeDependency, influenceOf, type Dependency } from "@jellytind/domain";
import { CausalityGraph } from "./graph";

/**
 * Deterministic checks on the registered causality graph.
 *
 * A dependency is an authored claim about the story's structure, and like any
 * other authored claim it can go stale: the scene it named gets cut, the
 * chapters get reordered, the same edge gets registered twice. None of that is
 * visible without looking, which is what these do.
 *
 * Everything here is arithmetic over recorded data. Whether a dependency is
 * *true* — whether the confrontation really does rest on the letter — is the
 * writer's claim, and nothing checks it.
 */

export type DependencyFindingKind =
  "dangling_endpoint" | "self_dependency" | "duplicate" | "cycle" | "effect_precedes_cause";

export interface DependencyFinding {
  readonly kind: DependencyFindingKind;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly evidence: string;
  readonly entities: readonly string[];
  readonly dependencyId?: string;
  readonly sceneId?: string;
  readonly suggestedAction?: string;
}

export interface DependencyCheckInput {
  readonly dependencies: readonly Dependency[];
  /** Every entity ID that currently exists. */
  readonly existingIds: ReadonlySet<string>;
  /**
   * Scene IDs in story order, for the ordering check. Omit to skip it — a
   * project with no order to compare against gets no ordering findings rather
   * than guesses.
   */
  readonly sceneOrder?: readonly string[];
  /** Which scene each non-scene node happens in, where that is known. */
  readonly sceneOf?: ReadonlyMap<string, string>;
}

/**
 * Check the registered dependencies.
 *
 * Only confirmed edges are checked. A proposal that names a missing scene is
 * not a broken dependency — it is a proposal to reject, and reporting it as an
 * error would punish the writer for not having reviewed it yet.
 */
export function checkDependencies(input: DependencyCheckInput): DependencyFinding[] {
  const findings: DependencyFinding[] = [];
  const confirmed = input.dependencies.filter((d) => d.status === "confirmed");

  // ── Endpoints that no longer exist ────────────────────────────────────────

  for (const dependency of confirmed) {
    for (const endpoint of [dependency.fromId, dependency.toId]) {
      if (input.existingIds.has(endpoint)) continue;
      findings.push({
        kind: "dangling_endpoint",
        severity: "error",
        message: `A registered dependency names ${endpoint}, which no longer exists.`,
        evidence: `${dependency.id}: ${describeDependency(dependency)}.`,
        entities: [dependency.fromId, dependency.toId],
        dependencyId: dependency.id,
        suggestedAction:
          "Point the dependency at what replaced it, or remove the dependency if the link is gone.",
      });
    }

    if (dependency.fromId === dependency.toId) {
      findings.push({
        kind: "self_dependency",
        severity: "error",
        message: `${dependency.fromId} is registered as depending on itself.`,
        evidence: `${dependency.id}: ${describeDependency(dependency)}.`,
        entities: [dependency.fromId],
        dependencyId: dependency.id,
        suggestedAction: "Remove it, or point one end at what was meant.",
      });
    }
  }

  // ── The same link registered twice ────────────────────────────────────────

  const seen = new Map<string, Dependency>();
  for (const dependency of confirmed) {
    const key = `${dependency.kind}|${dependency.fromId}|${dependency.toId}`;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, dependency);
      continue;
    }
    findings.push({
      kind: "duplicate",
      severity: "info",
      message: `The same dependency is registered twice: ${describeDependency(dependency)}.`,
      evidence: `${first.id} and ${dependency.id} say the same thing.`,
      entities: [dependency.fromId, dependency.toId],
      dependencyId: dependency.id,
      suggestedAction: "Remove one of them.",
    });
  }

  // ── Loops ─────────────────────────────────────────────────────────────────

  const graph = new CausalityGraph(confirmed);
  for (const cycle of graph.findCycles()) {
    // A one-node loop is already reported, more usefully, as a self-dependency.
    if (cycle.length < 2) continue;
    findings.push({
      kind: "cycle",
      severity: "warning",
      message: `A causal loop: ${[...cycle, cycle[0] as string].join(" → ")}.`,
      evidence:
        "Each of these is registered as leading to the next, and the last leads back to the first.",
      entities: cycle,
      suggestedAction:
        "If the loop is real, leave it — traversal handles it. If it is not, one of these links points the wrong way.",
    });
  }

  // ── An effect recorded before its cause ───────────────────────────────────

  if (input.sceneOrder !== undefined) {
    const position = new Map(input.sceneOrder.map((id, at) => [id, at]));
    const sceneOf = input.sceneOf ?? new Map<string, string>();
    const at = (id: string): number | undefined => {
      const scene = position.has(id) ? id : sceneOf.get(id);
      return scene === undefined ? undefined : position.get(scene);
    };

    for (const dependency of confirmed) {
      const { causeId, effectId } = influenceOf(dependency);
      const cause = at(causeId);
      const effect = at(effectId);
      if (cause === undefined || effect === undefined || cause <= effect) continue;

      findings.push({
        kind: "effect_precedes_cause",
        severity: "warning",
        message: `${effectId} is registered as resting on ${causeId}, but it comes first in the story.`,
        evidence: `${causeId} is at position ${String(cause + 1)} in story order; ${effectId} is at ${String(effect + 1)}.`,
        entities: [causeId, effectId],
        dependencyId: dependency.id,
        sceneId: position.has(effectId) ? effectId : sceneOf.get(effectId),
        suggestedAction:
          "A warning, not an error: a flashback or a delayed reveal can be recorded this way on purpose. Check the direction of the link.",
      });
    }
  }

  return findings;
}
