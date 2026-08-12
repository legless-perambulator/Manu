import {
  DEPENDENCY_KIND_INFO,
  influenceOf,
  type Dependency,
  type DependencyKind,
} from "@jellytind/domain";

/**
 * The causality graph.
 *
 * Edges are stored as the writer wrote them and traversed on a single
 * normalised arrow — **cause → effect** — so `A requires B` and `B enables A`
 * describe the same influence and behave identically in every query
 * (docs/STORY_REFACTOR.md).
 *
 * Every traversal here is cycle-safe. A causal cycle is usually a mistake, but
 * it is a mistake a writer can make, and a graph that crashed on one would be
 * useless in exactly the moment it was needed. Cycles are reported, never fatal.
 */

/** One traversal step, in the direction influence runs. */
export interface DependencyStep {
  readonly dependencyId: string;
  readonly kind: DependencyKind;
  /** Upstream end of the influence. */
  readonly causeId: string;
  /** Downstream end. */
  readonly effectId: string;
  /** The relation as the writer stated it, which may be the other way round. */
  readonly statedFromId: string;
  readonly statedToId: string;
}

/** A chain of steps from one node to another. */
export interface DependencyPath {
  readonly fromId: string;
  readonly toId: string;
  readonly steps: readonly DependencyStep[];
}

/** One entity caught in a blast radius, and why. */
export interface AffectedEntity {
  readonly id: string;
  /** Steps along the shortest path from the changed entity. 1 = direct. */
  readonly distance: number;
  /** How it is reached. The shortest path first. */
  readonly paths: readonly DependencyPath[];
  /** Whether it depends on the entity directly, or only through others. */
  readonly direct: boolean;
}

export interface BlastRadius {
  readonly entityId: string;
  /** Everything downstream, nearest first. */
  readonly affected: readonly AffectedEntity[];
  readonly total: number;
  /** True when traversal met a cycle; the result is still complete. */
  readonly cyclic: boolean;
  /** The dependency edges walked, for the UI to draw. */
  readonly edges: readonly DependencyStep[];
}

export interface TraversalOptions {
  /** Only follow these relation kinds. Omit for all of them. */
  readonly kinds?: readonly DependencyKind[];
  /** How far to walk. Omit for as far as it goes. */
  readonly maxDepth?: number;
}

/** How many paths to keep per affected entity — enough to explain, not to flood. */
const MAX_PATHS_PER_ENTITY = 3;

export class CausalityGraph {
  /** Every edge, normalised, keyed by its upstream end. */
  private readonly downstream = new Map<string, DependencyStep[]>();
  /** The same edges keyed by their downstream end. */
  private readonly upstream = new Map<string, DependencyStep[]>();
  private readonly steps: DependencyStep[] = [];

  /**
   * Build from the registered dependencies.
   *
   * Only `confirmed` edges are included by default: a model's proposal is not
   * story architecture until a human says so, and planning a refactor against
   * a guess would be worse than planning against nothing.
   */
  constructor(dependencies: readonly Dependency[], options: { includeProposed?: boolean } = {}) {
    for (const dependency of dependencies) {
      if (dependency.status === "rejected") continue;
      if (dependency.status === "proposed" && options.includeProposed !== true) continue;

      const { causeId, effectId } = influenceOf(dependency);
      const step: DependencyStep = {
        dependencyId: dependency.id,
        kind: dependency.kind,
        causeId,
        effectId,
        statedFromId: dependency.fromId,
        statedToId: dependency.toId,
      };
      this.steps.push(step);
      push(this.downstream, causeId, step);
      push(this.upstream, effectId, step);
    }
  }

  /** Every normalised edge in the graph. */
  get edges(): readonly DependencyStep[] {
    return this.steps;
  }

  /** Every node with at least one edge. */
  nodes(): string[] {
    return [...new Set(this.steps.flatMap((s) => [s.causeId, s.effectId]))].sort();
  }

  /**
   * What this entity rests on — one step upstream.
   *
   * "Dependencies" in the ordinary sense: remove one of these and the entity
   * loses something it was built on.
   */
  getDependencies(entityId: string, options: TraversalOptions = {}): DependencyStep[] {
    return (this.upstream.get(entityId) ?? []).filter((s) => allowed(s, options));
  }

  /** What rests on this entity — one step downstream. */
  getDependents(entityId: string, options: TraversalOptions = {}): DependencyStep[] {
    return (this.downstream.get(entityId) ?? []).filter((s) => allowed(s, options));
  }

  /** Everything downstream, at any distance. Cycle-safe. */
  getTransitiveDependents(entityId: string, options: TraversalOptions = {}): string[] {
    return this.reach(entityId, "down", options).order;
  }

  /** Everything upstream, at any distance. Cycle-safe. */
  getTransitiveDependencies(entityId: string, options: TraversalOptions = {}): string[] {
    return this.reach(entityId, "up", options).order;
  }

  /**
   * How one entity leads to another, if it does.
   *
   * The shortest chain, so the explanation a writer reads is the most direct
   * one rather than whichever the search happened to find first. `null` when
   * nothing connects them in that direction.
   */
  getDependencyPath(
    fromId: string,
    toId: string,
    options: TraversalOptions = {},
  ): DependencyPath | null {
    if (fromId === toId) return { fromId, toId, steps: [] };
    return this.shortestPaths(fromId, options).get(toId)?.[0] ?? null;
  }

  /**
   * What a change to this entity may reach.
   *
   * The question the whole graph exists to answer: *if I cut this scene, what
   * later story elements depend on it?* Every affected entity carries the path
   * that reaches it, because "SCENE_0051 is affected" is not actionable and
   * "SCENE_0051, because it resolves the thread this scene introduces" is.
   */
  calculateBlastRadius(entityId: string, options: TraversalOptions = {}): BlastRadius {
    const paths = this.shortestPaths(entityId, options);
    const direct = new Set(this.getDependents(entityId, options).map((s) => s.effectId));

    const affected: AffectedEntity[] = [...paths.entries()]
      .map(([id, found]) => ({
        id,
        distance: (found[0] as DependencyPath).steps.length,
        paths: found.slice(0, MAX_PATHS_PER_ENTITY),
        direct: direct.has(id),
      }))
      .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));

    const walked = new Set(affected.flatMap((a) => a.paths.flatMap((p) => p.steps)));

    return {
      entityId,
      affected,
      total: affected.length,
      cyclic: this.reach(entityId, "down", options).cyclic,
      edges: [...walked],
    };
  }

  /**
   * Every cycle the graph contains, as node lists.
   *
   * Reported rather than prevented: a writer may register a genuine feedback
   * loop, and refusing the edge would be the system overruling them. What the
   * system owes them is to say it is there.
   */
  findCycles(options: TraversalOptions = {}): string[][] {
    const cycles: string[][] = [];
    const seen = new Set<string>();
    const onPath: string[] = [];
    const inPath = new Set<string>();

    const walk = (node: string): void => {
      inPath.add(node);
      onPath.push(node);
      for (const step of this.getDependents(node, options)) {
        const next = step.effectId;
        if (inPath.has(next)) {
          const at = onPath.indexOf(next);
          const cycle = onPath.slice(at);
          // One canonical rotation per cycle, so a loop is reported once.
          const key = canonicalCycle(cycle).join(">");
          if (!cycles.some((c) => canonicalCycle(c).join(">") === key)) cycles.push(cycle);
          continue;
        }
        if (!seen.has(next)) {
          seen.add(next);
          walk(next);
        }
      }
      onPath.pop();
      inPath.delete(node);
    };

    for (const node of this.nodes()) {
      if (seen.has(node)) continue;
      seen.add(node);
      walk(node);
    }
    return cycles;
  }

  // ── Traversal ─────────────────────────────────────────────────────────────

  /** Breadth-first reach in one direction, with a visited set as the cycle guard. */
  private reach(
    start: string,
    direction: "up" | "down",
    options: TraversalOptions,
  ): { order: string[]; cyclic: boolean } {
    const order: string[] = [];
    const seen = new Set<string>([start]);
    let frontier = [start];
    let depth = 0;
    let cyclic = false;

    while (frontier.length > 0 && (options.maxDepth === undefined || depth < options.maxDepth)) {
      const next: string[] = [];
      for (const node of frontier) {
        const steps =
          direction === "down"
            ? this.getDependents(node, options)
            : this.getDependencies(node, options);
        for (const step of steps) {
          const other = direction === "down" ? step.effectId : step.causeId;
          if (seen.has(other)) {
            // Reaching the start again is a cycle; reaching a sibling is a
            // diamond, which is ordinary and not worth reporting.
            if (other === start) cyclic = true;
            continue;
          }
          seen.add(other);
          order.push(other);
          next.push(other);
        }
      }
      frontier = next;
      depth += 1;
    }
    return { order, cyclic };
  }

  /**
   * Shortest paths from one node to everything downstream.
   *
   * Breadth-first, so the first path found to a node is a shortest one; further
   * paths of the same length are kept because two independent routes to the
   * same scene is exactly the sort of thing a writer wants to see.
   */
  private shortestPaths(start: string, options: TraversalOptions): Map<string, DependencyPath[]> {
    const found = new Map<string, DependencyPath[]>();
    const distance = new Map<string, number>([[start, 0]]);
    let frontier: DependencyPath[] = [{ fromId: start, toId: start, steps: [] }];
    let depth = 0;

    while (frontier.length > 0 && (options.maxDepth === undefined || depth < options.maxDepth)) {
      const next: DependencyPath[] = [];
      for (const path of frontier) {
        for (const step of this.getDependents(path.toId, options)) {
          const to = step.effectId;
          if (to === start) continue;
          const reachedAt = distance.get(to);
          const here = depth + 1;
          if (reachedAt !== undefined && reachedAt < here) continue;

          const extended: DependencyPath = {
            fromId: start,
            toId: to,
            steps: [...path.steps, step],
          };
          const list = found.get(to);
          if (list === undefined) found.set(to, [extended]);
          else if (list.length < MAX_PATHS_PER_ENTITY) list.push(extended);

          if (reachedAt === undefined) {
            distance.set(to, here);
            next.push(extended);
          }
        }
      }
      frontier = next;
      depth += 1;
    }
    return found;
  }
}

function push(map: Map<string, DependencyStep[]>, key: string, step: DependencyStep): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [step]);
  else existing.push(step);
}

function allowed(step: DependencyStep, options: TraversalOptions): boolean {
  return options.kinds === undefined || options.kinds.includes(step.kind);
}

/** Rotate a cycle so the same loop always compares equal. */
function canonicalCycle(cycle: readonly string[]): string[] {
  if (cycle.length === 0) return [];
  let at = 0;
  for (let i = 1; i < cycle.length; i += 1) {
    if ((cycle[i] as string) < (cycle[at] as string)) at = i;
  }
  return [...cycle.slice(at), ...cycle.slice(0, at)];
}

/**
 * A path as a sentence a writer can read.
 *
 * Rendered along the influence arrow, so an edge written backwards — *the
 * confrontation requires the letter* — reads forwards here: *the letter is
 * required by the confrontation*. The chain always runs the way consequence
 * runs, whichever way the writer phrased any link in it.
 */
export function describePath(
  path: DependencyPath,
  label: (id: string) => string = (id) => id,
): string {
  if (path.steps.length === 0) return label(path.fromId);
  const parts = [label(path.fromId)];
  for (const step of path.steps) {
    parts.push(`→ ${DEPENDENCY_KIND_INFO[step.kind].arrowVerb} →`, label(step.effectId));
  }
  return parts.join(" ");
}
