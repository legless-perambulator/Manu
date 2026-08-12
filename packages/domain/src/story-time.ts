/**
 * Story-world time.
 *
 * The manuscript has an order — chapter 1, then chapter 2 — and the story world
 * has a chronology, and **they are not the same thing**. A flashback is
 * presented third and happens first. Two chapters may cover the same afternoon
 * from different points of view. Treating chapter order as chronological truth
 * is exactly the mistake that makes continuity checking useless for anything but
 * the simplest linear novel (MASTER_BUILD.md §26; docs/TIMELINE.md).
 *
 * So story time is modelled here as a first-class, *optional*, deliberately
 * partial thing. A writer who never assigns a single date still gets a usable
 * chronology from ordering relations alone; a writer who timestamps everything
 * to the minute gets contradiction checking. Neither is forced on the other.
 */

/** How precisely a story time is known. */
export type StoryTimeKind =
  /** A specific instant, to the minute or better. */
  | "exact"
  /** A calendar day, with no time of day. */
  | "date"
  /** Somewhere in a range, or a vague label like "that winter". */
  | "approximate"
  /** Positioned against another node, e.g. "three days after the fire". */
  | "relative"
  /** Ordered by relations only — no clock, no calendar. */
  | "ordinal"
  /** Deliberately unknown; the node still takes part in ordering. */
  | "unknown";

export const STORY_TIME_KINDS: readonly StoryTimeKind[] = [
  "exact",
  "date",
  "approximate",
  "relative",
  "ordinal",
  "unknown",
];

/**
 * A span of story-world time.
 *
 * Components are additive (`{ hours: 1, minutes: 30 }`). `label` carries a
 * duration a writer will not quantify — "most of the night" — which is a real
 * answer, not a missing one: it renders and it travels, it simply cannot
 * participate in arithmetic.
 */
export interface StoryDuration {
  readonly minutes?: number;
  readonly hours?: number;
  readonly days?: number;
  readonly weeks?: number;
  readonly years?: number;
  readonly label?: string;
}

const MINUTE = 60_000;
const UNIT_MS: Readonly<Record<string, number>> = {
  minutes: MINUTE,
  hours: 60 * MINUTE,
  days: 24 * 60 * MINUTE,
  weeks: 7 * 24 * 60 * MINUTE,
  // A story-world year is 365 days. Fiction rarely turns on the leap-year
  // difference, and pretending to a precision the writer did not give would be
  // worse than a stated convention.
  years: 365 * 24 * 60 * MINUTE,
};

/**
 * A duration in milliseconds, or `undefined` when it carries no quantity —
 * a bare `label` is unquantified by intent and must not silently become zero.
 */
export function durationMs(duration: StoryDuration | undefined): number | undefined {
  if (duration === undefined) return undefined;
  let total = 0;
  let found = false;
  for (const [unit, ms] of Object.entries(UNIT_MS)) {
    const value = (duration as Record<string, unknown>)[unit];
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value * ms;
      found = true;
    }
  }
  return found ? total : undefined;
}

/** A duration as a reader sees it: "1h 30m", or the writer's own words. */
export function describeDuration(duration: StoryDuration): string {
  const parts: string[] = [];
  const push = (value: number | undefined, suffix: string): void => {
    if (typeof value === "number" && value !== 0) parts.push(`${String(value)}${suffix}`);
  };
  push(duration.years, "y");
  push(duration.weeks, "w");
  push(duration.days, "d");
  push(duration.hours, "h");
  push(duration.minutes, "m");
  if (parts.length === 0) return duration.label ?? "unspecified";
  return duration.label === undefined ? parts.join(" ") : `${parts.join(" ")} (${duration.label})`;
}

/**
 * Where something sits in story-world time.
 *
 * Every variant is optional to use and none is privileged: `ordinal` is as
 * legitimate an answer as `exact`. What matters is that the *kind* is explicit,
 * so a check never mistakes "roughly that summer" for a timestamp.
 */
export type StoryTime =
  | {
      readonly kind: "exact";
      /** ISO 8601 instant, e.g. `1997-08-14T14:00:00Z`. */
      readonly instant: string;
      readonly label?: string;
    }
  | {
      readonly kind: "date";
      /** ISO calendar date, e.g. `1997-08-14`. Covers the whole day. */
      readonly date: string;
      readonly label?: string;
    }
  | {
      readonly kind: "approximate";
      /** Earliest ISO instant or date it could be. */
      readonly earliest?: string;
      /** Latest ISO instant or date it could be. */
      readonly latest?: string;
      /** What the writer actually wrote, e.g. "the summer of the fire". */
      readonly label: string;
    }
  | {
      readonly kind: "relative";
      /** The scene or event this is positioned against. */
      readonly anchorId: string;
      readonly relation: "before" | "after" | "same_time";
      /** How far from the anchor, when known. */
      readonly offset?: StoryDuration;
      readonly label?: string;
    }
  | {
      readonly kind: "ordinal";
      /** The writer's own marker, e.g. "Day 3, evening". */
      readonly label: string;
    }
  | { readonly kind: "unknown"; readonly label?: string };

/**
 * Allen-style relations between two points on the timeline.
 *
 * These are what make a chronology possible without a single date. "The
 * confrontation happens after the funeral" is a complete, checkable statement
 * about the story world; it needs no calendar.
 */
export type TemporalRelation =
  | "before"
  | "after"
  | "during"
  | "overlaps"
  | "same_time"
  /** Ordered, but softly — a hint, not a constraint a check will fail on. */
  | "approximately_before";

export const TEMPORAL_RELATIONS: readonly TemporalRelation[] = [
  "before",
  "after",
  "during",
  "overlaps",
  "same_time",
  "approximately_before",
];

export function isTemporalRelation(value: string): value is TemporalRelation {
  return (TEMPORAL_RELATIONS as readonly string[]).includes(value);
}

/** How a relation reads in a sentence: `A happens before B`. */
export const RELATION_VERBS: Readonly<Record<TemporalRelation, string>> = {
  before: "happens before",
  after: "happens after",
  during: "happens during",
  overlaps: "overlaps",
  same_time: "happens at the same time as",
  approximately_before: "happens roughly before",
};

/**
 * An authored statement that one timeline node stands in some temporal relation
 * to another.
 *
 * Links are canon, not inference: they carry the same `confirmationStatus`
 * discipline as story-state transitions, so a model may *propose* that two
 * scenes are simultaneous without that becoming the story's chronology.
 */
export interface TemporalLink {
  readonly id: string;
  /** Scene or event ID. */
  readonly fromId: string;
  /** Scene or event ID. */
  readonly toId: string;
  readonly relation: TemporalRelation;
  /** A known gap between the two, for `before`/`after`. */
  readonly gap?: StoryDuration;
  readonly note?: string;
  readonly source: "author" | "agent" | "import";
  readonly confirmationStatus: "confirmed" | "proposed" | "rejected";
  readonly modelId?: string;
  readonly createdAt: string;
}

/**
 * A declared minimum travel time between two locations.
 *
 * Deliberately declared rather than inferred. The system does **not** know how
 * long it takes to get from London to Edinburgh, and must not guess: the story
 * may be set in 1840, in 2140, or on a world where the two are a door apart.
 * With nothing declared, no travel violation is ever reported.
 */
export interface TravelRule {
  readonly id: string;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  readonly minimum: StoryDuration;
  /** Whether the same minimum applies in the other direction. Defaults to true. */
  readonly bidirectional?: boolean;
  readonly note?: string;
}

// ── Reading and interpreting ─────────────────────────────────────────────────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * MINUTE;

/** Parse an ISO instant or date. Returns `undefined` for anything unparseable. */
export function parseInstant(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Date.parse(DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * The bounds a story time places on an instant, in epoch milliseconds.
 *
 * A date-only time is a *range*, not a point: `1997-08-14` bounds the whole day,
 * which is precisely why "14:00 in London, 14:05 in Edinburgh" is checkable and
 * "the 14th in London, the 14th in Edinburgh" is not. Kinds that carry no clock
 * — ordinal, unknown, and relative before its anchor is resolved — bound
 * nothing, and that is an answer too.
 */
export interface TimeBounds {
  readonly earliest?: number;
  readonly latest?: number;
}

export function boundsOf(time: StoryTime | undefined): TimeBounds {
  if (time === undefined) return {};
  switch (time.kind) {
    case "exact": {
      const at = parseInstant(time.instant);
      return at === undefined ? {} : { earliest: at, latest: at };
    }
    case "date": {
      const at = parseInstant(time.date);
      return at === undefined ? {} : { earliest: at, latest: at + DAY_MS - 1 };
    }
    case "approximate": {
      const earliest = parseInstant(time.earliest);
      const latest = parseInstant(time.latest);
      // A `latest` given as a bare date means "by the end of that day".
      const latestEnd =
        latest !== undefined && time.latest !== undefined && DATE_ONLY.test(time.latest)
          ? latest + DAY_MS - 1
          : latest;
      return {
        ...(earliest !== undefined ? { earliest } : {}),
        ...(latestEnd !== undefined ? { latest: latestEnd } : {}),
      };
    }
    default:
      return {};
  }
}

/** Whether a story time pins the node to a clock at all. */
export function isAnchored(time: StoryTime | undefined): boolean {
  const bounds = boundsOf(time);
  return bounds.earliest !== undefined || bounds.latest !== undefined;
}

/** A story time as a reader sees it. */
export function describeStoryTime(time: StoryTime | undefined): string {
  if (time === undefined) return "no story time recorded";
  switch (time.kind) {
    case "exact":
      return time.label ?? time.instant;
    case "date":
      return time.label ?? time.date;
    case "approximate":
      return time.label;
    case "relative": {
      const gap = time.offset === undefined ? "" : `${describeDuration(time.offset)} `;
      const relation = time.relation === "same_time" ? "at the same time as" : time.relation;
      return time.label ?? `${gap}${relation} ${time.anchorId}`;
    }
    case "ordinal":
      return time.label;
    case "unknown":
      return time.label ?? "unknown time";
  }
}

/**
 * Interpret whatever is stored as a story time.
 *
 * Events used to carry story time as a free-form string — `"1997"`,
 * `"Day 3, evening"`. That is still a legitimate thing for a writer to write, so
 * it is not discarded and no project is rewritten: a bare string becomes an
 * `ordinal` time whose label is the original text, or a `date`/`exact` time when
 * it plainly is one. Migration by interpretation on read (AGENTS.md).
 */
export function normaliseStoryTime(raw: unknown): StoryTime | undefined {
  if (raw === undefined || raw === null) return undefined;

  if (typeof raw === "string") {
    if (raw.trim() === "") return undefined;
    if (DATE_ONLY.test(raw)) return { kind: "date", date: raw };
    if (parseInstant(raw) !== undefined && raw.includes("T")) {
      return { kind: "exact", instant: raw };
    }
    return { kind: "ordinal", label: raw };
  }

  if (typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  const label = typeof d.label === "string" && d.label !== "" ? d.label : undefined;
  const withLabel = <T extends object>(value: T): T => ({
    ...value,
    ...(label !== undefined ? { label } : {}),
  });

  switch (d.kind) {
    case "exact":
      return typeof d.instant === "string" && parseInstant(d.instant) !== undefined
        ? withLabel({ kind: "exact" as const, instant: d.instant })
        : undefined;
    case "date":
      return typeof d.date === "string" && parseInstant(d.date) !== undefined
        ? withLabel({ kind: "date" as const, date: d.date })
        : undefined;
    case "approximate": {
      const earliest = typeof d.earliest === "string" ? d.earliest : undefined;
      const latest = typeof d.latest === "string" ? d.latest : undefined;
      return {
        kind: "approximate",
        ...(earliest !== undefined ? { earliest } : {}),
        ...(latest !== undefined ? { latest } : {}),
        label: label ?? "approximate",
      };
    }
    case "relative": {
      if (typeof d.anchorId !== "string" || d.anchorId === "") return undefined;
      const relation: "before" | "after" | "same_time" =
        d.relation === "before" || d.relation === "same_time" ? d.relation : "after";
      const offset = normaliseDuration(d.offset);
      return withLabel({
        kind: "relative" as const,
        anchorId: d.anchorId,
        relation,
        ...(offset !== undefined ? { offset } : {}),
      });
    }
    case "ordinal":
      return { kind: "ordinal", label: label ?? "unplaced" };
    case "unknown":
      return withLabel({ kind: "unknown" as const });
    default:
      return undefined;
  }
}

/** Interpret whatever is stored as a duration, dropping non-numeric components. */
export function normaliseDuration(raw: unknown): StoryDuration | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const d = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const unit of Object.keys(UNIT_MS)) {
    const value = d[unit];
    if (typeof value === "number" && Number.isFinite(value)) out[unit] = value;
  }
  if (typeof d.label === "string" && d.label !== "") out.label = d.label;
  return Object.keys(out).length === 0 ? undefined : (out as StoryDuration);
}
