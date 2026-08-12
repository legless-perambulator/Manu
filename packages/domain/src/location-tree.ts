import type { Location } from "./entities";

/**
 * Nested locations.
 *
 * A location is a place inside other places:
 *
 * ```
 * Blackthorn Manor
 *   └── West Wing
 *        └── Library
 *             └── Hidden Vault
 * ```
 *
 * Someone in the Hidden Vault **is** at Blackthorn Manor, and any check that
 * cannot see that will report a contradiction where there is none. So
 * containment is domain knowledge, derived in one place, and every consumer —
 * continuity checks, the Context Compiler, the UI — answers "is this inside
 * that?" the same way (docs/OBJECTS_LOCATIONS.md).
 *
 * Every function here tolerates a broken tree. A parent that does not exist, or
 * a cycle a writer created mid-edit, must not throw or loop: it is a finding for
 * `checkContinuity`, not a crash.
 */

/** Locations indexed by ID. The shape every function here works from. */
export type LocationIndex = ReadonlyMap<string, Location>;

export function indexLocations(locations: readonly Location[]): LocationIndex {
  return new Map(locations.map((location) => [location.id as string, location]));
}

/**
 * A location and everything it is inside, innermost first.
 *
 * Stops at a missing parent and at a cycle, so a malformed tree yields a short
 * path rather than an infinite one.
 */
export function locationPath(locations: LocationIndex, id: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = id;

  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    path.push(current);
    const parent: string | undefined = locations.get(current)?.parentLocationId;
    current = parent;
  }
  return path;
}

/** Everything a location is inside, excluding itself, innermost first. */
export function locationAncestors(locations: LocationIndex, id: string): string[] {
  return locationPath(locations, id).slice(1);
}

/** Every location inside this one, at any depth. */
export function locationDescendants(locations: LocationIndex, id: string): string[] {
  const out: string[] = [];
  for (const [candidate] of locations) {
    if (candidate !== id && locationPath(locations, candidate).includes(id)) out.push(candidate);
  }
  return out.sort();
}

/**
 * Whether `inner` is at `outer` — the same place, or somewhere inside it.
 *
 * Directional on purpose. Being in the Hidden Vault means being at the Manor;
 * being at the Manor does **not** mean being in the vault.
 */
export function isWithin(locations: LocationIndex, inner: string, outer: string): boolean {
  return locationPath(locations, inner).includes(outer);
}

/**
 * Whether two locations could describe the same position.
 *
 * True when either contains the other, because "at the Manor" and "in the
 * Library" are compatible statements about one person. This is the test a
 * continuity check should use: it flags only positions that genuinely cannot
 * both hold, never a coarser description of the same place.
 */
export function locationsCompatible(
  locations: LocationIndex,
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (a === undefined || b === undefined || a === b) return true;
  return isWithin(locations, a, b) || isWithin(locations, b, a);
}

/** The outermost location containing this one — the place a reader would name. */
export function rootLocation(locations: LocationIndex, id: string): string {
  const path = locationPath(locations, id);
  return path.at(-1) ?? id;
}

/** How deeply nested a location is. `0` for a top-level place. */
export function locationDepth(locations: LocationIndex, id: string): number {
  return locationPath(locations, id).length - 1;
}

/** A location and its containers as a readable trail: `Manor › West Wing › Library`. */
export function describeLocationPath(
  locations: LocationIndex,
  id: string,
  separator = " › ",
): string {
  return locationPath(locations, id)
    .reverse()
    .map((step) => locations.get(step)?.name ?? step)
    .join(separator);
}

export type LocationTreeProblem =
  /** A location is its own parent. */
  | "self_parent"
  /** A chain of parents loops back on itself. */
  | "cycle"
  /** The parent named does not exist in the project. */
  | "missing_parent";

export interface LocationTreeFault {
  readonly locationId: string;
  readonly problem: LocationTreeProblem;
  /** The chain that demonstrates it, for a `cycle`. */
  readonly path?: readonly string[];
  readonly parentLocationId?: string;
}

/**
 * Structural faults in the location tree.
 *
 * Deliberately separate from the continuity checks that consume it: this
 * function answers "is the tree well-formed?", which is a question about the
 * data rather than about the story.
 */
export function locationTreeFaults(locations: LocationIndex): LocationTreeFault[] {
  const out: LocationTreeFault[] = [];

  for (const [id, location] of locations) {
    const parent = location.parentLocationId as string | undefined;
    if (parent === undefined) continue;

    if (parent === id) {
      out.push({ locationId: id, problem: "self_parent", parentLocationId: parent });
      continue;
    }
    if (!locations.has(parent)) {
      out.push({ locationId: id, problem: "missing_parent", parentLocationId: parent });
      continue;
    }
    // `locationPath` stops at the first repeat, so a path that returns to this
    // location's parent chain without terminating is a loop.
    const path = locationPath(locations, id);
    const last = path.at(-1) as string;
    const beyond = locations.get(last)?.parentLocationId as string | undefined;
    if (beyond !== undefined && path.includes(beyond)) {
      out.push({ locationId: id, problem: "cycle", path, parentLocationId: parent });
    }
  }

  return out.sort((a, b) => a.locationId.localeCompare(b.locationId));
}
