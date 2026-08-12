import type { CharacterStatus, PlotThreadStatus } from "./entities";
import type {
  CharacterId,
  ChapterId,
  FactId,
  LocationId,
  ObjectId,
  PlotThreadId,
  RelationshipId,
  SceneId,
  TestId,
} from "./ids/ids";

/**
 * Story tests: a writer's intentions, written down as assertions the project
 * can check.
 *
 * *Elias must not know the killer's identity before chapter 37* is the kind of
 * thing an author holds in their head for eighteen months and then breaks in a
 * single afternoon's revision. Recording it makes it survive the revision —
 * this is the fiction equivalent of an automated test (MASTER_BUILD.md §15,
 * docs/STORY_TESTS.md).
 */

/**
 * How a test is decided.
 *
 * The separation is the point. A deterministic test is answered from recorded
 * state and is either true or false; a semantic one needs a model's reading and
 * can only ever be a judgement. Collapsing the two would let an opinion be
 * reported as a fact, which is the failure this whole product is built to avoid.
 */
export type TestType = "deterministic" | "semantic";

/** How loudly a failing test should complain. */
export type TestSeverity = "error" | "warning" | "info";
export const TEST_SEVERITIES: readonly TestSeverity[] = ["error", "warning", "info"];

/**
 * Where in the story a test applies.
 *
 * Ranges matter: most narrative intentions are not "always true" but "true
 * until", and a system that could only assert the former would be useless for
 * exactly the promises writers care about most.
 */
export type TestScope =
  /** Every scene in the manuscript. */
  | { readonly kind: "always" }
  /** One scene only. */
  | { readonly kind: "at"; readonly anchorId: SceneId }
  /** Every scene strictly before the anchor. */
  | { readonly kind: "before"; readonly anchorId: SceneId | ChapterId }
  /** Every scene from the anchor onwards. */
  | { readonly kind: "from"; readonly anchorId: SceneId | ChapterId }
  /** Every scene from `anchorId` to `untilId`, inclusive. */
  | {
      readonly kind: "between";
      readonly anchorId: SceneId | ChapterId;
      readonly untilId: SceneId | ChapterId;
    };

export const SCOPE_KINDS: readonly TestScope["kind"][] = [
  "always",
  "at",
  "before",
  "from",
  "between",
];

/**
 * What a deterministic test claims.
 *
 * Every variant is answerable from recorded story state alone — that is the
 * entry requirement. An assertion that needs a model's reading belongs in
 * {@link SemanticAssertion}, and the two are separate unions so the type system
 * refuses to mix them.
 */
export type DeterministicAssertion =
  | {
      readonly kind: "character_knows_fact";
      readonly characterId: CharacterId;
      readonly factId: FactId;
    }
  | {
      readonly kind: "character_does_not_know_fact";
      readonly characterId: CharacterId;
      readonly factId: FactId;
    }
  | { readonly kind: "character_alive"; readonly characterId: CharacterId }
  | { readonly kind: "character_dead"; readonly characterId: CharacterId }
  | {
      readonly kind: "character_at_location";
      readonly characterId: CharacterId;
      readonly locationId: LocationId;
    }
  | {
      readonly kind: "object_at_location";
      readonly objectId: ObjectId;
      readonly locationId: LocationId;
    }
  | {
      readonly kind: "object_owned_by";
      readonly objectId: ObjectId;
      readonly characterId: CharacterId;
    }
  | {
      readonly kind: "plot_thread_status";
      readonly threadId: PlotThreadId;
      readonly status: PlotThreadStatus;
    }
  | { readonly kind: "fact_true"; readonly factId: FactId }
  | {
      readonly kind: "relationship_status";
      readonly relationshipId: RelationshipId;
      readonly status: string;
    };

export const DETERMINISTIC_ASSERTION_KINDS: readonly DeterministicAssertion["kind"][] = [
  "character_knows_fact",
  "character_does_not_know_fact",
  "character_alive",
  "character_dead",
  "character_at_location",
  "object_at_location",
  "object_owned_by",
  "plot_thread_status",
  "fact_true",
  "relationship_status",
];

/**
 * What a semantic test claims.
 *
 * Declared now, evaluated later. These are the assertions a writer most wants —
 * *the romance should feel slow-burn*, *Elias should stay emotionally guarded* —
 * and none of them is decidable from structured state. Recording them without
 * an evaluator is deliberate: the shape exists, tests can be written against it,
 * and the engine reports them as **not evaluated** rather than guessing
 * (docs/STORY_TESTS.md).
 */
export type SemanticAssertion =
  | {
      readonly kind: "reader_suspicion";
      readonly characterId: CharacterId;
      readonly comparison: "below" | "above";
      /** A qualitative level a reader simulation would report. */
      readonly level: string;
    }
  | {
      readonly kind: "relationship_progression";
      readonly relationshipId: RelationshipId;
      /** e.g. "slow-burn", "abrupt", "steady". */
      readonly expected: string;
    }
  | {
      readonly kind: "character_disposition";
      readonly characterId: CharacterId;
      /** e.g. "emotionally guarded". */
      readonly expected: string;
    }
  /** Anything the shapes above do not cover, stated in the writer's words. */
  | { readonly kind: "free_form"; readonly statement: string };

export const SEMANTIC_ASSERTION_KINDS: readonly SemanticAssertion["kind"][] = [
  "reader_suspicion",
  "relationship_progression",
  "character_disposition",
  "free_form",
];

export type Assertion = DeterministicAssertion | SemanticAssertion;

export interface StoryTest {
  readonly id: TestId;
  readonly name: string;
  readonly description: string;
  readonly type: TestType;
  readonly scope: TestScope;
  /** Disabled tests are kept and reported as skipped, never silently dropped. */
  readonly enabled: boolean;
  readonly severity: TestSeverity;
  readonly assertion: Assertion;
  readonly createdAt: string;
}

/** Whether an assertion is one the engine can decide today. */
export function isDeterministicAssertion(
  assertion: Assertion,
): assertion is DeterministicAssertion {
  return (DETERMINISTIC_ASSERTION_KINDS as readonly string[]).includes(assertion.kind);
}

/** Every entity an assertion names — for validation, navigation and deletion safety. */
export function assertionEntities(assertion: Assertion): string[] {
  const out: string[] = [];
  const record = assertion as unknown as Record<string, unknown>;
  for (const key of [
    "characterId",
    "factId",
    "locationId",
    "objectId",
    "threadId",
    "relationshipId",
  ]) {
    const value = record[key];
    if (typeof value === "string" && value !== "") out.push(value);
  }
  return out;
}

// ── Reading a test aloud ─────────────────────────────────────────────────────

const ASSERTION_PHRASES: Readonly<Record<string, (a: Record<string, string>) => string>> = {
  character_knows_fact: (a) => `${a.characterId} knows ${a.factId}`,
  character_does_not_know_fact: (a) => `${a.characterId} does not know ${a.factId}`,
  character_alive: (a) => `${a.characterId} is alive`,
  character_dead: (a) => `${a.characterId} is dead`,
  character_at_location: (a) => `${a.characterId} is at ${a.locationId}`,
  object_at_location: (a) => `${a.objectId} is at ${a.locationId}`,
  object_owned_by: (a) => `${a.objectId} is owned by ${a.characterId}`,
  plot_thread_status: (a) => `${a.threadId} is ${a.status}`,
  fact_true: (a) => `${a.factId} is true`,
  relationship_status: (a) => `${a.relationshipId} is ${a.status}`,
  reader_suspicion: (a) => `the reader suspects ${a.characterId} ${a.comparison} ${a.level}`,
  relationship_progression: (a) => `${a.relationshipId} progresses as ${a.expected}`,
  character_disposition: (a) => `${a.characterId} is ${a.expected}`,
  free_form: (a) => a.statement ?? "",
};

const SCOPE_PHRASES: Readonly<Record<TestScope["kind"], string>> = {
  always: "throughout",
  at: "at",
  before: "before",
  from: "from",
  between: "between",
};

/**
 * A test as a sentence a writer would say.
 *
 * The structured builder shows this back as you fill the form, so what you
 * built is legible before you save it. `label` turns IDs into names when the
 * caller has them; without it the sentence still reads, in IDs.
 */
export function describeTest(
  test: Pick<StoryTest, "assertion" | "scope">,
  label: (id: string) => string = (id) => id,
): string {
  const record = Object.fromEntries(
    Object.entries(test.assertion as unknown as Record<string, unknown>).map(([key, value]) => [
      key,
      typeof value === "string" && key.endsWith("Id") ? label(value) : String(value),
    ]),
  );
  const phrase = ASSERTION_PHRASES[test.assertion.kind]?.(record) ?? test.assertion.kind;

  switch (test.scope.kind) {
    case "always":
      return `${phrase}, throughout`;
    case "between":
      return `${phrase}, between ${label(test.scope.anchorId)} and ${label(test.scope.untilId)}`;
    default:
      return `${phrase}, ${SCOPE_PHRASES[test.scope.kind]} ${label(test.scope.anchorId)}`;
  }
}

/** The default a new test starts from: enabled, and loud enough to notice. */
export const DEFAULT_TEST_SEVERITY: TestSeverity = "error";

/** Character statuses that count as alive for `character_alive`. */
export const ALIVE_STATUSES: readonly CharacterStatus[] = ["active", "inactive"];
