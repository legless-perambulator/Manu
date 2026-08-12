/**
 * Dynamic relationship state.
 *
 * A relationship is not a label. "Elias and Mara are allies" is insufficient —
 * the question the product has to answer is what their relationship *was at the
 * point in the story being worked on* (MASTER_BUILD.md §10, docs/STORY_STATE.md).
 *
 * So relationships get the same treatment as location and knowledge: identity
 * lives on the entity, everything that changes lives in scene-anchored
 * transitions, and any moment is reconstructed by replay.
 *
 * **Identity survives change.** `REL_0012` is Elias↔Mara for the whole book,
 * however often the type or status changes. Nothing keys off "the ally
 * relationship"; it keys off the ID.
 */

/**
 * Analytical dimensions a writer *may* track.
 *
 * Every one is optional. A writer who never opens this feature still has fully
 * working relationships — type, status and description are the substance, and
 * these are aids for analysis (does the trust curve earn its collapse?), not a
 * requirement to quantify a friendship.
 */
export type RelationshipDimension =
  | "trust"
  | "affection"
  | "fear"
  | "resentment"
  | "loyalty"
  | "dependency"
  | "suspicion"
  | "attraction"
  | "respect"
  | "power";

export const RELATIONSHIP_DIMENSIONS: readonly RelationshipDimension[] = [
  "trust",
  "affection",
  "fear",
  "resentment",
  "loyalty",
  "dependency",
  "suspicion",
  "attraction",
  "respect",
  "power",
];

export function isRelationshipDimension(value: unknown): value is RelationshipDimension {
  return (
    typeof value === "string" && (RELATIONSHIP_DIMENSIONS as readonly string[]).includes(value)
  );
}

/**
 * A qualitative level, for writers who would rather say "trust: low" than pick a
 * number. First-class, not a fallback.
 */
export type QualitativeLevel = "none" | "very_low" | "low" | "moderate" | "high" | "very_high";

export const QUALITATIVE_LEVELS: readonly QualitativeLevel[] = [
  "none",
  "very_low",
  "low",
  "moderate",
  "high",
  "very_high",
];

export function isQualitativeLevel(value: unknown): value is QualitativeLevel {
  return typeof value === "string" && (QUALITATIVE_LEVELS as readonly string[]).includes(value);
}

/**
 * The band each qualitative level occupies, so analysis can work with either
 * form. The mapping is one-way lossy on purpose: a number can be described
 * qualitatively, but "low" does not become 0.3 — it stays "low", and anything
 * reading it knows only the band.
 */
const LEVEL_BANDS: ReadonlyArray<{ level: QualitativeLevel; upTo: number }> = [
  { level: "none", upTo: 0.05 },
  { level: "very_low", upTo: 0.2 },
  { level: "low", upTo: 0.4 },
  { level: "moderate", upTo: 0.6 },
  { level: "high", upTo: 0.8 },
  { level: "very_high", upTo: 1 },
];

/** Describe a 0–1 magnitude qualitatively. */
export function qualitativeOf(magnitude: number): QualitativeLevel {
  const clamped = Math.min(1, Math.max(0, magnitude));
  return LEVEL_BANDS.find((band) => clamped <= band.upTo)?.level ?? "very_high";
}

/**
 * One dimension's value at a point in the story.
 *
 * Either or both forms may be present: a writer can record `low`, or `0.31`, or
 * `0.31` labelled `low`. Consumers should prefer whichever they were given and
 * must not invent the other.
 */
export interface DimensionValue {
  readonly dimension: RelationshipDimension;
  /** 0–1 analytical aid. Not objective literary truth. */
  readonly magnitude?: number;
  readonly level?: QualitativeLevel;
  /** Why it changed — the sentence a writer reads in the inspector. */
  readonly reason?: string;
  readonly changedAtSceneId: string;
  /** The value before this change, for rendering `0.48 → 0.31`. */
  readonly previous?: { magnitude?: number; level?: QualitativeLevel };
}

/**
 * Relationship milestones.
 *
 * Deliberately not romance-shaped: alliances, betrayals, debts and oaths matter
 * as much as kisses, and a thriller or a political novel must be as well served
 * as a romance.
 */
export type RelationshipEventKind =
  | "first_meeting"
  | "alliance"
  | "betrayal"
  | "confession"
  | "reconciliation"
  | "falling_out"
  | "estrangement"
  | "rescue"
  | "debt_incurred"
  | "oath_sworn"
  | "oath_broken"
  | "rivalry_begins"
  | "kiss"
  | "breakup"
  | "death_of_one";

export const RELATIONSHIP_EVENT_KINDS: readonly RelationshipEventKind[] = [
  "first_meeting",
  "alliance",
  "betrayal",
  "confession",
  "reconciliation",
  "falling_out",
  "estrangement",
  "rescue",
  "debt_incurred",
  "oath_sworn",
  "oath_broken",
  "rivalry_begins",
  "kiss",
  "breakup",
  "death_of_one",
];

export function isRelationshipEventKind(value: unknown): value is RelationshipEventKind {
  return (
    typeof value === "string" && (RELATIONSHIP_EVENT_KINDS as readonly string[]).includes(value)
  );
}

export interface RelationshipEventRecord {
  readonly kind: RelationshipEventKind;
  readonly sceneId: string;
  readonly reason?: string;
}

/** A relationship as it stood at one moment. */
export interface RelationshipState {
  readonly relationshipId: string;
  readonly characterAId: string;
  readonly characterBId: string;
  /** The type as of this moment — rival, ally, mentor. Changes over time. */
  readonly type: string;
  /** Free-form status as of this moment — "strained", "estranged". */
  readonly status: string;
  readonly description: string;
  /** Only the dimensions this project actually tracks. Usually empty. */
  readonly dimensions: Readonly<Partial<Record<RelationshipDimension, DimensionValue>>>;
  /** Milestones reached by this point, in story order. */
  readonly events: readonly RelationshipEventRecord[];
  readonly asOf: { sceneId: string; position: "before" | "after" };
}

/** One recorded change, for the history view. */
export interface RelationshipChange {
  readonly relationshipId: string;
  readonly sceneId: string;
  readonly kind: "type" | "status" | "dimension" | "event";
  /** Dimension name, event kind, or the new type/status. */
  readonly label: string;
  readonly from?: string;
  readonly to: string;
  readonly reason?: string;
}

/** Render a dimension value the way the inspector shows it: `0.48 → 0.31`. */
export function describeDimensionChange(value: DimensionValue): string {
  const show = (v: { magnitude?: number; level?: QualitativeLevel } | undefined): string => {
    if (v === undefined) return "—";
    if (v.magnitude !== undefined && v.level !== undefined) {
      return `${v.level} (${String(v.magnitude)})`;
    }
    if (v.magnitude !== undefined) return String(v.magnitude);
    return v.level ?? "—";
  };
  const to = show({
    ...(value.magnitude !== undefined ? { magnitude: value.magnitude } : {}),
    ...(value.level !== undefined ? { level: value.level } : {}),
  });
  return value.previous === undefined
    ? `${value.dimension}: ${to}`
    : `${value.dimension}: ${show(value.previous)} → ${to}`;
}

/** A one-line summary of a relationship, for context and the timeline view. */
export function describeRelationship(state: RelationshipState): string {
  const head = `${state.characterAId} ↔ ${state.characterBId}: ${state.type}${
    state.status === "" ? "" : ` (${state.status})`
  }`;
  const dims = Object.values(state.dimensions)
    .filter((d): d is DimensionValue => d !== undefined)
    .map((d) =>
      d.level !== undefined && d.magnitude !== undefined
        ? `${d.dimension} ${d.level} (${String(d.magnitude)})`
        : `${d.dimension} ${d.level ?? String(d.magnitude ?? "")}`,
    );
  return dims.length === 0 ? head : `${head}; ${dims.join(", ")}`;
}
