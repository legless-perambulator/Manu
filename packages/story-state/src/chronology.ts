import {
  boundsOf,
  durationMs,
  orderScenes,
  type Chapter,
  type Scene,
  type StoryDuration,
  type StoryEvent,
  type StoryTime,
  type TemporalLink,
  type TimeBounds,
} from "@jellytind/domain";
import { AppError } from "@jellytind/shared";
import { StoryTimeline } from "./timeline";
import type { StateTransition, TimelineView } from "./types";

export class ChronologyError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("chronology_error", message, details === undefined ? undefined : { details });
  }
}

/**
 * One point on the story timeline: a scene, or an event.
 *
 * Deliberately neutral — the chronology does not care whether something is on
 * the page. An event that predates the manuscript by forty years is as much a
 * timeline node as the scene it is remembered in, and giving them one shape is
 * what lets a single ordering cover both.
 */
export interface TimelineNode {
  readonly id: string;
  readonly kind: "scene" | "event";
  readonly label: string;
  readonly storyTime?: StoryTime;
  readonly duration?: StoryDuration;
  /** For events: the scene that puts this on the page, if any. */
  readonly sceneId?: string;
  readonly locationId?: string;
  readonly characterIds: readonly string[];
  readonly plotThreadIds: readonly string[];
  /**
   * Position in manuscript presentation order. Absent for material that is
   * never presented directly — an off-page event, a piece of backstory.
   */
  readonly presentationIndex?: number;
}

/** A node's resolved position in story time, after constraints are propagated. */
export interface ResolvedInterval {
  readonly nodeId: string;
  /** Bounds on when it starts. */
  readonly start: TimeBounds;
  /** Bounds on when it ends — equal to `start` when no duration is recorded. */
  readonly end: TimeBounds;
  /** Whether anything pinned this node to a clock, directly or by inference. */
  readonly anchored: boolean;
  /** True when bounds came from a relation or anchor rather than the node itself. */
  readonly inferred: boolean;
}

/** Where to sample the timeline. */
export type TimelinePoint =
  /** A story-world instant, ISO 8601. */
  | { readonly kind: "instant"; readonly instant: string }
  /** The boundary of a node, in *chronological* order. */
  | { readonly kind: "node"; readonly nodeId: string; readonly position: "before" | "after" };

export interface CharacterTimelineEntry {
  readonly characterId: string;
  readonly nodeId: string;
  readonly kind: "scene" | "event";
  readonly label: string;
  readonly chronologicalIndex: number;
  readonly presentationIndex?: number;
  readonly storyTime?: StoryTime;
  readonly locationId?: string;
  readonly sceneId?: string;
  /** True when the manuscript reaches this after material that happens later. */
  readonly isFlashback: boolean;
}

export interface ChronologyOptions {
  /** Which links to honour. Defaults to confirmed only. */
  readonly view?: TimelineView;
}

/** Turn project entities into timeline nodes, in manuscript presentation order. */
export function timelineNodes(input: {
  readonly scenes: readonly Scene[];
  readonly chapters: readonly Chapter[];
  readonly events?: readonly StoryEvent[];
}): TimelineNode[] {
  const ordered = orderScenes(input.scenes, input.chapters);
  const presentation = new Map(ordered.map((scene, index) => [scene.id as string, index]));

  const sceneNodes: TimelineNode[] = ordered.map((scene) => ({
    id: scene.id as string,
    kind: "scene",
    label: scene.title === "" ? (scene.id as string) : scene.title,
    ...(scene.storyTime !== undefined ? { storyTime: scene.storyTime } : {}),
    ...(scene.duration !== undefined ? { duration: scene.duration } : {}),
    ...(scene.locationId !== undefined ? { locationId: scene.locationId as string } : {}),
    characterIds: [
      ...new Set([
        ...(scene.pov === undefined ? [] : [scene.pov as string]),
        ...(scene.characterIds as readonly string[]),
      ]),
    ],
    plotThreadIds: [...(scene.plotThreadIds as readonly string[])],
    presentationIndex: presentation.get(scene.id as string) as number,
  }));

  const eventNodes: TimelineNode[] = (input.events ?? []).map((event) => {
    // An event dramatised in a scene is presented where that scene is; an
    // off-page event is presented nowhere, and that is not a defect.
    const at = event.sceneId === undefined ? undefined : presentation.get(event.sceneId as string);
    return {
      id: event.id as string,
      kind: "event",
      label: event.name === "" ? (event.id as string) : event.name,
      ...(event.storyTime !== undefined ? { storyTime: event.storyTime } : {}),
      ...(event.duration !== undefined ? { duration: event.duration } : {}),
      ...(event.sceneId !== undefined ? { sceneId: event.sceneId as string } : {}),
      ...(event.locationId !== undefined ? { locationId: event.locationId as string } : {}),
      characterIds: [...(event.characterIds as readonly string[])],
      plotThreadIds: [...((event.plotThreadIds ?? []) as readonly string[])],
      ...(at !== undefined ? { presentationIndex: at } : {}),
    };
  });

  return [...sceneNodes, ...eventNodes];
}

/** Edges of the "must come first" graph, and where each came from. */
interface Precedence {
  readonly from: string;
  readonly to: string;
  /** Soft edges order the display but never fail a check. */
  readonly soft: boolean;
}

const MAX_PROPAGATION_PASSES = 32;

/** Resolved time, then manuscript position, then ID — a total order. */
type SortKey = [number, number, string];

function lessThan(a: SortKey, b: SortKey): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return a[2] < b[2];
}

/**
 * Story-world chronology.
 *
 * The manuscript's order and the story world's order are two different
 * sequences over the same material, and this class is the second one. It
 * resolves whatever temporal information a project happens to carry — exact
 * timestamps, bare dates, "three days after the fire", or nothing but a handful
 * of "this happens before that" statements — into one deterministic ordering.
 *
 * **Order of precedence, strictly:**
 *
 * 1. explicit temporal relations between nodes;
 * 2. resolved absolute story time;
 * 3. manuscript presentation order.
 *
 * The third is a *tie-break*, not a claim. A node with no story time and no
 * relation keeps the position the writer gave it, and an undated node inherits
 * the last dated position before it in the manuscript — so undated material
 * stays where it was put while dated material moves to where it belongs. This
 * is what lets a project adopt story time gradually instead of all at once.
 */
export class StoryChronology {
  private readonly nodes: readonly TimelineNode[];
  private readonly byId: Map<string, TimelineNode>;
  private readonly links: readonly TemporalLink[];
  private readonly intervals: Map<string, ResolvedInterval>;
  private readonly ordered: readonly TimelineNode[];
  private readonly rank: Map<string, number>;
  private readonly unresolvable: readonly string[];

  constructor(
    nodes: readonly TimelineNode[],
    links: readonly TemporalLink[] = [],
    options: ChronologyOptions = {},
  ) {
    const allowProposed = options.view?.include === "with_proposed";
    this.nodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.links = links.filter(
      (link) =>
        link.confirmationStatus !== "rejected" &&
        (link.confirmationStatus !== "proposed" || allowProposed) &&
        this.byId.has(link.fromId) &&
        this.byId.has(link.toId),
    );

    this.intervals = this.resolveIntervals();
    const { order, unresolvable } = this.topologicalOrder();
    this.ordered = order;
    this.unresolvable = unresolvable;
    this.rank = new Map(order.map((node, index) => [node.id, index]));
  }

  // ── Interval resolution ──────────────────────────────────────────────────

  /**
   * Resolve every node to bounds on when it starts and ends.
   *
   * Bounds propagate: a scene stamped `1997-08-14T14:00Z` pins itself, an event
   * declared "three days after" it inherits a pin, and a scene linked `before`
   * that event inherits an upper bound. Propagation runs to a fixed point (or a
   * pass cap, which a cyclic constraint set would otherwise spin on), and every
   * inherited bound is marked `inferred` so a check can tell a writer's
   * timestamp from the system's arithmetic.
   */
  private resolveIntervals(): Map<string, ResolvedInterval> {
    const start = new Map<string, TimeBounds>();
    const inferred = new Set<string>();
    const declared = new Set<string>();

    for (const node of this.nodes) {
      const bounds = boundsOf(node.storyTime);
      start.set(node.id, bounds);
      if (bounds.earliest !== undefined || bounds.latest !== undefined) declared.add(node.id);
    }

    const endOf = (id: string): TimeBounds => {
      const s = start.get(id) ?? {};
      const span = durationMs(this.byId.get(id)?.duration);
      if (span === undefined) return s;
      return {
        ...(s.earliest !== undefined ? { earliest: s.earliest + span } : {}),
        ...(s.latest !== undefined ? { latest: s.latest + span } : {}),
      };
    };

    const tighten = (id: string, next: TimeBounds): boolean => {
      const current = start.get(id) ?? {};
      const earliest = pickMax(current.earliest, next.earliest);
      const latest = pickMin(current.latest, next.latest);
      if (earliest === current.earliest && latest === current.latest) return false;
      start.set(id, {
        ...(earliest !== undefined ? { earliest } : {}),
        ...(latest !== undefined ? { latest } : {}),
      });
      if (!declared.has(id)) inferred.add(id);
      return true;
    };

    for (let pass = 0; pass < MAX_PROPAGATION_PASSES; pass += 1) {
      let changed = false;

      // Relative story times: "three days after the fire".
      for (const node of this.nodes) {
        const time = node.storyTime;
        if (time?.kind !== "relative") continue;
        const anchor = start.get(time.anchorId);
        if (anchor === undefined) continue;
        const anchorEnd = endOf(time.anchorId);
        const offset = durationMs(time.offset);
        changed = tighten(node.id, shift(time.relation, anchor, anchorEnd, offset)) || changed;
      }

      // Explicit relations.
      for (const link of this.links) {
        const from = start.get(link.fromId) ?? {};
        const to = start.get(link.toId) ?? {};
        const gap = durationMs(link.gap);
        switch (link.relation) {
          case "before":
            changed = tighten(link.toId, shift("after", from, endOf(link.fromId), gap)) || changed;
            changed = tighten(link.fromId, shift("before", to, to, gap)) || changed;
            break;
          case "after":
            changed = tighten(link.fromId, shift("after", to, endOf(link.toId), gap)) || changed;
            changed = tighten(link.toId, shift("before", from, from, gap)) || changed;
            break;
          case "same_time":
            changed = tighten(link.toId, from) || changed;
            changed = tighten(link.fromId, to) || changed;
            break;
          case "during": {
            // `from` happens inside `to`: it cannot start before it, nor after
            // it has finished.
            const container = {
              ...to,
              ...(endOf(link.toId).latest !== undefined ? { latest: endOf(link.toId).latest } : {}),
            };
            changed = tighten(link.fromId, container) || changed;
            break;
          }
          default:
            break;
        }
      }

      if (!changed) break;
    }

    const out = new Map<string, ResolvedInterval>();
    for (const node of this.nodes) {
      const s = start.get(node.id) ?? {};
      out.set(node.id, {
        nodeId: node.id,
        start: s,
        end: endOf(node.id),
        anchored: s.earliest !== undefined || s.latest !== undefined,
        inferred: inferred.has(node.id) && !declared.has(node.id),
      });
    }
    return out;
  }

  // ── Ordering ─────────────────────────────────────────────────────────────

  /** The "must come first" edges implied by relations and relative times. */
  private precedences(): Precedence[] {
    const out: Precedence[] = [];
    for (const link of this.links) {
      switch (link.relation) {
        case "before":
          out.push({ from: link.fromId, to: link.toId, soft: false });
          break;
        case "after":
          out.push({ from: link.toId, to: link.fromId, soft: false });
          break;
        case "approximately_before":
          out.push({ from: link.fromId, to: link.toId, soft: true });
          break;
        case "during":
          // A container opens no later than what happens inside it.
          out.push({ from: link.toId, to: link.fromId, soft: true });
          break;
        default:
          break;
      }
    }
    for (const node of this.nodes) {
      const time = node.storyTime;
      if (time?.kind !== "relative" || !this.byId.has(time.anchorId)) continue;
      if (time.relation === "after") out.push({ from: time.anchorId, to: node.id, soft: false });
      if (time.relation === "before") out.push({ from: node.id, to: time.anchorId, soft: false });
    }
    return out;
  }

  /**
   * The sort key that decides between nodes no relation separates.
   *
   * An undated node carries the timestamp of the last dated node before it in
   * the manuscript, so it stays in its neighbourhood rather than being flung to
   * one end of the timeline. Nodes with no dated predecessor sort by
   * presentation alone — which is the whole-project fallback for a story that
   * uses no dates at all.
   */
  private sortKeys(): Map<string, SortKey> {
    const byPresentation = [...this.nodes].sort(
      (a, b) =>
        (a.presentationIndex ?? Number.MAX_SAFE_INTEGER) -
          (b.presentationIndex ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
    );

    const keys = new Map<string, SortKey>();
    let carried = Number.NEGATIVE_INFINITY;
    for (const node of byPresentation) {
      const own = this.intervals.get(node.id)?.start.earliest;
      if (own !== undefined) carried = own;
      keys.set(node.id, [
        own ?? carried,
        node.presentationIndex ?? Number.MAX_SAFE_INTEGER,
        node.id,
      ]);
    }
    return keys;
  }

  /**
   * A node's sort key, lowered to the earliest key of anything it must precede.
   *
   * Without this, a greedy topological sort disturbs the manuscript far more
   * than the writer asked it to. Given only "scene 3 happens before scene 1",
   * scene 2 is unconstrained and would be emitted first simply because it
   * became available first — leaving 2, 3, 1 when the honest reading is 3, 1, 2.
   * Letting a node inherit the position of what it blocks keeps the ordering to
   * the smallest rearrangement the relations actually demand.
   */
  private effectiveKeys(outgoing: ReadonlyMap<string, readonly string[]>): Map<string, SortKey> {
    const own = this.sortKeys();
    const resolved = new Map<string, SortKey>();
    const visiting = new Set<string>();

    const walk = (id: string): SortKey => {
      const cached = resolved.get(id);
      if (cached !== undefined) return cached;
      // A cycle has no well-founded answer; its own key is the honest fallback,
      // and validation reports the cycle separately.
      if (visiting.has(id)) return own.get(id) as SortKey;

      visiting.add(id);
      let best = own.get(id) as SortKey;
      for (const next of outgoing.get(id) ?? []) {
        const candidate = walk(next);
        if (lessThan(candidate, best)) best = candidate;
      }
      visiting.delete(id);
      resolved.set(id, best);
      return best;
    };

    for (const node of this.nodes) walk(node.id);
    return resolved;
  }

  /**
   * Kahn's algorithm with a deterministic tie-break.
   *
   * Nodes caught in a contradictory set of relations cannot be ordered at all;
   * rather than throwing — a writer mid-edit will produce contradictions, and an
   * unusable timeline is not a helpful response — they are appended in key order
   * and reported through {@link contradictorySet} for validation to explain.
   */
  private topologicalOrder(): { order: TimelineNode[]; unresolvable: string[] } {
    const outgoing = new Map<string, string[]>();
    const indegree = new Map<string, number>(this.nodes.map((n) => [n.id, 0]));
    const seen = new Set<string>();
    for (const edge of this.precedences()) {
      const key = `${edge.from}→${edge.to}`;
      if (edge.from === edge.to || seen.has(key)) continue;
      seen.add(key);
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }

    const keys = this.effectiveKeys(outgoing);
    const compare = (a: string, b: string): number => {
      const ka = keys.get(a) as SortKey;
      const kb = keys.get(b) as SortKey;
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
    };

    const ready = this.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
    const order: TimelineNode[] = [];

    while (ready.length > 0) {
      let best = 0;
      for (let i = 1; i < ready.length; i += 1) {
        if (compare(ready[i] as string, ready[best] as string) < 0) best = i;
      }
      const id = ready.splice(best, 1)[0] as string;
      order.push(this.byId.get(id) as TimelineNode);
      for (const next of outgoing.get(id) ?? []) {
        const remaining = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, remaining);
        if (remaining === 0) ready.push(next);
      }
    }

    const unresolvable = this.nodes
      .filter((n) => !order.some((o) => o.id === n.id))
      .map((n) => n.id)
      .sort();
    for (const id of [...unresolvable].sort(compare)) {
      order.push(this.byId.get(id) as TimelineNode);
    }
    return { order, unresolvable };
  }

  // ── Reading the chronology ───────────────────────────────────────────────

  /** Every node in story-world chronological order. */
  chronologicalOrder(): TimelineNode[] {
    return [...this.ordered];
  }

  /** Every node in manuscript presentation order; unpresented material last. */
  presentationOrder(): TimelineNode[] {
    return [...this.nodes].sort(
      (a, b) =>
        (a.presentationIndex ?? Number.MAX_SAFE_INTEGER) -
          (b.presentationIndex ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
    );
  }

  /** Scene IDs in chronological order — the story's own sequence. */
  chronologicalSceneOrder(): string[] {
    return this.ordered.filter((n) => n.kind === "scene").map((n) => n.id);
  }

  node(id: string): TimelineNode {
    const node = this.byId.get(id);
    if (node === undefined) {
      throw new ChronologyError(`"${id}" is not on the timeline.`, { id });
    }
    return node;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  chronologicalIndexOf(id: string): number {
    const at = this.rank.get(id);
    if (at === undefined) {
      throw new ChronologyError(`"${id}" is not on the timeline.`, { id });
    }
    return at;
  }

  intervalOf(id: string): ResolvedInterval {
    const interval = this.intervals.get(id);
    if (interval === undefined) {
      throw new ChronologyError(`"${id}" is not on the timeline.`, { id });
    }
    return interval;
  }

  /** Nodes whose relations contradict each other, so no ordering satisfies them. */
  contradictorySet(): string[] {
    return [...this.unresolvable];
  }

  /**
   * Whether the manuscript reaches this node after material that happens later
   * in the story world — the structural definition of a flashback.
   */
  isFlashback(id: string): boolean {
    const node = this.byId.get(id);
    if (node?.presentationIndex === undefined) return false;
    const here = this.chronologicalIndexOf(id);
    return this.nodes.some(
      (other) =>
        other.presentationIndex !== undefined &&
        other.presentationIndex < (node.presentationIndex as number) &&
        this.chronologicalIndexOf(other.id) > here,
    );
  }

  /** Every scene the manuscript presents out of chronological sequence. */
  flashbacks(): TimelineNode[] {
    return this.ordered.filter((n) => this.isFlashback(n.id));
  }

  /**
   * Nodes that happen at the same time as this one.
   *
   * Two ways to be simultaneous, and both count: an explicit `same_time` or
   * `overlaps` relation, or resolved intervals that genuinely overlap. The first
   * is how a writer with no calendar says "meanwhile"; the second is how a
   * timestamped project says it without being asked.
   */
  simultaneousWith(id: string): TimelineNode[] {
    this.node(id);
    const declared = new Set<string>();
    for (const link of this.links) {
      if (link.relation !== "same_time" && link.relation !== "overlaps") continue;
      if (link.fromId === id) declared.add(link.toId);
      if (link.toId === id) declared.add(link.fromId);
    }

    const mine = this.intervalOf(id);
    const out = this.nodes.filter((other) => {
      if (other.id === id) return false;
      if (declared.has(other.id)) return true;
      return overlaps(mine, this.intervalOf(other.id));
    });
    return out.sort((a, b) => this.chronologicalIndexOf(a.id) - this.chronologicalIndexOf(b.id));
  }

  /** Nodes that involve a character, in chronological order. */
  nodesForCharacter(characterId: string): TimelineNode[] {
    return this.ordered.filter((n) => n.characterIds.includes(characterId));
  }

  /** Events only — scenes are the manuscript, events are the world. */
  getEventsForCharacter(characterId: string): TimelineNode[] {
    return this.nodesForCharacter(characterId).filter((n) => n.kind === "event");
  }

  /** Nodes at a location, in chronological order. */
  nodesAtLocation(locationId: string): TimelineNode[] {
    return this.ordered.filter((n) => n.locationId === locationId);
  }

  /** Nodes belonging to a plot thread, in chronological order. */
  nodesForPlotThread(plotThreadId: string): TimelineNode[] {
    return this.ordered.filter((n) => n.plotThreadIds.includes(plotThreadId));
  }

  /** One character's life through the story, in the order they lived it. */
  getCharacterTimeline(characterId: string): CharacterTimelineEntry[] {
    return this.nodesForCharacter(characterId).map((node) => ({
      characterId,
      nodeId: node.id,
      kind: node.kind,
      label: node.label,
      chronologicalIndex: this.chronologicalIndexOf(node.id),
      ...(node.presentationIndex !== undefined
        ? { presentationIndex: node.presentationIndex }
        : {}),
      ...(node.storyTime !== undefined ? { storyTime: node.storyTime } : {}),
      ...(node.locationId !== undefined ? { locationId: node.locationId } : {}),
      ...(node.sceneId !== undefined ? { sceneId: node.sceneId } : {}),
      isFlashback: this.isFlashback(node.id),
    }));
  }

  // ── Chronological state ──────────────────────────────────────────────────

  /**
   * A state timeline that replays in **story order** rather than manuscript
   * order.
   *
   * This is the payoff of the whole subsystem. `StoryTimeline` built from
   * `orderScenes` answers "what had the reader been told by chapter 12?"; built
   * from the chronology it answers "what was true in the world at that moment?".
   * A flashback makes those two different answers, and a project that cannot
   * tell them apart cannot check continuity in a nonlinear story.
   */
  stateTimeline(transitions: readonly StateTransition[]): StoryTimeline {
    return new StoryTimeline(this.chronologicalSceneOrder(), transitions);
  }

  /**
   * The chronologically last scene at or before a point — the scene whose
   * recorded state describes the world there.
   */
  sceneAt(point: TimelinePoint): string | undefined {
    const scenes = this.ordered.filter((n) => n.kind === "scene");
    if (point.kind === "node") {
      const limit = this.chronologicalIndexOf(point.nodeId);
      const eligible = scenes.filter((s) => {
        const at = this.chronologicalIndexOf(s.id);
        return point.position === "after" ? at <= limit : at < limit;
      });
      return eligible.at(-1)?.id;
    }

    const instant = Date.parse(point.instant);
    if (Number.isNaN(instant)) {
      throw new ChronologyError(`"${point.instant}" is not a parseable instant.`, {
        instant: point.instant,
      });
    }
    // A scene counts as "reached" once it can no longer be in the future: its
    // earliest possible start is at or before the instant asked about.
    const eligible = scenes.filter((s) => {
      const earliest = this.intervalOf(s.id).start.earliest;
      return earliest !== undefined && earliest <= instant;
    });
    return eligible.at(-1)?.id;
  }

  /**
   * Where a character was at a story moment — reconstructed from state
   * transitions replayed in **chronological** order, not manuscript order.
   */
  getCharacterLocationAtTime(
    characterId: string,
    at: TimelinePoint,
    transitions: readonly StateTransition[],
    view: TimelineView = {},
  ): string | undefined {
    const sceneId = this.sceneAt(at);
    if (sceneId === undefined) return undefined;
    return this.stateTimeline(transitions).characterStateAfterScene(characterId, sceneId, view)
      .locationId;
  }
}

// ── Bounds arithmetic ────────────────────────────────────────────────────────

function pickMax(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function pickMin(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

/**
 * Bounds implied by standing a known distance from an anchor.
 *
 * Without a stated gap, "after" only says *not before the anchor ends* — a lower
 * bound and nothing more. Inventing an upper bound there would be the system
 * making up story time the writer never gave it.
 */
function shift(
  relation: "before" | "after" | "same_time",
  anchorStart: TimeBounds,
  anchorEnd: TimeBounds,
  offset: number | undefined,
): TimeBounds {
  if (relation === "same_time") return anchorStart;
  if (relation === "after") {
    if (offset === undefined) {
      return anchorEnd.latest === undefined ? {} : { earliest: anchorEnd.latest };
    }
    return {
      ...(anchorEnd.earliest !== undefined ? { earliest: anchorEnd.earliest + offset } : {}),
      ...(anchorEnd.latest !== undefined ? { latest: anchorEnd.latest + offset } : {}),
    };
  }
  if (offset === undefined) {
    return anchorStart.earliest === undefined ? {} : { latest: anchorStart.earliest };
  }
  return {
    ...(anchorStart.earliest !== undefined ? { earliest: anchorStart.earliest - offset } : {}),
    ...(anchorStart.latest !== undefined ? { latest: anchorStart.latest - offset } : {}),
  };
}

/** Whether two resolved intervals could describe the same story-world moment. */
export function overlaps(a: ResolvedInterval, b: ResolvedInterval): boolean {
  if (!a.anchored || !b.anchored) return false;
  const aStart = a.start.earliest ?? Number.NEGATIVE_INFINITY;
  const aEnd = a.end.latest ?? a.start.latest ?? Number.POSITIVE_INFINITY;
  const bStart = b.start.earliest ?? Number.NEGATIVE_INFINITY;
  const bEnd = b.end.latest ?? b.start.latest ?? Number.POSITIVE_INFINITY;
  return aStart <= bEnd && bStart <= aEnd;
}

/** Whether `a` provably finishes before `b` begins. */
export function strictlyBefore(a: ResolvedInterval, b: ResolvedInterval): boolean {
  const aEnd = a.end.latest ?? a.start.latest;
  const bStart = b.start.earliest;
  return aEnd !== undefined && bStart !== undefined && aEnd < bStart;
}
