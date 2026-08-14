import type { ChapterId } from "./ids/ids";
import type { TestScope } from "./story-tests";
import type { FactConstraint, PlanStatus, PlannedKnowledgeState } from "./planning";

/**
 * Act planning: goals that span chapters (Phase 33).
 *
 * An act is not an entity in the closed ID registry — it is **named by the
 * chapters that make it up**, the shape the thread queries already committed to
 * (`getThreadsIntroducedInAct`). The act plan *is* the act: an ordered list of
 * chapters, plus the goals the act exists to reach — "by the end of Act II,
 * Elias fully distrusts Mara; the cellar key pays off; the reader still does
 * not know the killer".
 *
 * The same three properties as chapter plans (Phase 32) hold here:
 *
 * - **A plan is a proposal.** Nothing builds from a draft; approval pins a
 *   version, and approval is the writer's alone.
 * - **Progressive structure.** Chapters and a title make a complete act plan.
 *   Goals, roles, pacing and constraints are for the writers who want them.
 * - **Versioned in place**, bounded snapshots, journaled like any project file.
 */

/**
 * Descriptive vocabulary for a chapter's job inside its act (§2).
 *
 * Deliberately **not** an enum on the field: these are planning concepts, not a
 * structural theory Manu enforces. The field is free text; this list feeds
 * suggestions in the UI and nothing else.
 */
export const CHAPTER_ROLE_SUGGESTIONS = [
  "setup",
  "escalation",
  "reversal",
  "aftermath",
  "revelation",
  "pressure",
  "midpoint",
  "collapse",
  "climax",
  "transition",
] as const;

/** One chapter's membership in the act, in act order. */
export interface ActChapter {
  readonly chapterId: string;
  /** The chapter's job inside the act, in the writer's words ("reversal"). */
  readonly role?: string;
  readonly note?: string;
}

/**
 * A goal about a plot thread, spanning the act.
 *
 * `intent` is always the author's words. The optional fields are deterministic
 * hooks: when present, act progress can answer them from recorded state alone —
 * "advances twice" is a count of act scenes touching the thread; a target
 * status is the thread's state at the act's closing boundary.
 */
export interface ActThreadGoal {
  readonly threadId: string;
  readonly intent: string;
  /** The thread's status by act end, when the writer pins one ("resolved"). */
  readonly targetStatus?: string;
  /** Minimum number of act scenes that must touch the thread. */
  readonly minAdvances?: number;
}

/**
 * A goal about a character's movement across the act.
 *
 * With `factId` + `target` the goal is deterministic — "Mara knows FACT_X by
 * act end" is a knowledge-graph question. Without them it is the author's
 * intent, tracked but never machine-judged.
 */
export interface ActArcGoal {
  readonly characterId: string;
  readonly movement: string;
  readonly factId?: string;
  readonly target?: PlannedKnowledgeState;
}

/**
 * A goal about how two characters stand to each other by act end.
 *
 * `dimension` + `direction` make it deterministic when the project tracks that
 * dimension: "trust falls" compares the recorded value entering the act with
 * the value leaving it. The strings are the story-state vocabulary
 * (dimension names, qualitative levels); domain sits below story-state, so
 * they are plain strings here and resolved above.
 */
export interface ActRelationshipGoal {
  readonly relationshipId: string;
  readonly intent: string;
  readonly dimension?: string;
  readonly direction?: "rises" | "falls";
}

/** A bounded snapshot of an earlier act-plan version. */
export interface ActPlanRevision {
  readonly version: number;
  readonly savedAt: string;
  readonly note?: string;
  readonly objective?: string;
  readonly chapters: readonly ActChapter[];
}

export interface ActPlan {
  readonly id: string;
  /** The act's stable key, minted by the store (`ACT_0001`). Not an entity ID. */
  readonly actId: string;
  /** Writer-facing name: "Act II". */
  readonly title: string;
  readonly version: number;
  readonly status: PlanStatus;
  /** The version that was approved, when one was. Act builds pin to this. */
  readonly approvedVersion?: number;
  /** What the act is for, in the author's words. */
  readonly objective?: string;
  /** Its dramatic job in the whole book ("everything gets worse"). */
  readonly dramaticFunction?: string;
  /** Where things stand entering the act, in the author's words. */
  readonly openingState?: string;
  /** Where things must stand leaving it. */
  readonly targetClosingState?: string;
  /** The chapters, in act order. This list defines the act. */
  readonly chapters: readonly ActChapter[];
  readonly plotThreadGoals: readonly ActThreadGoal[];
  readonly characterArcGoals: readonly ActArcGoal[];
  readonly relationshipGoals: readonly ActRelationshipGoal[];
  /** Setups that must be planted within this act (SETUP_ ids). */
  readonly requiredSetupIds: readonly string[];
  /** Setups that must pay off within this act (SETUP_ ids). */
  readonly requiredPayoffIds: readonly string[];
  /**
   * Knowledge that must stay withheld through the act — "the reader should
   * still not know the killer's identity" is a forbidden fact with no
   * character named. Checked deterministically at the act's closing boundary.
   */
  readonly forbiddenFacts: readonly FactConstraint[];
  readonly pacingIntent?: string;
  readonly escalationIntent?: string;
  /** Free-form constraints the whole act must hold to. */
  readonly constraints: readonly string[];
  readonly notes: readonly string[];
  /** Story tests the writer tied to this act, beyond scope-derived relevance. */
  readonly storyTestIds: readonly string[];
  readonly source: "author" | "model" | "mixed";
  readonly modelId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revisions: readonly ActPlanRevision[];
}

/** An empty act plan for manual planning. Everything beyond identity is optional. */
export function emptyActPlan(
  actId: string,
  title: string,
): Omit<ActPlan, "version" | "revisions" | "createdAt" | "updatedAt"> {
  return {
    id: `PLANFOR_${actId}`,
    actId,
    title,
    status: "draft",
    chapters: [],
    plotThreadGoals: [],
    characterArcGoals: [],
    relationshipGoals: [],
    requiredSetupIds: [],
    requiredPayoffIds: [],
    forbiddenFacts: [],
    constraints: [],
    notes: [],
    storyTestIds: [],
    source: "author",
  };
}

// ── Act plan validation ─────────────────────────────────────────────────────

export interface ActPlanFinding {
  readonly severity: "error" | "warning" | "info";
  readonly code:
    | "empty_act"
    | "unknown_chapter"
    | "duplicate_chapter"
    | "chapter_out_of_order"
    | "chapter_without_scenes"
    | "unknown_reference"
    | "payoff_without_setup";
  readonly message: string;
  /** The act chapter the finding is about, when it is about one. */
  readonly chapterId?: string;
}

// ── Act goal evaluation (§3, §8) ────────────────────────────────────────────

/**
 * One goal's standing.
 *
 * `method` is the honesty marker: `deterministic` results are read from
 * recorded state and are facts about the record; `semantic` goals are the
 * author's intent in prose, and the engine reports them `not_evaluated` with
 * whatever deterministic evidence exists — it never guesses a judgement
 * (AGENTS.md — measurement is not judgement).
 */
export interface ActGoalResult {
  readonly kind: "thread" | "arc" | "relationship" | "setup" | "payoff" | "forbidden_fact";
  /** The entity the goal is about. */
  readonly refId: string;
  /** The goal as a sentence. */
  readonly statement: string;
  readonly status: "satisfied" | "unsatisfied" | "not_evaluated";
  readonly method: "deterministic" | "semantic";
  /** What the record shows, in plain words. */
  readonly evidence: string;
}

export interface ActGoalReport {
  readonly evaluatedAt: string;
  /** The closing boundary the state questions were asked at, when one existed. */
  readonly boundarySceneId?: string;
  readonly results: readonly ActGoalResult[];
  readonly satisfied: number;
  readonly unsatisfied: number;
  readonly notEvaluated: number;
}

export function summariseGoalReport(
  results: readonly ActGoalResult[],
  evaluatedAt: string,
  boundarySceneId?: string,
): ActGoalReport {
  return {
    evaluatedAt,
    ...(boundarySceneId !== undefined ? { boundarySceneId } : {}),
    results,
    satisfied: results.filter((r) => r.status === "satisfied").length,
    unsatisfied: results.filter((r) => r.status === "unsatisfied").length,
    notEvaluated: results.filter((r) => r.status === "not_evaluated").length,
  };
}

// ── Act-scoped story tests (§9) ─────────────────────────────────────────────

/**
 * The scope an act-wide story test wants: every scene from the act's first
 * chapter to its last, inclusive — riding the existing scope machinery rather
 * than a new scope kind.
 */
export function actTestScope(chapterIds: readonly string[]): TestScope | null {
  const first = chapterIds[0];
  const last = chapterIds[chapterIds.length - 1];
  if (first === undefined || last === undefined) return null;
  return { kind: "between", anchorId: first as ChapterId, untilId: last as ChapterId };
}

/**
 * Whether a story test is relevant to an act: explicitly tied to it, or its
 * scope anchors name one of the act's chapters or scenes. Deterministic; used
 * to report the act-relevant slice of a full test run, never to skip tests.
 */
export function testAppliesToAct(
  test: { readonly id: string; readonly scope: TestScope },
  act: {
    readonly chapterIds: ReadonlySet<string>;
    readonly sceneIds: ReadonlySet<string>;
    readonly storyTestIds: readonly string[];
  },
): boolean {
  if (act.storyTestIds.includes(test.id)) return true;
  const anchors: string[] = [];
  if (test.scope.kind !== "always") anchors.push(test.scope.anchorId as string);
  if (test.scope.kind === "between") anchors.push(test.scope.untilId as string);
  return anchors.some((anchor) => act.chapterIds.has(anchor) || act.sceneIds.has(anchor));
}

// ── Version comparison ──────────────────────────────────────────────────────

export interface ActPlanComparison {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly addedChapters: readonly string[];
  readonly removedChapters: readonly string[];
  readonly reordered: boolean;
  readonly objectiveChanged: boolean;
  readonly roleChanges: readonly { chapterId: string; from?: string; to?: string }[];
}

/** Compare two act-plan versions structurally, in plain terms. */
export function compareActPlanVersions(
  from: { version: number; objective?: string; chapters: readonly ActChapter[] },
  to: { version: number; objective?: string; chapters: readonly ActChapter[] },
): ActPlanComparison {
  const fromIds = from.chapters.map((c) => c.chapterId);
  const toIds = to.chapters.map((c) => c.chapterId);
  const fromSet = new Set(fromIds);
  const toSet = new Set(toIds);
  const shared = toIds.filter((id) => fromSet.has(id));
  const sharedInFromOrder = fromIds.filter((id) => toSet.has(id));
  const fromRoles = new Map(from.chapters.map((c) => [c.chapterId, c.role]));
  const roleChanges: { chapterId: string; from?: string; to?: string }[] = [];
  for (const chapter of to.chapters) {
    if (!fromSet.has(chapter.chapterId)) continue;
    const before = fromRoles.get(chapter.chapterId);
    if (before !== chapter.role) {
      roleChanges.push({
        chapterId: chapter.chapterId,
        ...(before !== undefined ? { from: before } : {}),
        ...(chapter.role !== undefined ? { to: chapter.role } : {}),
      });
    }
  }
  return {
    fromVersion: from.version,
    toVersion: to.version,
    addedChapters: toIds.filter((id) => !fromSet.has(id)),
    removedChapters: fromIds.filter((id) => !toSet.has(id)),
    reordered: shared.join(" ") !== sharedInFromOrder.join(" "),
    objectiveChanged: (from.objective ?? "") !== (to.objective ?? ""),
    roleChanges,
  };
}
