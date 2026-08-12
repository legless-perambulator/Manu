import {
  describeDuration,
  durationMs,
  RELATION_VERBS,
  type TemporalLink,
  type TravelRule,
} from "@jellytind/domain";
import { strictlyBefore, type ResolvedInterval, type StoryChronology } from "./chronology";

/**
 * Deterministic timeline checks.
 *
 * Everything here is decidable from recorded data — no model, no inference about
 * how the world works. That constraint is the point: the system does **not**
 * know how long it takes to get from London to Edinburgh, and a check that
 * guessed would be worse than no check at all. It reports a travel violation
 * only where the writer has declared a travel time, and a bilocation only where
 * two positions are pinned precisely enough that they cannot both be true
 * (docs/TIMELINE.md).
 */
export type TimelineViolationKind =
  /** Relations form a loop: nothing can satisfy them all. */
  | "contradictory_relations"
  /** A stated relation is refuted by the story times of the two nodes. */
  | "relation_contradicts_time"
  /** Constraints leave a node with no possible moment at all. */
  | "impossible_interval"
  /** One character is pinned to two places at one moment. */
  | "character_bilocation"
  /** A declared travel time does not fit in the gap between two appearances. */
  | "impossible_travel"
  /** An event is placed in a scene whose story time excludes it. */
  | "event_outside_scene"
  /** A relation points at something that is not on the timeline. */
  | "dangling_relation";

export type TimelineViolationSeverity = "error" | "warning";

export interface TimelineViolation {
  readonly kind: TimelineViolationKind;
  readonly severity: TimelineViolationSeverity;
  /** The nodes involved, in the order the message names them. */
  readonly nodeIds: readonly string[];
  readonly characterId?: string;
  readonly locationIds?: readonly string[];
  readonly linkId?: string;
  readonly message: string;
}

export interface TimelineCheckInput {
  readonly chronology: StoryChronology;
  /**
   * Every recorded link, including any pointing at missing nodes — the
   * chronology drops those, and a dropped constraint is exactly the thing worth
   * telling a writer about.
   */
  readonly links?: readonly TemporalLink[];
  /**
   * Declared travel times. With none, no travel violation is ever reported;
   * that is deliberate, not a gap.
   */
  readonly travel?: readonly TravelRule[];
}

/**
 * Check the project's chronology for contradictions.
 *
 * Errors are statements the data cannot support. Warnings are placements worth
 * a second look that may well be intentional — a soft `approximately_before`
 * that the timestamps disagree with is a nudge, not a verdict.
 */
export function checkTimeline(input: TimelineCheckInput): TimelineViolation[] {
  const { chronology } = input;
  const out: TimelineViolation[] = [];
  const links = input.links ?? [];
  const label = (id: string): string =>
    chronology.has(id) ? `${id} (${chronology.node(id).label})` : id;

  // ── Relations that cannot all hold ──────────────────────────────────────
  const cycle = chronology.contradictorySet();
  if (cycle.length > 0) {
    out.push({
      kind: "contradictory_relations",
      severity: "error",
      nodeIds: cycle,
      message: `${cycle.map(label).join(", ")} are caught in a loop of temporal relations: no ordering satisfies all of them.`,
    });
  }

  // ── Over-constrained nodes ──────────────────────────────────────────────
  for (const node of chronology.chronologicalOrder()) {
    const { start } = chronology.intervalOf(node.id);
    if (
      start.earliest !== undefined &&
      start.latest !== undefined &&
      start.earliest > start.latest
    ) {
      out.push({
        kind: "impossible_interval",
        severity: "error",
        nodeIds: [node.id],
        message: `${label(node.id)} is constrained to start no earlier than ${iso(start.earliest)} and no later than ${iso(start.latest)}, which is impossible.`,
      });
    }
  }

  // ── Relations refuted by story time ─────────────────────────────────────
  for (const link of links) {
    if (link.confirmationStatus === "rejected") continue;
    if (!chronology.has(link.fromId) || !chronology.has(link.toId)) {
      out.push({
        kind: "dangling_relation",
        severity: "warning",
        nodeIds: [link.fromId, link.toId],
        linkId: link.id,
        message: `The relation "${label(link.fromId)} ${RELATION_VERBS[link.relation]} ${label(link.toId)}" points at something that is not on the timeline, so it constrains nothing.`,
      });
      continue;
    }

    const from = chronology.intervalOf(link.fromId);
    const to = chronology.intervalOf(link.toId);
    const soft = link.relation === "approximately_before";
    const refuted =
      link.relation === "before" || link.relation === "approximately_before"
        ? strictlyBefore(to, from)
        : link.relation === "after"
          ? strictlyBefore(from, to)
          : link.relation === "same_time" || link.relation === "during"
            ? strictlyBefore(from, to) || strictlyBefore(to, from)
            : false;

    if (refuted) {
      out.push({
        kind: "relation_contradicts_time",
        severity: soft ? "warning" : "error",
        nodeIds: [link.fromId, link.toId],
        linkId: link.id,
        message: `"${label(link.fromId)} ${RELATION_VERBS[link.relation]} ${label(link.toId)}" is contradicted by their recorded story times.`,
      });
    }
  }

  // ── An event placed in a scene it cannot be in ──────────────────────────
  for (const node of chronology.chronologicalOrder()) {
    if (node.kind !== "event" || node.sceneId === undefined) continue;
    if (!chronology.has(node.sceneId)) continue;
    const event = chronology.intervalOf(node.id);
    const scene = chronology.intervalOf(node.sceneId);
    if (!event.anchored || !scene.anchored) continue;
    if (strictlyBefore(event, scene) || strictlyBefore(scene, event)) {
      out.push({
        kind: "event_outside_scene",
        severity: "warning",
        nodeIds: [node.id, node.sceneId],
        message: `${label(node.id)} is recorded as happening in ${label(node.sceneId)}, but their story times do not overlap.`,
      });
    }
  }

  out.push(...checkCharacterMovement(input));
  return out;
}

/**
 * Where a character is pinned, checked pair by pair along their own timeline.
 *
 * Two findings live here, and the difference between them matters. Bilocation
 * needs no assumption about the world at all — one body, two places, one moment
 * — so it is checked wherever both moments are pinned precisely. Impossible
 * travel needs to know how long a journey takes, which only the writer knows, so
 * it is checked only against declared {@link TravelRule}s.
 */
function checkCharacterMovement(input: TimelineCheckInput): TimelineViolation[] {
  const { chronology } = input;
  const rules = travelIndex(input.travel ?? []);
  const out: TimelineViolation[] = [];

  const characterIds = [
    ...new Set(chronology.chronologicalOrder().flatMap((n) => n.characterIds)),
  ].sort();

  for (const characterId of characterIds) {
    const placed = chronology
      .nodesForCharacter(characterId)
      .filter((n) => n.locationId !== undefined);

    for (let i = 0; i < placed.length; i += 1) {
      const a = placed[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < placed.length; j += 1) {
        const b = placed[j];
        if (b === undefined || a.locationId === b.locationId) continue;

        const ia = chronology.intervalOf(a.id);
        const ib = chronology.intervalOf(b.id);

        if (necessarilyOverlaps(ia, ib)) {
          out.push({
            kind: "character_bilocation",
            severity: "error",
            nodeIds: [a.id, b.id],
            characterId,
            locationIds: [a.locationId as string, b.locationId as string],
            message: `${characterId} is in ${a.locationId as string} in ${a.id} and in ${b.locationId as string} in ${b.id} at the same story moment.`,
          });
          continue;
        }

        const required = rules.get(pairKey(a.locationId as string, b.locationId as string));
        if (required === undefined) continue;
        const minimum = durationMs(required.minimum);
        if (minimum === undefined) continue;

        // The most generous gap the recorded times allow. If even that is too
        // short, the journey is impossible under the writer's own declaration.
        const departure = ia.end.earliest ?? ia.start.earliest;
        const arrival = ib.start.latest ?? ib.start.earliest;
        if (departure === undefined || arrival === undefined) continue;
        const available = arrival - departure;
        if (available >= minimum) continue;

        out.push({
          kind: "impossible_travel",
          severity: "error",
          nodeIds: [a.id, b.id],
          characterId,
          locationIds: [a.locationId as string, b.locationId as string],
          message: `${characterId} leaves ${a.locationId as string} in ${a.id} and is in ${b.locationId as string} in ${b.id} ${describeGap(available)} later, but the declared journey takes at least ${describeDuration(required.minimum)}.`,
        });
      }
    }
  }

  return out;
}

function travelIndex(rules: readonly TravelRule[]): Map<string, TravelRule> {
  const out = new Map<string, TravelRule>();
  for (const rule of rules) {
    out.set(`${rule.fromLocationId}→${rule.toLocationId}`, rule);
    if (rule.bidirectional !== false) {
      out.set(`${rule.toLocationId}→${rule.fromLocationId}`, rule);
    }
  }
  return out;
}

function pairKey(from: string, to: string): string {
  return `${from}→${to}`;
}

/**
 * Whether two intervals *must* coincide, not merely could.
 *
 * The distinction is the whole reason precision is modelled. Two scenes dated
 * `1997-08-14` could overlap, and flagging that would call an ordinary novel
 * broken; two scenes stamped `14:00` on that day cannot be told apart by any
 * reading, and one character cannot be in both.
 */
function necessarilyOverlaps(a: ResolvedInterval, b: ResolvedInterval): boolean {
  const aStart = pinned(a.start);
  const bStart = pinned(b.start);
  if (aStart === undefined || bStart === undefined) return false;
  const aEnd = pinned(a.end) ?? aStart;
  const bEnd = pinned(b.end) ?? bStart;
  return aStart <= bEnd && bStart <= aEnd;
}

/** A bound that names one instant rather than a range. */
function pinned(bounds: { earliest?: number; latest?: number }): number | undefined {
  return bounds.earliest !== undefined && bounds.earliest === bounds.latest
    ? bounds.earliest
    : undefined;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function describeGap(ms: number): string {
  if (ms <= 0) return "at the same moment or earlier";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${String(minutes)} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${String(hours)} hours`;
  return `${String(Math.round(hours / 24))} days`;
}
