import {
  ALIVE_STATUSES,
  describeTest,
  isDeterministicAssertion,
  orderScenes,
  type Chapter,
  type DeterministicAssertion,
  type Relationship,
  type Scene,
  type StoryTest,
  type TestScope,
  type TestSeverity,
} from "@jellytind/domain";
import type { StoryTimeline } from "@jellytind/story-state";

/**
 * The story-test engine.
 *
 * A test is a writer's intention, held to. Evaluating one means resolving its
 * scope to the scene boundaries it covers and asking the reconstructed state at
 * each of them whether the assertion holds — so *Elias must not know the
 * killer's identity before chapter 37* is checked at every scene up to chapter
 * 37, not merely at one convenient point (docs/STORY_TESTS.md).
 *
 * Only deterministic assertions are decided here. A semantic test is reported
 * as **not evaluated**, never as passing: an unanswered question is not a
 * satisfied one, and a green suite that quietly included unevaluated judgements
 * would be a lie.
 */

export type TestStatus =
  /** The assertion held everywhere its scope covers. */
  | "passed"
  /** It failed somewhere. */
  | "failed"
  /** The test is disabled. */
  | "skipped"
  /** Semantic: no evaluator exists yet. */
  | "not_evaluated"
  /** The scope or the assertion could not be resolved against this project. */
  | "errored";

/** One place a test did not hold. */
export interface TestFailure {
  readonly sceneId: string;
  readonly chapterId?: string;
  /** What the test asked for, in words. */
  readonly expected: string;
  /** What the project actually records there. */
  readonly actual: string;
  /** The recorded data behind `actual`. */
  readonly evidence: string;
  readonly entities: readonly string[];
}

export interface TestResult {
  readonly testId: string;
  readonly name: string;
  readonly type: StoryTest["type"];
  readonly severity: TestSeverity;
  readonly status: TestStatus;
  /** The test as a sentence, for a report a writer reads. */
  readonly statement: string;
  /** Scene boundaries the scope resolved to. */
  readonly checkedScenes: readonly string[];
  readonly failures: readonly TestFailure[];
  /** Why it was skipped, not evaluated, or errored. */
  readonly reason?: string;
}

export interface TestRunSummary {
  readonly deterministic: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
  };
  readonly semantic: { readonly total: number; readonly notEvaluated: number };
  readonly skipped: number;
  readonly errored: number;
  readonly results: readonly TestResult[];
}

export interface TestRunInput {
  readonly tests: readonly StoryTest[];
  readonly timeline: StoryTimeline;
  readonly scenes: readonly Scene[];
  readonly chapters: readonly Chapter[];
  readonly relationships: readonly Relationship[];
}

/** Run every test and summarise the run. */
export function runStoryTests(input: TestRunInput): TestRunSummary {
  const results = input.tests.map((test) => runStoryTest(test, input));

  const deterministic = results.filter((r) => r.type === "deterministic" && r.status !== "skipped");
  const semantic = results.filter((r) => r.type === "semantic" && r.status !== "skipped");

  return {
    deterministic: {
      total: deterministic.length,
      passed: deterministic.filter((r) => r.status === "passed").length,
      failed: deterministic.filter((r) => r.status === "failed").length,
    },
    semantic: {
      total: semantic.length,
      notEvaluated: semantic.filter((r) => r.status === "not_evaluated").length,
    },
    skipped: results.filter((r) => r.status === "skipped").length,
    errored: results.filter((r) => r.status === "errored").length,
    results,
  };
}

/** Run one test. */
export function runStoryTest(test: StoryTest, input: TestRunInput): TestResult {
  const statement = describeTest(test);
  const base = {
    testId: test.id as string,
    name: test.name,
    type: test.type,
    severity: test.severity,
    statement,
  };

  if (!test.enabled) {
    return {
      ...base,
      status: "skipped",
      checkedScenes: [],
      failures: [],
      reason: "disabled",
    };
  }

  if (!isDeterministicAssertion(test.assertion)) {
    // Deliberately not "passed". Nothing has answered this question.
    return {
      ...base,
      status: "not_evaluated",
      checkedScenes: [],
      failures: [],
      reason: "semantic tests need model judgement, which is not yet implemented",
    };
  }

  let scenes: string[];
  try {
    scenes = resolveScope(test.scope, input);
  } catch (cause) {
    return {
      ...base,
      status: "errored",
      checkedScenes: [],
      failures: [],
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }

  if (scenes.length === 0) {
    return {
      ...base,
      status: "errored",
      checkedScenes: [],
      failures: [],
      reason: "the scope covers no scenes in this project",
    };
  }

  const chapterOf = new Map(
    input.scenes.map((scene) => [scene.id as string, scene.chapterId as string | undefined]),
  );
  const failures: TestFailure[] = [];

  for (const sceneId of scenes) {
    const outcome = evaluate(test.assertion, sceneId, input);
    if (outcome.held) continue;
    const chapterId = chapterOf.get(sceneId);
    failures.push({
      sceneId,
      ...(chapterId !== undefined ? { chapterId } : {}),
      expected: outcome.expected,
      actual: outcome.actual,
      evidence: outcome.evidence,
      entities: outcome.entities,
    });
  }

  return {
    ...base,
    status: failures.length === 0 ? "passed" : "failed",
    checkedScenes: scenes,
    failures,
  };
}

// ── Scope ────────────────────────────────────────────────────────────────────

export class ScopeError extends Error {}

/**
 * The scenes a scope covers, in story order.
 *
 * A chapter anchor resolves to the chapter's first scene, so "before chapter
 * 37" means "before chapter 37 begins" — which is what a writer means when they
 * say it.
 */
export function resolveScope(scope: TestScope, input: TestRunInput): string[] {
  const order = orderScenes(input.scenes, input.chapters).map((s) => s.id as string);
  if (scope.kind === "always") return order;

  const anchor = anchorIndex(scope.anchorId, order, input);
  switch (scope.kind) {
    case "at":
      return [order[anchor] as string];
    case "before":
      return order.slice(0, anchor);
    case "from":
      return order.slice(anchor);
    case "between": {
      const until = anchorIndex(scope.untilId, order, input, true);
      if (until < anchor) {
        throw new ScopeError(
          `The range ends at ${scope.untilId}, which comes before it starts at ${scope.anchorId}.`,
        );
      }
      return order.slice(anchor, until + 1);
    }
  }
}

/**
 * Where an anchor sits in story order.
 *
 * `last` picks a chapter's final scene rather than its first, so a range that
 * ends at a chapter covers the whole of it.
 */
function anchorIndex(
  anchorId: string,
  order: readonly string[],
  input: TestRunInput,
  last = false,
): number {
  const direct = order.indexOf(anchorId);
  if (direct !== -1) return direct;

  const inChapter = order.filter(
    (sceneId) => input.scenes.find((s) => s.id === sceneId)?.chapterId === anchorId,
  );
  const pick = last ? inChapter.at(-1) : inChapter[0];
  if (pick === undefined) {
    throw new ScopeError(`${anchorId} is not a scene or a chapter with scenes in this project.`);
  }
  return order.indexOf(pick);
}

// ── Assertions ───────────────────────────────────────────────────────────────

interface Outcome {
  readonly held: boolean;
  readonly expected: string;
  readonly actual: string;
  readonly evidence: string;
  readonly entities: readonly string[];
}

/**
 * Decide one assertion at one scene.
 *
 * Boundaries are `after`: an assertion is checked against the world as it stands
 * once the scene has happened, which is what "true at this point in the story"
 * means to a reader who has just finished it.
 */
function evaluate(
  assertion: DeterministicAssertion,
  sceneId: string,
  input: TestRunInput,
): Outcome {
  const { timeline } = input;
  const asOf = { sceneId, position: "after" } as const;
  const at = `after ${sceneId}`;

  switch (assertion.kind) {
    case "character_knows_fact":
    case "character_does_not_know_fact": {
      const characterId = assertion.characterId as string;
      const factId = assertion.factId as string;
      const record = timeline.knows(characterId, factId, asOf);
      const holds = record !== null && (record.state === "known" || record.state === "believed");
      const wantsKnown = assertion.kind === "character_knows_fact";
      return {
        held: holds === wantsKnown,
        expected: `${characterId} ${wantsKnown ? "knows" : "does not know"} ${factId} ${at}`,
        actual:
          record === null
            ? `${characterId} has no recorded position on ${factId}`
            : `${characterId} ${record.state} ${factId}`,
        evidence:
          record === null
            ? "No knowledge transition gives them a position on it up to this point."
            : `Acquired in ${record.acquiredAtSceneId ?? "an unrecorded scene"} (${record.sourceType}${
                record.sourceEntityId === undefined ? "" : ` by ${record.sourceEntityId}`
              }).`,
        entities: [characterId, factId],
      };
    }

    case "character_alive":
    case "character_dead": {
      const characterId = assertion.characterId as string;
      const state = timeline.characterStateAt(characterId, asOf);
      const alive = (ALIVE_STATUSES as readonly string[]).includes(state.status);
      const wantsAlive = assertion.kind === "character_alive";
      return {
        held: alive === wantsAlive,
        expected: `${characterId} is ${wantsAlive ? "alive" : "dead"} ${at}`,
        actual: `${characterId} is ${state.status}`,
        evidence: "Reconstructed from character_status transitions up to this point.",
        entities: [characterId],
      };
    }

    case "character_at_location": {
      const characterId = assertion.characterId as string;
      const locationId = assertion.locationId as string;
      const state = timeline.characterStateAt(characterId, asOf);
      return {
        held: state.locationId === locationId,
        expected: `${characterId} is at ${locationId} ${at}`,
        actual:
          state.locationId === undefined
            ? `${characterId} is ${state.presence === "present" ? "nowhere recorded" : state.presence}`
            : `${characterId} is at ${state.locationId}`,
        evidence: `Presence: ${state.presence}; last recorded location ${state.lastKnownLocationId ?? "none"}.`,
        entities: [characterId, locationId],
      };
    }

    case "object_at_location": {
      const objectId = assertion.objectId as string;
      const locationId = assertion.locationId as string;
      const where = timeline.objectLocationAt(objectId, asOf);
      const state = timeline.objectStateAt(objectId, asOf);
      return {
        held: where === locationId,
        expected: `${objectId} is at ${locationId} ${at}`,
        actual:
          where === undefined ? `${objectId} is nowhere recorded` : `${objectId} is at ${where}`,
        evidence:
          state.placement === "held"
            ? `Carried by ${state.holderId ?? "someone"}, so it is wherever they are.`
            : `Last put down at ${state.locationId ?? "nowhere recorded"}; status ${state.status}.`,
        entities: [objectId, locationId],
      };
    }

    case "object_owned_by": {
      const objectId = assertion.objectId as string;
      const characterId = assertion.characterId as string;
      const state = timeline.objectStateAt(objectId, asOf);
      return {
        held: state.ownerId === characterId,
        expected: `${objectId} is owned by ${characterId} ${at}`,
        actual: `${objectId} is owned by ${state.ownerId ?? "nobody"}`,
        // Ownership and possession are different questions; say which this is.
        evidence: `Held by ${state.holderId ?? "nobody"}. Ownership survives theft and lending.`,
        entities: [objectId, characterId],
      };
    }

    case "plot_thread_status": {
      const threadId = assertion.threadId as string;
      const state = timeline.threadStateAt({ id: threadId }, asOf);
      return {
        held: state.status === assertion.status,
        expected: `${threadId} is ${assertion.status} ${at}`,
        actual: `${threadId} is ${state.status}`,
        evidence: `Appearances up to this point: ${
          state.appearanceSceneIds.length === 0 ? "none" : state.appearanceSceneIds.join(", ")
        }.`,
        entities: [threadId],
      };
    }

    case "fact_true": {
      const factId = assertion.factId as string;
      const established = timeline.establishedFactsAt(asOf);
      return {
        held: established.includes(factId),
        expected: `${factId} is true in the story world ${at}`,
        actual: established.includes(factId)
          ? `${factId} is established`
          : `${factId} is not yet established`,
        evidence: "Reconstructed from fact_established transitions up to this point.",
        entities: [factId],
      };
    }

    case "relationship_status": {
      const relationshipId = assertion.relationshipId as string;
      const identity = input.relationships.find((r) => r.id === relationshipId);
      if (identity === undefined) {
        return {
          held: false,
          expected: `${relationshipId} is "${assertion.status}" ${at}`,
          actual: `${relationshipId} does not exist in this project`,
          evidence: "The test names a relationship the project does not have.",
          entities: [relationshipId],
        };
      }
      const state = timeline.relationshipStateAt(identity, asOf);
      return {
        held: state.status === assertion.status,
        expected: `${relationshipId} is "${assertion.status}" ${at}`,
        actual: `${relationshipId} is "${state.status}"`,
        evidence: `Type ${state.type}; ${String(state.events.length)} milestone(s) recorded.`,
        entities: [relationshipId, state.characterAId, state.characterBId],
      };
    }
  }
}

/**
 * The line a build report shows for the deterministic suite.
 *
 * Semantic tests are counted separately and never folded into this number.
 */
export function describeTestRun(summary: TestRunSummary): string {
  const { deterministic } = summary;
  return `${String(deterministic.passed)} / ${String(deterministic.total)} passed`;
}
